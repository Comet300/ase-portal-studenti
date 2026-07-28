import type { APIRoute } from 'astro'
import { COOKIE_SESIUNE, distrugeSesiune } from '../../lib/auth'

export const POST: APIRoute = async ({ cookies, url }) => {
  await distrugeSesiune(cookies.get(COOKIE_SESIUNE)?.value)
  cookies.delete(COOKIE_SESIUNE, { path: '/' })
  return Response.redirect(new URL('/', url), 303)
}
