import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isDepartmentHead, isTeacher } from '../../lib/auth'
import { query, queryOne } from '../../lib/db'
import { id } from '../../lib/ids'
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
 * Excel on a Romanian locale splits on `;`, not `,` — and these titles and names
 * are full of commas — so the separator is the semicolon and the file is written
 * with a BOM so the diacritics survive the double-click.
 */

/* „Student” carries the name as it is written in the register, initial
 * included, and the initial also travels in a column of its own: the
 * secretariat matches this file against lists where the two are separate
 * fields. */
const COLUMNS = [
  'Nr. cerere',
  'Student',
  'Inițiala tatălui',
  'Număr matricol',
  'Nivel',
  'Specializare',
  'Limbă',
  'An',
  'Seria',
  'Grupa',
  'Email student',
  'Coordonator',
  'Titlu didactic',
  'Titlul lucrării (RO)',
  'Titlul lucrării (EN)',
  'Aprobată la',
  'Termene finalizate',
  'Termene total',
]

function cell(value: unknown): string {
  const text = value == null ? '' : String(value)
  // A semicolon, quote or newline inside a field would otherwise shift every
  // column after it.
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

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

  const lines = [
    COLUMNS.join(';'),
    ...rows.map((r) =>
      [
        r.number,
        officialName({
          name: r.student_name as string,
          father_initial: r.father_initial as string | null,
        }),
        formatInitial(r.father_initial as string | null),
        r.student_number,
        levelLabel(r.program as string | null),
        r.specialization,
        languageLabel(r.study_language as string | null),
        r.study_year,
        r.study_series,
        r.study_group,
        r.student_email,
        r.teacher_name,
        r.academic_title,
        r.title_ro,
        r.title_en,
        r.decided_at ? new Date(r.decided_at as string).toISOString().slice(0, 10) : '',
        r.done,
        r.total,
      ]
        .map(cell)
        .join(';'),
    ),
  ]

  /* The file name says which cohort is inside it: two exports from two years
     both landed as „coordonarile-mele.csv” in the Downloads folder. */
  const yearLabel = (
    await queryOne<{ label: string }>(
      `SELECT label FROM academic_years
        WHERE id = COALESCE($1::uuid, (SELECT id FROM academic_years WHERE is_current))`,
      [yearId],
    )
  )?.label
  const suffix = yearLabel ? '-' + yearLabel.replace(/[^\x20-\x7e]+/g, '-') : ''
  const filename = `${all ? 'coordonari-departament' : 'coordonarile-mele'}${suffix}.csv`

  await recordAccess({ userId: u!.id, action: 'export_coordonari', subject: url.pathname + url.search, rowCount: rows.length, request })

  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
