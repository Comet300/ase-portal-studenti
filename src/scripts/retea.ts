/**
 * Conexiunea pierdută.
 *
 * Publicul acestui portal îl deschide din amfiteatru și din metrou. Fără nimic
 * aici, un submit pe semnal slab dă pagina de eroare a browserului și tot ce
 * s-a scris dispare — mai des decât o respingere de la server, care măcar
 * păstrează câmpurile (vezi scripts/formulare.ts).
 */

export function porneste() {
  const banner = document.getElementById('banner-offline')
  if (!banner) return

  const arata = () => {
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

  window.addEventListener('online', arata)
  window.addEventListener('offline', arata)
  arata()
}
