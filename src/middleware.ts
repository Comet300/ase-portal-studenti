import { defineMiddleware } from 'astro:middleware'
import { SESSION_COOKIE, getUserFromSession } from './lib/auth'
import { sweepDeadlines } from './lib/lifecycle'

/**
 * Student routes are open to every role; the teacher area requires `teacher` or
 * `head`, and the department view requires `head`. A signed-in user without the
 * right role gets 404 rather than 403: we do not confirm an area they cannot use.
 */

const REQUIRES_SESSION = [
  '/cererile-mele',
  '/mesaje',
  '/consultatii',
  '/contul-meu',
  '/arhiva',
  '/coordonari',
  '/profil',
]
const TEACHER_AREA = '/profesor'
const HEAD_ONLY = ['/profesor/departament', '/profesor/calendar', '/profesor/an-universitar']

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request forgery guard.
 *
 * Replaces Astro's built-in check, which cannot see past the reverse proxy. A
 * state-changing request must carry an Origin matching the configured public
 * origin; browsers always send it on cross-origin form posts, so a forged POST
 * from another site is rejected before it reaches a handler.
 */
function originAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // same-origin navigations and non-browser clients

  const expected = process.env.APP_BASE_URL?.replace(/\/$/, '')
  if (expected) return origin === expected

  return origin === url.origin
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (UNSAFE.has(context.request.method) && !originAllowed(context.request, context.url)) {
    return new Response('Cerere respinsă: origine neconformă.', { status: 403 })
  }

  const sessionId = context.cookies.get(SESSION_COOKIE)?.value
  const user = await getUserFromSession(sessionId)
  context.locals.user = user

  // Deadlines are enforced here rather than by a scheduler: one container, no
  // cron, and the sweep throttles itself. It never blocks the response.
  void sweepDeadlines(process.env.APP_BASE_URL ?? context.url.origin)

  const path = context.url.pathname

  const needsLogin =
    REQUIRES_SESSION.some((p) => path === p || path.startsWith(p + '/')) ||
    path.startsWith(TEACHER_AREA)

  if (needsLogin && !user) {
    return context.redirect(`/autentificare?redirect=${encodeURIComponent(path)}`, 302)
  }

  if (path.startsWith(TEACHER_AREA) && user?.role === 'student') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  if (HEAD_ONLY.some((p) => path.startsWith(p)) && user && user.role !== 'head') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  return next()
})
