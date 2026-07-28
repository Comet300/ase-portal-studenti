import { defineMiddleware } from 'astro:middleware'
import { SESSION_COOKIE, getUserFromSession } from './lib/auth'

/**
 * Student routes are open to every role; the teacher area requires `teacher` or
 * `head`, and the department view requires `head`. A signed-in user without the
 * right role gets 404 rather than 403: we do not confirm an area they cannot use.
 */

const REQUIRES_SESSION = ['/cererile-mele', '/mesaje', '/consultatii', '/contul-meu']
const TEACHER_AREA = '/profesor'
const HEAD_AREA = '/profesor/departament'

export const onRequest = defineMiddleware(async (context, next) => {
  const sessionId = context.cookies.get(SESSION_COOKIE)?.value
  const user = await getUserFromSession(sessionId)
  context.locals.user = user

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

  if (path.startsWith(HEAD_AREA) && user && user.role !== 'head') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  return next()
})
