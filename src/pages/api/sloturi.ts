import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, query } from '../../lib/db'
import { redirect, redirectWithNotice } from '../../lib/http'

/**
 * Intervalele de consultație.
 *
 * Publicarea acceptă o zi și un interval orar și creează câte un slot pe oră,
 * pentru că așa arată în practică un program de consultații.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const actiune = String(date.get('actiune') ?? 'publica')
  const redirectTo = '/profesor/studenti?sectiune=consultatii'

  const inapoi = (mesaj: string, eroare = false) =>
    redirectWithNotice(redirectTo, mesaj, isError)

  if (action === 'publica') {
    const day = String(date.get('day') ?? '')
    const startHour = Number(date.get('ora_start') ?? 14)
    const endHour = Number(date.get('ora_final') ?? 16)
    const mod = String(date.get('mod') ?? 'in_person')
    const location = String(date.get('location') ?? '').trim()
    const meetingUrl = String(date.get('link_online') ?? '').trim()

    if (!day || !Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
      return back('Alege ziua și un interval orar valid.', true)
    }
    if (!['in_person', 'online'].includes(mod)) return back('Mod invalid.', true)

    const hours = Math.min(endHour - startHour, 8)
    let created = 0

    for (let i = 0; i < ore; i++) {
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
        [u!.id, zi, String(oraStart + i), String(oraStart + i + 1), mod, locatie, link],
      )
      create += n
    }

    return inapoi(
      create > 0
        ? `${created} ${created === 1 ? 'interval publicat' : 'intervale publicate'}.`
        : 'Intervalele existau deja.',
      created === 0,
    )
  }

  if (action === 'anuleaza') {
    const slotId = String(date.get('slot_id') ?? '')

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

    return inapoi(
      n
        ? anulate.length > 0
          ? 'Intervalul a fost cancelled, iar rezervarea a fost retrasă.'
          : 'Intervalul a fost cancelled.'
        : 'Intervalul nu a fost găsit.',
      !n,
    )
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
