/**
 * Meniul de pe telefon.
 *
 * Era un `<nav hidden>` comutat de un buton: fără animație, fără fundal, fără
 * închidere la Escape sau la atingerea în afară, iar pagina de dedesubt
 * continua să deruleze sub el. Din spatele meniului se putea ajunge cu Tab în
 * conținutul acoperit, ceea ce pentru un cititor de ecran înseamnă că meniul
 * practic nu s-a deschis.
 *
 * Aceeași mecanică servește și bara laterală a cadrelor didactice, care avea
 * deja jumătate din ea.
 */

interface Optiuni {
  buton: string
  panou: string
  /** Clasa care marchează starea deschisă; stilurile de pagină o cunosc deja. */
  clasa?: string
  /**
   * Bara laterală a cadrelor didactice este vizibilă permanent pe ecran lat, deci
   * nu are voie să primească `hidden`; meniul de telefon, care nu există altfel,
   * îl primește.
   */
  ascunde?: boolean
  /** Textul butonului se schimbă odată cu starea, nu doar `aria-expanded`. */
  etichetaDeschis?: string
  etichetaInchis?: string
}

export function porneste({
  buton: selectorButon,
  panou: selectorPanou,
  clasa = 'is-deschis',
  ascunde = true,
  etichetaDeschis = 'Închide meniul',
  etichetaInchis = 'Deschide meniul',
}: Optiuni) {
  const buton = document.querySelector<HTMLButtonElement>(selectorButon)
  const panou = document.querySelector<HTMLElement>(selectorPanou)
  if (!buton || !panou) return

  let perdea: HTMLElement | null = null
  let deschis = false

  const seteaza = (vrem: boolean) => {
    if (vrem === deschis) return
    deschis = vrem

    if (ascunde) panou.hidden = !vrem
    panou.classList.toggle(clasa, vrem)
    buton.setAttribute('aria-expanded', String(vrem))
    buton.setAttribute('aria-label', vrem ? etichetaDeschis : etichetaInchis)

    // Pagina de dedesubt nu mai derulează cât meniul e peste ea.
    document.body.style.overflow = vrem ? 'hidden' : ''

    if (vrem) {
      perdea = document.createElement('div')
      perdea.className = 'perdea'
      perdea.addEventListener('click', () => seteaza(false))
      document.body.appendChild(perdea)
      panou.querySelector<HTMLElement>('a, button')?.focus()
      return
    }

    perdea?.remove()
    perdea = null
    if (panou.contains(document.activeElement)) buton.focus()
  }

  buton.addEventListener('click', () => seteaza(!deschis))

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deschis) seteaza(false)
  })

  // Focusul nu are voie să iasă din meniu cât e deschis: altfel Tab plimbă
  // utilizatorul prin pagina acoperită, fără să vadă unde a ajuns.
  panou.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !deschis) return
    const focusabile = [...panou.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
    if (focusabile.length === 0) return

    const primul = focusabile[0]
    const ultimul = focusabile[focusabile.length - 1]

    if (e.shiftKey && document.activeElement === primul) {
      e.preventDefault()
      ultimul.focus()
    } else if (!e.shiftKey && document.activeElement === ultimul) {
      e.preventDefault()
      primul.focus()
    }
  })

  // O rotire în peisaj poate readuce bara normală; meniul nu trebuie să rămână
  // deschis peste ea.
  const lat = window.matchMedia('(min-width: 901px)')
  lat.addEventListener('change', (e) => {
    if (e.matches) seteaza(false)
  })
}
