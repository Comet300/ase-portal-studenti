/**
 * Everything needs a session; this list is the whole of the exception.
 *
 * The gate used to be the other way round — the middleware listed the paths
 * that required signing in — so every route written since was public by
 * omission. That is how `/coordonatori` came to publish real names, thesis
 * titles and student numbers to anyone who found the address, with no session
 * and no log entry.
 *
 * The match is on the exact path, never on a prefix: the role check next to it
 * used `startsWith('/profesor')`, which also matched `/profesorat`, and the same
 * slip in a list of public paths opens the portal instead of closing a corner
 * of it.
 *
 * It lives here rather than in `middleware.ts` because that module imports
 * `astro:middleware`, which no test runner can load — and a list this
 * consequential is worth pinning in a test (test/routes.test.ts).
 *
 * Assets under `public/` are served before the middleware runs, so fonts and
 * icons need no entry here.
 */
export const PUBLIC_PATHS = [
  '/autentificare', // the form, and where every gate sends people
  '/intra', // consumes the link from the email and sets the cookie
  '/confidentialitate', // GDPR art. 13: readable before any data is collected
  '/404',
  '/500',
  '/api/autentificare', // POST, issues the link
  '/api/demo-login', // POST, answers 404 by itself unless DEMO_MODE
  '/api/deconectare', // POST, so a stale cookie can still be cleared
  '/api/sanatate', // the container healthcheck; gated, it restart-loops the container
  '/api/sweep', // carries its own bearer token
] as const

const PUBLIC = new Set<string>(PUBLIC_PATHS)

export function isPublicPath(path: string): boolean {
  return PUBLIC.has(path)
}

/**
 * The screens only the head of department opens.
 *
 * Here for the same reason as the list above: it decides who sees the whole
 * cohort — names, student numbers, addresses, who is still unassigned — and a
 * list that consequential is worth pinning in a test a reviewer reads
 * (`test/routes.test.ts`). `middleware.ts` imports it; it cannot be the other
 * way round, because that module imports `astro:middleware`, which no test
 * runner can load.
 *
 * Matched on the prefix, not on the exact path: `/profesor/facultate/export`
 * has to be as closed as the screen that links to it.
 */
export const HEAD_ONLY_PREFIXES = [
  '/profesor/facultate',
  '/profesor/departament',
  '/profesor/conturi',
  '/profesor/calendar',
  '/profesor/an-universitar',
] as const

export function isHeadOnlyPath(path: string): boolean {
  return HEAD_ONLY_PREFIXES.some((p) => path.startsWith(p))
}
