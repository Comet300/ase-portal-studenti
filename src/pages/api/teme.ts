import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { numar } from '../../lib/text'
import { id as formId } from '../../lib/ids'

/** The topics proposed by a teacher. Ownership is checked in every statement. */
export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form) || 'adauga'
  const redirectTo = '/profesor/teme'

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'adauga') {
    const title = String(form.get('titlu') ?? '').trim()
    const level = String(form.get('nivel') ?? '')
    const programmeId = formId(form.get('program_id'))
    const description = String(form.get('descriere') ?? '').trim()
    const methodology = String(form.get('metodologie') ?? '').trim()
    const domain = String(form.get('domeniu') ?? '').trim()

    if (!title || !['bachelor', 'master'].includes(level)) {
      return back('Completează titlul și nivelul temei.', true)
    }
    /* The browser filters the list of programmes by level; this is the check
     * that actually binds. A programme from another year, or a master's
     * programme under „Licență”, would put the topic in a catalogue where no
     * student can see it — and the seats it competes for are counted per
     * programme, so the mismatch would be arithmetic, not just a label. */
    const programme = programmeId
      ? await queryOne<{ id: string; language: string }>(
          `SELECT id, language FROM study_programmes
            WHERE id = $1 AND level = $2 AND is_active
              AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
          [programmeId, level],
        )
      : null

    if (!programme) {
      return back(
        'Alege un program de studii din anul curent, potrivit cu nivelul temei.',
        true,
      )
    }

    /* The three texts are capped where the form says they are. `maxlength` is
     * the browser's promise, not the portal's: a request that never went
     * through a form could write a thesis into a column meant for one line. */
    if (title.length > 300 || description.length > 800 || methodology.length > 200 || domain.length > 200) {
      return back('Textele depășesc lungimea permisă. Scurtează-le și reia.', true)
    }

    // Topics belong to the current year: a new year starts with an empty
    // catalogue, unless the director explicitly chooses to carry it over.
    //
    // The language is the programme's, not a second answer: „Limba lucrării”
    // and „Program de studii” could contradict each other, and the catalogue
    // filters on the language.
    await execute(
      `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                           methodology, domain, programme_id)
       VALUES ((SELECT id FROM academic_years WHERE is_current),
               $1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8)`,
      [u!.id, title, description, level, programme.language, methodology, domain, programme.id],
    )
    return back('Tema a fost publicată în catalog.')
  }

  /* --- preluarea temelor din alt an -----------------------------------------
   *
   * Aceeași operație pe care o face directorul când deschide anul, dar pentru
   * un singur cadru didactic și pentru temele bifate de el. Ownership-ul este
   * în instrucțiune, ca peste tot: se copiază doar temele lui, doar din anul
   * cerut, și doar în anul curent.
   *
   * Programul de studii călătorește după nume, nu după id: anul nou are
   * rândurile lui în `study_programmes`, iar id-ul vechi arată către lista de
   * anul trecut. Perechea `(level, name, language)` este aceeași pe care o
   * folosește `openYear`. O temă al cărei program nu s-a mai deschis anul
   * acesta vine fără program, și se vede pe ecran că îi lipsește. */
  if (action === 'preia') {
    const sourceYear = formId(form.get('an_sursa'))
    const ids = form.getAll('tema_id').map((v) => formId(v)).filter((v): v is string => Boolean(v))

    if (!sourceYear) return back('Anul din care se preiau temele nu a fost identificat.', true)
    if (ids.length === 0) return back('Bifează cel puțin o temă de preluat.', true)

    /* Titlurile care există deja în anul curent nu se dublează: ecranul le
     * ascunde, dar între afișare și trimitere poate trece o altă filă. */
    const n = await execute(
      `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                           methodology, domain, programme_id, is_active)
       SELECT curent.id, t.teacher_id, t.title, t.description, t.level, t.language,
              t.methodology, t.domain, nou.id, true
         FROM topics t
         CROSS JOIN (SELECT id FROM academic_years WHERE is_current) AS curent
         LEFT JOIN study_programmes vechi ON vechi.id = t.programme_id
         LEFT JOIN study_programmes nou
           ON nou.academic_year_id = curent.id
          AND nou.level = vechi.level
          AND nou.name = vechi.name
          AND nou.language = vechi.language
          AND nou.is_active
        WHERE t.teacher_id = $1
          AND t.academic_year_id = $2
          AND t.id = ANY($3::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM topics existenta
             WHERE existenta.teacher_id = t.teacher_id
               AND existenta.academic_year_id = curent.id
               AND lower(btrim(existenta.title)) = lower(btrim(t.title))
          )`,
      [u!.id, sourceYear, ids],
    )

    if (n === 0) {
      return back('Temele bifate sunt deja în catalogul acestui an.', true)
    }
    return back(
      `${numar(n, 'temă preluată', 'teme preluate')} în catalogul anului curent. Verifică programul de studii la fiecare.`,
    )
  }

  if (action === 'comuta') {
    const topicId = formId(form.get('tema_id'))
    const n = await execute(
      `UPDATE topics SET is_active = NOT is_active WHERE id = $2 AND teacher_id = $1`,
      [u!.id, topicId],
    )
    return back(n ? 'Disponibilitatea temei a fost schimbată.' : 'Tema nu a fost găsită.', !n)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
