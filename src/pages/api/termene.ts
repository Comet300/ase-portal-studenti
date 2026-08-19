import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, query, queryOne } from '../../lib/db'
import { deadEnd, redirectWithNotice, redirectWithUndo, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'
import { numar } from '../../lib/text'

/** What the toast says a state change did — the word, not the enum value. */
const MILESTONE_NOTICE: Record<string, string> = {
  planned: 'este din nou planificat',
  in_progress: 'este în lucru',
  done: 'este finalizat',
}

/**
 * The editable milestone timeline.
 *
 * Milestones have no owner column — they belong to a request, and the request
 * belongs to a supervisor. Every statement therefore carries an EXISTS against
 * `requests`, in the same sentence as the write it protects.
 *
 * Six verbs. `stare` and `adauga_multi` are the two the screen was missing: a
 * state change used to be a full save of the whole row, and one deadline for
 * five students was five page loads with the title retyped each time.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const redirectTo = String(form.get('redirect') ?? '/profesor/studenti')

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'adauga') {
    const requestId = formId(form.get('cerere_id'))
    const title = String(form.get('title') ?? '').trim()
    const dueOn = String(form.get('termen') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()

    if (!title) return back('Titlul termenului este obligatoriu.', true)

    const n = await execute(
      `INSERT INTO milestones (request_id, title, description, due_on, position)
       SELECT $2, $3, $4, NULLIF($5, '')::date,
              COALESCE((SELECT max(position) + 1 FROM milestones WHERE request_id = $2), 0)
        WHERE EXISTS (SELECT 1 FROM requests r WHERE r.id = $2 AND r.teacher_id = $1)`,
      [u!.id, requestId, title, description || null, dueOn],
    )
    return back(n ? 'Termen adăugat.' : 'Cererea nu a fost găsită.', !n)
  }

  if (action === 'actualizeaza') {
    const milestoneId = formId(form.get('termen_id'))
    const title = String(form.get('title') ?? '').trim()
    const dueOn = String(form.get('termen') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()
    const status = String(form.get('status') ?? '')

    if (!['planned', 'in_progress', 'done'].includes(status)) {
      return back('Stare invalidă.', true)
    }

    const n = await execute(
      `UPDATE milestones m
          SET title = COALESCE(NULLIF($3, ''), m.title),
              description = NULLIF($4, ''),
              due_on = NULLIF($5, '')::date,
              status = $6
        WHERE m.id = $2
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)`,
      [u!.id, milestoneId, title, description, dueOn, status],
    )
    return back(n ? 'Termen actualizat.' : 'Termenul nu a fost găsit.', !n)
  }

  /* The state, on its own, from the row.
   *
   * „Am terminat capitolul” used to cost: expand the row, change a select,
   * press Salvează, wait for a reload — four gestures for one word, and the
   * form carried the title and the date along with it, so a half-typed edit in
   * another field went out with it. Here it is one button and one column. */
  if (action === 'stare') {
    const milestoneId = formId(form.get('termen_id'))
    const status = String(form.get('status') ?? '')

    if (!['planned', 'in_progress', 'done'].includes(status)) {
      return back('Stare invalidă.', true)
    }

    const changed = await queryOne<{ title: string; previous: string }>(
      `UPDATE milestones m
          SET status = $3
        FROM (SELECT id, status FROM milestones WHERE id = $2) old
        WHERE m.id = old.id
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)
       RETURNING m.title, old.status AS previous`,
      [u!.id, milestoneId, status],
    )

    if (!changed) return back('Termenul nu a fost găsit.', true)

    return redirectWithUndo(redirectTo, `„${changed.title}” — ${MILESTONE_NOTICE[status]}.`, {
      to: '/api/termene',
      date: {
        actiune: 'stare',
        termen_id: milestoneId ?? '',
        status: changed.previous,
        redirect: redirectTo,
      },
    })
  }

  /* One deadline, several theses.
   *
   * „Predarea capitolului empiric · 15 aprilie” is the same sentence for every
   * student a coordinator has, and setting it for five of them meant five page
   * loads and the title typed out five times. The `teacher_id` guard stays in
   * the same statement as the write, exactly as the single-row verb does: an id
   * arriving from the form buys nothing.
   */
  if (action === 'adauga_multi') {
    const requestIds = form.getAll('cerere_id').map((v) => formId(v)).filter((v): v is string => Boolean(v))
    const title = String(form.get('title') ?? '').trim()
    const dueOn = String(form.get('termen') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()

    if (!title) return back('Titlul termenului este obligatoriu.', true)
    if (requestIds.length === 0) return back('Alege cel puțin un student.', true)

    const created = await query<{ id: string }>(
      `INSERT INTO milestones (request_id, title, description, due_on, position)
       SELECT r.id, $2, NULLIF($3, ''), NULLIF($4, '')::date,
              COALESCE((SELECT max(m.position) + 1 FROM milestones m WHERE m.request_id = r.id), 0)
         FROM requests r
        WHERE r.teacher_id = $1 AND r.status = 'approved' AND r.id = ANY($5::uuid[])
       RETURNING id`,
      [u!.id, title, description, dueOn, requestIds],
    )

    if (created.length === 0) return back('Niciun student dintre cei aleși nu mai poate primi termene.', true)

    /* The same undo as a deletion, for the same reason in reverse: one click
       writes as many rows as there are students, and taking them back one at a
       time through the edit dialog is not a way out. */
    return redirectWithUndo(
      redirectTo,
      `„${title}” a fost adăugat pentru ${numar(created.length, 'student', 'studenți')}.`,
      {
        to: '/api/termene',
        date: {
          actiune: 'sterge_multi',
          termen_ids: created.map((m) => m.id).join(','),
          redirect: redirectTo,
        },
      },
    )
  }

  /* Undoing a bulk addition. Ids come back through the toast, so the statement
   * still has to prove ownership of every one of them. */
  if (action === 'sterge_multi') {
    const ids = String(form.get('termen_ids') ?? '')
      .split(',')
      .map((v) => formId(v))
      .filter((v): v is string => Boolean(v))

    if (ids.length === 0) return back('Termenele nu au putut fi retrase.', true)

    const n = await execute(
      `DELETE FROM milestones m
        WHERE m.id = ANY($2::uuid[])
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)`,
      [u!.id, ids],
    )
    return back(
      n ? `${numar(n, 'termen retras', 'termene retrase')}.` : 'Termenele nu au putut fi retrase.',
      !n,
    )
  }

  if (action === 'sterge') {
    const milestoneId = formId(form.get('termen_id'))

    // What goes away is read in the same statement that deletes it, so that the
    // notice can offer the undo. Ownership is checked here too, as before.
    const deletedMilestone = await queryOne<{
      request_id: string
      title: string
      description: string | null
      due_on: string | null
      status: string
      position: number
    }>(
      `DELETE FROM milestones m
        WHERE m.id = $2
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)
       RETURNING request_id, title, description, due_on::text, status, position`,
      [u!.id, milestoneId],
    )

    if (!deletedMilestone) return back('Termenul nu a fost găsit.', true)

    return redirectWithUndo(redirectTo, `Termenul „${deletedMilestone.title}” a fost șters.`, {
      to: '/api/termene',
      date: {
        actiune: 'restaureaza',
        cerere_id: deletedMilestone.request_id,
        title: deletedMilestone.title,
        descriere: deletedMilestone.description ?? '',
        termen: deletedMilestone.due_on ?? '',
        stare: deletedMilestone.status,
        pozitie: String(deletedMilestone.position),
        redirect: redirectTo,
      },
    })
  }

  /* Undoing a deletion: the row is written again, with a new id, at the
   * position it had. The same `EXISTS` guard — a request id coming from the
   * form does not give access to somebody else's thesis. */
  if (action === 'restaureaza') {
    const requestId = formId(form.get('cerere_id'))
    const title = String(form.get('title') ?? '').trim()
    if (!requestId || !title) return back('Termenul nu a putut fi refăcut.', true)

    const pozitie = Number(form.get('pozitie') ?? '')
    const stare = String(form.get('stare') ?? 'planned')
    const n = await execute(
      `INSERT INTO milestones (request_id, position, title, description, due_on, status)
       SELECT r.id,
              COALESCE($6::int, (SELECT COALESCE(max(position), 0) + 1 FROM milestones WHERE request_id = r.id)),
              $2, NULLIF($3, ''), NULLIF($4, '')::date, $5
         FROM requests r
        WHERE r.id = $7 AND r.teacher_id = $1`,
      [
        u!.id,
        title,
        String(form.get('descriere') ?? '').trim(),
        String(form.get('termen') ?? '').trim(),
        // Only the three from the table's CHECK; 'late' is computed, never stored.
        ['planned', 'in_progress', 'done'].includes(stare) ? stare : 'planned',
        Number.isFinite(pozitie) ? Math.trunc(pozitie) : null,
        requestId,
      ],
    )

    return back(
      n ? `Termenul „${title}” a fost pus înapoi.` : 'Termenul nu a putut fi refăcut.',
      !n,
    )
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
