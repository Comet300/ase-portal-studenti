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
export function redirect(path: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { location: path } })
}

/** Redirect back to a path, carrying a Romanian toast message. */
export function redirectWithNotice(path: string, message: string, isError = false): Response {
  const [base, existing] = path.split('?')
  const params = new URLSearchParams(existing ?? '')
  params.set('notificare', message)
  if (isError) params.set('tip', 'error')
  return redirect(`${base}?${params.toString()}`)
}
