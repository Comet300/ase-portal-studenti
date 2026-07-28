/**
 * Redirect helper.
 *
 * `Response.redirect()` returns a response whose headers are immutable, so the
 * adapter throws `TypeError: immutable` the moment it tries to append a
 * Set-Cookie — which is exactly what sign-in does. Building the response by hand
 * keeps the headers writable.
 */
export function redirect(location: string | URL, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { location: String(location) } })
}

/** Redirect back to a page with a Romanian toast message. */
export function redirectWithNotice(
  base: string | URL,
  message: string,
  isError = false,
): Response {
  const url = new URL(String(base))
  url.searchParams.set('notificare', message)
  if (isError) url.searchParams.set('tip', 'error')
  return redirect(url)
}
