import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { deadEnd, redirectWithNotice } from '../../lib/http'
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
  const studentId = formId(form.get('student_id'))
  const programmeId = formId(form.get('program_id'))
  const anBrut = form.get('an_studiu')
  const studyGroup = String(form.get('grupa') ?? '').trim()

  const back = (message: string, isError = false) => redirectWithNotice(PAGE, message, isError)

  const student = await queryOne<{ name: string; programme_id: string | null }>(
    `SELECT name, programme_id FROM users WHERE id = $1 AND role = 'student'`,
    [studentId],
  )
  if (!student) return back('Studentul nu a fost găsit.', true)

  // A programme from another academic year would put the student in a cohort
  // that is not running, so the lookup is scoped to the current one.
  const programme = await queryOne<{ id: string; level: string; name: string; language: string }>(
    `SELECT id, level, name, language
       FROM study_programmes
      WHERE id = $1 AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
    [programmeId],
  )
  if (!programme) return back('Alege un program de studiu din anul curent.', true)

  /* Câmp gol înseamnă „nu schimba”, nu „anul 1”.
   *
   * `Number('')` este 0, `Number.isFinite(0)` este adevărat, iar limitarea la
   * 1–6 îl ridica la 1 — deci `COALESCE` nu vedea niciodată NULL. Câmpul se
   * randează gol pentru orice student fără an înregistrat, așa că un director
   * care corecta doar grupa îi ștergea anul, fără ca mesajul de confirmare să
   * pomenească nimic. */
  const anText = anBrut === null ? '' : String(anBrut).trim()
  let year: number | null = null

  if (anText !== '') {
    const n = Number(anText)
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      return back('Anul de studiu trebuie să fie un număr între 1 și 6.', true)
    }
    year = Math.trunc(n)
  }

  // Ce s-a schimbat de fapt, ca mesajul să nu anunțe o mutare care nu a avut loc.
  const aMutat = student.programme_id !== programme.id

  await execute(
    `UPDATE users
        SET programme_id   = $2,
            program        = $3,
            specialization = $4,
            study_language = $5,
            study_year     = COALESCE($6, study_year),
            study_group    = NULLIF($7, '')
      WHERE id = $1 AND role = 'student'`,
    [studentId, programme.id, programme.level, programme.name, programme.language, year, studyGroup],
  )

  /* Mesajul spunea „a fost mutat la X” la fiecare salvare, chiar când programul
   * nu se schimbase și se corectase doar grupa — și punea participiul la
   * masculin pentru oricine. Formularea neutră evită și una, și alta. */
  return back(
    aMutat
      ? `${student.name}: program schimbat în ${programme.name}.`
      : `Datele lui ${student.name} au fost salvate.`,
  )
}
