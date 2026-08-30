/**
 * The discussion thread, on the client.
 *
 * The rest of the portal submits through a plain POST and reloads the page,
 * which is fine for a form filled in once. In a conversation it is not: on
 * every reply the position in the thread was lost, and the message just sent
 * ended up below the bottom edge. Here — and only here — sending is done from
 * JavaScript.
 *
 * The form stays a real form: without JavaScript it submits normally.
 */

import { prezenta } from '../lib/presence'
import { numar } from '../lib/text'

const MAX = 15 * 1024 * 1024
const NEAR_BOTTOM_PX = 200

/* The same list as on the server (lib/files.ts). It is written down twice
 * because the client script cannot import from the server modules, but the
 * check that counts remains the one in the API. */
const EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'xls', 'xlsx', 'csv', 'ods',
  'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'zip',
])

/* Which of them the browser can be asked to draw in the strip.
 *
 * Decided on the extension, not on `File.type`: a file dragged out of a zip, or
 * off a network share, arrives with an empty type, and the server derives the
 * mime from the extension anyway (lib/files.ts). Judging by the type meant the
 * same photo previewed or not depending on where it was dragged from. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

function extensionOf(name: string): string {
  const part = name.split('.').pop()
  return !part || part === name ? '' : part.toLowerCase()
}

function isAllowedExtension(nume: string): boolean {
  const ext = extensionOf(nume)
  return !!ext && EXTENSIONS.has(ext)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function acum(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'acum'
  if (min < 60) return `acum ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `acum ${hours} ${hours === 1 ? 'oră' : 'ore'}`
  const days = Math.floor(hours / 24)
  return `acum ${days} ${days === 1 ? 'zi' : 'zile'}`
}

export function start() {
  const form = document.querySelector<HTMLFormElement>('.chat__compose')
  const input = document.querySelector<HTMLTextAreaElement>('.chat__input')
  const fisier = document.querySelector<HTMLInputElement>('.chat__compose input[type="file"]')
  const scroller = document.getElementById('chat-messages')
  const fir = document.querySelector<HTMLElement>('.chat__thread')

  /* --- relative time no longer freezes at render -------------------------- */
  const refreshTimes = () => {
    document.querySelectorAll<HTMLTimeElement>('time[data-relativ]').forEach((t) => {
      const iso = t.getAttribute('datetime')
      if (iso) t.textContent = acum(iso)
    })
  }
  refreshTimes()
  setInterval(refreshTimes, 60_000)

  /* A thread whose pairing has ended has no composer at all — in its place
   * stands the record saying what closed it. The guard used to be
   * `if (!form || !input || !scroller) return`, which meant that on exactly
   * those threads the files drawer, the thesis panel, the poll and the relative
   * times all stopped working too: read-only would have become inert. Only the
   * message list is indispensable here. */
  if (!scroller) return

  /* --- the position in the thread --------------------------------------------
   *
   * The initial jump is instant — an animated scroll from the beginning of a
   * long conversation is an animation nobody asked for. Only after it does
   * smooth scrolling get turned on, for the messages that follow. */
  const scrollToBottom = (smooth = false) => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  const isNearBottom = () =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX

  scrollToBottom()
  requestAnimationFrame(() => {
    scroller.style.scrollBehavior = 'smooth'
  })

  const scrollPill = document.getElementById('mesaje-noi')
  const toggleScrollPill = () => {
    if (scrollPill) scrollPill.hidden = isNearBottom()
  }
  scroller.addEventListener('scroll', toggleScrollPill, { passive: true })
  scrollPill?.addEventListener('click', () => scrollToBottom(true))
  toggleScrollPill()

  const composer =
    form && input ? startComposer({ form, input, fisier, scroller, fir, scrollToBottom }) : null

  // A file dropped beside the thread would have the browser open it over the
  // portal — including on a closed thread, where nothing accepts it.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  /* --- the files drawer --------------------------------------------------- */
  const filesDrawer = document.getElementById('fisiere-drawer')
  const comuta = document.getElementById('comuta-fisiere')

  const setFilesDrawer = (open: boolean) => {
    if (!filesDrawer) return
    filesDrawer.hidden = !open
    comuta?.setAttribute('aria-expanded', String(open))

    if (open) {
      filesDrawer.querySelector<HTMLElement>('input, button, a')?.focus()
      return
    }
    // The focus goes back only if it was inside: otherwise we would steal it
    // from wherever it has landed in the meantime.
    if (filesDrawer.contains(document.activeElement)) comuta?.focus()
  }

  comuta?.addEventListener('click', () => setFilesDrawer(filesDrawer?.hidden ?? true))
  document.getElementById('inchide-fisiere')?.addEventListener('click', () => setFilesDrawer(false))

  /* --- the thesis context drawer ------------------------------------------ */

  /* Below 1200px the right-hand column does not fit, and until now it simply
   * disappeared: the thesis title, the deadlines and the supervisor did not
   * exist on a tablet or on a phone. The same mechanics as for the files —
   * open, announced as a drawer; at a large width the button is not visible, so
   * `hidden` is never set and the column stays a column. */
  const context = document.getElementById('chat-context')
  const contextToggle = document.getElementById('comuta-context')

  const setContext = (open: boolean) => {
    if (!context) return
    context.hidden = !open
    contextToggle?.setAttribute('aria-expanded', String(open))
    if (open) {
      context.querySelector<HTMLElement>('a, button')?.focus()
      return
    }
    if (context.contains(document.activeElement)) contextToggle?.focus()
  }

  // Starts closed on a narrow screen, without touching anything on a wide one.
  if (context && contextToggle && contextToggle.offsetParent !== null) {
    context.hidden = true
  }

  contextToggle?.addEventListener('click', () => setContext(context?.hidden ?? true))
  document.getElementById('inchide-context')?.addEventListener('click', () => setContext(false))

  /* Crossing above 1200px with the drawer closed left the column hidden on a
   * screen where it must always be visible. */
  const wide = window.matchMedia('(min-width: 1201px)')
  const matchWidth = () => {
    if (!context) return
    if (wide.matches) context.hidden = false
    else if (contextToggle?.getAttribute('aria-expanded') !== 'true') context.hidden = true
  }
  wide.addEventListener('change', matchWidth)
  matchWidth()

  document.addEventListener('keydown', (e) => {
    if (input && e.target === input) return
    if (e.key === 'Escape' && filesDrawer && !filesDrawer.hidden) setFilesDrawer(false)
    if (e.key === 'Escape' && context && !context.hidden && contextToggle?.offsetParent !== null) {
      setContext(false)
    }
  })

  document.addEventListener('click', (e) => {
    if (!filesDrawer || filesDrawer.hidden) return
    const t = e.target as Node
    if (filesDrawer.contains(t) || comuta?.contains(t)) return
    setFilesDrawer(false)
  })

  /* --- the search inside the drawer --------------------------------------- */
  const cauta = document.getElementById('cauta-fisier') as HTMLInputElement | null
  cauta?.addEventListener('input', () => {
    const q = cauta.value.trim().toLowerCase()
    let visibleCount = 0
    filesDrawer?.querySelectorAll<HTMLElement>('[data-nume-fisier]').forEach((li) => {
      const isVisible = !q || (li.dataset.numeFisier ?? '').includes(q)
      li.hidden = !isVisible
      if (isVisible) visibleCount++
    })

    /* The files are grouped by month now, and a month with nothing left after
     * filtering would be a group heading without a group — „august, 3 fișiere”,
     * followed by nothing. The group disappears together with its content. */
    filesDrawer?.querySelectorAll<HTMLElement>('[data-luna]').forEach((grup) => {
      const filesInGroup = [...grup.querySelectorAll<HTMLElement>('[data-nume-fisier]')]
      grup.hidden = filesInGroup.length > 0 && filesInGroup.every((li) => li.hidden)
    })

    const emptyMessage = document.getElementById('fisiere-fara-rezultat')
    if (emptyMessage) emptyMessage.hidden = visibleCount > 0
  })

  /* --- the messages that arrive in the meantime ------------------------------
   *
   * Nothing reached an open conversation without a manual reload: two people
   * writing to each other at the same time saw nothing until one pressed F5.
   *
   * The query is cheap — a count, not content — and it stops completely when
   * the tab is out of sight, so that a portal left open overnight asks for
   * nothing. When something turns up, the page does not change under your hand:
   * a pill appears, which you press if you want to. */
  const conversationId = new URLSearchParams(location.search).get('conversatie')
  const newMessagesPill = document.getElementById('mesaje-primite')

  if (conversationId && newMessagesPill) {
    /* The reference point is how many messages the thread had, not how many
     * were rendered: the window is forty, and a thread of three hundred would
     * suddenly have looked full of new messages. */
    const fromPage = Number(
      document.querySelector<HTMLElement>('.chat')?.dataset.total ?? '',
    )
    const renderedTotal = Number.isFinite(fromPage) && fromPage > 0
      ? fromPage
      : scroller.querySelectorAll('.bubble, .eveniment').length
    let known = renderedTotal

    const poll = async () => {
      if (document.hidden || composer?.isSending()) return
      try {
        const r = await fetch(`/api/fir?conversatie=${encodeURIComponent(conversationId)}`, {
          headers: { accept: 'application/json' },
        })
        if (!r.ok) return
        const d = (await r.json()) as { total?: number; vazut?: string | null }

        /* Presence is refreshed on every tick, whether or not a message has
         * turned up: „în portal acum” has to stop being true on its own. */
        const presenceLabelEl = document.querySelector<HTMLElement>('[data-prezenta]')
        if (presenceLabelEl) {
          const text = prezenta(d.vazut ?? null)
          if (text) presenceLabelEl.textContent = text
        }

        if (typeof d.total !== 'number' || d.total <= known) return

        known = d.total
        const newCount = d.total - renderedTotal
        newMessagesPill.textContent =
          newCount === 1 ? '1 mesaj nou — arată' : `${newCount} mesaje noi — arată`
        newMessagesPill.hidden = false
      } catch {
        // A downed network must not fill up the console: we retry on the
        // next tick.
      }
    }

    newMessagesPill.addEventListener('click', () => location.reload())

    setInterval(poll, 20_000)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll()
    })
  }
}

