import type { APIRoute } from 'astro'
import { recordAccess } from '../../../lib/audit'
import { isDepartmentHead } from '../../../lib/auth'
import { query } from '../../../lib/db'
import { STATUS_LABELS, programLabel } from '../../../lib/repo'
import { id } from '../../../lib/ids'
import { type Column, sheetFormat, sheetResponse } from '../../../lib/sheet'
import { formatInitial, officialName } from '../../../lib/text'
import { currentYearLabel } from '../../../lib/years'

/**
 * The department's requests, honouring the filters shown on screen.
 *
 * .xlsx by default and .csv on `?format=csv`, both written by `lib/sheet.ts` —
 * the same writer as the two other exports, so a column defined once cannot
 * drift between the files that are meant to be reconciled with each other.
 */
export const GET: APIRoute = async ({ locals, url, request }) => {
  if (!isDepartmentHead(locals.user)) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  const sesiune = (await currentYearLabel()) || 'curenta'

  const rows = await query<{
    number: string
    student_name: string
    student_number: string | null
    father_initial: string | null
    program: string | null
    specialization: string | null
    study_year: number | null
    study_series: string | null
    study_group: string | null
    teacher_name: string
    title_ro: string
    status: string
    submitted_at: string
    decided_at: string | null
  }>(
    `SELECT r.number, s.name AS student_name, s.student_number, s.father_initial,
            s.program, s.specialization, s.study_year, s.study_series, s.study_group,
            t.name AS teacher_name, r.title_ro, r.status, r.submitted_at, r.decided_at
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        AND ($1::uuid IS NULL OR r.teacher_id = $1)
        AND ($2::text IS NULL OR s.program = $2)
        AND ($3::text IS NULL OR r.status = $3)
        AND ($4::text IS NULL OR s.study_series = $4)
      ORDER BY t.name, s.name`,
    [
      // Same year as the table this button sits under: an export that quietly
      // spans every session does not reconcile with what is on screen.
      id(url.searchParams.get('coordonator')),
      url.searchParams.get('program') || null,
      url.searchParams.get('status') || null,
      // The series filter is on the screen too; a file that ignored it would
      // hold rows the table above it does not show.
      url.searchParams.get('serie') || null,
    ],
  )

  /* The two exports of the same cohort disagreed: this one carried neither the
   * year nor the group, so a row here could not be reconciled with a row in
   * „Export coordonări”. The columns line up now. */
  const COLUMNS: Column<(typeof rows)[number]>[] = [
    { header: 'Număr cerere', value: (r) => r.number },
    {
      header: 'Student',
      value: (r) => officialName({ name: r.student_name, father_initial: r.father_initial }),
    },
    { header: 'Inițiala tatălui', value: (r) => formatInitial(r.father_initial) },
    { header: 'Număr matricol', value: (r) => r.student_number },
    { header: 'Program', value: (r) => programLabel(r.program) },
    { header: 'Specializare', value: (r) => r.specialization },
    { header: 'An', value: (r) => r.study_year },
    { header: 'Seria', value: (r) => r.study_series },
    { header: 'Grupa', value: (r) => r.study_group },
    { header: 'Coordonator', value: (r) => r.teacher_name },
    { header: 'Titlul lucrării', value: (r) => r.title_ro },
    { header: 'Stare', value: (r) => STATUS_LABELS[r.status] ?? r.status },
    { header: 'Depusă la', value: (r) => r.submitted_at?.slice(0, 10) ?? '' },
    { header: 'Decisă la', value: (r) => r.decided_at?.slice(0, 10) ?? '' },
  ]

  await recordAccess({ userId: locals.user!.id, action: 'export_cereri', subject: url.pathname + url.search, rowCount: rows.length, request })

  return sheetResponse(
    sheetFormat(url.searchParams.get('format')),
    COLUMNS,
    rows,
    `cereri-sesiune-${sesiune}`,
  )
}
