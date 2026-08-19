import type { APIRoute } from 'astro'
import { queryOne } from '../../lib/db'
import { buildIcs, consultationUid } from '../../lib/ics'
import { id as routeId } from '../../lib/ids'

/**
 * The calendar invitation, downloadable from the portal.
 *
 * The file was already built at booking time and left only by email. Whoever
 * deleted it by mistake, or read it on a phone that did not add the event
 * automatically, had nowhere left to take it from — even though the portal
 * could generate it at any time from the same data.
 *
 * Ownership is checked in the same query that fetches the data, as everywhere
 * else in the portal: a student sees only their own booking.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const slotId = routeId((params.id ?? '').replace(/\.ics$/, ''))
  if (!slotId) return new Response('Rezervarea nu a fost găsită', { status: 404 })

  const r = await queryOne<{
    starts_at: string
    ends_at: string
    mode: string
    location: string | null
    meeting_url: string | null
    note: string | null
    subject: string | null
    teacher_name: string
    teacher_email: string
    student_name: string
    student_email: string
  }>(
    `SELECT s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url, s.note,
            b.subject,
            t.name AS teacher_name, t.email AS teacher_email,
            st.name AS student_name, st.email AS student_email
       FROM bookings b
       JOIN consultation_slots s ON s.id = b.slot_id
       JOIN users t ON t.id = s.teacher_id
       JOIN users st ON st.id = b.student_id
      WHERE b.slot_id = $2 AND b.student_id = $1 AND b.status = 'booked'
        AND s.is_cancelled = false`,
    [u.id, slotId],
  )

  if (!r) return new Response('Rezervarea nu a fost găsită', { status: 404 })

  const location = r.mode === 'online' ? (r.meeting_url ?? 'Online') : (r.location ?? 'Cabinet')

  const ics = buildIcs({
    uid: consultationUid(slotId, u.id),
    title: `Consultație cu ${r.teacher_name}`,
    description: r.note ?? r.subject ?? 'Consultație pentru lucrarea de finalizare a studiilor.',
    location,
    meetingUrl: r.meeting_url ?? undefined,
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
    organizerName: r.teacher_name,
    organizerEmail: r.teacher_email,
    attendeeName: r.student_name,
    attendeeEmail: r.student_email,
  })

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="consultatie-${slotId.slice(0, 8)}.ics"`,
      'cache-control': 'private, no-store',
    },
  })
}
