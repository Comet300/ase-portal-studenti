import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { archiveRows, formatDate, type ArchiveRow } from '../../lib/repo'
import { type Column, sheetFormat, sheetResponse } from '../../lib/sheet'
import { allYears, languageLabel, levelLabel, yearById } from '../../lib/years'

/**
 * The archive of a session, as a file.
 *
 * The screen answers „who wrote what, with whom”; the file is the same answer
 * for the minutes, which still travel printed, and for whoever has to reconcile
 * the session against the registrar's own lists.
 *
 * Same rows as the screen, same year, same search — a download that quietly
 * returns something else than what is on screen is checked once and then
 * trusted.
 *
 * Who may ask: everybody who may read the archive, which is students and the
 * head of department. It carries names, titles and coordinators — what the page
 * already shows — and not the file of anybody's thesis.
 */

const COLUMNS: Column<ArchiveRow>[] = [
  { header: 'Student', value: (r) => r.student_name },
  { header: 'Număr matricol', value: (r) => r.student_number },
  { header: 'Nivel', value: (r) => (r.level ? levelLabel(r.level) : '') },
  { header: 'Program', value: (r) => r.programme },
  { header: 'Limbă', value: (r) => (r.language ? languageLabel(r.language) : '') },
  { header: 'Coordonator', value: (r) => r.teacher_name },
  { header: 'Titlul lucrării', value: (r) => r.title_ro },
  { header: 'Susținută la', value: (r) => (r.defended_on ? formatDate(r.defended_on) : '') },
  {
    header: 'Lucrarea în portal',
    value: (r) =>
      r.thesis_uploaded_at ? `predată ${formatDate(r.thesis_uploaded_at)}` : 'nu a fost încărcată',
  },
  { header: 'Sursa', value: (r) => (r.source === 'import' ? 'din evidență' : 'portal') },
]

export const GET: APIRoute = async ({ locals, url, request }) => {
  const u = locals.user
  /* The archive is closed to a plain teacher, exactly like the screen: their own
   * past sessions are on „Studenți & Cereri”. */
  if (!u || u.role === 'teacher') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  const years = await allYears()
  const asked = url.searchParams.get('an')
  const year =
    (asked ? await yearById(asked) : null) ?? years.find((y) => !y.is_current) ?? years[0]
  if (!year) return new Response('Nu există niciun an universitar.', { status: 404 })

  const search = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const rows = (await archiveRows(year.id)).filter((r) => {
    if (!search) return true
    const haystack = `${r.student_name} ${r.teacher_name} ${r.title_ro} ${r.programme ?? ''}`
    return haystack.toLowerCase().includes(search)
  })

  await recordAccess({
    userId: u.id,
    action: 'export_arhiva',
    subject: url.pathname + url.search,
    rowCount: rows.length,
    request,
  })

  return sheetResponse(
    sheetFormat(url.searchParams.get('format')),
    COLUMNS,
    rows,
    `arhiva-${year.label}`,
  )
}
