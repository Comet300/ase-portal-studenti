import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { id as formId } from '../../lib/ids'

/**
 * The editable milestone timeline.
 *
 * Milestones have no owner column — they belong to a request, and the request
 * belongs to a supervisor. Every statement therefore carries an EXISTS against
 * `requests`, in the same sentence as the write it protects.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const redirectTo = String(form.get('redirect') ?? '/profesor/studenti')

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'adauga') {
    const requestId = formId(form.get('cerere_id'))
    const title = String(form.get('title') ?? '').trim()
    const dueOn = String(form.get('termen') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()

    if (!title) return back('Titlul termenului este obligatoriu.', true)

    const n = await execute(
      `INSERT INTO milestones (request_id, title, description, due_on, position)
       SELECT $2, $3, $4, NULLIF($5, '')::date,
              COALESCE((SELECT max(position) + 1 FROM milestones WHERE request_id = $2), 0)
        WHERE EXISTS (SELECT 1 FROM requests r WHERE r.id = $2 AND r.teacher_id = $1)`,
      [u!.id, requestId, title, description || null, dueOn],
    )
    return back(n ? 'Termen adăugat.' : 'Cererea nu a fost găsită.', !n)
  }

  if (action === 'actualizeaza') {
    const milestoneId = formId(form.get('termen_id'))
    const title = String(form.get('title') ?? '').trim()
    const dueOn = String(form.get('termen') ?? '').trim()
    const description = String(form.get('descriere') ?? '').trim()
    const status = String(form.get('status') ?? '')

    if (!['planned', 'in_progress', 'done'].includes(status)) {
      return back('Stare invalidă.', true)
    }

    const n = await execute(
      `UPDATE milestones m
          SET title = COALESCE(NULLIF($3, ''), m.title),
              description = NULLIF($4, ''),
              due_on = NULLIF($5, '')::date,
              status = $6
        WHERE m.id = $2
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)`,
      [u!.id, milestoneId, title, description, dueOn, status],
    )
    return back(n ? 'Termen actualizat.' : 'Termenul nu a fost găsit.', !n)
  }

  if (action === 'sterge') {
    const milestoneId = formId(form.get('termen_id'))
    const n = await execute(
      `DELETE FROM milestones m
        WHERE m.id = $2
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = m.request_id AND r.teacher_id = $1)`,
      [u!.id, milestoneId],
    )
    return back(n ? 'Termen șters.' : 'Termenul nu a fost găsit.', !n)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
