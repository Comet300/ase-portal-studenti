/**
 * The portal's notifications.
 *
 * A single channel, as before, but with three corrections: an error no longer
 * disappears on its own after four seconds, it can be closed by hand, and it
 * leaves on an assertive channel — a rejection reason is not allowed to be
 * announced with the same discretion as „Termen adăugat”.
 */

type Tone = 'info' | 'error'

/**
 * An action attached to the notification: „Anulează”, for the deletions that
 * can be taken back. It lives exactly as long as the notification, and that is
 * also the window in which undoing makes sense — once the message is gone, the
 * gesture is over.
 */
export interface ToastAction {
  text: string
  /** What is submitted, as a form, on press. */
  to: string
  fields: Record<string, string>
}

const INFO_DURATION_MS = 5200

/** With an action to undo, the notification stays longer: it has something to read and to decide. */
const ACTION_DURATION_MS = 12_000

function hostFor(tone: Tone): HTMLElement | null {
  return document.getElementById(tone === 'error' ? 'toast-host-erori' : 'toast-host')
}

function dismiss(el: HTMLElement) {
  if (el.dataset.pleaca !== undefined) return
  el.dataset.pleaca = ''
  // The space closes up together with the exit, so that the stack underneath
  // slides upwards instead of jumping by the whole height at once.
  el.style.marginBlockStart = `-${el.offsetHeight}px`
  el.addEventListener('transitionend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), 600)
}

export function notify(message: string, tone: Tone = 'info', action?: ToastAction) {
  const host = hostFor(tone)
  if (!host) return

  const el = document.createElement('div')
  el.className = tone === 'error' ? 'toast toast--error' : 'toast'

  const icon = document.createElement('span')
  icon.className = 'toast__semn'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = tone === 'error' ? '!' : '✓'

  const body = document.createElement('div')
  body.className = 'toast__corp'

  const label = document.createElement('strong')
  label.className = 'toast__eticheta'
  label.textContent = tone === 'error' ? 'Eroare' : 'Gata'

  const text = document.createElement('span')
  text.textContent = message

  body.append(label, text)

  /* Undoing is a form, not a fetch: it goes through the same POST route, with
   * the same ownership checks, and ends with the usual redirect — so the page
   * shows again what exists, without rebuilding anything on the client. */
  if (action) {
    const f = document.createElement('form')
    f.method = 'POST'
    f.action = action.to
    f.className = 'toast__actiune'
    for (const [nume, valoare] of Object.entries(action.fields)) {
      const field = document.createElement('input')
      field.type = 'hidden'
      field.name = nume
      field.value = valoare
      f.appendChild(field)
    }
    const b = document.createElement('button')
    b.type = 'submit'
    b.className = 'btn btn--ghost btn--sm'
    b.textContent = action.text
    f.appendChild(b)
    body.appendChild(f)
  }

  const closeButton = document.createElement('button')
  closeButton.className = 'toast__inchide'
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Închide notificarea')
  closeButton.textContent = '✕'
  closeButton.addEventListener('click', () => dismiss(el))

  el.append(icon, body, closeButton)
  host.appendChild(el)

  // Confirmations leave on their own; errors stay until they are read and closed.
  if (tone !== 'error') {
    const timer = setTimeout(() => dismiss(el), action ? ACTION_DURATION_MS : INFO_DURATION_MS)
    el.addEventListener('pointerenter', () => clearTimeout(timer))
  }
}

export function start() {
  window.notify = notify

  const params = new URLSearchParams(location.search)
  const message = params.get('notificare')
  if (!message) return

  /* The undo comes from the address, put there by the route that deleted:
   * `anulare` is the path and `anulare_date` the fields, as JSON. Nothing in
   * them is trusted — the POST route checks ownership anyway, as on any
   * request. */
  const to = params.get('anulare')
  let action: ToastAction | undefined
  if (to && to.startsWith('/api/')) {
    try {
      const fields = JSON.parse(params.get('anulare_date') ?? '{}')
      if (fields && typeof fields === 'object') {
        action = { text: 'Anulează', to, fields: fields as Record<string, string> }
      }
    } catch {
      // A tampered address is not allowed to leave the page without a notification.
    }
  }

  notify(message, params.get('tip') === 'error' ? 'error' : 'info', action)

  params.delete('notificare')
  params.delete('tip')
  params.delete('anulare')
  params.delete('anulare_date')
  const rest = params.toString()
  /* The fragment stays.
   *
   * The cleanup rewrote the address without it, and it is exactly the row the
   * save returned to: the message appeared, while the page stayed at the top of
   * the list, with the target ring gone out before it could be seen. */
  history.replaceState(
    {},
    '',
    location.pathname + (rest ? `?${rest}` : '') + location.hash,
  )
}
