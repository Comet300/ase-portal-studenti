import type { APIRoute } from 'astro'
import { isDepartmentHead, isTeacher } from '../../lib/auth'
import { query } from '../../lib/db'
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

const COLUMNS = [
  'Nr. cerere',
  'Student',
  'Număr matricol',
  'Nivel',
  'Specializare',
  'Limbă',
  'An',
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

export const GET: APIRoute = async ({ locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Pagina nu a fost găsită', { status: 404 })

  const all = isDepartmentHead(u) && url.searchParams.get('doar_ale_mele') !== '1'

  const rows = await query<Record<string, unknown>>(
    `SELECT r.number, s.name AS student_name, s.student_number, s.program, s.specialization,
            s.study_language, s.study_year, s.study_group, s.email AS student_email,
            t.name AS teacher_name, t.academic_title,
            r.title_ro, r.title_en, r.decided_at,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id AND m.status = 'done') AS done,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id) AS total
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.status = 'approved'
        AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        AND ($1 OR r.teacher_id = $2)
      ORDER BY t.name, s.name`,
    [all, u!.id],
  )

  const lines = [
    COLUMNS.join(';'),
    ...rows.map((r) =>
      [
        r.number,
        r.student_name,
        r.student_number,
        levelLabel(r.program as string | null),
        r.specialization,
        languageLabel(r.study_language as string | null),
        r.study_year,
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

  const filename = all ? 'coordonari-departament.csv' : 'coordonarile-mele.csv'

  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
