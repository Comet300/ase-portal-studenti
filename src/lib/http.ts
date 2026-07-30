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

/**
 * Sesiunea a expirat în timp ce cineva completa un formular.
 *
 * Rutele răspundeau cu `new Response('Neautentificat', { status: 401 })` — adică
 * o pagină albă cu un cuvânt pe ea, în afara portalului, după douăzeci de minute
 * de scris. Cookie-ul ține treizeci de zile, deci se întâmplă rar, dar când se
 * întâmplă e cel mai prost moment posibil.
 *
 * Un redirect duce omul unde poate face ceva. Ce a scris se păstrează oricum în
 * `sessionStorage` (scripts/formulare.ts) și revine după autentificare.
 */
export function sessionExpired(back?: string): Response {
  const params = new URLSearchParams()
  if (back) params.set('redirect', internalPath(back))
  params.set('notificare', 'Sesiunea a expirat. Autentifică-te din nou — ce ai scris se păstrează.')
  params.set('tip', 'error')
  return redirect(`/autentificare?${params.toString()}`)
}

/**
 * Un capăt de drum, îmbrăcat ca portalul.
 *
 * Pentru cazurile în care nu există o pagină la care să te întorci: o cerere
 * greșită, o acțiune necunoscută. Nu folosește layout-urile, ca să funcționeze
 * și când baza de date este exact lucrul care a picat.
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
