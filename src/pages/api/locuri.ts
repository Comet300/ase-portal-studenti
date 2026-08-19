import type { APIRoute } from 'astro'
import { isDepartmentHead, isTeacher } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { grantSeats } from '../../lib/lifecycle'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { html, quote, sendEmail, template } from '../../lib/mail'
import { id as formId } from '../../lib/ids'

/**
 * Seats.
 *
 * How many students a coordinator may take is the department's decision, not the
 * coordinator's — so allocating is `head` only, and a coordinator who needs more
 * asks in writing. Granting a request and adding the seats happen in one
 * transaction (see `grantSeats`): a granted request whose seats never landed is
 * a promise the portal would then break.
 */

const HEAD_PAGE = '/profesor/departament?sectiune=locuri'
/* The form moved out of the archive and onto the coordinator's own dashboard,
 * next to the capacity it argues about. The fragment matters: without it a
 * refused request answered at the top of a screen whose seats panel is halfway
 * down, and `redirectWithNotice` keeps `#…` at the end of the address. */
const TEACHER_PAGE = '/profesor#locuri'

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const base = process.env.APP_BASE_URL ?? url.origin

  /* --- the head allocates -------------------------------------------------- */

  if (action === 'aloca') {
    if (!isDepartmentHead(u)) return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')

    const teacherId = formId(form.get('profesor_id'))
    const bachelor = Number(form.get('locuri_licenta') ?? 0)
    const master = Number(form.get('locuri_master') ?? 0)
    const clamp = (n: number) => (Number.isFinite(n) ? Math.min(40, Math.max(0, Math.trunc(n))) : 0)

    const teacher = await queryOne<{ name: string }>(
      `SELECT name FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
      [teacherId],
    )
    if (!teacher) return redirectWithNotice(HEAD_PAGE, 'Cadrul didactic nu există.', true)

    await execute(
      `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_seats, master_seats, set_by)
       VALUES ($1, (SELECT id FROM academic_years WHERE is_current), $2, $3, $4)
       ON CONFLICT (teacher_id, academic_year_id)
       DO UPDATE SET bachelor_seats = EXCLUDED.bachelor_seats,
                     master_seats   = EXCLUDED.master_seats,
                     set_by         = EXCLUDED.set_by,
                     updated_at     = now()`,
      [teacherId, clamp(bachelor), clamp(master), u!.id],
    )

    /* The value saved may not be the value sent.
     *
     * `clamp` cuts silently to 0–40: whoever typed 100 got „Locurile au fost
     * actualizate” and left convinced they had allocated 100. If anything was
     * changed, the message says what was actually written. */
    const taiat = clamp(bachelor) !== bachelor || clamp(master) !== master
    return redirectWithNotice(
      HEAD_PAGE,
      taiat
        ? `Locurile pentru ${teacher.name}: ${clamp(bachelor)} licență și ${clamp(master)} master. Valorile au fost limitate la intervalul 0–40.`
        : `Locurile pentru ${teacher.name} au fost actualizate.`,
      taiat,
    )
  }

  /* --- a coordinator asks --------------------------------------------------- */

  if (action === 'cere') {
    const level = String(form.get('nivel') ?? '')
    const extra = Number(form.get('locuri') ?? 0)
    const reason = String(form.get('motiv') ?? '').trim()

    if (!['bachelor', 'master'].includes(level)) {
      return redirectWithNotice(TEACHER_PAGE, 'Alege nivelul pentru care ceri locuri.', true)
    }
    if (!Number.isFinite(extra) || extra < 1 || extra > 20) {
      return redirectWithNotice(TEACHER_PAGE, 'Numărul de locuri cerute trebuie să fie între 1 și 20.', true)
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
        `INSERT INTO seat_requests (teacher_id, academic_year_id, level, extra_seats, reason)
         VALUES ($1, (SELECT id FROM academic_years WHERE is_current), $2, $3, $4)`,
        [u!.id, level, Math.trunc(extra), reason],
      )
    } catch (err) {
      if (String(err).includes('idx_seat_requests_one_open')) {
        return redirectWithNotice(
          TEACHER_PAGE,
          'Ai deja o cerere de locuri în așteptare la acest nivel. Așteaptă decizia directorului sau cere locuri la celălalt nivel.',
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
           suplimentare la ${level === 'master' ? 'master' : 'licență'}.</p>
           <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${reason}</p>`,
          { text: 'Deschide alocarea locurilor', url: `${base}${HEAD_PAGE}` },
        ),
      })
    }

    return redirectWithNotice(TEACHER_PAGE, 'Cererea a fost trimisă directorului de departament.')
  }

  /* --- the head decides ----------------------------------------------------- */

  if (action === 'decide') {
    if (!isDepartmentHead(u)) return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')

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
        'Nu îți poți decide propria cerere de locuri. Alocă-ți direct locurile din tabelul de mai sus, unde decizia rămâne vizibilă ca alocare.',
        true,
      )
    }

    const decided =
      decision === 'approved'
        ? await grantSeats(u!.id, seatRequestId, note)
        : await queryOne<{ teacher_id: string; extra_seats: number; level: string }>(
            `UPDATE seat_requests
                SET status = 'rejected', decision_note = NULLIF($3, ''), decided_by = $1, decided_at = now()
              WHERE id = $2 AND status = 'pending'
              RETURNING teacher_id, extra_seats, level`,
            [u!.id, seatRequestId, note],
          )

    if (!decided) {
      return redirectWithNotice(HEAD_PAGE, 'Cererea nu mai poate fi decisă.', true)
    }

    const teacher = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [decided.teacher_id],
    )
    if (teacher) {
      const granted = decision === 'approved'
      await sendEmail({
        to: teacher.email,
        subject: granted
          ? `Ai primit ${decided.extra_seats} locuri suplimentare`
          : 'Cererea de locuri suplimentare a fost respinsă',
        html: template(
          granted ? 'Locuri suplimentare aprobate' : 'Cerere de locuri respinsă',
          granted
            ? html`<p>Directorul de departament ți-a alocat încă <strong>${decided.extra_seats}</strong> locuri la
               ${decided.level === 'master' ? 'master' : 'licență'}.</p>${note ? quote(note) : ''}`
            : html`<p>Cererea pentru ${decided.extra_seats} locuri la
               ${decided.level === 'master' ? 'master' : 'licență'} a fost respinsă.</p>
               ${note ? html`<p><strong>Motiv:</strong> ${note}</p>` : ''}`,
          { text: 'Deschide locurile de coordonare', url: `${base}/profesor#locuri` },
        ),
      })
    }

    return redirectWithNotice(
      HEAD_PAGE,
      decision === 'approved' ? 'Locuri alocate. Cadrul didactic a fost notificat.' : 'Cerere respinsă.',
    )
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