/**
 * Everything that only exists while the thread can be written in.
 *
 * Kept apart from `start()` so that a read-only thread — a supervision that has
 * ended, a request that was refused — still gets its drawers, its poll and its
 * scrolling, instead of losing all of them to one missing form.
 */
function startComposer(el: {
  form: HTMLFormElement
  input: HTMLTextAreaElement
  fisier: HTMLInputElement | null
  scroller: HTMLElement
  fir: HTMLElement | null
  scrollToBottom: (smooth?: boolean) => void
}) {
  const { form, input, fisier, scroller, fir, scrollToBottom } = el

  /* --- the attachments -------------------------------------------------------
   *
   * Several of them, not one. A chapter comes with the questionnaire and with
   * the data file, and before this that meant three messages for a single
   * thought — and three emails to the other person.
   *
   * The list is kept here, not in `input.files`: a `drop` or a `paste` has to
   * *add*, whereas assigning to `files` replaces everything. `input.files` is
   * rewritten from the list on every change, so that submitting without
   * JavaScript stays correct. */
  const attachmentTray = document.getElementById('atasamente')
  const track = document.getElementById('atasamente-pista')
  const lista = document.getElementById('atasamente-lista')
  const summary = document.getElementById('atasamente-rezumat')
  const progressBar = document.getElementById('atasamente-bara')

  const MAX_FILES = 10
  let chosen: File[] = []
  let inFlight: XMLHttpRequest | null = null

  /** Two files are “the same one” if name, size and date are identical. */
  const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

  /* The thumbnails, and the bytes behind them.
   *
   * `createObjectURL` pins the whole file in memory until it is revoked. Ten
   * files of 15 MB is 150 MB held for one message, and every second thought
   * about what to attach would add another copy — so the addresses are kept in
   * one place and everything no longer in `chosen` is released on every render.
   * That covers all four ways a file leaves: the „✕”, Escape, a message sent,
   * an upload aborted. */
  const previewUrls = new Map<string, string>()

  function previewUrlFor(f: File): string | null {
    if (!IMAGE_EXTENSIONS.has(extensionOf(f.name))) return null
    const key = fileKey(f)
    const known = previewUrls.get(key)
    if (known) return known
    const url = URL.createObjectURL(f)
    previewUrls.set(key, url)
    return url
  }

  function releasePreviews() {
    const live = new Set(chosen.map(fileKey))
    for (const [key, url] of previewUrls) {
      if (live.has(key)) continue
      URL.revokeObjectURL(url)
      previewUrls.delete(key)
    }
  }

  function syncFileInput() {
    if (!fisier) return
    const dt = new DataTransfer()
    for (const f of chosen) dt.items.add(f)
    fisier.files = dt.files
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  /**
   * How much of the strip is out of sight, said in a word and shown at the
   * edge.
   *
   * A row that scrolls with no sign that it scrolls hides files by design: on a
   * phone, three of ten chips are visible and the other seven simply are not
   * there. The fade is the peripheral half of the signal and the sentence is
   * the half that survives a colour-blind reading of the screen.
   */
  function refreshStrip() {
    if (!lista || !track) return
    const hidden = lista.scrollWidth - lista.clientWidth
    track.toggleAttribute('data-overflow-start', lista.scrollLeft > 1)
    track.toggleAttribute('data-overflow-end', hidden - lista.scrollLeft > 1)

    if (!summary) return
    if (chosen.length === 0) {
      summary.textContent = ''
      return
    }
    const bytes = chosen.reduce((n, f) => n + f.size, 0)
    const parts = [numar(chosen.length, 'fișier', 'fișiere'), formatSize(bytes)]
    if (hidden > 1) parts.push('derulează lateral pentru restul')
    summary.textContent = parts.join(' · ')
  }

  lista?.addEventListener('scroll', refreshStrip, { passive: true })
  window.addEventListener('resize', refreshStrip)

  /** Builds one chip per chosen file. `reveal` scrolls to the newest of them. */
  function renderAttachments(reveal = false) {
    releasePreviews()
    if (!lista || !attachmentTray) return
    lista.textContent = ''

    for (const [i, f] of chosen.entries()) {
      const li = document.createElement('li')
      li.className = 'atasament'

      /* The preview sits in a box of its own, and the box has the size. A
       * photo used to be a document glyph like any other; a glyph with a
       * viewBox and no dimensions falls back to 300×150px, which is what a
       * .docx and a .png both looked like in here. */
      const visual = document.createElement('span')
      visual.className = 'atasament__vizual'

      const previewUrl = previewUrlFor(f)
      if (previewUrl) {
        const img = document.createElement('img')
        img.src = previewUrl
        img.alt = ''
        img.decoding = 'async'
        visual.appendChild(img)
      } else {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        icon.setAttribute('viewBox', '0 0 24 24')
        // Written on the element as well as in the stylesheet: a glyph without
        // dimensions is 300×150px the moment a rule fails to reach it.
        icon.setAttribute('width', '16')
        icon.setAttribute('height', '16')
        icon.setAttribute('fill', 'none')
        icon.setAttribute('stroke', 'currentColor')
        icon.setAttribute('stroke-width', '1.6')
        icon.setAttribute('aria-hidden', 'true')
        const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        iconPath.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6')
        icon.appendChild(iconPath)
        visual.appendChild(icon)
      }

      const body = document.createElement('span')
      body.className = 'atasament__corp'
      const nume = document.createElement('strong')
      nume.textContent = f.name
      nume.title = f.name
      const sizeEl = document.createElement('small')
      sizeEl.className = 'muted'
      // The kind of file, next to its size: the name is cut off after a dozen
      // characters in a chip this wide, and „raport-final-v3-corectat…” says
      // nothing about what will be sent.
      const ext = extensionOf(f.name).toUpperCase()
      sizeEl.textContent = ext ? `${ext} · ${formatSize(f.size)}` : formatSize(f.size)
      body.append(nume, sizeEl)

      const removeButton = document.createElement('button')
      removeButton.className = 'atasament__scoate'
      removeButton.type = 'button'
      removeButton.setAttribute('aria-label', `Elimină ${f.name}`)
      removeButton.textContent = '✕'
      removeButton.addEventListener('click', () => {
        // While it is uploading, the same button stops the upload instead
        // of removing a file.
        if (inFlight) {
          inFlight.abort()
          return
        }
        chosen.splice(i, 1)
        syncFileInput()
        renderAttachments()
        input.focus()
      })

      li.append(visual, body, removeButton)
      lista.appendChild(li)
    }

    attachmentTray.hidden = chosen.length === 0
    if (progressBar) progressBar.style.width = '0%'

    /* The newest file is the one you want to see you attached. `block:
     * 'nearest'` keeps the thread where it is — otherwise attaching would
     * scroll the conversation as well. */
    if (reveal) {
      lista.lastElementChild?.scrollIntoView({
        inline: 'end',
        block: 'nearest',
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      })
    }
    refreshStrip()
  }

  /**
   * Adds files to the ones already chosen, refusing what has no business there.
   *
   * The refusal comes before the upload, not after 15 MB have gone up for
   * nothing, and duplicates are stopped here: the same file dragged twice would
   * end up twice in the conversation, with two rows in the files drawer.
   */
  function addFiles(incoming: File[]) {
    const rejectedNames: string[] = []
    let hitLimit = false

    for (const f of incoming) {
      if (chosen.length >= MAX_FILES) {
        hitLimit = true
        break
      }
      if (f.size > MAX) {
        window.notify?.(`„${f.name}” depășește 15 MB și nu poate fi atașat.`, 'error')
        continue
      }
      if (!isAllowedExtension(f.name)) {
        rejectedNames.push(f.name)
        continue
      }
      if (chosen.some((g) => fileKey(g) === fileKey(f))) continue
      chosen.push(f)
    }

    if (rejectedNames.length === 1) {
      window.notify?.(
        `„${rejectedNames[0]}” nu este un tip acceptat. Trimite un document, o foaie de calcul, o imagine sau o arhivă.`,
        'error',
      )
    } else if (rejectedNames.length > 1) {
      window.notify?.(
        `${rejectedNames.length} fișiere nu au un tip acceptat: ${rejectedNames.join(', ')}.`,
        'error',
      )
    }
    if (hitLimit) {
      window.notify?.(
        `Cel mult ${MAX_FILES} fișiere la un mesaj. Restul se trimit într-un al doilea mesaj.`,
        'error',
      )
    }

    syncFileInput()
    renderAttachments(true)
  }

  /** Files coming from somewhere other than the picker: dragged, pasted,
   * however. */
  function acceptFiles(...noi: File[]) {
    addFiles(noi)
    input.focus()
  }

  /* The picker replaces, it does not add: whatever is left over from an
   * earlier choice is already in the list, and `input.files` is rewritten from
   * it right afterwards. */
  fisier?.addEventListener('change', () => {
    const fromPicker = [...(fisier.files ?? [])]
    addFiles(fromPicker.filter((f) => !chosen.some((g) => fileKey(g) === fileKey(f))))
  })

  document.getElementById('alege-fisier')?.addEventListener('click', () => fisier?.click())

  /* Some browsers restore the fields on Back, files included: the list is
   * taken from what is already in the field, otherwise the tray stays hidden
   * over files the form would submit anyway. */
  if (fisier?.files?.length) addFiles([...fisier.files])

  /* --- dragged and dropped over the thread -----------------------------------
   *
   * `dragenter` and `dragleave` fire for every child the cursor passes over, so
   * the state is kept with a depth counter, not with a boolean that would
   * flicker. */
  if (fir) {
    let dragDepth = 0
    const stopDrag = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    fir.addEventListener('dragenter', (e) => {
      stopDrag(e)
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth++
      fir.dataset.drop = ''
    })
    fir.addEventListener('dragover', stopDrag)
    fir.addEventListener('dragleave', (e) => {
      stopDrag(e)
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) delete fir.dataset.drop
    })
    fir.addEventListener('drop', (e) => {
      stopDrag(e)
      dragDepth = 0
      delete fir.dataset.drop
      // All of them, not the first: whoever drags three files chose three.
      const noi = [...(e.dataTransfer?.files ?? [])]
      if (noi.length) acceptFiles(...noi)
    })
  }

  /* --- pasted from the clipboard ------------------------------------------ */
  input.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file')
    if (!items.length) return
    const noi = items
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null)
      .map((pasted, idx) => {
        const ext = (pasted.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        // The name is missing on a screen capture; two pasted at once are not
        // allowed to receive the same invented name.
        return pasted.name
          ? pasted
          : new File([pasted], `captura-${Date.now()}-${idx + 1}.${ext}`, { type: pasted.type })
      })
    if (!noi.length) return
    e.preventDefault()
    acceptFiles(...noi)
  })

  /* --- the keyboard ------------------------------------------------------- */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
      return
    }
    if (e.key !== 'Escape') return

    // Escape undoes one thing at a time: first the attachment, then the text,
    // then the focus.
    e.stopPropagation()
    // Escape removes the last attachment, not all of them: one at a time, like
    // any undoing.
    if (chosen.length) {
      chosen.pop()
      syncFileInput()
      renderAttachments()
      return
    }
    if (input.value) {
      input.value = ''
      input.style.height = 'auto'
      return
    }
    input.blur()
  })

  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  })

  /* --- the sending -----------------------------------------------------------
   *
   * XMLHttpRequest, not fetch: only it reports the progress of an upload, and a
   * chapter of 12 MB with no sign of life is exactly the moment when the person
   * presses a second time. */
  function pendingBubble(text: string, fileNames: string[]): HTMLElement {
    const el = document.createElement('article')
    el.className = 'bubble bubble--mine is-pending'

    if (text) {
      const p = document.createElement('p')
      // `bubble__body`, which the stylesheet defines. It said `bubble__text`,
      // a class that exists nowhere, so the text of every message in flight
      // was drawn at the page's default size.
      p.className = 'bubble__body'
      p.textContent = text
      el.appendChild(p)
    }
    for (const nume of fileNames) {
      const f = document.createElement('span')
      f.className = 'bubble__file'
      f.textContent = nume
      el.appendChild(f)
    }

    const meta = document.createElement('span')
    meta.className = 'bubble__time'
    meta.textContent = 'se trimite…'
    el.appendChild(meta)

    return el
  }

  form.addEventListener('submit', (e) => {
    const text = input.value.trim()

    if (!text && chosen.length === 0) {
      e.preventDefault()
      window.notify?.('Scrie un mesaj sau atașează un fișier.', 'error')
      return
    }

    e.preventDefault()
    if (inFlight) return

    const payload = new FormData(form)
    const chosenNames = chosen.map((f) => f.name)
    const totalBytes = chosen.reduce((n, f) => n + f.size, 0)
    const bubble = pendingBubble(text, chosenNames)
    scroller.appendChild(bubble)
    scrollToBottom(true)

    input.value = ''
    input.style.height = 'auto'
    input.focus()

    const xhr = new XMLHttpRequest()
    inFlight = xhr
    xhr.open('POST', form.action)
    xhr.setRequestHeader('accept', 'application/json')

    /* The progress belongs to the request, so to all the files together — that
     * is why there is a single bar, under the tray, and the size written out is
     * their sum. */
    if (chosen.length > 0 && progressBar) {
      const firstSizeEl = lista?.querySelector<HTMLElement>('.atasament__corp small')
      xhr.upload.addEventListener('progress', (ev) => {
        if (!ev.lengthComputable) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        progressBar.style.width = `${pct}%`
        if (firstSizeEl && chosen.length === 1) {
          firstSizeEl.textContent = `${pct}% din ${formatSize(totalBytes)}`
        }
      })
    }

    const finish = () => {
      inFlight = null
      chosen = []
      if (fisier) fisier.value = ''
      renderAttachments()
    }

    xhr.addEventListener('load', () => {
      finish()
      if (xhr.status >= 200 && xhr.status < 400) {
        // The thread reloads once, so that the pending bubble is replaced by
        // the real one — with the time, the read state and the attached file.
        location.href = String(payload.get('redirect') || location.pathname)
        return
      }

      /* The coordination ended while this tab was open — the composer is not
       * rendered at all for a thread that was already closed when the page
       * loaded. There is no „Reîncearcă” on this one, because the same request
       * would be refused the same way; what matters is that the typed text
       * comes back into the field instead of disappearing, which is precisely
       * what happened before: the refusal travelled as a 303 whose notice the
       * XHR followed, read as success and threw away. */
      if (xhr.status === 403) {
        bubble.remove()
        input.value = text
        input.dispatchEvent(new Event('input'))
        window.notify?.(closedThreadMessage(xhr), 'error')
        return
      }

      markFailed(bubble, payload)
    })

    xhr.addEventListener('error', () => {
      finish()
      markFailed(bubble, payload)
    })

    xhr.addEventListener('abort', () => {
      finish()
      bubble.remove()
      window.notify?.('Trimiterea a fost oprită.')
    })

    xhr.send(payload)
  })

  function markFailed(bubble: HTMLElement, payload: FormData) {
    bubble.classList.remove('is-pending')
    bubble.classList.add('is-failed')

    const meta = bubble.querySelector('.bubble__time')
    if (meta) meta.textContent = 'netrimis'

    const retryButton = document.createElement('button')
    retryButton.type = 'button'
    retryButton.className = 'bubble__reia'
    retryButton.textContent = 'Reîncearcă'
    retryButton.addEventListener('click', () => {
      const x = new XMLHttpRequest()
      x.open('POST', form.action)
      x.addEventListener('load', () => {
        if (x.status >= 200 && x.status < 400) {
          location.href = String(payload.get('redirect') || location.pathname)
        }
      })
      x.send(payload)
    })
    bubble.appendChild(retryButton)

    window.notify?.('Mesajul nu a plecat. Verifică legătura și reîncearcă.', 'error')
  }

  /* --- the first message -------------------------------------------------- */
  document.querySelectorAll<HTMLButtonElement>('[data-inceput]').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = b.dataset.inceput ?? ''
      input.dispatchEvent(new Event('input'))
      input.focus()
    })
  })

  if (!scroller.querySelector('.bubble')) input.focus()

  // The poll must not fire while a message is on its way up.
  return { isSending: () => inFlight !== null }
}

/**
 * The server's own reason for refusing, or a wording that is true whatever it
 * was.
 *
 * The API answers a closed thread with 403 and the reason in JSON exactly
 * because it is read here; anything else that comes back with that status is
 * not worth guessing at.
 */
function closedThreadMessage(xhr: XMLHttpRequest): string {
  try {
    const answer = JSON.parse(xhr.responseText) as { message?: string }
    if (answer.message) return answer.message
  } catch {
    // Not JSON — an intermediary, a proxy page. The general wording says the
    // one thing that is certainly true.
  }
  return 'Conversația s-a închis între timp. O poți citi, dar nu mai poți scrie în ea.'
}
