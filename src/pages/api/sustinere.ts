import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { formAction } from '../../lib/forms'
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
  const action = formAction(form) || 'sesiune'
  const requestId = formId(form.get('cerere_id'))
  const yearId = formId(form.get('an_id'))
  const back = (message: string, isError = false) =>
    redirectWithNotice('/profesor/studenti?sectiune=studenti', message, isError)

  /* --- lucrarea a fost susținută -------------------------------------------
   *
   * Terminarea unei lucrări nu avea nicio stare: coordonarea rămânea „aprobată”
   * pentru totdeauna, deci un student care își luase licența cu doi ani în urmă
   * apărea în continuare printre cei coordonați activ, iar locul lui rămânea
   * ocupat. Iar arhiva prezenta data aprobării drept dată a susținerii. */
  if (action === 'sustinuta') {
    const data = String(form.get('data') ?? '').trim()
    const nota = String(form.get('nota') ?? '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return back('Alege data susținerii.', true)
    }
    if (new Date(data) > new Date()) {
      return back('Data susținerii nu poate fi în viitor.', true)
    }

    const notaNum = nota === '' ? null : Number(nota.replace(',', '.'))
    if (notaNum !== null && (!Number.isFinite(notaNum) || notaNum < 1 || notaNum > 10)) {
      return back('Nota trebuie să fie între 1 și 10.', true)
    }

    const n = await execute(
      `UPDATE requests
          SET status = 'defended', defended_on = $3::date, grade = $4, updated_at = now()
        WHERE id = $2 AND teacher_id = $1 AND status = 'approved'`,
      [u!.id, requestId, data, notaNum],
    )

    return back(
      n
        ? 'Lucrarea este înregistrată ca susținută. Locul s-a eliberat, iar lucrarea a intrat în arhivă.'
        : 'Lucrarea nu a fost găsită sau nu mai este în coordonare activă.',
      !n,
    )
  }

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
