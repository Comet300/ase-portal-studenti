import type { APIRoute } from 'astro'
import { postEvent } from '../../lib/chat'
import { queryOne } from '../../lib/db'
import { buildIcs, consultationUid } from '../../lib/ics'
import { template, sendEmail, html } from '../../lib/mail'
import { formatDate, formatTime } from '../../lib/repo'
import { redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'

/** Booking and cancelling a consultation slot, with a calendar invitation. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form) || 'rezerva'
  const slotId = formId(form.get('slot_id'))
  const subject = String(form.get('subiect') ?? '').trim()

  const back = (message: string, isError = false) =>
    redirectWithNotice('/consultatii', message, isError)

  // A missing id would not match any row anyway; refused here, the message is
  // about what happened, not "the slot is no longer available".
  if (!slotId) return back('Ora de consultație nu a fost identificată. Reîncarcă pagina.', true)

  if (action === 'anuleaza') {
    /* The cancellation has to reach the coordinator as well.
     *
     * The confirmation dialog told the student, in black and white, that "the
     * coordinator sees the cancellation". The code did a single UPDATE and
     * returned: no email, no event in the thread, no cancellation in the
     * calendar — even though `ics.ts` has had `METHOD:CANCEL` written in it
     * from the start and nobody ever asked it for one. The hour stayed in the
     * teacher's calendar forever. */
    const cancelled = await queryOne<{
      starts_at: string
      ends_at: string
      mode: string
      location: string | null
      meeting_url: string | null
      teacher_id: string
      teacher_name: string
      teacher_email: string
      student_name: string
      student_email: string
    }>(
      `UPDATE bookings b SET status = 'cancelled'
         FROM consultation_slots s, users t, users st
        WHERE b.slot_id = s.id AND s.teacher_id = t.id AND st.id = b.student_id
          AND b.slot_id = $2 AND b.student_id = $1 AND b.status = 'booked'
       RETURNING s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
                 t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email,
                 st.name AS student_name, st.email AS student_email`,
      [u.id, slotId],
    )

    if (!cancelled) return back('Rezervarea nu a fost găsită. Reîncarcă pagina — s-ar putea să fie deja anulată.', true)

    const when = `${formatDate(cancelled.starts_at)}, ${formatTime(cancelled.starts_at)}–${formatTime(cancelled.ends_at)}`

    await postEvent({
      studentId: u.id,
      teacherId: cancelled.teacher_id,
      senderId: u.id,
      eventType: 'consultation_cancelled',
      body: `${cancelled.student_name} a anulat consultația din ${when}. Locul este din nou liber.`,
      createConversation: false,
      subjectKind: 'slot',
      subjectId: slotId,
    })

    /* The calendar cancellation: the same UID, a higher `SEQUENCE`,
     * `METHOD:CANCEL` — and the same SUMMARY the invitation carried. Both
     * calendars hold this event under the title the booking gave it, so a
     * cancellation announcing a differently-named meeting reads, to whoever
     * opens it, as a message about something else. */
    const anulare = buildIcs({
      uid: consultationUid(slotId, u.id),
      title: `Consultație — ${cancelled.teacher_name}`,
      description: 'Consultație anulată de student.',
      location: cancelled.mode === 'online' ? (cancelled.meeting_url ?? 'Online') : (cancelled.location ?? 'Cabinet'),
      meetingUrl: cancelled.meeting_url ?? undefined,
      start: new Date(cancelled.starts_at),
      end: new Date(cancelled.ends_at),
      organizerName: cancelled.teacher_name,
      organizerEmail: cancelled.teacher_email,
      attendeeName: cancelled.student_name,
      attendeeEmail: cancelled.student_email,
      cancelled: true,
    })

    const atasament = [
      { filename: 'anulare.ics', content: Buffer.from(anulare), contentType: 'text/calendar; method=CANCEL' },
    ]

    void sendEmail({
      to: cancelled.teacher_email,
      subject: `Consultație anulată — ${when}`,
      html: template(
        'O consultație a fost anulată',
        html`<p><strong>${cancelled.student_name}</strong> a anulat consultația din ${when}.</p>
         <p>Ora este din nou liberă pentru ceilalți studenți pe care îi coordonezi.</p>`,
        { text: 'Vezi programul', url: `${process.env.APP_BASE_URL ?? url.origin}/profesor/consultatii` },
      ),
      attachments: atasament,
    }).catch((err) => console.error('[rezervari] anularea nu a fost anunțată', err))

    /* And to the one who cancelled.
     *
     * Booking sends the calendar invitation to both of them; cancelling withdrew
     * it only from the coordinator. The student who cancelled their own
     * consultation was left with the accepted event in their calendar, forever —
     * they knew they had cancelled, but their calendar did not, and it is the
     * calendar that reminds them on Tuesday at 14:00.
     *
     * The same UID and the same `SEQUENCE`, so it is exactly their event, withdrawn. */
    void sendEmail({
      to: cancelled.student_email,
      subject: `Consultația din ${when} a fost anulată`,
      html: template(
        'Consultația a fost anulată',
        html`<p>
           Bună, ${cancelled.student_name.split(' ')[0]}. Ai anulat consultația din ${when} cu
           <strong>${cancelled.teacher_name}</strong>.
         </p>
         <p>Am retras și invitația din calendar. Poți rezerva altă oră oricând.</p>`,
        { text: 'Vezi orele libere', url: `${process.env.APP_BASE_URL ?? url.origin}/consultatii` },
      ),
      attachments: atasament,
    }).catch((err) => console.error('[rezervari] confirmarea anulării nu a plecat', err))

    return back('Rezervarea a fost anulată. Coordonatorul a fost anunțat.')
  }

  /* The slot must be free, in the future, not cancelled — and your own
   * coordinator's.
   *
   * The last two conditions were missing: the page showed only the slots of the
   * student's own coordinator, but the interface is not an authorization. With a
   * `slot_id` obtained some other way, anyone authenticated could book with any
   * teacher, including a slot reserved through `student_id` for one particular
   * student.
   *
   * All the conditions sit in the INSERT, so two simultaneous requests cannot
   * both take the last seat. */
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

  if (!booking) return back('Ora nu mai este liberă — cineva a luat locul înaintea ta. Alege altă oră din listă.', true)

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
      uid: consultationUid(slotId, u.id),
      title: `Consultație — ${slot.teacher_name}`,
      description: subject || 'Consultație pentru lucrarea de finalizare a studiilor.',
      location,
      meetingUrl: slot.meeting_url ?? undefined,
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
          html`<p><strong>${u.name}</strong> (${u.student_number ?? '—'}) a rezervat ora:</p>${body}`,
        ),
        attachments: attachment,
      }),
    ])
  }

  return back('Oră rezervată. Invitația de calendar a plecat pe email.')
}
