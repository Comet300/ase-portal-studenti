import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'

/** Temele propuse de un cadru didactic. Proprietarul este verificat în fiecare instrucțiune. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const actiune = String(date.get('actiune') ?? 'adauga')
  const redirect = '/profesor/studenti?sectiune=teme'

  const inapoi = (mesaj: string, eroare = false) =>
    Response.redirect(
      new URL(`${redirect}&notificare=${encodeURIComponent(mesaj)}${error ? '&kind=error' : ''}`, url),
      303,
    )

  if (action === 'adauga') {
    const title = String(date.get('title') ?? '').trim()
    const nivel = String(date.get('nivel') ?? '')
    const metode = String(date.get('metode') ?? '').trim()
    const prerechizite = String(date.get('prerechizite') ?? '').trim()
    const locuri = Number(date.get('locuri') ?? 1)

    if (!title || !['bachelor', 'master'].includes(nivel)) {
      return back('Completează titlul și nivelul temei.', true)
    }

    await execute(
      `INSERT INTO topics (teacher_id, title, level, methods, prerequisites, seats)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)`,
      [u!.id, title, nivel, metode, prerechizite, Number.isFinite(locuri) ? Math.max(1, locuri) : 1],
    )
    return back('Tema a fost publicată în catalog.')
  }

  if (action === 'comuta') {
    const topicId = String(date.get('tema_id') ?? '')
    const n = await execute(
      `UPDATE topics SET is_active = NOT is_active WHERE id = $2 AND teacher_id = $1`,
      [u!.id, topicId],
    )
    return back(n ? 'Disponibilitatea temei a fost schimbată.' : 'Tema nu a fost găsită.', !n)
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
