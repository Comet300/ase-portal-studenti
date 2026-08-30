import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isDepartmentHead, isTeacher } from '../../lib/auth'
import { execute, queryOne, transaction } from '../../lib/db'
import { grantSeats } from '../../lib/lifecycle'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { html, quote, sendEmail, template } from '../../lib/mail'
import { id as formId } from '../../lib/ids'
import { teacherCapacity } from '../../lib/repo'
import { capacityOf, EXTRA_SEATS_MAX_PER_LEVEL, GRANT_MAX, GRANT_MIN, SEAT_BASE_MAX } from '../../lib/seats'
import { numar } from '../../lib/text'

/**
 * Seats.
 *
 * How many students a coordinator may take is the department's decision, not
 * the coordinator's — so setting the base is `head` only, and a coordinator who
 * needs more asks in writing.
 *
 * Two different things are written here and they must not be confused again.
 * The BASE (`aloca`) is the norm, or the number the director set for this
 * person instead of it; it is shared across every programme at that level. An
 * EXTRA (`acorda`, or `decide` on a written request) is granted for one named
 * study programme and is reserved to it. Until this release both landed in the
 * same integer — one path overwriting it, the other adding to it — so a
 * coordinator's granted seats could be destroyed by the director's next save,
 * and afterwards nothing could tell the two apart.
 *
 * Every one of the four writes leaves a row somebody can read back: the base in
 * `seat_base_changes`, the extras in `seat_grants`, and both in the access log.
 */

const HEAD_PAGE = '/profesor/departament?sectiune=locuri'
/* The form moved out of the archive and onto the coordinator's own dashboard,
 * next to the capacity it argues about. The fragment matters: without it a
 * refused request answered at the top of a screen whose seats panel is halfway
 * down, and `redirectWithNotice` keeps `#…` at the end of the address. */
const TEACHER_PAGE = '/profesor#locuri'

const LEVEL_WORD = { bachelor: 'licență', master: 'master' } as const

interface ProgrammeRow {
  id: string
  name: string
  level: 'bachelor' | 'master'
  is_active: boolean
}

