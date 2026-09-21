import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../../lib/auth'
import { REGISTRY_COLUMNS, REGISTRY_TEMPLATE_ROWS } from '../../../lib/import/students'
import { type Column, sheetFormat, sheetResponse } from '../../../lib/sheet'

/**
 * The import template, in the registry's own format.
 *
 * WHY THE REGISTRY'S FORMAT AND NOT THE PORTAL'S. A template written in the
 * portal's ten columns would be a file the secretariat has to produce by
 * rearranging the one they already have — which is the work the import wizard
 * exists to remove. The 25 columns below, in this order, are what SIMUR
 * exports; a director who has that file needs no template at all, and one who
 * is assembling a list by hand gets the shape the importer is built to read.
 *
 * The columns and the example rows both come from `lib/import/students.ts`, so
 * the template cannot describe a file the parser does not accept: a test parses
 * exactly these rows and requires zero rejections.
 *
 * The gate is the head of department's, matching the screen that links here —
 * repeated, because a route is not protected by the page that links to it.
 *
 * Nothing is written to the access log, unlike every other download in the
 * portal. That log answers „who read or changed somebody else's data”, and this
 * file contains two invented students: a row in it would be noise in the one
 * record that has to stay readable when a real question is asked of it.
 */

const COLUMNS: Column<string[]>[] = REGISTRY_COLUMNS.map((column, index) => ({
  header: column.name,
  value: (row) => row[index] ?? '',
}))

export const GET: APIRoute = ({ locals, url }) => {
  if (!isDepartmentHead(locals.user)) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  return sheetResponse(
    sheetFormat(url.searchParams.get('format')),
    COLUMNS,
    REGISTRY_TEMPLATE_ROWS,
    'sablon-import-studenti',
  )
}
