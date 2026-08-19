import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { deadEnd, redirectWithNotice, redirectWithUndo } from '../../lib/http'
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

    // The stage belongs to the current year, and the position is counted only
    // among that year's stages: otherwise the first stage of a new year would
    // continue the numbering of the one that ended, and the column is NOT NULL,
    // so leaving it out does not go through at all.
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

    /* What is being deleted is read first, so that it can be put back.
     *
     * `RETURNING` does both in a single statement: without it there would be a
     * `SELECT` and a `DELETE` with a window between them in which the row can
     * change. The notice receives exactly what left. */
    const deletedStage = await queryOne<{
      title: string
      interval_label: string
      description: string | null
      starts_on: string | null
      ends_on: string | null
      position: number
    }>(
      `DELETE FROM session_stages WHERE id = $1
       RETURNING title, interval_label, description,
                 starts_on::text, ends_on::text, position`,
      [id],
    )

    if (!deletedStage) return back('Etapa nu a fost găsită.', true)

    return redirectWithUndo('/profesor/calendar', `Etapa „${deletedStage.title}” a fost ștearsă.`, {
      to: '/api/etape',
      date: {
        actiune: 'restaureaza',
        titlu: deletedStage.title,
        interval: deletedStage.interval_label,
        descriere: deletedStage.description ?? '',
        inceput: deletedStage.starts_on ?? '',
        sfarsit: deletedStage.ends_on ?? '',
        pozitie: String(deletedStage.position),
      },
    })
  }

  /* Undoing a deletion.
   *
   * This is not a “restore” in the recycle-bin sense: the row is written again,
   * with a new id, at the position it used to have. Nothing refers to the id of
   * a stage, so the difference is not visible — and the alternative, a
   * `deleted_at` over the whole table, would have required every read in the
   * portal to know about it.
   *
   * The gate stays the same: the head of department, checked above. */
  if (action === 'restaureaza') {
    const title = String(form.get('titlu') ?? '').trim()
    const intervalLabel = String(form.get('interval') ?? '').trim()
    if (!title || !intervalLabel) return back('Etapa nu a putut fi refăcută.', true)

    const pozitie = Number(form.get('pozitie') ?? '')
    await execute(
      `INSERT INTO session_stages (academic_year_id, position, title, description,
                                   interval_label, starts_on, ends_on)
       VALUES ((SELECT id FROM academic_years WHERE is_current),
               COALESCE($6::int, (SELECT COALESCE(max(position), 0) + 1 FROM session_stages
                                   WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current))),
               $1, NULLIF($2, ''), $3, NULLIF($4, '')::date, NULLIF($5, '')::date)`,
      [
        title,
        String(form.get('descriere') ?? '').trim(),
        intervalLabel,
        String(form.get('inceput') ?? '').trim(),
        String(form.get('sfarsit') ?? '').trim(),
        Number.isFinite(pozitie) ? Math.trunc(pozitie) : null,
      ],
    )

    return back(`Etapa „${title}” a fost pusă înapoi.`)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
