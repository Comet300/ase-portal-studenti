import { SCREENS } from '../lib/navigation'

/**
 * A single field for the whole portal.
 *
 * The portal has eleven screens, and the way to any of them goes through the
 * sidebar: for a coordinator who jumps between the request queue, a discussion
 * thread and the consultation schedule twenty times a day, that means twenty
 * crossings of the screen with the mouse. Ctrl+K opens a list in which you type
 * where you want to end up.
 *
 * It is not a search over the data — it does not look for students, nor topics,
 * because that would ask for a new route and an index, and the catalogue
 * already has its own search. It is navigation, plus the actions the current
 * page has: exactly what is now hidden in the furniture.
 */

interface Entry {
  text: string
  /** What shows under the text: where it leads or what kind of thing it is. */
  note?: string
  href: string
  /** Words it can also be found by, besides the text. */
  synonyms?: string
}

/** Diacritics do not get typed when you are in a hurry: „consultatii” must find „Consultații”. */
function normalizeText(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
}

/**
 * Subsequence matching, not substring matching.
 *
 * „cst” finds „Consultații”, the way anyone who has used a command field
 * expects. A score is returned: letters stuck one next to the other and a match
 * at the start of a word weigh more, so that „mes” does not put „Teme propuse”
 * ahead of „Mesaje”.
 */
function scoreMatch(text: string, query: string): number | null {
  if (!query) return 0
  const t = normalizeText(text)
  const n = normalizeText(query).replace(/\s+/g, '')
  let i = 0
  let score = 0
  let lastIndex = -2
  for (const letter of n) {
    const found = t.indexOf(letter, i)
    if (found === -1) return null
    if (found === lastIndex + 1) score += 3
    if (found === 0 || t[found - 1] === ' ') score += 2
    lastIndex = found
    i = found + 1
  }
  // A short text that contains everything you typed is almost surely the one
  // being looked for.
  return score - Math.floor(t.length / 12)
}

function buildEntries(): Entry[] {
  const nav = [...document.querySelectorAll<HTMLAnchorElement>('.nav__link, .nav-link')]
  const seen = new Set<string>()
  const entries: Entry[] = []

  /* The destinations are taken from the page's bar, not from the table of
   * screens: the bar already knows what the current role sees, and a student
   * has no business with „Departament” in the list just because the route
   * exists. */
  for (const a of nav) {
    const path = a.getAttribute('href') ?? ''
    if (!path.startsWith('/') || seen.has(path)) continue
    seen.add(path)
    /* No note: the screen name is enough, and „/coordonatori” written under
     * „Coordonatori & Teme” adds nothing for someone looking for where to go. */
    entries.push({
      text: (SCREENS[path.split('?')[0]] ?? a.textContent ?? '').trim(),
      href: path,
    })
  }

  /* The current page's actions: the header buttons and the section tabs are
   * exactly the things for which the screen gets crossed with the mouse. */
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    '.content__header a[href], .topbar a[href].btn, .taburi a[href], .vederi a[href]',
  )) {
    const path = a.getAttribute('href') ?? ''
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!path.startsWith('/') || !text || seen.has(path + text)) continue
    seen.add(path + text)
    entries.push({ text, note: 'pe această pagină', href: path })
  }

  return entries.filter((i) => i.text)
}

export function start() {
  // Without destinations there is no point: the sign-in screen has no navigation.
  const entries = buildEntries()
  if (entries.length === 0) return

  const dialog = document.createElement('dialog')
  dialog.className = 'paleta'
  dialog.setAttribute('aria-label', 'Mergi la')

  const field = document.createElement('input')
  field.className = 'paleta__camp'
  field.type = 'text'
  field.placeholder = 'Scrie unde vrei să ajungi…'
  field.setAttribute('aria-label', 'Caută în portal')
  field.autocomplete = 'off'
  field.setAttribute('role', 'combobox')
  field.setAttribute('aria-expanded', 'true')
  field.setAttribute('aria-controls', 'paleta-lista')

  const lista = document.createElement('ul')
  lista.className = 'paleta__lista'
  lista.id = 'paleta-lista'
  lista.setAttribute('role', 'listbox')

  const emptyMessage = document.createElement('p')
  emptyMessage.className = 'paleta__gol'
  emptyMessage.textContent = 'Nimic nu se potrivește.'
  emptyMessage.hidden = true

  const footerHint = document.createElement('p')
  footerHint.className = 'paleta__jos'
  footerHint.textContent = '↑↓ alegi · Enter deschizi · Esc închizi'

  dialog.append(field, lista, emptyMessage, footerHint)
  document.body.appendChild(dialog)

  let visible: Entry[] = []
  let ales = 0

  const render = () => {
    const query = field.value.trim()
    visible = entries
      .map((i) => ({ i, s: Math.max(scoreMatch(i.text, query) ?? -Infinity, scoreMatch(i.synonyms ?? '', query) ?? -Infinity) }))
      .filter((x) => Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.i)

    ales = 0
    lista.textContent = ''
    emptyMessage.hidden = visible.length > 0

    visible.forEach((entry, index) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.id = `paleta-op-${index}`
      li.setAttribute('aria-selected', String(index === ales))
      li.className = index === ales ? 'paleta__op is-ales' : 'paleta__op'

      const a = document.createElement('a')
      a.href = entry.href
      a.tabIndex = -1
      const strongText = document.createElement('strong')
      strongText.textContent = entry.text
      a.appendChild(strongText)
      if (entry.note) {
        const smallText = document.createElement('small')
        smallText.textContent = entry.note
        a.appendChild(smallText)
      }
      li.appendChild(a)
      // The mouse moves the selection instead of doubling it: otherwise Enter
      // would open something other than what is highlighted under the cursor.
      li.addEventListener('mousemove', () => {
        if (ales === index) return
        ales = index
        highlight()
      })
      lista.appendChild(li)
    })

    highlight()
  }

  const highlight = () => {
    ;[...lista.children].forEach((li, index) => {
      li.className = index === ales ? 'paleta__op is-ales' : 'paleta__op'
      li.setAttribute('aria-selected', String(index === ales))
    })
    field.setAttribute('aria-activedescendant', visible.length ? `paleta-op-${ales}` : '')
    lista.children[ales]?.scrollIntoView({ block: 'nearest' })
  }

  const open = () => {
    if (dialog.open) return
    field.value = ''
    render()
    dialog.showModal()
    field.focus()
  }

  field.addEventListener('input', render)

  field.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      ales = Math.min(ales + 1, visible.length - 1)
      highlight()
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      ales = Math.max(ales - 1, 0)
      highlight()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = visible[ales]
      if (target) location.href = target.href
    }
  })

  /* Ctrl+K, and Cmd+K on Mac. It does not open over a field being typed into: a
   * coordinator who is typing a message and presses Ctrl+K wants something
   * other than to have the text disappear under a dialog. */
  document.addEventListener('keydown', (e) => {
    const isK = e.key === 'k' || e.key === 'K'
    if (!isK || !(e.ctrlKey || e.metaKey)) return
    const active = document.activeElement
    const isTyping =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(active.type))
    if (isTyping && active !== field) return
    e.preventDefault()
    open()
  })

  // A way to open it for those who do not have a keyboard at hand.
  document.querySelectorAll('[data-paleta]').forEach((b) => b.addEventListener('click', open))
}
