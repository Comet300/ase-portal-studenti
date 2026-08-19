import type { APIRoute } from 'astro'
import { sweepDeadlines, lastSweepAt } from '../../lib/lifecycle'

/**
 * The deadlines, run by a schedule — not by whoever happens to come in.
 *
 * The sweep used to live in the middleware: it expired requests and invitations
 * only if somebody opened a page. On a Friday evening with no traffic, a request
 * that should have been refused automatically stayed open until Monday, and the
 * student waited for nothing on a deadline that had already passed.
 *
 * The route is protected by a secret of its own, not by a session: it is called
 * by a scheduler, not by a person. With no `SWEEP_TOKEN` configured it answers
 * 404, so that there is no public route that sets off emails.
 */
export const GET: APIRoute = async ({ request, url }) => {
  /* The responses here are for a machine, not for a person: a scheduler needs a
   * status code, not a page or a redirect towards the sign-in screen. */
  const expectedToken = process.env.SWEEP_TOKEN
  if (!expectedToken) return new Response('Pagina nu a fost găsită', { status: 404 })

  const receivedToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (receivedToken !== expectedToken) return new Response('Neautorizat', { status: 401 })

  await sweepDeadlines(process.env.APP_BASE_URL ?? url.origin, { force: true })

  return new Response(JSON.stringify({ ok: true, ultima: lastSweepAt() }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
