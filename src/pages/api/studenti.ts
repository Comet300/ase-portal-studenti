import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, query, queryOne } from '../../lib/db'
import { deadEnd, internalPath, redirectWithNotice } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/**
 * Which group a student belongs to.
 *
 * The registrar decides this, not the student — so it is editable only by the
 * head of department, and only here. The programme carries level, name and
 * language, and those three are written onto the student in the same statement:
 * every screen that groups or filters reads the plain columns, and a programme
 * that disagreed with them would split one cohort into two.
 */

const PAGE = '/profesor/facultate'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isDepartmentHead(locals.user)) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const form = await request.formData()
  const programmeId = formId(form.get('program_id'))
  const rawYear = form.get('an_studiu')
  const studyGroup = String(form.get('grupa') ?? '').trim()

  /* One or many.
   *
   * A whole year gets corrected against the lists from the registrar: thirty
   * students from the same group, the same move thirty times over. `getAll`,
   * not `get`: the checkboxes in the table send several fields with the same
   * name, and `get` would return only the first. */
  const studentIds = [...form.getAll('student_id'), ...form.getAll('studenti')]
    .map((v) => formId(v))
    .filter((v): v is string => v !== null)

  /* The filters and the place in the page are kept.
   *
   * It used to go back to a bare `/profesor/facultate`: after every save, the
   * head of department working on „master, fără cerere depusă” got the whole
   * faculty again and the top of the list. The address comes from the page and
   * goes through `internalPath`, so that a hand-written parameter cannot send
   * anyone somewhere else. */
  const backUrl = internalPath(String(form.get('redirect') ?? ''), PAGE)

  const back = (message: string, isError = false) => redirectWithNotice(backUrl, message, isError)

  if (studentIds.length === 0) return back('Niciun student selectat.', true)

  const studenti = await query<{ id: string; name: string; programme_id: string | null }>(
    `SELECT id, name, programme_id FROM users WHERE id = ANY($1::uuid[]) AND role = 'student'`,
    [studentIds],
  )
  if (studenti.length === 0) return back('Studentul nu a fost găsit.', true)

  // A programme from another academic year would put the student in a cohort
  // that is not running, so the lookup is scoped to the current one.
  const programme = await queryOne<{ id: string; level: string; name: string; language: string }>(
    `SELECT id, level, name, language
       FROM study_programmes
      WHERE id = $1 AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
    [programmeId],
  )
  if (!programme) return back('Alege un program de studiu din anul curent.', true)

  /* An empty field means „nu schimba”, not „anul 1”.
   *
   * `Number('')` is 0, `Number.isFinite(0)` is true, and the clamp to 1–6
   * raised it to 1 — so `COALESCE` never saw NULL. The field renders empty for
   * any student with no year on record, so a head of department who was
   * correcting only the group wiped their year, without the confirmation
   * message mentioning anything. */
  const yearText = rawYear === null ? '' : String(rawYear).trim()
  let year: number | null = null

  if (yearText !== '') {
    const n = Number(yearText)
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      return back('Anul de studiu trebuie să fie un număr între 1 și 6.', true)
    }
    year = Math.trunc(n)
  }

  // What actually changed, so that the message does not announce a move that
  // never took place.
  const moved = studenti.filter((s) => s.programme_id !== programme.id).length

  /* A single statement for all of them: thirty UPDATEs in a loop would leave
   * the first half moved and the rest not, if the second half fails. */
  await execute(
    `UPDATE users
        SET programme_id   = $2,
            program        = $3,
            specialization = $4,
            study_language = $5,
            study_year     = COALESCE($6, study_year),
            study_group    = COALESCE(NULLIF($7, ''), study_group)
      WHERE id = ANY($1::uuid[]) AND role = 'student'`,
    [studenti.map((s) => s.id), programme.id, programme.level, programme.name, programme.language, year, studyGroup],
  )

  /* The message said „a fost mutat la X” on every save, even when the
   * programme had not changed and only the group had been corrected — and it
   * put the participle in the masculine for everyone. The neutral wording
   * avoids both. */
  if (studenti.length === 1) {
    return back(
      moved === 1
        ? `${studenti[0].name}: program schimbat în ${programme.name}.`
        : `Datele lui ${studenti[0].name} au fost salvate.`,
    )
  }

  return back(
    moved > 0
      ? `${studenti.length} studenți salvați, dintre care ${moved} mutați la ${programme.name}.`
      : `${studenti.length} studenți salvați.`,
  )
}
