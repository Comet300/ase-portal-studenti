/**
 * The behaviour every form shares.
 *
 * The portal submits everything through a plain POST followed by a redirect. It
 * is a good choice — it works without JavaScript, it keeps no state on the
 * client — but it leaves four gaps that every page felt: nothing shows that the
 * request has left, a second click submits it again, long fields do not say how
 * much room is left, and a validation the server rejects throws away everything
 * that was written.
 *
 * Solved once, here, for all 35 forms.
 */

const PREFIX = 'portal:form:'

/* --- the submitting state --------------------------------------------------
 *
 * `disabled` would be simpler, but a disabled button no longer submits its
 * name/value pair — and the buttons that carry „actiune” do need it.
 * `aria-disabled` plus the guard below stop the second click without changing
 * what gets submitted. */
function markSubmitting(form: HTMLFormElement, submitter: HTMLElement | null) {
  form.dataset.seTrimite = ''
  document.documentElement.dataset.seIncarca = ''

  const button = (submitter as HTMLButtonElement | null) ?? form.querySelector('button[type="submit"]')
  if (button instanceof HTMLElement && button.classList.contains('btn')) {
    button.dataset.loading = ''
    button.setAttribute('aria-disabled', 'true')
  }
}

/* --- what was written is kept ----------------------------------------------
 *
 * The server answers a failed validation with a redirect that carries only the
 * message, not the values. We put them aside before leaving and put them back
 * if we come back to the same page with an error. Passwords and files are never
 * saved. */
function formKey(form: HTMLFormElement): string {
  const id = form.id || form.getAttribute('action') || 'form'
  return `${PREFIX}${location.pathname}:${id}`
}

function saveFields(form: HTMLFormElement) {
  try {
    const values: Record<string, string> = {}
    for (const field of Array.from(form.elements)) {
      if (!(field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement ||
            field instanceof HTMLSelectElement)) continue
      if (!field.name || field.type === 'password' || field.type === 'file' || field.type === 'hidden') continue
      if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
        if (field.checked) values[`${field.name}::${field.value}`] = 'on'
        continue
      }
      if (field.value) values[field.name] = field.value
    }
    sessionStorage.setItem(formKey(form), JSON.stringify(values))
  } catch {
    // Session storage can be full or blocked; keeping the fields is a bonus, not a condition.
  }
}

function restoreFields(form: HTMLFormElement) {
  let values: Record<string, string>
  try {
    const raw = sessionStorage.getItem(formKey(form))
    if (!raw) return
    values = JSON.parse(raw)
  } catch {
    return
  }

  for (const field of Array.from(form.elements)) {
    if (!(field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement)) continue
    if (!field.name) continue
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
      if (`${field.name}::${field.value}` in values) field.checked = true
      continue
    }
    const value = values[field.name]
    if (value !== undefined && !field.value) field.value = value
  }

  form.dispatchEvent(new Event('reluat'))
}

function clearSaved(form: HTMLFormElement) {
  try {
    sessionStorage.removeItem(formKey(form))
  } catch {
    /* see above */
  }
}

/* --- the fields that grow along with the text ----------------------------- */
function autoGrow(field: HTMLTextAreaElement) {
  field.style.height = 'auto'
  field.style.height = `${Math.min(field.scrollHeight, 320)}px`
}

/* --- the character counter -------------------------------------------------
 *
 * A minimum imposed by the server that you cannot see is a trap: you write, you
 * submit, you lose everything. The counter shows the threshold as a state, not
 * as arithmetic. */
function bindCounter(contor: HTMLElement) {
  const field = document.getElementById(contor.dataset.contorPentru ?? '')
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return

  const min = Number(contor.dataset.min ?? 0)
  const max = Number(contor.dataset.max ?? field.getAttribute('maxlength') ?? 0)

  const render = () => {
    const n = field.value.length
    contor.classList.toggle('is-sub-minim', min > 0 && n < min)
    contor.classList.toggle('is-aproape-plin', max > 0 && n > max - 100)

    if (min > 0 && n < min) {
      const missing = min - n
      contor.textContent = `încă ${missing} ${missing === 1 ? 'caracter' : 'caractere'} până la minimum`
      return
    }
    contor.textContent = max > 0 ? `${n} / ${max} caractere` : `${n} caractere`
  }

  field.addEventListener('input', render)
  field.form?.addEventListener('reluat', render)
  render()
}

export function start() {
  const isError = new URLSearchParams(location.search).get('tip') === 'error'

  document.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    // Search forms and filters have nothing to lose and must not be blocked.
    const transient = form.method.toLowerCase() === 'get'

    if (!transient) {
      if (isError) restoreFields(form)
      else clearSaved(form)
    }

    form.addEventListener('submit', (e) => {
      if (form.dataset.seTrimite !== undefined) {
        e.preventDefault()
        return
      }
      if (e.defaultPrevented) return
      if (!transient) saveFields(form)
      markSubmitting(form, (e as SubmitEvent).submitter)
    })
  })

  document.querySelectorAll<HTMLTextAreaElement>('textarea[data-autogrow]').forEach((field) => {
    field.addEventListener('input', () => autoGrow(field))
    field.form?.addEventListener('reluat', () => autoGrow(field))
    autoGrow(field)
  })

  document.querySelectorAll<HTMLElement>('[data-contor-pentru]').forEach(bindCounter)
}
