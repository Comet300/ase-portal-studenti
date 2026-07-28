import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'
import { redirectWithNotice } from '../../lib/http'

/** Temele propuse de un cadru didactic. Proprietarul este verificat în fiecare instrucțiune. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const form = await request.formData()
  const action = String(form.get('actiune') ?? 'adauga')
  const redirectTo = '/profesor/studenti?sectiune=teme'

  const back = (message: string, isError = false) =>
    redirectWithNotice(redirectTo, message, isError)

  if (action === 'adauga') {
    const title = String(form.get('titlu') ?? '').trim()
    const level = String(form.get('nivel') ?? '')
    const methods = String(form.get('metode') ?? '').trim()
    const prerequisites = String(form.get('prerechizite') ?? '').trim()
    const seats = Number(form.get('locuri') ?? 1)

    if (!title || !['bachelor', 'master'].includes(level)) {
      return back('Completează titlul și nivelul temei.', true)
    }

    await execute(
      `INSERT INTO topics (teacher_id, title, level, methods, prerequisites, seats)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)`,
      [u!.id, title, level, methods, prerequisites, Number.isFinite(seats) ? Math.max(1, seats) : 1],
    )
    return back('Tema a fost publicată în catalog.')
  }

  if (action === 'comuta') {
    const topicId = String(form.get('tema_id') ?? '')
    const n = await execute(
      `UPDATE topics SET is_active = NOT is_active WHERE id = $2 AND teacher_id = $1`,
      [u!.id, topicId],
    )
    return back(n ? 'Disponibilitatea temei a fost schimbată.' : 'Tema nu a fost găsită.', !n)
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
