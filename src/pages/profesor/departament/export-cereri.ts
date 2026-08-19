import type { APIRoute } from 'astro'
import { recordAccess } from '../../../lib/audit'
import { isDepartmentHead } from '../../../lib/auth'
import { query } from '../../../lib/db'
import { STATUS_LABELS, programLabel } from '../../../lib/repo'
import { id } from '../../../lib/ids'
import { formatInitial, officialName } from '../../../lib/text'
import { currentYearLabel } from '../../../lib/years'

/** CSV of the department's requests, honouring the filters shown on screen. */
export const GET: APIRoute = async ({ locals, url, request }) => {
  if (!isDepartmentHead(locals.user)) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  // The year label contains an en dash, and a non-ASCII byte in a plain
  // `filename=` is not valid per RFC 6266 — the browser silently kept the tail.
  const sesiune = (await currentYearLabel()).replace(/[^\x20-\x7e]+/g, '-') || 'curenta'

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

  const cell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`
  /* The two exports of the same cohort disagreed: this one carried neither the
   * year nor the group, so a row here could not be reconciled with a row in
   * „Export coordonări”. The columns now line up. */
  const header = [
    'Numar cerere', 'Student', 'Inițiala tatălui', 'Numar matricol', 'Program', 'Specializare',
    'An', 'Seria', 'Grupa',
    'Coordonator', 'Titlul lucrarii', 'Stare', 'Depusa la', 'Decisa la',
  ]

  const body = rows.map((r) =>
    [
      r.number,
      officialName({ name: r.student_name, father_initial: r.father_initial }),
      formatInitial(r.father_initial),
      r.student_number, programLabel(r.program), r.specialization,
      r.study_year === null ? '' : String(r.study_year), r.study_series, r.study_group,
      r.teacher_name, r.title_ro, STATUS_LABELS[r.status] ?? r.status,
      r.submitted_at?.slice(0, 10) ?? '', r.decided_at?.slice(0, 10) ?? '',
    ].map(cell).join(';'),
  )

  /* Semicolon, the same as in the other export.
   *
   * The portal's two exports used different separators. In an Excel with
   * Romanian settings the list separator is „;”, so the comma-separated file
   * opened in a single column — which is exactly the file the head of
   * department downloads. The BOM stays, for the diacritics. */
  const csv = '﻿' + [header.map(cell).join(';'), ...body].join('\r\n') + '\r\n'

  await recordAccess({ userId: locals.user!.id, action: 'export_cereri', subject: url.pathname + url.search, rowCount: rows.length, request })

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cereri-sesiune-${sesiune}.csv"`,
    },
  })
}
