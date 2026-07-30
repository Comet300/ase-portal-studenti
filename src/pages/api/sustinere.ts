import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { redirectWithNotice, sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/**
 * The session a thesis will be defended in.
 *
 * Distinct from the session the coordination started in: a student may choose a
 * coordinator in the second year of a bachelor and defend at the end of the
 * third. The coordinator is the one who knows, so they are the one who records
 * it — and the archive files the thesis under it.
 *
 * Clearing it means "the same session it started in", which is the common case.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const requestId = formId(form.get('cerere_id'))
  const yearId = formId(form.get('an_id'))
  const back = (message: string, isError = false) =>
    redirectWithNotice('/profesor/studenti?sectiune=studenti', message, isError)

  if (yearId) {
    const year = await queryOne<{ label: string }>(
      `SELECT label FROM academic_years WHERE id = $1`,
      [yearId],
    )
    if (!year) return back('Anul universitar nu există.', true)
  }

  // Ownership travels with the write: another coordinator's request does not
  // match, so nothing changes.
  const n = await execute(
    `UPDATE requests SET graduation_year_id = $3, updated_at = now()
      WHERE id = $2 AND teacher_id = $1 AND status = 'approved'`,
    [u!.id, requestId, yearId],
  )

  return back(
    n ? 'Sesiunea susținerii a fost actualizată.' : 'Lucrarea nu a fost găsită.',
    !n,
  )
}
