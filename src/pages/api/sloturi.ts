import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { postEvent } from '../../lib/chat'
import { execute, query, queryOne } from '../../lib/db'
import { buildIcs } from '../../lib/ics'
import { redirectWithNotice } from '../../lib/http'
import { sendEmail, template, html } from '../../lib/mail'
import { formatDate, formatTime } from '../../lib/repo'
import { id as formId } from '../../lib/ids'

/**
 * Consultation intervals.
 *
 * Two shapes, because coordinators work in two ways. `publica` opens a block of
 * hourly intervals that any coordinated student may book — the office-hours
 * model. `programeaza` schedules one meeting with one named student and books it
 * on their behalf, which is what happens when the coordinator is the one who
 * needs the meeting.
 *
 * Either way the interval carries where it is: a room with a floor and a number,
 * a meeting link, or both when a student may attend remotely.
 */

const PAGE = '/profesor/studenti?sectiune=consultatii'

function whereItIs(mode: string, location: string | null, meetingUrl: string | null): string {
  if (mode === 'online') return meetingUrl || 'Online'
  return [location, meetingUrl].filter(Boolean).join(' · ') || 'Cabinet'
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const form = await request.formData()
  const action = String(form.get('actiune') ?? 'publica')
  const base = process.env.APP_BASE_URL ?? url.origin

  const back = (message: string, isError = false) => redirectWithNotice(PAGE, message, isError)

  /* --- open intervals anyone coordinated may book --------------------------- */

  if (action === 'publica') {
    const day = String(form.get('zi') ?? '')
    const startHour = Number(form.get('ora_start') ?? 14)
    const endHour = Number(form.get('ora_final') ?? 16)
    const mode = String(form.get('mod') ?? 'in_person')
    const location = String(form.get('locatie') ?? '').trim()
    const meetingUrl = String(form.get('link_online') ?? '').trim()

    if (!day || !Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
      return back('Alege ziua și un interval orar valid.', true)
    }
    if (!['in_person', 'online'].includes(mode)) return back('Mod invalid.', true)
    if (mode === 'online' && !meetingUrl) {
      return back('O consultație online are nevoie de un link de întâlnire.', true)
    }
    if (meetingUrl && !/^https?:\/\/\S+$/i.test(meetingUrl)) {
      return back('Linkul întâlnirii trebuie să înceapă cu http:// sau https://.', true)
    }
    if (mode === 'in_person' && !location) {
      return back('Scrie unde are loc consultația — clădirea, etajul și sala.', true)
    }

    const hours = Math.min(endHour - startHour, 8)
    let created = 0

    for (let i = 0; i < hours; i++) {
      const n = await execute(
        `INSERT INTO consultation_slots (teacher_id, starts_at, ends_at, mode, location, meeting_url)
         SELECT $1,
                ($2::date + ($3 || ' hours')::interval),
                ($2::date + ($4 || ' hours')::interval),
                $5, NULLIF($6, ''), NULLIF($7, '')
          WHERE NOT EXISTS (
            SELECT 1 FROM consultation_slots s
             WHERE s.teacher_id = $1
               AND s.starts_at = ($2::date + ($3 || ' hours')::interval)
          )`,
        [u!.id, day, String(startHour + i), String(startHour + i + 1), mode, location, meetingUrl],
      )
      created += n
    }

    return back(
      created > 0
        ? `${created} ${created === 1 ? 'interval publicat' : 'intervale publicate'}.`
        : 'Intervalele existau deja.',
      created === 0,
    )
  }

  /* --- schedule one meeting with one student -------------------------------- */

  if (action === 'programeaza') {
    const studentId = formId(form.get('student_id'))
    const day = String(form.get('zi') ?? '')
    const startHour = Number(form.get('ora_start') ?? 14)
    const durationHours = Number(form.get('durata') ?? 1)
    const mode = String(form.get('mod') ?? 'in_person')
    const location = String(form.get('locatie') ?? '').trim()
    const meetingUrl = String(form.get('link_online') ?? '').trim()
    const note = String(form.get('subiect') ?? '').trim()

    if (!day || !Number.isFinite(startHour)) return back('Alege ziua și ora consultației.', true)
    if (!['in_person', 'online'].includes(mode)) return back('Mod invalid.', true)
    if (mode === 'online' && !meetingUrl) {
      return back('O consultație online are nevoie de un link de întâlnire.', true)
    }
    if (meetingUrl && !/^https?:\/\/\S+$/i.test(meetingUrl)) {
      return back('Linkul întâlnirii trebuie să înceapă cu http:// sau https://.', true)
    }
    if (mode === 'in_person' && !location) {
      return back('Scrie unde are loc consultația — clădirea, etajul și sala.', true)
    }

    // Only a student this coordinator actually supervises, and the condition is
    // part of the lookup rather than a check before it.
    const student = await queryOne<{ id: string; name: string; email: string }>(
      `SELECT s.id, s.name, s.email
         FROM users s
         JOIN requests r ON r.student_id = s.id
        WHERE s.id = $2 AND r.teacher_id = $1 AND r.status = 'approved'`,
      [u!.id, studentId],
    )
    if (!student) return back('Alege un student pe care îl coordonezi.', true)

    const hours = Math.min(Math.max(1, Math.trunc(durationHours) || 1), 4)

    const slot = await queryOne<{ id: string; starts_at: string; ends_at: string }>(
      `INSERT INTO consultation_slots
         (teacher_id, student_id, starts_at, ends_at, mode, location, meeting_url, note, capacity)
       VALUES ($1, $2,
               ($3::date + ($4 || ' hours')::interval),
               ($3::date + ($5 || ' hours')::interval),
               $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), 1)
       RETURNING id, starts_at, ends_at`,
      [
        u!.id, studentId, day, String(startHour), String(startHour + hours),
        mode, location, meetingUrl, note,
      ],
    )
    if (!slot) return back('Consultația nu a putut fi creată.', true)

    // The coordinator scheduled it, so it is booked, not offered.
    await execute(
      `INSERT INTO bookings (slot_id, student_id, subject) VALUES ($1, $2, NULLIF($3, ''))
       ON CONFLICT (slot_id, student_id) DO UPDATE SET status = 'booked'`,
      [slot.id, student.id, note],
    )

    const place = whereItIs(mode, location, meetingUrl)
    const ics = buildIcs({
      uid: `consultatie-${slot.id}@portal.stargrid.dev`,
      title: `Consultație — ${u!.name}`,
      description: note || 'Consultație pentru lucrarea de finalizare a studiilor.',
      location: place,
      start: new Date(slot.starts_at),
      end: new Date(slot.ends_at),
      organizerName: u!.name,
      organizerEmail: u!.email,
      attendeeName: student.name,
      attendeeEmail: student.email,
    })

    const details = html`<p style="padding:12px 16px;background:#f8f9fa;border-radius:4px">
        <strong>${formatDate(slot.starts_at)}</strong>, ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}<br>
        ${place}
      </p>
      ${note ? html`<p><strong>Subiect:</strong> ${note}</p>` : ''}`

    const attachment = [
      { filename: 'consultatie.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
    ]

    await Promise.all([
      sendEmail({
        to: student.email,
        subject: `Consultație programată — ${formatDate(slot.starts_at)}`,
        html: template(
          'Coordonatorul ți-a programat o consultație',
          html`<p><strong>${u!.name}</strong> a programat o consultație cu tine:</p>${details}
           <p style="color:#5b6169;font-size:13px">Invitația atașată se adaugă automat în calendar.</p>`,
          { text: 'Vezi consultațiile', url: `${base}/consultatii` },
        ),
        attachments: attachment,
      }),
      sendEmail({
        to: u!.email,
        subject: `Consultație cu ${student.name} — ${formatDate(slot.starts_at)}`,
        html: template('Consultație programată', details),
        attachments: attachment,
      }),
    ])

    await postEvent({
      studentId: student.id,
      teacherId: u!.id,
      senderId: u!.id,
      eventType: 'consultation_scheduled',
      body: `Consultație programată pentru ${formatDate(slot.starts_at)}, ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}.\n${place}${note ? `\n\nSubiect: ${note}` : ''}`,
      createConversation: true,
    })

    return back(`Consultație programată cu ${student.name}. Invitația a plecat pe email.`)
  }

  /* --- cancel --------------------------------------------------------------- */

  if (action === 'anuleaza') {
    const slotId = formId(form.get('slot_id'))

    // Anularea marchează și rezervările, ca studentul să nu rămână cu o
    // rezervare la un interval care nu mai există.
    const cancelledBookings = await query<{ student_id: string }>(
      `UPDATE bookings r SET status = 'cancelled'
        WHERE r.slot_id = $2
          AND r.status = 'booked'
          AND EXISTS (SELECT 1 FROM consultation_slots s WHERE s.id = r.slot_id AND s.teacher_id = $1)
        RETURNING r.student_id`,
      [u!.id, slotId],
    )

    const n = await execute(
      `UPDATE consultation_slots SET is_cancelled = true WHERE id = $2 AND teacher_id = $1`,
      [u!.id, slotId],
    )

    return back(
      n
        ? cancelledBookings.length > 0
          ? 'Intervalul a fost anulat, iar rezervarea a fost retrasă.'
          : 'Intervalul a fost anulat.'
        : 'Intervalul nu a fost găsit.',
      !n,
    )
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
