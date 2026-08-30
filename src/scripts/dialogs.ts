/**
 * Modal windows: Escape, the backdrop, and what is lost along with them.
 *
 * A native `<dialog>` closes on Escape without asking anything. In a one-line
 * form that is fine; in the one for submitting a request, where a rationale of
 * a few hundred characters is written, a key pressed out of reflex erased
 * everything. The click on the backdrop, on the other hand, did absolutely
 * nothing — two different behaviours for the same „ies de aici” gesture.
 */

const CONFIRM_QUESTION = 'Închizi fereastra? Ce ai scris până acum se pierde.'

/** What the form contains now, as text, so it can be compared with what was. */
function fingerprint(dialog: HTMLDialogElement): string {
  const form = dialog.querySelector('form')
  if (!form) return ''
  return [...new FormData(form).entries()]
    .filter(([nume]) => nume !== 'redirect' && !nume.startsWith('actiune'))
    .map(([nume, val]) => `${nume}=${typeof val === 'string' ? val : val.name}`)
    .join('&')
}

export function start() {
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    let atOpen = ''

    // `showModal` is called from other scripts, so the reference state is taken
    // at opening time, whoever opened it.
    new MutationObserver(() => {
      if (dialog.open) atOpen = fingerprint(dialog)
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] })

    const hasTyped = () => fingerprint(dialog) !== atOpen

    dialog.addEventListener('cancel', (e) => {
      if (!hasTyped()) return
      e.preventDefault()
      if (confirm(CONFIRM_QUESTION)) dialog.close()
    })

    // The click on the backdrop reaches the dialog, not its children: if the
    // target is the dialog itself, the press was outside the box.
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return
      if (hasTyped() && !confirm(CONFIRM_QUESTION)) return
      dialog.close()
    })

    // The focus goes to the first field, not to „✕”: whoever opens a window
    // wants to write in it, not to close it.
    dialog.addEventListener('close', () => {
      atOpen = ''
    })
  })
}

/** Moves the focus to the first field of a window that has just been opened. */
export function focusFirstField(dialog: HTMLDialogElement) {
  const field = dialog.querySelector<HTMLElement>(
    '.field :is(input, select, textarea):not([type="hidden"])',
  )
  field?.focus()
}
