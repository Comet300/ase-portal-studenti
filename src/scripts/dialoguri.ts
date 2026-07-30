/**
 * Ferestrele modale: Escape, fundal, și ce se pierde odată cu ele.
 *
 * Un `<dialog>` nativ se închide la Escape fără să întrebe nimic. Într-un
 * formular de o linie e în regulă; în cel de depunere a cererii, unde se scrie o
 * motivație de câteva sute de caractere, o tastă apăsată din reflex ștergea tot.
 * Clicul pe fundal, în schimb, nu făcea absolut nimic — două comportamente
 * diferite pentru același gest de „ies de aici”.
 */

const INTREBARE = 'Închizi fereastra? Ce ai scris până acum se pierde.'

/** Ce conține formularul acum, ca text, ca să poată fi comparat cu ce era. */
function amprenta(dialog: HTMLDialogElement): string {
  const form = dialog.querySelector('form')
  if (!form) return ''
  return [...new FormData(form).entries()]
    .filter(([nume]) => nume !== 'redirect' && !nume.startsWith('actiune'))
    .map(([nume, val]) => `${nume}=${typeof val === 'string' ? val : val.name}`)
    .join('&')
}

export function porneste() {
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    let laDeschidere = ''

    // `showModal` este apelat din alte scripturi, deci starea de referință se ia
    // la deschidere, oricine ar fi deschis-o.
    new MutationObserver(() => {
      if (dialog.open) laDeschidere = amprenta(dialog)
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] })

    const sAScris = () => amprenta(dialog) !== laDeschidere

    dialog.addEventListener('cancel', (e) => {
      if (!sAScris()) return
      e.preventDefault()
      if (confirm(INTREBARE)) dialog.close()
    })

    // Clicul pe fundal ajunge la dialog, nu la copiii lui: dacă ținta e chiar
    // el, s-a apăsat în afara casetei.
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return
      if (sAScris() && !confirm(INTREBARE)) return
      dialog.close()
    })

    // Focusul intră pe primul câmp, nu pe „✕”: cine deschide o fereastră vrea să
    // scrie în ea, nu să o închidă.
    dialog.addEventListener('close', () => {
      laDeschidere = ''
    })
  })
}

/** Mută focusul pe primul câmp al unei ferestre tocmai deschise. */
export function focuseazaPrimulCamp(dialog: HTMLDialogElement) {
  const camp = dialog.querySelector<HTMLElement>(
    '.field :is(input, select, textarea):not([type="hidden"])',
  )
  camp?.focus()
}
