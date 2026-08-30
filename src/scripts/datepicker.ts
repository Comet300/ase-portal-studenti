/**
 * The date field, with a calendar the portal drew itself.
 *
 * The `<input type="date">` stays: it is what posts `YYYY-MM-DD`, what the
 * server validates, what a phone opens its own wheel for, and what still works
 * with this file switched off. What it does not do is look like the rest of the
 * portal — the drop-down panel is the operating system's, in a font nobody
 * chose, and the value is written in the browser's locale, so „05.08.2026” sat
 * two lines under „5 august 2026”. This adds the missing half: a trigger, a
 * month grid in Romanian, and the value read back as prose.
 *
 * Nothing here is a source of truth. Every path ends in writing `input.value`
 * and firing `change`, so `forms.ts`, `validation.ts` and `dialogs.ts` see
 * exactly what they would have seen from a keystroke.
 */

import { MONTHS, WEEKDAYS, formatDate, localDay, monthGrid, parseDay } from '../lib/date'
import { numar } from '../lib/text'

/** The day the reader is in, not the day UTC is in. */
const today = () => localDay(new Date())

function shiftDays(iso: string, days: number): string {
  const d = parseDay(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return localDay(d)
}

/**
 * A month away, keeping the day of the month where it can.
 *
 * `setMonth` on the 31st of a month rolls into the next one — PageDown from
 * „31 martie” landed on „1 mai”, skipping April entirely. The day is clamped to
 * the last of the month it arrives in.
 */
function shiftMonths(iso: string, months: number): string {
  const d = parseDay(iso)
  if (!d) return iso
  const day = d.getDate()
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return localDay(new Date(target.getFullYear(), target.getMonth(), Math.min(day, last)))
}

/** Whole days from one to the other, both counted: 1–14 octombrie is 14 days. */
function daysBetween(from: string, to: string): number | null {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

function build(field: HTMLElement) {
  const input = field.querySelector<HTMLInputElement>('[data-camp]')
  const trigger = field.querySelector<HTMLButtonElement>('[data-buton]')
  const readout = field.querySelector<HTMLElement>('[data-citit]')
  /* The span sits in the label, which is a sibling of this box, not a child of
   * it: looked up from here it was never found and the range said nothing. */
  const span = field.closest('.field')?.querySelector<HTMLElement>('[data-durata]') ?? null
  if (!input || !trigger || !readout) return

  /* The bound written into the markup, kept aside: a range field overwrites
   * `min` with its partner's value and has to be able to fall back to it when
   * the partner is emptied. */
  const floorAttr = input.getAttribute('min') ?? ''
  const ceiling = input.getAttribute('max') ?? ''
  const partner = field.dataset.pereche
    ? document.getElementById(field.dataset.pereche)
    : null
  const start = partner instanceof HTMLInputElement ? partner : null

  let panel: HTMLElement | null = null
  let grid: HTMLElement | null = null
  let title: HTMLElement | null = null
  let prev: HTMLButtonElement | null = null
  let next: HTMLButtonElement | null = null
  let cells: HTMLButtonElement[] = []
  let cursor = today() // the day the grid has focus on, chosen or not
  let open = false

  const floor = () => (start?.value ? start.value : floorAttr)
  const outOfRange = (iso: string) =>
    (floor() !== '' && iso < floor()) || (ceiling !== '' && iso > ceiling)

  /* --- the value, read back as prose --------------------------------------
   *
   * It sits over the field, not under it: an extra line would push the date
   * fields taller than the ones beside them and break every row that aligns on
   * its bottom edge. It is hidden the moment the field takes focus, so what is
   * typed into is always the real control. */
  const showValue = () => {
    readout.textContent = formatDate(input.value || null)
    readout.hidden = input.value === ''
    showSpan()
  }

  /** „· 14 zile”, in the label of the field that closes a range. */
  const showSpan = () => {
    if (!span || !start) return
    const days = start.value && input.value ? daysBetween(start.value, input.value) : null
    const reversed = days !== null && days < 1

    span.hidden = days === null
    span.classList.toggle('is-eroare', reversed)
    // Colour alone would say „ceva e roșu”, not what: the words carry it.
    span.textContent = reversed
      ? '· se încheie înainte să înceapă'
      : days === null
        ? ''
        : `· ${numar(days, 'zi', 'zile')}`

    if (reversed) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
  }

  /** The partner moved, so the earliest day this field accepts moved with it. */
  const followPartner = () => {
    if (!start) return
    if (start.value) input.setAttribute('min', start.value)
    else if (floorAttr) input.setAttribute('min', floorAttr)
    else input.removeAttribute('min')
    showSpan()
  }

  /* --- the panel ----------------------------------------------------------
   *
   * Built on the first opening, not on load: the calendar screen renders one of
   * these per stage, inside a collapsed `<details>`, and forty-two buttons times
   * twenty stages is a page nobody asked for. */
  const make = () => {
    if (panel) return
    panel = document.createElement('div')
    panel.className = 'alege-data__panou'
    panel.hidden = true
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Alege o dată')

    const head = document.createElement('div')
    head.className = 'alege-data__cap'

    prev = document.createElement('button')
    prev.type = 'button'
    prev.className = 'alege-data__nav'
    prev.setAttribute('aria-label', 'Luna precedentă')
    prev.innerHTML = arrow('M19 12H5M12 19l-7-7 7-7')
    // The focus stays on the arrow: whoever is walking back through the months
    // presses it several times, and a focus that jumps into the grid stops that.
    prev.addEventListener('click', () => moveTo(shiftMonths(cursor, -1), false))

    next = document.createElement('button')
    next.type = 'button'
    next.className = 'alege-data__nav'
    next.setAttribute('aria-label', 'Luna următoare')
    next.innerHTML = arrow('M5 12h14M13 6l6 6-6 6')
    next.addEventListener('click', () => moveTo(shiftMonths(cursor, 1), false))

    title = document.createElement('p')
    title.className = 'alege-data__luna'
    // The month is the only thing that changes when the arrows are pressed, and
    // a screen reader is otherwise told nothing at all.
    title.setAttribute('aria-live', 'polite')

    head.append(prev, title, next)

    grid = document.createElement('div')
    grid.className = 'alege-data__zile'
    grid.setAttribute('role', 'grid')

    const header = document.createElement('div')
    header.className = 'alege-data__rand alege-data__rand--cap'
    header.setAttribute('role', 'row')
    for (const day of WEEKDAYS) {
      const th = document.createElement('span')
      th.setAttribute('role', 'columnheader')
      th.setAttribute('aria-label', day)
      th.className = 'alege-data__cap-zi'
      // Two letters, not one: „L M M J V S D” has the same initial twice.
      th.textContent = day.slice(0, 2)
      header.appendChild(th)
    }
    grid.appendChild(header)

    cells = []
    for (let week = 0; week < 6; week++) {
      const row = document.createElement('div')
      row.className = 'alege-data__rand'
      row.setAttribute('role', 'row')
      for (let day = 0; day < 7; day++) {
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'alege-data__zi'
        cell.setAttribute('role', 'gridcell')
        cell.tabIndex = -1
        cell.addEventListener('click', () => {
          if (cell.getAttribute('aria-disabled') === 'true') return
          choose(cell.dataset.zi ?? '')
        })
        cells.push(cell)
        row.appendChild(cell)
      }
      grid.appendChild(row)
    }

    const foot = document.createElement('div')
    foot.className = 'alege-data__subsol'

    const now = document.createElement('button')
    now.type = 'button'
    now.className = 'alege-data__actiune'
    now.textContent = 'Astăzi'
    now.addEventListener('click', () => {
      if (outOfRange(today())) moveTo(today())
      else choose(today())
    })
    foot.appendChild(now)

    // Emptying a field the server insists on would only produce a refusal.
    if (!input.required) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'alege-data__actiune'
      clear.textContent = 'Golește'
      clear.addEventListener('click', () => choose(''))
      foot.appendChild(clear)
    }

    panel.append(head, grid, foot)
    panel.addEventListener('keydown', onKey)
    field.appendChild(panel)
  }

  const arrow = (d: string) =>
    `<svg class="icon icon--md" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${d}"/></svg>`

  /* --- drawing ------------------------------------------------------------ */
  const draw = () => {
    if (!grid || !title || !prev || !next) return
    const anchor = parseDay(cursor) ?? new Date()
    const year = anchor.getFullYear()
    const month = anchor.getMonth()

    title.textContent = `${MONTHS[month]} ${year}`

    const days = monthGrid(year, month)
    const now = today()
    const chosen = input.value
    const from = start?.value ?? ''

    days.forEach((iso, i) => {
      const cell = cells[i]
      const date = parseDay(iso)!
      const disabled = outOfRange(iso)
      const selected = iso === chosen

      cell.dataset.zi = iso
      cell.textContent = String(date.getDate())
      cell.tabIndex = iso === cursor ? 0 : -1
      cell.setAttribute('aria-selected', String(selected))
      cell.setAttribute('aria-disabled', String(disabled))
      cell.classList.toggle('is-alta-luna', date.getMonth() !== month)
      cell.classList.toggle('is-azi', iso === now)
      // The band between the two ends of a range, so the pair reads as one span.
      cell.classList.toggle(
        'is-interval',
        Boolean(from) && chosen !== '' && iso > from && iso < chosen,
      )
      cell.classList.toggle('is-capat', Boolean(from) && iso === from)

      const parts = [formatDate(iso)]
      if (iso === now) parts.push('astăzi')
      if (iso === from) parts.push('începutul intervalului')
      if (disabled) parts.push('indisponibilă')
      cell.setAttribute('aria-label', parts.join(', '))
    })

    // A month entirely outside the bounds cannot be reached, so its arrow says so.
    prev.disabled = floor() !== '' && localDay(new Date(year, month, 0)) < floor()
    next.disabled = ceiling !== '' && localDay(new Date(year, month + 1, 1)) > ceiling
  }

  const focusCursor = () => {
    cells.find((c) => c.dataset.zi === cursor)?.focus()
  }

  const moveTo = (iso: string, moveFocus = true) => {
    cursor = iso
    draw()
    if (moveFocus && open) focusCursor()
  }

  const choose = (iso: string) => {
    input.value = iso
    /* `validation.ts` clears the custom message on `input`/`change` only; a value
     * written straight into the property fires neither, and the field stayed
     * invalid with nothing on screen saying why. */
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    showValue()
    close()
  }

  /* --- opening and closing ------------------------------------------------ */
  const place = () => {
    if (!panel) return
    panel.classList.remove('is-dreapta', 'is-sus')
    const box = panel.getBoundingClientRect()
    // On a phone the panel is nearly as wide as the screen: anchored left it
    // hangs off the right edge and widens the document.
    if (box.right > window.innerWidth - 8) panel.classList.add('is-dreapta')
    const anchor = field.getBoundingClientRect()
    if (box.bottom > window.innerHeight - 8 && anchor.top > box.height + 8) {
      panel.classList.add('is-sus')
    }
  }

  const show = () => {
    make()
    if (!panel) return
    open = true
    panel.hidden = false
    trigger.setAttribute('aria-expanded', 'true')

    const wanted = input.value || today()
    // Opening on a day the bounds forbid would put the cursor where Enter does
    // nothing; the nearest permitted day is the useful start.
    cursor = outOfRange(wanted)
      ? floor() !== '' && wanted < floor()
        ? floor()
        : ceiling
      : wanted
    draw()
    place()
    focusCursor()
  }

  const close = (returnFocus = true) => {
    if (!open || !panel) return
    open = false
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (returnFocus) trigger.focus()
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      /* Inside `<dialog>` the browser also answers Escape by firing `cancel` on
       * the window itself, so without `preventDefault` one press closed both the
       * calendar and the form behind it. */
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    if (e.key === 'Tab') {
      // „Astăzi” and „Golește” are only reachable from the grid by Tab, so the
      // cycle stays inside the panel; Escape is the way out.
      const stops = [...(panel?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"])',
      ) ?? [])]
      if (stops.length === 0) return
      const at = stops.indexOf(document.activeElement as HTMLElement)
      const step = e.shiftKey ? -1 : 1
      e.preventDefault()
      stops[(at + step + stops.length) % stops.length].focus()
      return
    }

    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftDays(cursor, -1),
      ArrowRight: () => shiftDays(cursor, 1),
      ArrowUp: () => shiftDays(cursor, -7),
      ArrowDown: () => shiftDays(cursor, 7),
      Home: () => shiftDays(cursor, -weekdayOf(cursor)),
      End: () => shiftDays(cursor, 6 - weekdayOf(cursor)),
      PageUp: () => shiftMonths(cursor, e.shiftKey ? -12 : -1),
      PageDown: () => shiftMonths(cursor, e.shiftKey ? 12 : 1),
    }

    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      moveTo(move())
      return
    }

    if (e.key === 'Enter' || e.key === ' ') {
      const cell = e.target as HTMLElement
      if (cell.classList.contains('alege-data__zi')) {
        e.preventDefault()
        if (cell.getAttribute('aria-disabled') !== 'true') choose(cursor)
      }
    }
  }

  const weekdayOf = (iso: string) => ((parseDay(iso)?.getDay() ?? 1) + 6) % 7

  /* --- wiring ------------------------------------------------------------- */
  field.classList.add('is-imbunatatit')
  trigger.hidden = false
  trigger.addEventListener('click', () => (open ? close() : show()))

  document.addEventListener('click', (e) => {
    if (open && !field.contains(e.target as Node)) close(false)
  })
  // Escape anywhere in the field, including from the input itself.
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close()
    }
  })

  input.addEventListener('change', showValue)
  input.addEventListener('input', showValue)

  /* A failed validation comes back through `forms.ts`, which writes the saved
   * values into the fields directly — no `input` event, so the prose over the
   * field would still show the date from before the error. */
  input.form?.addEventListener('reluat', () => {
    showValue()
    followPartner()
  })
  // Back-button restores read from the browser's own cache, not from the markup.
  window.addEventListener('pageshow', showValue)

  if (start) {
    for (const event of ['change', 'input'] as const) {
      start.addEventListener(event, followPartner)
    }
    followPartner()
  }

  showValue()
}

export function start() {
  document.querySelectorAll<HTMLElement>('[data-alege-data]').forEach(build)
}
