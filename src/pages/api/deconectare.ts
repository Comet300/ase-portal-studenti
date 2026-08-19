import type { APIRoute } from 'astro'
import { SESSION_COOKIE, destroySession } from '../../lib/auth'
import { redirect } from '../../lib/http'

export const POST: APIRoute = async ({ cookies }) => {
  await destroySession(cookies.get(SESSION_COOKIE)?.value)
  cookies.delete(SESSION_COOKIE, { path: '/' })
  /* `/` is behind the gate now, so sending someone there after signing out only
   * bounced them through a redirect to reach the same screen. */
  return redirect('/autentificare')
}
