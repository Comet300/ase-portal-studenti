import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { recordAccess } from '../../lib/audit'
import { postEvent } from '../../lib/chat'
import { queryOne, transaction } from '../../lib/db'
import { formAction } from '../../lib/forms'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'
import {
  sendChangeApplied,
  sendChangeDecided,
  sendChangeRequested,
  sendChangeWithdrawn,
} from '../../lib/mail-title-changes'
import {
  describeChanges,
  normalizeThesis,
  thesisDiff,
  validateThesis,
  type ThesisFields,
} from '../../lib/title-changes.ts'

/**
 * Changing the title, the English title or the objectives of an agreed thesis.
 *
 * The agreed thesis is the `requests` row with `status = 'approved'`; there is
 * no separate supervision record. The row stays `approved` through the whole of
 * this flow — roughly fifteen statements elsewhere filter on that value, and a
 * student in the middle of a change must not lose their seat, their write
 * access to the thread and their printable document while the coordinator
 * thinks about it. What is pending lives in `title_changes` instead.
 *
 * Two directions, deliberately not symmetrical: the student asks and the
 * coordinator decides; the coordinator edits and the student is told. Both are
 * written into the same table, so the history of the thesis is one list.
 *
 * A defended thesis is refused. Every statement carries `r.status = 'approved'`,
 * and `defended` does not match it: the archive computes live from
 * `requests.title_ro`, so a change entered in September would silently rewrite
 * the public record of a June session — for the student, for the coordinator
 * and for anyone reading the faculty's archive.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const redirectTo = String(form.get('redirect') ?? (isTeacher(u) ? '/profesor/studenti' : '/lucrarea-mea'))
  const baseUrl = process.env.APP_BASE_URL ?? url.origin

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  /* --- the student asks ---------------------------------------------------- */
  if (action === 'cere') {
    if (u.role !== 'student') return sessionExpired()

    const requestId = formId(form.get('cerere_id'))
    const reason = String(form.get('motiv') ?? '').trim()
    const proposed = normalizeThesis({
      title_ro: form.get('titlu_ro'),
      title_en: form.get('titlu_en'),
      objectives: form.get('scop_obiective'),
    })

    const invalid = validateThesis(proposed)
    if (invalid) return back(invalid, true)

    // The current text is read with the ownership condition on it, so a request
    // id from a form buys nothing, and so the diff is against what is really
    // stored rather than against what the page was rendered from.
    const current = await queryOne<
      ThesisFields & { id: string; number: string; teacher_id: string; teacher_name: string; teacher_email: string }
    >(
      `SELECT r.id, r.number, r.title_ro, r.title_en, r.objectives,
              t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email
         FROM requests r
         JOIN users t ON t.id = r.teacher_id
        WHERE r.id = $2 AND r.student_id = $1 AND r.status = 'approved'`,
      [u.id, requestId],
    )

    if (!current) {
      return back(
        'Lucrarea nu poate fi modificată: fie nu este a ta, fie coordonarea nu mai este activă. Deschide „Cererile mele” și reia de acolo.',
        true,
      )
    }

    const changes = thesisDiff(current, proposed)
    if (changes.length === 0) {
      return back('Nu ai schimbat nimic. Modifică titlul sau obiectivele înainte de a trimite.', true)
    }

    /* The snapshot is copied from the request inside the INSERT, so it cannot
     * be a stale value carried through the form. */
    let created: { id: string } | null = null
    try {
      created = await queryOne<{ id: string }>(
        `INSERT INTO title_changes (request_id, requested_by,
                                    old_title_ro, old_title_en, old_objectives,
                                    new_title_ro, new_title_en, new_objectives, reason)
         SELECT r.id, $1, r.title_ro, r.title_en, r.objectives, $3, $4, $5, NULLIF($6, '')
           FROM requests r
          WHERE r.id = $2 AND r.student_id = $1 AND r.status = 'approved'
         RETURNING id`,
        [u.id, requestId, proposed.title_ro, proposed.title_en, proposed.objectives, reason],
      )
    } catch {
      /* The partial unique index. Two open changes on one thesis are not a
       * queue: they are two edits of the same three columns, and deciding the
       * second would silently undo the first. */
      return back(
        'Ai deja o cerere de modificare în așteptare. Retrage-o din „Cererile mele” dacă vrei să ceri altceva.',
        true,
      )
    }

    if (!created) return back('Lucrarea nu a fost găsită.', true)

    /* `recentEvents` filters `sender_id <> reader`, so attributing the event to
     * the student is what puts it in the coordinator's bell and not in their
     * own. Reversed, nobody is notified and nothing errors. */
    await postEvent({
      studentId: u.id,
      teacherId: current.teacher_id,
      senderId: u.id,
      eventType: 'change_requested',
      body: `${u.name} cere să schimbe ${describeChanges(changes)} la lucrarea ${current.number}.${reason ? `\n\n${reason}` : ''}`,
      subjectKind: 'change',
      subjectId: created.id,
    })

    await sendChangeRequested({
      to: current.teacher_email,
      teacherName: current.teacher_name,
      studentName: u.name,
      requestNumber: current.number,
      changes,
      reason: reason || null,
      baseUrl,
    })

    return back('Cererea de modificare a plecat la coordonator. Lucrarea rămâne neschimbată până răspunde.')
  }

  /* --- the student takes it back ------------------------------------------- */
  if (action === 'retrage') {
    if (u.role !== 'student') return sessionExpired()

    const changeId = formId(form.get('modificare_id'))
    const withdrawn = await queryOne<{
      id: string
      number: string
      teacher_id: string
      teacher_name: string
      teacher_email: string
    }>(
      `UPDATE title_changes tc
          SET status = 'withdrawn', decided_at = now()
         FROM requests r, users t
        WHERE tc.id = $2 AND tc.status = 'pending'
          AND r.id = tc.request_id AND r.student_id = $1
          AND t.id = r.teacher_id
       RETURNING tc.id, r.number, t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email`,
      [u.id, changeId],
    )

    if (!withdrawn) return back('Cererea de modificare nu mai poate fi retrasă.', true)

    await sendChangeWithdrawn({
      to: withdrawn.teacher_email,
      teacherName: withdrawn.teacher_name,
      studentName: u.name,
      requestNumber: withdrawn.number,
      baseUrl,
    })

    return back('Cererea de modificare a fost retrasă.')
  }

  /* --- the coordinator decides --------------------------------------------- */
  if (action === 'decizie') {
    if (!isTeacher(u)) return sessionExpired()

    const changeId = formId(form.get('modificare_id'))
    const decision = String(form.get('decizie') ?? '')
    const note = String(form.get('motiv') ?? '').trim()

    if (decision !== 'approved' && decision !== 'rejected') {
      return deadEnd(
        400,
        'Decizie neînțeleasă',
        'Decizia trimisă nu este una dintre cele posibile. Reia din lista de modificări.',
      )
    }

    if (decision === 'rejected' && note.length < 10) {
      return back('Motivul respingerii este obligatoriu (minimum 10 caractere).', true)
    }

    /* Deciding and applying move together, or not at all: an approved change
     * whose title was never written is the discrepancy nobody notices until the
     * archive and the portal disagree in front of a commission. */
    const outcome = await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string
        request_id: string
        student_id: string
        student_name: string
        student_email: string
        number: string
        old_title_ro: string
        old_title_en: string | null
        old_objectives: string
        new_title_ro: string
        new_title_en: string | null
        new_objectives: string
        live_title_ro: string
        live_title_en: string | null
        live_objectives: string
      }>(
        `UPDATE title_changes tc
            SET status = $3, decision_note = NULLIF($4, ''), decided_by = $1, decided_at = now()
           FROM requests r, users s
          WHERE tc.id = $2 AND tc.status = 'pending'
            AND r.id = tc.request_id AND r.teacher_id = $1 AND r.status = 'approved'
            AND s.id = r.student_id
         RETURNING tc.id, tc.request_id,
                   tc.old_title_ro, tc.old_title_en, tc.old_objectives,
                   tc.new_title_ro, tc.new_title_en, tc.new_objectives,
                   r.number, r.title_ro AS live_title_ro, r.title_en AS live_title_en,
                   r.objectives AS live_objectives,
                   s.id AS student_id, s.name AS student_name, s.email AS student_email`,
        [u.id, changeId, decision, note],
      )

      const tc = rows[0]
      if (!tc) return null

      if (decision === 'approved') {
        /* The snapshot was taken when the student wrote the request. If the
         * coordinator has edited the thesis themselves since, approving would
         * silently revert their own edit — so the two are compared and the
         * whole transaction is abandoned instead. */
        const drifted =
          tc.live_title_ro !== tc.old_title_ro ||
          (tc.live_title_en ?? '') !== (tc.old_title_en ?? '') ||
          tc.live_objectives !== tc.old_objectives

        if (drifted) throw new Error('drift')

        await client.query(
          `UPDATE requests
              SET title_ro = $2, title_en = $3, objectives = $4, updated_at = now()
            WHERE id = $1 AND status = 'approved'`,
          [tc.request_id, tc.new_title_ro, tc.new_title_en, tc.new_objectives],
        )
      }

      return tc
    }).catch((err: unknown) => (err instanceof Error && err.message === 'drift' ? 'drift' : Promise.reject(err)))

    if (outcome === 'drift') {
      return back(
        'Lucrarea s-a schimbat între timp, așa că cererea nu mai poate fi aplicată peste ea. Deschide-o din nou și decide pe textul actual.',
        true,
      )
    }

    if (!outcome) return back('Cererea de modificare nu mai poate fi decisă.', true)

    const approved = decision === 'approved'
    const changes = thesisDiff(
      {
        title_ro: outcome.old_title_ro,
        title_en: outcome.old_title_en,
        objectives: outcome.old_objectives,
      },
      {
        title_ro: outcome.new_title_ro,
        title_en: outcome.new_title_en,
        objectives: outcome.new_objectives,
      },
    )

    await postEvent({
      studentId: outcome.student_id,
      teacherId: u.id,
      senderId: u.id,
      eventType: approved ? 'change_approved' : 'change_rejected',
      body: approved
        ? `Modificarea la lucrarea ${outcome.number} a fost acceptată: ${describeChanges(changes)}.${note ? `\n\n${note}` : ''}`
        : `Modificarea la lucrarea ${outcome.number} a fost respinsă.\n\n${note}`,
      subjectKind: 'change',
      subjectId: outcome.id,
    })

    await sendChangeDecided({
      to: outcome.student_email,
      studentName: outcome.student_name,
      teacherName: u.name,
      requestNumber: outcome.number,
      approved,
      changes,
      note: note || null,
      baseUrl,
    })

    if (approved) {
      await recordAccess({
        userId: u.id,
        action: 'schimba_titlu',
        subject: outcome.request_id,
        request,
      })
    }

    return back(
      approved
        ? 'Modificarea a fost aplicată. Titlul nou apare peste tot, iar studentul a fost anunțat.'
        : 'Modificarea a fost respinsă. Studentul a primit motivul pe email și în conversație.',
    )
  }

  /* --- the coordinator edits it themselves --------------------------------- */
  if (action === 'aplica') {
    if (!isTeacher(u)) return sessionExpired()

    const requestId = formId(form.get('cerere_id'))
    const reason = String(form.get('motiv') ?? '').trim()
    const proposed = normalizeThesis({
      title_ro: form.get('titlu_ro'),
      title_en: form.get('titlu_en'),
      objectives: form.get('scop_obiective'),
    })

    const invalid = validateThesis(proposed)
    if (invalid) return back(invalid, true)

    /* Written as an approved row in the same table, not as a bare UPDATE: a
     * coordinator's edit is part of the history of the thesis, and „de ce se
     * numește altfel decât în cererea pe care am semnat-o” has to have an
     * answer on the screen. */
    const applied = await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string
        number: string
        student_id: string
        student_name: string
        student_email: string
        title_ro: string
        title_en: string | null
        objectives: string
      }>(
        `SELECT r.id, r.number, r.title_ro, r.title_en, r.objectives,
                s.id AS student_id, s.name AS student_name, s.email AS student_email
           FROM requests r
           JOIN users s ON s.id = r.student_id
          WHERE r.id = $2 AND r.teacher_id = $1 AND r.status = 'approved'
          FOR UPDATE OF r`,
        [u.id, requestId],
      )

      const r = rows[0]
      if (!r) return null

      const changes = thesisDiff(r, proposed)
      if (changes.length === 0) return 'unchanged' as const

      const written = await client.query<{ id: string }>(
        `INSERT INTO title_changes (request_id, requested_by,
                                    old_title_ro, old_title_en, old_objectives,
                                    new_title_ro, new_title_en, new_objectives,
                                    reason, status, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), 'approved', $2, now())
         RETURNING id`,
        [
          r.id,
          u.id,
          r.title_ro,
          r.title_en,
          r.objectives,
          proposed.title_ro,
          proposed.title_en,
          proposed.objectives,
          reason,
        ],
      )

      await client.query(
        `UPDATE requests
            SET title_ro = $2, title_en = $3, objectives = $4, updated_at = now()
          WHERE id = $1 AND status = 'approved'`,
        [r.id, proposed.title_ro, proposed.title_en, proposed.objectives],
      )

      return { ...r, changes, change_id: written.rows[0]!.id }
    })

    if (applied === 'unchanged') {
      return back('Nu ai schimbat nimic. Modifică titlul sau obiectivele înainte de a salva.', true)
    }
    if (!applied) return back('Lucrarea nu a fost găsită sau coordonarea nu mai este activă.', true)

    await postEvent({
      studentId: applied.student_id,
      teacherId: u.id,
      senderId: u.id,
      eventType: 'change_applied',
      body: `${u.name} a modificat ${describeChanges(applied.changes)} la lucrarea ${applied.number}.${reason ? `\n\n${reason}` : ''}`,
      subjectKind: 'change',
      subjectId: applied.change_id,
    })

    await sendChangeApplied({
      to: applied.student_email,
      studentName: applied.student_name,
      teacherName: u.name,
      requestNumber: applied.number,
      changes: applied.changes,
      reason: reason || null,
      baseUrl,
    })

    await recordAccess({
      userId: u.id,
      action: 'schimba_titlu',
      subject: applied.id,
      request,
    })

    return back('Lucrarea a fost modificată. Studentul a fost anunțat pe email și în conversație.')
  }

  return deadEnd(
    400,
    'Cerere neînțeleasă',
    'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.',
  )
}
