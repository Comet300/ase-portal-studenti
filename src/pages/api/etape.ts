import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute } from '../../lib/db'
import { redirectWithNotice } from '../../lib/http'

/**
 * The session calendar.
 *
 * Every other screen navigates by these stages, and the downloadable .ics is
 * built from them, so editing is restricted to the head of department rather
 * than to any teacher.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isDepartmentHead(locals.user)) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  const form = await request.formData()
  const action = String(form.get('actiune') ?? '')
  const back = (message: string, isError = false) =>
    redirectWithNotice('/profesor/calendar', message, isError)

  if (action === 'adauga') {
    const title = String(form.get('titlu') ?? '').trim()
    const intervalLabel = String(form.get('interval') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()
    const startsOn = String(form.get('inceput') ?? '').trim()
    const endsOn = String(form.get('sfarsit') ?? '').trim()

    if (!title || !intervalLabel) {
      return back('Titlul și intervalul afișat sunt obligatorii.', true)
    }
    if (startsOn && endsOn && startsOn > endsOn) {
      return back('Data de început este după data de sfârșit.', true)
    }

    await execute(
      `INSERT INTO session_stages (position, title, description, interval_label, starts_on, ends_on)
       VALUES (COALESCE((SELECT max(position) + 1 FROM session_stages), 1),
               $1, NULLIF($2, ''), $3, NULLIF($4, '')::date, NULLIF($5, '')::date)`,
      [title, description, intervalLabel, startsOn, endsOn],
    )
    return back('Etapă adăugată.')
  }

  if (action === 'actualizeaza') {
    const id = String(form.get('etapa_id') ?? '')
    const title = String(form.get('titlu') ?? '').trim()
    const intervalLabel = String(form.get('interval') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()
    const startsOn = String(form.get('inceput') ?? '').trim()
    const endsOn = String(form.get('sfarsit') ?? '').trim()

    if (!title || !intervalLabel) {
      return back('Titlul și intervalul afișat sunt obligatorii.', true)
    }
    if (startsOn && endsOn && startsOn > endsOn) {
      return back('Data de început este după data de sfârșit.', true)
    }

    const n = await execute(
      `UPDATE session_stages
          SET title = $2, description = NULLIF($3, ''), interval_label = $4,
              starts_on = NULLIF($5, '')::date, ends_on = NULLIF($6, '')::date
        WHERE id = $1`,
      [id, title, description, intervalLabel, startsOn, endsOn],
    )
    return back(n ? 'Etapă actualizată.' : 'Etapa nu a fost găsită.', !n)
  }

  if (action === 'muta') {
    const id = String(form.get('etapa_id') ?? '')
    const direction = String(form.get('directie') ?? '')
    if (!['sus', 'jos'].includes(direction)) return back('Direcție invalidă.', true)

    // Swap with the neighbour rather than renumbering the whole list: fewer
    // writes, and the order stays stable if two edits land close together.
    const n = await execute(
      `WITH me AS (SELECT id, position FROM session_stages WHERE id = $1),
            neighbour AS (
              SELECT s.id, s.position FROM session_stages s, me
               WHERE ($2 = 'sus'  AND s.position < me.position)
                  OR ($2 = 'jos'  AND s.position > me.position)
               ORDER BY CASE WHEN $2 = 'sus' THEN -s.position ELSE s.position END
               LIMIT 1
            )
       UPDATE session_stages t
          SET position = CASE WHEN t.id = (SELECT id FROM me) THEN (SELECT position FROM neighbour)
                              ELSE (SELECT position FROM me) END
        WHERE t.id IN (SELECT id FROM me UNION SELECT id FROM neighbour)
          AND EXISTS (SELECT 1 FROM neighbour)`,
      [id, direction],
    )
    return back(n ? 'Ordinea a fost schimbată.' : 'Etapa este deja la capăt.', !n)
  }

  if (action === 'sterge') {
    const id = String(form.get('etapa_id') ?? '')
    const n = await execute('DELETE FROM session_stages WHERE id = $1', [id])
    return back(n ? 'Etapă ștearsă.' : 'Etapa nu a fost găsită.', !n)
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
