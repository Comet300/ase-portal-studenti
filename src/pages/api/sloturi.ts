import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, query } from '../../lib/db'
import { redirectWithNotice } from '../../lib/http'

/**
 * Intervalele de consultație.
 *
 * Publicarea acceptă o zi și un interval orar și creează câte un slot pe oră,
 * pentru că așa arată în practică un program de consultații.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const form = await request.formData()
  const action = String(form.get('actiune') ?? 'publica')
  const redirectTo = '/profesor/studenti?sectiune=consultatii'

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'publica') {
    const day = String(form.get('zi') ?? '')
    const startHour = Number(form.get('ora_start') ?? 14)
    const endHour = Number(form.get('ora_final') ?? 16)
    const mode = String(form.get('mod') ?? 'in_person')
    const location = String(form.get('location') ?? '').trim()
    const meetingUrl = String(form.get('link_online') ?? '').trim()

    if (!day || !Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
      return back('Alege ziua și un interval orar valid.', true)
    }
    if (!['in_person', 'online'].includes(mode)) return back('Mod invalid.', true)

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

  if (action === 'anuleaza') {
    const slotId = String(form.get('slot_id') ?? '')

    // Anularea marchează și rezervările, ca studentul să nu rămână cu o
    // booking la un interval care nu mai există.
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