/** The programme, but only if it belongs to the year the seats are for. */
function programmeOfCurrentYear(programmeId: string | null): Promise<ProgrammeRow | null> {
  return queryOne<ProgrammeRow>(
    `SELECT p.id, p.name, p.level, p.is_active
       FROM study_programmes p
      WHERE p.id = $1
        AND p.academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
    [programmeId],
  )
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const base = process.env.APP_BASE_URL ?? url.origin
  const notFound = () =>
    deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')

  /* --- the head sets the base ---------------------------------------------- */

  if (action === 'aloca') {
    if (!isDepartmentHead(u)) return notFound()

    const teacherId = formId(form.get('profesor_id'))
    /* „Pe normă” is a value, not an absence: it puts the coordinator back on the
     * year's norm, so a later change of the norm reaches them again. Sent as a
     * separate field because an empty number input is indistinguishable from a
     * cleared one, and „0 seats” has to stay expressible. */
    const onNorm = String(form.get('pe_norma') ?? '')
    const wantsNorm = (level: 'bachelor' | 'master') =>
      onNorm === 'ambele' || onNorm === (level === 'master' ? 'master' : 'licenta')

    const typed = {
      bachelor: Number(form.get('locuri_licenta') ?? 0),
      master: Number(form.get('locuri_master') ?? 0),
    }
    const clamp = (n: number) =>
      Number.isFinite(n) ? Math.min(SEAT_BASE_MAX, Math.max(0, Math.trunc(n))) : 0
    const wanted = {
      bachelor: wantsNorm('bachelor') ? null : clamp(typed.bachelor),
      master: wantsNorm('master') ? null : clamp(typed.master),
    }

    const teacher = await queryOne<{ name: string }>(
      `SELECT name FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
      [teacherId],
    )
    if (!teacher) return redirectWithNotice(HEAD_PAGE, 'Cadrul didactic nu există.', true)

    /* The previous value and the new one are written in the same transaction as
     * the change itself. Until now an allocation left one overwritten integer
     * and a timestamp: there was no way to answer „what was it before, and who
     * decided that” a week later, for the number that decides how many students
     * a person supervises. */
    await transaction(async (client) => {
      const { rows } = await client.query<{
        bachelor_base: number | null
        master_base: number | null
        year_id: string
      }>(
        `SELECT a.bachelor_base, a.master_base, y.id AS year_id
           FROM academic_years y
           LEFT JOIN seat_allocations a
             ON a.teacher_id = $1 AND a.academic_year_id = y.id
          WHERE y.is_current`,
        [teacherId],
      )
      const before = rows[0]
      if (!before) return

      await client.query(
        `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_base, master_base, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (teacher_id, academic_year_id)
         DO UPDATE SET bachelor_base = EXCLUDED.bachelor_base,
                       master_base   = EXCLUDED.master_base,
                       set_by        = EXCLUDED.set_by,
                       updated_at    = now()`,
        [teacherId, before.year_id, wanted.bachelor, wanted.master, u!.id],
      )

      for (const level of ['bachelor', 'master'] as const) {
        const was = level === 'master' ? before.master_base : before.bachelor_base
        if (was === wanted[level]) continue
        await client.query(
          `INSERT INTO seat_base_changes (academic_year_id, teacher_id, level,
                                          seats_before, seats_after, note, changed_by)
           VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7)`,
          [
            before.year_id, teacherId, level, was, wanted[level],
            String(form.get('nota') ?? '').trim(), u!.id,
          ],
        )
      }
    })

    await recordAccess({
      userId: u!.id,
      action: 'schimba_norma_locuri',
      subject: teacher.name,
      request,
    })

    /* The value saved may not be the value sent.
     *
     * `clamp` cuts silently to 0–40: whoever typed 100 got „Locurile au fost
     * actualizate” and left convinced they had allocated 100. If anything was
     * changed, the message says what was actually written. */
    const cut =
      (!wantsNorm('bachelor') && wanted.bachelor !== typed.bachelor) ||
      (!wantsNorm('master') && wanted.master !== typed.master)
    const said = (level: 'bachelor' | 'master') =>
      wanted[level] === null ? 'norma anului' : String(wanted[level])

    return redirectWithNotice(
      HEAD_PAGE,
      cut
        ? `Locurile de bază pentru ${teacher.name}: ${said('bachelor')} la licență și ${said('master')} la master. Valorile au fost limitate la intervalul 0–${SEAT_BASE_MAX}. Locurile suplimentare acordate pe programe nu sunt atinse.`
        : `Locurile de bază pentru ${teacher.name}: ${said('bachelor')} la licență și ${said('master')} la master. Locurile suplimentare acordate pe programe rămân neatinse.`,
      cut,
    )
  }

  /* --- the head grants extras, without being asked -------------------------- */

  if (action === 'acorda') {
    if (!isDepartmentHead(u)) return notFound()

    const teacherId = formId(form.get('profesor_id'))
    const seats = Number(form.get('locuri') ?? 0)
    const reason = String(form.get('motiv') ?? '').trim()
    const programme = await programmeOfCurrentYear(formId(form.get('program_id')))

    if (!programme) {
      return redirectWithNotice(
        HEAD_PAGE,
        'Alege programul de studiu pentru care acorzi locurile: un loc suplimentar este rezervat unui singur program.',
        true,
      )
    }
    if (!programme.is_active) {
      return redirectWithNotice(
        HEAD_PAGE,
        `„${programme.name}” nu mai este activ în acest an universitar, deci nu i se pot rezerva locuri. Reactivează-l din anul universitar sau alege alt program.`,
        true,
      )
    }
    if (!Number.isFinite(seats) || seats < GRANT_MIN || seats > GRANT_MAX) {
      return redirectWithNotice(
        HEAD_PAGE,
        `Numărul de locuri acordate deodată trebuie să fie între ${GRANT_MIN} și ${GRANT_MAX}.`,
        true,
      )
    }
    if (reason.length < 20) {
      return redirectWithNotice(
        HEAD_PAGE,
        'Scrie de ce acorzi locurile, în cel puțin 20 de caractere: motivul rămâne în jurnalul locurilor și este singurul care explică decizia peste un an.',
        true,
      )
    }

    const teacher = await queryOne<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
      [teacherId],
    )
    if (!teacher) return redirectWithNotice(HEAD_PAGE, 'Cadrul didactic nu există.', true)

    const capacity = await teacherCapacity(teacher.id)
    const level = programme.level === 'master' ? capacity.master : capacity.bachelor
    if (level.granted + Math.trunc(seats) > EXTRA_SEATS_MAX_PER_LEVEL) {
      return redirectWithNotice(
        HEAD_PAGE,
        `${teacher.name} are deja ${numar(level.granted, 'loc suplimentar', 'locuri suplimentare')} la ${LEVEL_WORD[programme.level]}, iar limita pe an este ${EXTRA_SEATS_MAX_PER_LEVEL}. Retrage locuri neocupate sau ridică-i baza.`,
        true,
      )
    }

    await execute(
      `INSERT INTO seat_grants (academic_year_id, teacher_id, programme_id, level, seats,
                                reason, granted_by)
       VALUES ((SELECT id FROM academic_years WHERE is_current), $1, $2, $3, $4, $5, $6)`,
      [teacher.id, programme.id, programme.level, Math.trunc(seats), reason, u!.id],
    )

    await recordAccess({
      userId: u!.id,
      action: 'acorda_locuri',
      subject: `${teacher.name} · ${programme.name}`,
      rowCount: Math.trunc(seats),
      request,
    })

    await sendEmail({
      to: teacher.email,
      subject: `Ai primit ${Math.trunc(seats)} locuri pentru ${programme.name}`,
      html: template(
        'Locuri suplimentare acordate',
        html`<p>Directorul de departament ți-a rezervat <strong>${Math.trunc(seats)}</strong>
         locuri pentru <strong>${programme.name}</strong> (${LEVEL_WORD[programme.level]}).</p>
         <p>Ele pot fi ocupate numai de studenți de la acest program de studiu.</p>
         ${quote(reason)}`,
        { text: 'Deschide locurile de coordonare', url: `${base}${TEACHER_PAGE}` },
      ),
    })

    return redirectWithNotice(
      HEAD_PAGE,
      `${Math.trunc(seats)} locuri rezervate pentru ${programme.name} la ${teacher.name}. Numai studenții acestui program le pot ocupa.`,
    )
  }

  /* --- the head takes extras back ------------------------------------------ */

  if (action === 'retrage') {
    if (!isDepartmentHead(u)) return notFound()

    const grantId = formId(form.get('acordare_id'))
    const reason = String(form.get('motiv') ?? '').trim()

    const grant = await queryOne<{
      id: string
      teacher_id: string
      teacher_name: string
      programme_id: string | null
      programme_name: string | null
      level: 'bachelor' | 'master'
      seats: number
    }>(
      `SELECT g.id, g.teacher_id, t.name AS teacher_name, g.programme_id,
              p.name AS programme_name, g.level, g.seats
         FROM seat_grants g
         JOIN users t ON t.id = g.teacher_id
         LEFT JOIN study_programmes p ON p.id = g.programme_id
        WHERE g.id = $1 AND g.revoked_at IS NULL
          AND g.academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
      [grantId],
    )
    if (!grant) {
      return redirectWithNotice(
        HEAD_PAGE,
        'Acordarea nu mai poate fi retrasă: fie a fost deja retrasă, fie este dintr-un an universitar încheiat.',
        true,
      )
    }
    if (reason.length < 10) {
      return redirectWithNotice(
        HEAD_PAGE,
        'Scrie de ce retragi locurile, în cel puțin 10 caractere. Cadrul didactic vede acest text.',
        true,
      )
    }

    /* Seats already filled cannot be taken back.
     *
     * Removing an earmark pushes the students who were sitting on it onto the
     * shared base, and the base may not have room — in which case the
     * coordinator would end the day supervising more students than they have
     * seats for, without having done anything. The same pure function that
     * answers the gates answers this, run once over the pots as they would be
     * after the revocation. */
    const capacity = await teacherCapacity(grant.teacher_id)
    const level = grant.level === 'master' ? capacity.master : capacity.bachelor
    const after = capacityOf({
      level: level.level,
      base: level.base,
      isNorm: level.is_norm,
      pots: level.pots.map((pot) =>
        pot.programme_id === grant.programme_id
          ? { ...pot, granted: Math.max(0, pot.granted - grant.seats) }
          : pot,
      ),
    })
    if (after.base_used > after.base) {
      const overflow = after.base_used - after.base
      return redirectWithNotice(
        HEAD_PAGE,
        `Nu poți retrage aceste locuri: ${numar(overflow, 'student', 'studenți')} de la ${grant.programme_name ?? 'programul respectiv'} ar rămâne fără loc la ${grant.teacher_name}. Retrage o acordare neocupată sau ridică-i mai întâi baza.`,
        true,
      )
    }

    await execute(
      `UPDATE seat_grants
          SET revoked_at = now(), revoked_by = $2, revoke_reason = $3
        WHERE id = $1 AND revoked_at IS NULL`,
      [grant.id, u!.id, reason],
    )

    await recordAccess({
      userId: u!.id,
      action: 'retrage_locuri',
      subject: `${grant.teacher_name} · ${grant.programme_name ?? '—'}`,
      rowCount: grant.seats,
      request,
    })

    return redirectWithNotice(
      HEAD_PAGE,
      `${numar(grant.seats, 'loc retras', 'locuri retrase')} de la ${grant.teacher_name}. Acordarea rămâne în jurnal, marcată ca retrasă.`,
    )
  }

  /* --- a coordinator asks --------------------------------------------------- */

  if (action === 'cere') {
    const extra = Number(form.get('locuri') ?? 0)
    const reason = String(form.get('motiv') ?? '').trim()
    const programme = await programmeOfCurrentYear(formId(form.get('program_id')))

    /* The level is not asked for any more: it is the programme's own. Two
     * fields that could disagree meant a request for „master” seats naming a
     * bachelor's programme, and the seat would have been unusable by anybody. */
    if (!programme || !programme.is_active) {
      return redirectWithNotice(
        TEACHER_PAGE,
        'Alege programul de studiu pentru care ceri locuri: locurile suplimentare sunt rezervate unui singur program, iar cererea trebuie să-l numească.',
        true,
      )
    }
    if (!Number.isFinite(extra) || extra < GRANT_MIN || extra > GRANT_MAX) {
      return redirectWithNotice(
        TEACHER_PAGE,
        `Numărul de locuri cerute trebuie să fie între ${GRANT_MIN} și ${GRANT_MAX}.`,
        true,
      )
    }
    if (reason.length < 20) {
      return redirectWithNotice(
        TEACHER_PAGE,
        'Scrie de ce ai nevoie de locuri, în cel puțin 20 de caractere: directorul de departament decide pe baza acestui text.',
        true,
      )
    }

    try {
      await execute(
        `INSERT INTO seat_requests (teacher_id, academic_year_id, level, programme_id, extra_seats, reason)
         VALUES ($1, (SELECT id FROM academic_years WHERE is_current), $2, $3, $4, $5)`,
        [u!.id, programme.level, programme.id, Math.trunc(extra), reason],
      )
    } catch (err) {
      if (String(err).includes('idx_seat_requests_one_open')) {
        return redirectWithNotice(
          TEACHER_PAGE,
          `Ai deja o cerere de locuri în așteptare pentru ${programme.name}. Așteaptă decizia directorului sau cere locuri pentru alt program de studiu.`,
          true,
        )
      }
      throw err
    }

    const heads = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE role = 'head' ORDER BY name LIMIT 1`,
    )
    if (heads) {
      await sendEmail({
        to: heads.email,
        subject: `Cerere de locuri suplimentare — ${u!.name}`,
        html: template(
          'Cerere de locuri suplimentare',
          html`<p><strong>${u!.name}</strong> solicită <strong>${Math.trunc(extra)}</strong> locuri
           suplimentare pentru <strong>${programme.name}</strong>
           (${LEVEL_WORD[programme.level]}).</p>
           <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${reason}</p>`,
          { text: 'Deschide alocarea locurilor', url: `${base}${HEAD_PAGE}` },
        ),
      })
    }

    return redirectWithNotice(
      TEACHER_PAGE,
      `Cererea pentru ${programme.name} a fost trimisă directorului de departament.`,
    )
  }

  /* --- the head decides ----------------------------------------------------- */

  if (action === 'decide') {
    if (!isDepartmentHead(u)) return notFound()

    const seatRequestId = formId(form.get('cerere_id'))
    const decision = String(form.get('decizie') ?? '')
    const note = String(form.get('nota') ?? '').trim()

    if (decision !== 'approved' && decision !== 'rejected') {
      return deadEnd(400, 'Decizie neînțeleasă', 'Decizia trimisă nu este una dintre cele posibile. Reia din coada de cereri.')
    }

    /* The head does not decide their own request.
     *
     * `isTeacher(head)` is true, so the „cere” branch accepted a request from
     * the head to themselves, and „decide” checked nothing: one could ask for
     * two seats and approve them alone, and the resulting row was impossible to
     * tell apart from a decision of the department. The condition sits in the
     * query, as everywhere in the portal, so that it cannot be bypassed with a
     * POST. */
    const isOwnRequest = await queryOne<{ da: boolean }>(
      `SELECT (teacher_id = $1) AS da FROM seat_requests WHERE id = $2`,
      [u!.id, seatRequestId],
    )
    if (isOwnRequest?.da) {
      return redirectWithNotice(
        HEAD_PAGE,
        'Nu îți poți decide propria cerere de locuri. Acordă-ți direct locurile din jurnalul de mai jos, unde decizia rămâne vizibilă cu motivul ei.',
        true,
      )
    }

    const decided =
      decision === 'approved'
        ? await grantSeats(u!.id, seatRequestId, note)
        : await queryOne<{ teacher_id: string; extra_seats: number; level: string; programme_id: string | null }>(
            `UPDATE seat_requests
                SET status = 'rejected', decision_note = NULLIF($3, ''), decided_by = $1, decided_at = now()
              WHERE id = $2 AND status = 'pending'
              RETURNING teacher_id, extra_seats, level, programme_id`,
            [u!.id, seatRequestId, note],
          )

    if (decided === 'no-programme') {
      return redirectWithNotice(
        HEAD_PAGE,
        'Cererea este dinaintea evidenței pe programe de studiu și nu numește niciun program, iar un loc suplimentar se rezervă unui singur program. Respinge-o și acordă locurile direct, alegând programul.',
        true,
      )
    }
    if (!decided) {
      return redirectWithNotice(HEAD_PAGE, 'Cererea nu mai poate fi decisă.', true)
    }

    const teacher = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [decided.teacher_id],
    )
    const programme = decided.programme_id
      ? await queryOne<{ name: string }>(`SELECT name FROM study_programmes WHERE id = $1`, [
          decided.programme_id,
        ])
      : null
    const where = programme ? programme.name : LEVEL_WORD[decided.level as 'bachelor' | 'master']

    if (teacher) {
      const granted = decision === 'approved'
      await sendEmail({
        to: teacher.email,
        subject: granted
          ? `Ai primit ${decided.extra_seats} locuri pentru ${where}`
          : 'Cererea de locuri suplimentare a fost respinsă',
        html: template(
          granted ? 'Locuri suplimentare aprobate' : 'Cerere de locuri respinsă',
          granted
            ? html`<p>Directorul de departament ți-a rezervat încă
               <strong>${decided.extra_seats}</strong> locuri pentru <strong>${where}</strong>.</p>
               <p>Ele pot fi ocupate numai de studenți de la acest program de studiu.</p>
               ${note ? quote(note) : ''}`
            : html`<p>Cererea pentru ${decided.extra_seats} locuri la ${where} a fost respinsă.</p>
               ${note ? html`<p><strong>Motiv:</strong> ${note}</p>` : ''}`,
          { text: 'Deschide locurile de coordonare', url: `${base}${TEACHER_PAGE}` },
        ),
      })
    }

    if (decision === 'approved') {
      await recordAccess({
        userId: u!.id,
        action: 'acorda_locuri',
        subject: `${teacher?.name ?? decided.teacher_id} · ${where}`,
        rowCount: decided.extra_seats,
        request,
      })
    }

    return redirectWithNotice(
      HEAD_PAGE,
      decision === 'approved'
        ? `${decided.extra_seats} locuri rezervate pentru ${where}. Cadrul didactic a fost notificat.`
        : 'Cerere respinsă.',
    )
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
