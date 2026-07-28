import type { APIRoute } from 'astro'
import { esteProfesor } from '../../lib/auth'
import { execute } from '../../lib/db'

/**
 * Cronologia editabilă a unei lucrări.
 *
 * Jaloanele nu au coloană de proprietar — aparțin cererii, iar cererea aparține
 * coordonatorului. De aceea fiecare instrucțiune poartă un `EXISTS` către
 * `cereri`, în aceeași frază cu scrierea.
 */

const inapoi = (url: URL, redirect: string, mesaj: string, eroare = false) =>
  Response.redirect(
    new URL(`${redirect}?notificare=${encodeURIComponent(mesaj)}${eroare ? '&tip=error' : ''}`, url),
    303,
  )

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.utilizator
  if (!esteProfesor(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const actiune = String(date.get('actiune') ?? '')
  const redirect = String(date.get('redirect') ?? '/profesor/studenti')

  if (actiune === 'adauga') {
    const cerereId = String(date.get('cerere_id') ?? '')
    const titlu = String(date.get('titlu') ?? '').trim()
    const termen = String(date.get('termen') ?? '').trim()
    const descriere = String(date.get('descriere') ?? '').trim()

    if (!titlu) return inapoi(url, redirect, 'Titlul jalonului este obligatoriu.', true)

    const n = await execute(
      `INSERT INTO jaloane (cerere_id, titlu, descriere, termen, ordine)
       SELECT $2, $3, $4, NULLIF($5, '')::date,
              COALESCE((SELECT max(ordine) + 1 FROM jaloane WHERE cerere_id = $2), 0)
        WHERE EXISTS (SELECT 1 FROM cereri c WHERE c.id = $2 AND c.profesor_id = $1)`,
      [u!.id, cerereId, titlu, descriere || null, termen],
    )
    return inapoi(url, redirect, n ? 'Jalon adăugat.' : 'Cererea nu a fost găsită.', !n)
  }

  if (actiune === 'actualizeaza') {
    const jalonId = String(date.get('jalon_id') ?? '')
    const titlu = String(date.get('titlu') ?? '').trim()
    const termen = String(date.get('termen') ?? '').trim()
    const descriere = String(date.get('descriere') ?? '').trim()
    const status = String(date.get('status') ?? '')

    if (!['planificat', 'in_lucru', 'finalizat'].includes(status)) {
      return inapoi(url, redirect, 'Stare invalidă.', true)
    }

    const n = await execute(
      `UPDATE jaloane j
          SET titlu = COALESCE(NULLIF($3, ''), j.titlu),
              descriere = NULLIF($4, ''),
              termen = NULLIF($5, '')::date,
              status = $6
        WHERE j.id = $2
          AND EXISTS (SELECT 1 FROM cereri c WHERE c.id = j.cerere_id AND c.profesor_id = $1)`,
      [u!.id, jalonId, titlu, descriere, termen, status],
    )
    return inapoi(url, redirect, n ? 'Jalon actualizat.' : 'Jalonul nu a fost găsit.', !n)
  }

  if (actiune === 'sterge') {
    const jalonId = String(date.get('jalon_id') ?? '')
    const n = await execute(
      `DELETE FROM jaloane j
        WHERE j.id = $2
          AND EXISTS (SELECT 1 FROM cereri c WHERE c.id = j.cerere_id AND c.profesor_id = $1)`,
      [u!.id, jalonId],
    )
    return inapoi(url, redirect, n ? 'Jalon șters.' : 'Jalonul nu a fost găsit.', !n)
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
