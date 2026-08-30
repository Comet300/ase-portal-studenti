import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isDepartmentHead, isTeacher } from '../../lib/auth'
import { query, queryOne } from '../../lib/db'
import { id } from '../../lib/ids'
import { type Column, sheetFormat, sheetResponse } from '../../lib/sheet'
import { formatInitial, officialName } from '../../lib/text'
import { languageLabel, levelLabel } from '../../lib/years'

/**
 * The pairing situation, as a spreadsheet.
 *
 * Available to every coordinator, not only the head: the department needs the
 * whole table, and a coordinator needs their own rows for the paperwork that
 * still travels on paper. Which rows you get depends on your role, and the
 * condition is part of the query.
 *
 * Two files, one description of the columns (`lib/sheet.ts`): .xlsx by default,
 * because that is what „Excel” means to a secretariat and it is UTF-8 by
 * definition, and .csv for everything else — with the `;` a Romanian locale
 * splits on and a BOM in front, so the diacritics survive the double-click.
 */

type Row = Record<string, unknown>

const day = (value: unknown) =>
  value ? new Date(value as string).toISOString().slice(0, 10) : ''

/* „Student” carries the name as it is written in the register, initial
 * included, and the initial also travels in a column of its own: the
 * secretariat matches this file against lists where the two are separate
 * fields. */
const COLUMNS: Column<Row>[] = [
  { header: 'Nr. cerere', value: (r) => r.number as string },
  {
    header: 'Student',
    value: (r) =>
      officialName({
        name: r.student_name as string,
        father_initial: r.father_initial as string | null,
      }),
  },
  { header: 'Inițiala tatălui', value: (r) => formatInitial(r.father_initial as string | null) },
  { header: 'Număr matricol', value: (r) => r.student_number as string },
  { header: 'Nivel', value: (r) => levelLabel(r.program as string | null) },
  { header: 'Specializare', value: (r) => r.specialization as string },
  { header: 'Limbă', value: (r) => languageLabel(r.study_language as string | null) },
  { header: 'An', value: (r) => r.study_year as number },
  { header: 'Seria', value: (r) => r.study_series as string },
  { header: 'Grupa', value: (r) => r.study_group as string },
  { header: 'Email student', value: (r) => r.student_email as string },
  { header: 'Coordonator', value: (r) => r.teacher_name as string },
  { header: 'Titlu didactic', value: (r) => r.academic_title as string },
  { header: 'Titlul lucrării (RO)', value: (r) => r.title_ro as string },
  { header: 'Titlul lucrării (EN)', value: (r) => r.title_en as string },
  { header: 'Aprobată la', value: (r) => day(r.decided_at) },
  { header: 'Termene finalizate', value: (r) => r.done as number },
  { header: 'Termene total', value: (r) => r.total as number },
]

export const GET: APIRoute = async ({ locals, url, request }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Pagina nu a fost găsită', { status: 404 })

  const all = isDepartmentHead(u) && url.searchParams.get('doar_ale_mele') !== '1'

  /* The year, when the screen asking for the export has one selected.
   *
   * The archive is browsed by academic year, but the export answered only with
   * the current session: the button on a 2023 cohort downloaded 2026. An `an`
   * that is not a uuid falls back to the current session, not to „tot”. */
  const yearId = id(url.searchParams.get('an'))

  const rows = await query<Record<string, unknown>>(
    `SELECT r.number, s.name AS student_name, s.student_number, s.father_initial,
            s.program, s.specialization,
            s.study_language, s.study_year, s.study_series, s.study_group, s.email AS student_email,
            t.name AS teacher_name, t.academic_title,
            r.title_ro, r.title_en, r.decided_at,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id AND m.status = 'done') AS done,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id) AS total
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.status = 'approved'
        AND r.academic_year_id = COALESCE($3::uuid, (SELECT id FROM academic_years WHERE is_current))
        AND ($1 OR r.teacher_id = $2)
      ORDER BY t.name, s.name`,
    [all, u!.id, yearId],
  )

  /* The file name says which cohort is inside it: two exports from two years
     both landed as „coordonarile-mele.csv” in the Downloads folder. */
  const yearLabel = (
    await queryOne<{ label: string }>(
      `SELECT label FROM academic_years
        WHERE id = COALESCE($1::uuid, (SELECT id FROM academic_years WHERE is_current))`,
      [yearId],
    )
  )?.label

  await recordAccess({ userId: u!.id, action: 'export_coordonari', subject: url.pathname + url.search, rowCount: rows.length, request })

  return sheetResponse(
    sheetFormat(url.searchParams.get('format')),
    COLUMNS,
    rows,
    `${all ? 'coordonari-departament' : 'coordonarile-mele'}${yearLabel ? '-' + yearLabel : ''}`,
  )
}
