/**
 * The phone menu.
 *
 * It was a `<nav hidden>` toggled by a button: no animation, no backdrop, no
 * closing on Escape or on a touch outside, and the page underneath kept
 * scrolling below it. From behind the menu Tab could reach the covered content,
 * which for a screen reader means the menu practically never opened.
 *
 * The same mechanics also serve the teachers' sidebar, which already had half
 * of it.
 */

interface Options {
  button: string
  panel: string
  /** The class that marks the open state; the page styles already know it. */
  openClass?: string
  /**
   * The teachers' sidebar is permanently visible on a wide screen, so it must
   * not be allowed to receive `hidden`; the phone menu, which does not exist
   * otherwise, does receive it.
   */
  hide?: boolean
  /** The button text changes along with the state, not just `aria-expanded`. */
  openLabel?: string
  closedLabel?: string
}

export function start({
  button: buttonSelector,
  panel: panelSelector,
  openClass = 'is-deschis',
  hide = true,
  openLabel = 'Închide meniul',
  closedLabel = 'Deschide meniul',
}: Options) {
  const button = document.querySelector<HTMLButtonElement>(buttonSelector)
  const panel = document.querySelector<HTMLElement>(panelSelector)
  if (!button || !panel) return

  let perdea: HTMLElement | null = null
  let deschis = false

  const setOpen = (next: boolean) => {
    if (next === deschis) return
    deschis = next

    if (hide) panel.hidden = !next
    panel.classList.toggle(openClass, next)

    /* Visually closed did not mean closed for the keyboard: the sidebar moved
     * off screen with `transform`, but its thirteen links stayed in the tab
     * order, so Tab walked the user through invisible content. */
    if (!hide) panel.toggleAttribute('inert', !next)
    button.setAttribute('aria-expanded', String(next))
    button.setAttribute('aria-label', next ? openLabel : closedLabel)

    // The page underneath no longer scrolls while the menu is over it.
    document.body.style.overflow = next ? 'hidden' : ''

    if (next) {
      perdea = document.createElement('div')
      perdea.className = 'perdea'
      perdea.addEventListener('click', () => setOpen(false))
      document.body.appendChild(perdea)
      panel.querySelector<HTMLElement>('a, button')?.focus()
      return
    }

    perdea?.remove()
    perdea = null
    if (panel.contains(document.activeElement)) button.focus()
  }

  button.addEventListener('click', () => setOpen(!deschis))

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deschis) setOpen(false)
  })

  // Focus is not allowed to leave the menu while it is open: otherwise Tab walks
  // the user through the covered page, without them seeing where they got to.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !deschis) return
    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  })

  // A turn into landscape can bring the normal bar back; the menu must not stay
  // open over it.
  const wide = window.matchMedia('(min-width: 901px)')
  wide.addEventListener('change', (e) => {
    if (e.matches) setOpen(false)
  })

  // At a wide width the bar is visible and has to be navigable.
  if (!hide && wide.matches) panel.removeAttribute('inert')
  wide.addEventListener('change', (e) => {
    if (!hide) panel.toggleAttribute('inert', !e.matches && !deschis)
  })
}

/**
 * A `<details>` panel that closes like a menu.
 *
 * A native `<details>` closes only if you press the summary again — neither
 * Escape nor a click outside. For something that looks like a menu, both are
 * expected.
 */
export function panels(selector: string) {
  document.querySelectorAll<HTMLDetailsElement>(selector).forEach((d) => {
    document.addEventListener('click', (e) => {
      if (d.open && !d.contains(e.target as Node)) d.open = false
    })
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !d.open) return
      d.open = false
      d.querySelector<HTMLElement>('summary')?.focus()
    })
  })
}
