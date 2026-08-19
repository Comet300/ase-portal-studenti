/**
 * The lost connection.
 *
 * The audience of this portal opens it from the lecture hall and from the
 * underground. With nothing here, a submit on a weak signal gives the browser's
 * error page and everything that was written disappears — more often than a
 * rejection from the server, which at least keeps the fields (see
 * scripts/forms.ts).
 */

export function start() {
  const banner = document.getElementById('banner-offline')
  if (!banner) return

  const render = () => {
    const offline = !navigator.onLine
    document.documentElement.dataset.offline = offline ? '' : undefined!
    if (!offline) delete document.documentElement.dataset.offline
    banner.hidden = !offline

    document.querySelectorAll<HTMLButtonElement>('form button[type="submit"]').forEach((b) => {
      if (offline) {
        b.setAttribute('aria-disabled', 'true')
        b.title = 'Nu ai conexiune. Ce ai scris rămâne aici.'
      } else if (b.dataset.loading === undefined) {
        b.removeAttribute('aria-disabled')
        b.removeAttribute('title')
      }
    })
  }

  window.addEventListener('online', render)
  window.addEventListener('offline', render)
  render()
}
