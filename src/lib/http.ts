/**
 * Redirect helper.
 *
 * Two things `Response.redirect()` gets wrong in this deployment:
 *
 * 1. Its headers are immutable, so the adapter throws `TypeError: immutable`
 *    the moment it appends a Set-Cookie — which is exactly what sign-in does.
 * 2. It requires an absolute URL, and behind the tunnel the server only knows
 *    itself as http://localhost:3000, so the browser would be sent to localhost.
 *
 * Locations are therefore relative paths, which the browser resolves against
 * whatever origin it is actually talking to.
 */
/**
 * Keeps a redirect inside this site.
 *
 * Several targets are read straight from a form field or carried through an
 * email — `redirect` on the sign-in form, on the message composer, on the
 * decision dialog. All of them are meant to be internal paths, so anything else
 * is dropped rather than sanitised: there is no legitimate absolute target, and
 * a link that leaves the portal after signing someone in would do so with our
 * name on it.
 *
 * `//evil.com` is rejected explicitly — the browser reads it as a host, not a
 * path, which is the whole trick.
 */
export function internalPath(path: string | null | undefined, fallback = '/'): string {
  if (!path) return fallback
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback
  return path
}

export function redirect(path: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { location: internalPath(path) } })
}

/** Redirect back to a path, carrying a Romanian toast message. */
export function redirectWithNotice(path: string, message: string, isError = false): Response {
  const [base, existing] = path.split('?')
  const params = new URLSearchParams(existing ?? '')
  params.set('notificare', message)
  if (isError) params.set('tip', 'error')
  return redirect(`${base}?${params.toString()}`)
}
