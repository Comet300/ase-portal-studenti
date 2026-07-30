import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute } from '../../lib/db'
import { deadEnd, redirectWithNotice } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'

/**
 * The session calendar.
 *
 * Every other screen navigates by these stages, and the downloadable .ics is
 * built from them, so editing is restricted to the head of department rather
 * than to any teacher.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isDepartmentHead(locals.user)) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const form = await request.formData()
  const action = formAction(form)
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

    // Etapa aparține anului în curs, iar poziția se numără doar între etapele
    // acelui an: altfel prima etapă a unui an nou ar continua numerotarea celui
    // încheiat, iar coloana este NOT NULL, deci omiterea ei nu trece deloc.
    await execute(
      `INSERT INTO session_stages
         (academic_year_id, position, title, description, interval_label, starts_on, ends_on)
       SELECT y.id,
              COALESCE((SELECT max(position) + 1 FROM session_stages WHERE academic_year_id = y.id), 1),
              $1, NULLIF($2, ''), $3, NULLIF($4, '')::date, NULLIF($5, '')::date
         FROM academic_years y
        WHERE y.is_current`,
      [title, description, intervalLabel, startsOn, endsOn],
    )
    return back('Etapă adăugată.')
  }

  if (action === 'actualizeaza') {
    const id = formId(form.get('etapa_id'))
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
    const id = formId(form.get('etapa_id'))
    const direction = String(form.get('directie') ?? '')
    if (!['sus', 'jos'].includes(direction)) return back('Direcție invalidă.', true)

    // Swap with the neighbour rather than renumbering the whole list: fewer
    // writes, and the order stays stable if two edits land close together.
    const n = await execute(
      `WITH me AS (
              SELECT id, position, academic_year_id FROM session_stages WHERE id = $1
            ),
            neighbour AS (
              SELECT s.id, s.position FROM session_stages s, me
               WHERE s.academic_year_id = me.academic_year_id
                 AND (($2 = 'sus' AND s.position < me.position)
                   OR ($2 = 'jos' AND s.position > me.position))
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
    const id = formId(form.get('etapa_id'))
    const n = await execute('DELETE FROM session_stages WHERE id = $1', [id])
    return back(n ? 'Etapă ștearsă.' : 'Etapa nu a fost găsită.', !n)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
