import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../../lib/auth'
import { recordAccess } from '../../../lib/audit'
import { studentDirectory, type DirectoryStudent } from '../../../lib/repo'
import { type Column, sheetFormat, sheetResponse } from '../../../lib/sheet'
import { officialName } from '../../../lib/text'
import { groupLabel, languageLabel, levelLabel, yearById, currentYear } from '../../../lib/years'

/**
 * „Studenții facultății”, as a file.
 *
 * The same rows as the screen, filtered the same way, because a download that
 * quietly returns the whole faculty after somebody narrowed to one series is
 * worse than no download: it is checked against the screen, once, and then
 * trusted.
 *
 * The gate is the head of department's, matching the screen — and repeated
 * here, because a route is not protected by the page that links to it.
 */

const LABELS: Record<string, string> = {
  approved: 'Coordonat',
  pending: 'Cerere în așteptare',
}

const COLUMNS: Column<DirectoryStudent>[] = [
  { header: 'Nume', value: (s) => officialName(s) },
  { header: 'Număr matricol', value: (s) => s.student_number },
  { header: 'Email', value: (s) => s.email },
  { header: 'Nivel', value: (s) => levelLabel(s.program ?? 'bachelor') },
  { header: 'Specializare', value: (s) => s.specialization },
  { header: 'Limbă', value: (s) => languageLabel(s.study_language) },
  { header: 'An', value: (s) => s.study_year },
  { header: 'Serie', value: (s) => s.study_series },
  { header: 'Grupa', value: (s) => s.study_group },
  { header: 'Grupare', value: (s) => groupLabel(s) },
  { header: 'Coordonator', value: (s) => s.teacher_name },
  { header: 'Stare', value: (s) => (s.request_status ? LABELS[s.request_status] : 'Nu a depus cerere') },
  {
    header: 'A intrat în portal',
    value: (s) => (s.first_login_at ? s.first_login_at.slice(0, 10) : 'niciodată'),
  },
]

export const GET: APIRoute = async ({ locals, url, request }) => {
  const u = locals.user
  if (!isDepartmentHead(u)) return new Response('Pagina nu a fost găsită', { status: 404 })

  const asked = url.searchParams.get('an')
  const year = (asked ? await yearById(asked) : null) ?? (await currentYear())

  const nivel = url.searchParams.get('nivel') ?? ''
  const limba = url.searchParams.get('limba') ?? ''
  const serie = url.searchParams.get('serie') ?? ''
  const cont = url.searchParams.get('cont') ?? ''
  const stare = url.searchParams.get('stare') ?? ''
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()

  const rows = (await studentDirectory(year?.id)).filter((s) => {
    if (nivel && s.program !== nivel) return false
    if (limba && s.study_language !== limba) return false
    if (serie && (s.study_series ?? '') !== serie) return false
    if (cont === 'folosit' && !s.first_login_at) return false
    if (cont === 'neintrat' && s.first_login_at) return false
    if (stare === 'coordonat' && s.request_status !== 'approved') return false
    if (stare === 'asteptare' && s.request_status !== 'pending') return false
    if (stare === 'depusa' && !s.request_status) return false
    if (stare === 'neinceput' && s.request_status) return false
    if (q) {
      const haystack = `${officialName(s)} ${s.student_number ?? ''} ${s.specialization ?? ''} ${s.study_series ?? ''} ${s.teacher_name ?? ''}`
      if (!haystack.toLowerCase().includes(q)) return false
    }
    return true
  })

  await recordAccess({
    userId: u!.id,
    action: 'export_studenti',
    subject: url.pathname + url.search,
    rowCount: rows.length,
    request,
  })

  return sheetResponse(
    sheetFormat(url.searchParams.get('format')),
    COLUMNS,
    rows,
    `studentii-facultatii-${year?.label ?? 'sesiunea-curenta'}`,
  )
}
