/**
 * Notificările portalului.
 *
 * Un singur canal, ca înainte, dar cu trei corecturi: o eroare nu mai dispare
 * singură după patru secunde, se poate închide cu mâna, și pleacă pe un canal
 * asertiv — un motiv de respingere nu are voie să fie anunțat cu aceeași
 * discreție ca „Termen adăugat”.
 */

type Ton = 'info' | 'error'

/**
 * O acțiune atașată notificării: „Anulează”, pentru ștergerile care se pot
 * întoarce. Trăiește exact cât notificarea, iar asta este și fereastra în care
 * anularea are sens — după ce mesajul a plecat, gestul s-a încheiat.
 */
export interface Actiune {
  text: string
  /** Ce se trimite, ca formular, la apăsare. */
  catre: string
  date: Record<string, string>
}

const DURATA_INFO = 5200

/** Cu o acțiune de anulat, notificarea rămâne mai mult: are ceva de citit și de decis. */
const DURATA_CU_ACTIUNE = 12_000

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

export function notifica(mesaj: string, ton: Ton = 'info', actiune?: Actiune) {
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

  /* Anularea este un formular, nu un fetch: trece prin aceeași rută POST, cu
   * aceleași verificări de proprietate, și se termină cu redirectul obișnuit —
   * deci pagina arată din nou ce există, fără să reconstruim nimic pe client. */
  if (actiune) {
    const f = document.createElement('form')
    f.method = 'POST'
    f.action = actiune.catre
    f.className = 'toast__actiune'
    for (const [nume, valoare] of Object.entries(actiune.date)) {
      const camp = document.createElement('input')
      camp.type = 'hidden'
      camp.name = nume
      camp.value = valoare
      f.appendChild(camp)
    }
    const b = document.createElement('button')
    b.type = 'submit'
    b.className = 'btn btn--ghost btn--sm'
    b.textContent = actiune.text
    f.appendChild(b)
    corp.appendChild(f)
  }

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
    const ceas = setTimeout(() => scoate(el), actiune ? DURATA_CU_ACTIUNE : DURATA_INFO)
    el.addEventListener('pointerenter', () => clearTimeout(ceas))
  }
}

export function porneste() {
  window.notifica = notifica

  const params = new URLSearchParams(location.search)
  const mesaj = params.get('notificare')
  if (!mesaj) return

  /* Anularea vine din adresă, pusă acolo de ruta care a șters: `anulare` este
   * calea, iar `anulare_date` câmpurile, ca JSON. Nimic din ele nu este de
   * încredere — ruta POST verifică oricum proprietatea, ca la orice cerere. */
  const catre = params.get('anulare')
  let actiune: Actiune | undefined
  if (catre && catre.startsWith('/api/')) {
    try {
      const date = JSON.parse(params.get('anulare_date') ?? '{}')
      if (date && typeof date === 'object') {
        actiune = { text: 'Anulează', catre, date: date as Record<string, string> }
      }
    } catch {
      // O adresă meșterită nu are voie să lase pagina fără notificare.
    }
  }

  notifica(mesaj, params.get('tip') === 'error' ? 'error' : 'info', actiune)

  params.delete('notificare')
  params.delete('tip')
  params.delete('anulare')
  params.delete('anulare_date')
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
