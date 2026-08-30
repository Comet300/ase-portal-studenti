import { defineMiddleware } from 'astro:middleware'
import { SESSION_COOKIE, getUserFromSession } from './lib/auth'
import { touchPresence } from './lib/chat'
import { sweepDeadlines } from './lib/lifecycle'
import { isHeadOnlyPath, isPublicPath } from './lib/routes'

/**
 * The teacher area requires `teacher` or `head`; which screens belong to the
 * head alone is written down in `lib/routes.ts`, next to the list of public
 * paths and pinned by the same test. A signed-in user without the right role
 * gets 404 rather than 403: we do not confirm an area they cannot use.
 */
const TEACHER_AREA = '/profesor'

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

  /* The safety net for deadlines.
   *
   * The primary source is `/api/sweep`, called by a scheduler: tied to traffic
   * alone, a request that should have been closed on Friday evening stayed open
   * until Monday. The call from here covers the case where the scheduler is not
   * configured — it rate-limits itself and does not hold up the response. */
  void sweepDeadlines(process.env.APP_BASE_URL ?? context.url.origin)

  /* A trailing slash is the same page to Astro's router, so it has to be the
   * same path here too: `/coordonatori/` misses the exact-match list in
   * `lib/routes.ts` and would be served ungated. */
  const path = context.url.pathname.replace(/\/+$/, '') || '/'

  /* Presence.
   *
   * A requested page is the proof that the person is in the portal. It is noted
   * only for navigations — not for files, exports or the API, which can be asked
   * for by a prefetch or by a tab left open — and it is written at most once a
   * minute, through the condition in the UPDATE. It does not hold up the
   * response. */
  if (
    user &&
    context.request.method === 'GET' &&
    !path.startsWith('/api/') &&
    !path.startsWith('/fisiere/') &&
    !path.startsWith('/documente/') &&
    !path.startsWith('/avatare/') &&
    !path.includes('export')
  ) {
    void touchPresence(user.id)
  }

  /* The gate.
   *
   * `search` travels with the path. The catalogue hands out links of the form
   * `/lucrarea-mea?coordonator=<id>&tema=<id>`; without the query a student
   * who signed in on the way arrived at a generic page with the topic they had
   * clicked silently gone.
   *
   * Only navigations are redirected. A POST without a session is left to its
   * handler, which knows what was being written and answers with
   * `sessionExpired()` — a redirect from here would take the person to the
   * sign-in screen with the text they had typed already lost. */
  if (!user && !isPublicPath(path) && context.request.method === 'GET') {
    const target = path + context.url.search
    return context.redirect(`/autentificare?redirect=${encodeURIComponent(target)}`, 302)
  }

  if (path.startsWith(TEACHER_AREA) && user?.role === 'student') {
    return context.rewrite('/404')
  }

  if (isHeadOnlyPath(path) && user && user.role !== 'head') {
    return context.rewrite('/404')
  }

  const response = await next()

  /* Nothing an authenticated user sees is allowed to end up in a shared
   * cache.
   *
   * Without this header the origin says nothing, and Cloudflare applies its own
   * default rule by extension: a `.csv` export was kept at the edge for four
   * hours and served to anyone, with no cookie. Responses for a visitor stay
   * public — they are the same for everybody.
   *
   * `no-store`, however, also forbids the browser's private cache, which makes
   * any prefetch pointless: the page fetched before the click would be
   * downloaded a second time. For ordinary navigations `private` with
   * revalidation is enough — it still does not reach the CDN, but it can be
   * reused by the browser that asked for it. Downloads and the API stay on
   * `no-store`. */
  if (user) {
    const path = context.url.pathname
    const strict =
      path.startsWith('/api/') ||
      path.startsWith('/fisiere/') ||
      path.startsWith('/documente/') ||
      path.includes('export') ||
      context.request.method !== 'GET'

    try {
      response.headers.set(
        'cache-control',
        strict ? 'private, no-store' : 'private, max-age=0, must-revalidate',
      )
      /* `cookie` is always in play; a page that also varies on something else
       * says so itself, and here it is added, not replaced. The profile takes
       * its „Înapoi” button out of `Referer`, so that is part of the key too. */
      const existingVary = response.headers.get('vary')
      response.headers.set('vary', existingVary ? `cookie, ${existingVary}` : 'cookie')
    } catch {
      // A response with immutable headers is built by us and never reaches the CDN.
    }
  }

  return response
})
