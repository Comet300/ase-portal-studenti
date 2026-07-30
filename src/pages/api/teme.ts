import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'

/** Temele propuse de un cadru didactic. Proprietarul este verificat în fiecare instrucțiune. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form) || 'adauga'
  const redirectTo = '/profesor/teme'

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'adauga') {
    const title = String(form.get('titlu') ?? '').trim()
    const level = String(form.get('nivel') ?? '')
    const language = String(form.get('limba') ?? 'ro')
    const description = String(form.get('descriere') ?? '').trim()
    const methods = String(form.get('metode') ?? '').trim()
    const prerequisites = String(form.get('prerechizite') ?? '').trim()
    const seats = Number(form.get('locuri') ?? 1)

    if (!title || !['bachelor', 'master'].includes(level)) {
      return back('Completează titlul și nivelul temei.', true)
    }
    if (!['ro', 'en', 'fr', 'de'].includes(language)) return back('Limbă invalidă.', true)

    // Temele aparțin anului curent: un an nou pornește cu un catalog gol, dacă
    // directorul nu alege explicit să îl preia.
    await execute(
      `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                           methods, prerequisites, seats)
       VALUES ((SELECT id FROM academic_years WHERE is_current),
               $1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8)`,
      [
        u!.id, title, description, level, language, methods, prerequisites,
        Number.isFinite(seats) ? Math.max(1, seats) : 1,
      ],
    )
    return back('Tema a fost publicată în catalog.')
  }

  if (action === 'comuta') {
    const topicId = formId(form.get('tema_id'))
    const n = await execute(
      `UPDATE topics SET is_active = NOT is_active WHERE id = $2 AND teacher_id = $1`,
      [u!.id, topicId],
    )
    return back(n ? 'Disponibilitatea temei a fost schimbată.' : 'Tema nu a fost găsită.', !n)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
