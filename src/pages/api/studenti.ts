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
  const anBrut = form.get('an_studiu')
  const studyGroup = String(form.get('grupa') ?? '').trim()

  /* Unul sau mai mulți.
   *
   * Un an întreg se corectează după listele de la secretariat: treizeci de
   * studenți din aceeași grupă, aceeași mutare de treizeci de ori. `getAll`, nu
   * `get`: cu bifele din tabel vin mai multe câmpuri cu același nume, iar `get`
   * ar întoarce doar primul. */
  const studentIds = [...form.getAll('student_id'), ...form.getAll('studenti')]
    .map((v) => formId(v))
    .filter((v): v is string => v !== null)

  /* Filtrele și locul din pagină se păstrează.
   *
   * Se întorcea la `/profesor/facultate` curat: după fiecare salvare, directorul
   * care lucra pe „master, fără cerere depusă” primea din nou toată facultatea și
   * capul listei. Adresa vine din pagină și trece prin `internalPath`, ca un
   * parametru scris de mână să nu poată trimite pe nimeni în altă parte. */
  const inapoi = internalPath(String(form.get('redirect') ?? ''), PAGE)

  const back = (message: string, isError = false) => redirectWithNotice(inapoi, message, isError)

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
  const mutati = studenti.filter((s) => s.programme_id !== programme.id).length

  /* O singură instrucțiune pentru toți: treizeci de UPDATE-uri într-o buclă ar
   * lăsa jumătatea dintâi mutată și restul nu, dacă a doua jumătate eșuează. */
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

  /* Mesajul spunea „a fost mutat la X” la fiecare salvare, chiar când programul
   * nu se schimbase și se corectase doar grupa — și punea participiul la
   * masculin pentru oricine. Formularea neutră evită și una, și alta. */
  if (studenti.length === 1) {
    return back(
      mutati === 1
        ? `${studenti[0].name}: program schimbat în ${programme.name}.`
        : `Datele lui ${studenti[0].name} au fost salvate.`,
    )
  }

  return back(
    mutati > 0
      ? `${studenti.length} studenți salvați, dintre care ${mutati} mutați la ${programme.name}.`
      : `${studenti.length} studenți salvați.`,
  )
}
