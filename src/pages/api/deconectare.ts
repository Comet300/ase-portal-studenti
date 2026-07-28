import type { APIRoute } from 'astro'
import { SESSION_COOKIE, destroySession } from '../../lib/auth'

export const POST: APIRoute = async ({ cookies, url }) => {
  await destroySession(cookies.get(SESSION_COOKIE)?.value)
  cookies.delete(SESSION_COOKIE, { path: '/' })
  return Response.redirect(new URL('/', url), 303)
}
