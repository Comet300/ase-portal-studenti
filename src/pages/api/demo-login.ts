import type { APIRoute } from 'astro'
import { SESSION_COOKIE, createSession, DEMO_MODE } from '../../lib/auth'
import { queryOne } from '../../lib/db'
import { deadEnd, redirect } from '../../lib/http'

/**
 * Intrare fără email pentru conturile demonstrative.
 *
 * Este o ocolire reală a autentificării, de aceea: se activează doar cu
 * DEMO_MODE=true, funcționează exclusiv pentru conturile marcate `cont_demo`, și
 * este anunțată vizibil în interfață. Cu DEMO_MODE dezactivat ruta răspunde 404,
 * ca să nu confirme nici măcar că există.
 */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!DEMO_MODE) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const date = await request.formData()
  const utilizatorId = String(date.get('utilizator_id') ?? '')
  const redirectTo = String(date.get('redirect') ?? '')

  const utilizator = await queryOne<{ id: string; role: string }>(
    `SELECT id, role FROM users WHERE id = $1 AND is_demo = true`,
    [utilizatorId],
  )

  if (!utilizator) {
    return redirect('/autentificare?eroare=' + encodeURIComponent('Cont demonstrativ inexistent.'))
  }

  const sesiuneId = await createSession(utilizator.id)

  cookies.set(SESSION_COOKIE, sesiuneId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30,
  })

  const implicit = utilizator.role === 'student' ? '/cererile-mele' : '/profesor'
  return redirect(redirectTo || implicit)
}
