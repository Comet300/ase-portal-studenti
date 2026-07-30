/**
 * Notificările portalului.
 *
 * Un singur canal, ca înainte, dar cu trei corecturi: o eroare nu mai dispare
 * singură după patru secunde, se poate închide cu mâna, și pleacă pe un canal
 * asertiv — un motiv de respingere nu are voie să fie anunțat cu aceeași
 * discreție ca „Termen adăugat”.
 */

type Ton = 'info' | 'error'

const DURATA_INFO = 5200

function gazda(ton: Ton): HTMLElement | null {
  return document.getElementById(ton === 'error' ? 'toast-host-erori' : 'toast-host')
}

function scoate(el: HTMLElement) {
  if (el.dataset.pleaca !== undefined) return
  el.dataset.pleaca = ''
  // Locul se strânge odată cu ieșirea, ca stiva de dedesubt să alunece în sus
  // în loc să sară cu toată înălțimea deodată.
  el.style.marginBlockStart = `-${el.offsetHeight}px`
  el.addEventListener('transitionend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), 600)
}

export function notifica(mesaj: string, ton: Ton = 'info') {
  const parinte = gazda(ton)
  if (!parinte) return

  const el = document.createElement('div')
  el.className = ton === 'error' ? 'toast toast--error' : 'toast'

  const semn = document.createElement('span')
  semn.className = 'toast__semn'
  semn.setAttribute('aria-hidden', 'true')
  semn.textContent = ton === 'error' ? '!' : '✓'

  const corp = document.createElement('div')
  corp.className = 'toast__corp'

  const eticheta = document.createElement('strong')
  eticheta.className = 'toast__eticheta'
  eticheta.textContent = ton === 'error' ? 'Eroare' : 'Gata'

  const text = document.createElement('span')
  text.textContent = mesaj

  corp.append(eticheta, text)

  const inchide = document.createElement('button')
  inchide.className = 'toast__inchide'
  inchide.type = 'button'
  inchide.setAttribute('aria-label', 'Închide notificarea')
  inchide.textContent = '✕'
  inchide.addEventListener('click', () => scoate(el))

  el.append(semn, corp, inchide)
  parinte.appendChild(el)

  // Confirmările pleacă singure; erorile rămân până sunt citite și închise.
  if (ton !== 'error') {
    const ceas = setTimeout(() => scoate(el), DURATA_INFO)
    el.addEventListener('pointerenter', () => clearTimeout(ceas))
  }
}

export function porneste() {
  window.notifica = notifica

  const params = new URLSearchParams(location.search)
  const mesaj = params.get('notificare')
  if (!mesaj) return

  notifica(mesaj, params.get('tip') === 'error' ? 'error' : 'info')

  params.delete('notificare')
  params.delete('tip')
  const rest = params.toString()
  /* Fragmentul rămâne.
   *
   * Curățarea rescria adresa fără el, iar el este exact rândul la care se
   * întorcea salvarea: mesajul apărea, iar pagina rămânea în capul listei, cu
   * inelul de țintă stins înainte de a fi văzut. */
  history.replaceState(
    {},
    '',
    location.pathname + (rest ? `?${rest}` : '') + location.hash,
  )
}
