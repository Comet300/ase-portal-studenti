import type { APIRoute } from 'astro'
import { queryOne } from '../../lib/db'
import { buildIcs } from '../../lib/ics'
import { template, sendEmail, html } from '../../lib/mail'
import { formatDate, formatTime } from '../../lib/repo'
import { redirectWithNotice } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'

/** Rezervarea și anularea unui interval de consultație, cu invitație în calendar. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const form = await request.formData()
  const action = formAction(form) || 'rezerva'
  const slotId = formId(form.get('slot_id'))
  const subject = String(form.get('subiect') ?? '').trim()

  const back = (message: string, isError = false) =>
    redirectWithNotice('/consultatii', message, isError)

  if (action === 'anuleaza') {
    const cancelledRow = await queryOne<{ id: string }>(
      `UPDATE bookings SET status = 'cancelled'
        WHERE slot_id = $2 AND student_id = $1 AND status = 'booked'
        RETURNING id`,
      [u.id, slotId],
    )
    return back(cancelledRow ? 'Rezervarea a fost anulată.' : 'Rezervarea nu a fost găsită.', !cancelledRow)
  }

  /* Slotul trebuie să fie liber, viitor, neanulat — și al coordonatorului tău.
   *
   * Ultimele două condiții lipseau: pagina arăta doar intervalele coordonatorului
   * propriu, dar interfața nu este o autorizare. Cu un `slot_id` obținut oricum,
   * oricine autentificat putea rezerva la orice cadru didactic, inclusiv un
   * interval rezervat prin `student_id` pentru un student anume.
   *
   * Toate condițiile stau în INSERT, deci două cereri simultane nu pot ocupa
   * amândouă ultimul loc. */
  const booking = await queryOne<{ id: string }>(
    `INSERT INTO bookings (slot_id, student_id, subject)
     SELECT s.id, $1, NULLIF($3, '')
       FROM consultation_slots s
      WHERE s.id = $2
        AND s.is_cancelled = false
        AND s.starts_at > now()
        AND (s.student_id IS NULL OR s.student_id = $1)
        AND EXISTS (
          SELECT 1 FROM requests r
           WHERE r.student_id = $1 AND r.teacher_id = s.teacher_id AND r.status = 'approved'
        )
        AND (SELECT count(*) FROM bookings r WHERE r.slot_id = s.id AND r.status = 'booked') < s.capacity
     ON CONFLICT (slot_id, student_id) DO UPDATE SET status = 'booked'
     RETURNING id`,
    [u.id, slotId, subject],
  )

  if (!booking) return back('Intervalul nu mai este disponibil.', true)

  const slot = await queryOne<{
    starts_at: string
    ends_at: string
    mode: string
    location: string | null
    meeting_url: string | null
    teacher_name: string
    teacher_email: string
  }>(
    `SELECT s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
            p.name AS teacher_name, p.email AS teacher_email
       FROM consultation_slots s
       JOIN users p ON p.id = s.teacher_id
      WHERE s.id = $1`,
    [slotId],
  )

  if (slot) {
    const location = slot.mode === 'online' ? (slot.meeting_url ?? 'Online') : (slot.location ?? 'Cabinet')
    const ics = buildIcs({
      uid: `consultatie-${slotId}@portal.stargrid.dev`,
      title: `Consultație — ${slot.teacher_name}`,
      description: subject || 'Consultație pentru lucrarea de finalizare a studiilor.',
      location,
      start: new Date(slot.starts_at),
      end: new Date(slot.ends_at),
      organizerName: slot.teacher_name,
      organizerEmail: slot.teacher_email,
      attendeeName: u.name,
      attendeeEmail: u.email,
    })

    const body = html`<p>Consultație confirmată:</p>
      <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px">
        <strong>${formatDate(slot.starts_at)}</strong>, ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}<br>
        ${location}
      </p>
      ${subject ? html`<p><strong>Subiect:</strong> ${subject}</p>` : ''}
      <p style="color:#5b6169;font-size:13px">Invitația atașată se adaugă automat în calendar.</p>`

    const attachment = [{ filename: 'consultatie.ics', content: ics, contentType: 'text/calendar; method=REQUEST' }]

    await Promise.all([
      sendEmail({
        to: u.email,
        subject: `Consultație confirmată — ${formatDate(slot.starts_at)}`,
        html: template('Consultație confirmată', body),
        attachments: attachment,
      }),
      sendEmail({
        to: slot.teacher_email,
        subject: `Rezervare consultație — ${u.name}`,
        html: template(
          'Un student ți-a rezervat o consultație',
          html`<p><strong>${u.name}</strong> (${u.student_number ?? '—'}) a rezervat intervalul:</p>${body}`,
        ),
        attachments: attachment,
      }),
    ])
  }

  return back('Consultație rezervată. Invitația a fost trimisă pe email.')
}
