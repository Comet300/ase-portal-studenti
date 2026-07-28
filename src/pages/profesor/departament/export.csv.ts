import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../../lib/auth'
import { query } from '../../../lib/db'
import { STATUS_LABELS, programLabel } from '../../../lib/repo'

/** CSV of the department's requests, honouring the filters shown on screen. */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!isDepartmentHead(locals.user)) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  const rows = await query<{
    number: string
    student_name: string
    student_number: string | null
    program: string | null
    specialization: string | null
    teacher_name: string
    title_ro: string
    status: string
    submitted_at: string
    decided_at: string | null
  }>(
    `SELECT r.number, s.name AS student_name, s.student_number, s.program, s.specialization,
            t.name AS teacher_name, r.title_ro, r.status, r.submitted_at, r.decided_at
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE ($1::uuid IS NULL OR r.teacher_id = $1)
        AND ($2::text IS NULL OR s.program = $2)
        AND ($3::text IS NULL OR r.status = $3)
      ORDER BY t.name, s.name`,
    [
      url.searchParams.get('coordonator') || null,
      url.searchParams.get('program') || null,
      url.searchParams.get('status') || null,
    ],
  )

  const cell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`
  const header = [
    'Numar cerere', 'Student', 'Numar matricol', 'Program', 'Specializare',
    'Coordonator', 'Titlul lucrarii', 'Stare', 'Depusa la', 'Decisa la',
  ]

  const body = rows.map((r) =>
    [
      r.number, r.student_name, r.student_number, programLabel(r.program), r.specialization,
      r.teacher_name, r.title_ro, STATUS_LABELS[r.status] ?? r.status,
      r.submitted_at?.slice(0, 10) ?? '', r.decided_at?.slice(0, 10) ?? '',
    ].map(cell).join(','),
  )

  // BOM so Excel opens the Romanian diacritics correctly.
  const csv = '﻿' + [header.map(cell).join(','), ...body].join('\r\n') + '\r\n'

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cereri-sesiune-2026.csv"',
    },
  })
}
