import type { Role } from './auth'

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

/**
 * Where a role belongs after signing in.
 *
 * The pair was written out in four places — the magic link, the demo sign-in,
 * the sign-in page and signing out — and they had already drifted: the demo
 * buttons fell back to `redirect()`'s own `/`, so a teacher who used them
 * landed on the student home. One rule, one place.
 */
export function homeFor(user: { role: Role }): string {
  return user.role === 'student' ? '/' : '/profesor'
}

export function redirect(path: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { location: internalPath(path) } })
}

/**
 * Redirect back to a path, carrying a Romanian toast message.
 *
 * The fragment is detached before it reaches `URLSearchParams` and glued back on
 * at the end. Otherwise `#student-<id>` ended up *inside* the last parameter and
 * was encoded as `%23student-…`: the address stayed valid, but the anchor no
 * longer existed, so a save no longer came back to the row you were working on.
 */
export function redirectWithNotice(path: string, message: string, isError = false): Response {
  const [withoutFragment, fragment] = path.split('#')
  const [base, existing] = withoutFragment.split('?')
  const params = new URLSearchParams(existing ?? '')
  params.set('notificare', message)
  if (isError) params.set('tip', 'error')
  return redirect(`${base}?${params.toString()}${fragment ? `#${fragment}` : ''}`)
}

/**
 * A confirmation with a way back.
 *
 * Deletions in the portal were final after a single click: a stage in the
 * calendar, a milestone of a thesis. None of them deserves a confirmation dialog
 * — they are small gestures, and a dialog on each one would make all of them
 * tiring — but they do deserve to be taken back.
 *
 * The window lasts as long as the notice does. After it, the gesture is over:
 * nothing is kept on the server, no recycle bin appears that has to be
 * maintained.
 */
export function redirectWithUndo(
  path: string,
  message: string,
  undo: { to: string; date: Record<string, string> },
): Response {
  const [withoutFragment, fragment] = path.split('#')
  const [base, existing] = withoutFragment.split('?')
  const params = new URLSearchParams(existing ?? '')
  params.set('notificare', message)
  params.set('anulare', undo.to)
  params.set('anulare_date', JSON.stringify(undo.date))
  return redirect(`${base}?${params.toString()}${fragment ? `#${fragment}` : ''}`)
}

/**
 * The session expired while somebody was filling in a form.
 *
 * The routes answered with `new Response('Neautentificat', { status: 401 })` —
 * that is, a white page with one word on it, outside the portal, after twenty
 * minutes of writing. The cookie lasts thirty days, so it happens rarely, but
 * when it does happen it is the worst possible moment.
 *
 * A redirect takes the person somewhere they can do something. What they wrote
 * is kept in `sessionStorage` anyway (scripts/forms.ts) and comes back after
 * signing in.
 */
export function sessionExpired(back?: string): Response {
  const params = new URLSearchParams()
  if (back) params.set('redirect', internalPath(back))
  params.set('notificare', 'Sesiunea a expirat. Autentifică-te din nou — ce ai scris se păstrează.')
  params.set('tip', 'error')
  return redirect(`/autentificare?${params.toString()}`)
}

/**
 * A dead end, dressed as the portal.
 *
 * For the cases where there is no page to go back to: a malformed request, an
 * unknown action. It does not use the layouts, so that it keeps working even
 * when the database is exactly the thing that went down.
 */
export function deadEnd(status: number, title: string, text: string): Response {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return new Response(
    `<!doctype html>
<html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Portal Studenți ASE</title>
<style>
 body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f8f9fa;
   font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1e23;padding:24px}
 .c{max-width:52ch;background:#fff;border:1px solid #e6e9ed;border-radius:8px;padding:32px;
   box-shadow:0 1px 2px rgba(26,30,35,.06),0 1px 3px rgba(26,30,35,.04)}
 h1{margin:0 0 12px;font:600 22px/1.3 Georgia,serif}
 p{margin:0 0 20px;color:#5b6169}
 a{display:inline-block;background:#990000;color:#fff;text-decoration:none;
   padding:11px 18px;border-radius:4px;font-weight:600;font-size:14px}
</style></head>
<body><main class="c">
  <h1>${esc(title)}</h1>
  <p>${esc(text)}</p>
  <a href="/">Înapoi la portal</a>
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}
