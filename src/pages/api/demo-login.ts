import type { APIRoute } from 'astro'
import { SESSION_COOKIE, createSession, DEMO_MODE } from '../../lib/auth'
import { queryOne } from '../../lib/db'
import { deadEnd, redirect } from '../../lib/http'

/**
 * Sign-in without email, for the demonstration accounts.
 *
 * It is a genuine bypass of authentication, hence: it is switched on only with
 * DEMO_MODE=true, it works exclusively for the accounts marked `cont_demo`, and
 * it is announced visibly in the interface. With DEMO_MODE off the route answers
 * 404, so as not to confirm even that it exists.
 */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!DEMO_MODE) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const form = await request.formData()
  const userId = String(form.get('utilizator_id') ?? '')
  const redirectTo = String(form.get('redirect') ?? '')

  const user = await queryOne<{ id: string; role: string }>(
    `SELECT id, role FROM users WHERE id = $1 AND is_demo = true`,
    [userId],
  )

  if (!user) {
    return redirect('/autentificare?eroare=' + encodeURIComponent('Cont demonstrativ inexistent.'))
  }

  const sessionId = await createSession(user.id)

  cookies.set(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30,
  })

  const fallbackPath = user.role === 'student' ? '/cererile-mele' : '/profesor'
  return redirect(redirectTo || fallbackPath)
}
