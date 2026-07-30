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

    /* Ce se șterge se citește înainte, ca să poată fi pus înapoi.
     *
     * `RETURNING` face amândouă într-o singură instrucțiune: fără el ar fi un
     * `SELECT` și un `DELETE` cu o fereastră între ele în care rândul se poate
     * schimba. Notificarea primește exact ce a plecat. */
    const stearsa = await queryOne<{
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

    if (!stearsa) return back('Etapa nu a fost găsită.', true)

    return redirectWithUndo('/profesor/calendar', `Etapa „${stearsa.title}” a fost ștearsă.`, {
      catre: '/api/etape',
      date: {
        actiune: 'restaureaza',
        titlu: stearsa.title,
        interval: stearsa.interval_label,
        descriere: stearsa.description ?? '',
        inceput: stearsa.starts_on ?? '',
        sfarsit: stearsa.ends_on ?? '',
        pozitie: String(stearsa.position),
      },
    })
  }

  /* Întoarcerea unei ștergeri.
   *
   * Nu este o „restaurare” în sensul unui coș de reciclare: rândul se scrie din
   * nou, cu un id nou, pe poziția pe care o avea. Nimic nu se referă la id-ul unei
   * etape, deci diferența nu se vede — iar alternativa, un `deleted_at` pe toată
   * tabela, ar fi cerut ca fiecare citire din portal să știe despre el.
   *
   * Poarta rămâne aceeași: directorul de departament, verificat mai sus. */
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
