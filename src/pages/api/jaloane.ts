import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'
import { redirect } from '../../lib/http'

/**
 * Cronologia editabilă a unei lucrări.
 *
 * Jaloanele nu au coloană de proprietar — aparțin cererii, iar cererea aparține
 * coordonatorului. De aceea fiecare instrucțiune poartă un `EXISTS` către
 * `cereri`, în aceeași frază cu scrierea.
 */

const inapoi = (url: URL, redirect: string, mesaj: string, eroare = false) =>
  redirect(
    new URL(`${redirectTo}?notificare=${encodeURIComponent(mesaj)}${eroare ? '&tip=error' : ''}`, url),
    303,
  )

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const actiune = String(date.get('actiune') ?? '')
  const redirectTo = String(date.get('redirect') ?? '/profesor/studenti')

  if (actiune === 'adauga') {
    const cerereId = String(date.get('cerere_id') ?? '')
    const titlu = String(date.get('titlu') ?? '').trim()
    const termen = String(date.get('termen') ?? '').trim()
    const descriere = String(date.get('descriere') ?? '').trim()

    if (!titlu) return inapoi(url, redirectTo, 'Titlul jalonului este obligatoriu.', true)

    const n = await execute(
      `INSERT INTO milestones (request_id, title, description, due_on, position)
       SELECT $2, $3, $4, NULLIF($5, '')::date,
              COALESCE((SELECT max(position) + 1 FROM milestones WHERE request_id = $2), 0)
        WHERE EXISTS (SELECT 1 FROM requests c WHERE c.id = $2 AND c.teacher_id = $1)`,
      [u!.id, cerereId, title, descriere || null, termen],
    )
    return inapoi(url, redirectTo, n ? 'Jalon adăugat.' : 'Cererea nu a fost găsită.', !n)
  }

  if (actiune === 'actualizeaza') {
    const jalonId = String(date.get('jalon_id') ?? '')
    const titlu = String(date.get('titlu') ?? '').trim()
    const termen = String(date.get('termen') ?? '').trim()
    const descriere = String(date.get('descriere') ?? '').trim()
    const status = String(date.get('status') ?? '')

    if (!['planned', 'in_progress', 'done'].includes(status)) {
      return inapoi(url, redirectTo, 'Stare invalidă.', true)
    }

    const n = await execute(
      `UPDATE milestones j
          SET title = COALESCE(NULLIF($3, ''), j.title),
              description = NULLIF($4, ''),
              due_on = NULLIF($5, '')::date,
              status = $6
        WHERE j.id = $2
          AND EXISTS (SELECT 1 FROM requests c WHERE c.id = j.request_id AND c.teacher_id = $1)`,
      [u!.id, jalonId, title, description, due_on, status],
    )
    return inapoi(url, redirectTo, n ? 'Jalon actualizat.' : 'Jalonul nu a fost găsit.', !n)
  }

  if (actiune === 'sterge') {
    const jalonId = String(date.get('jalon_id') ?? '')
    const n = await execute(
      `DELETE FROM milestones j
        WHERE j.id = $2
          AND EXISTS (SELECT 1 FROM requests c WHERE c.id = j.request_id AND c.teacher_id = $1)`,
      [u!.id, jalonId],
    )
    return inapoi(url, redirectTo, n ? 'Jalon șters.' : 'Jalonul nu a fost găsit.', !n)
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
