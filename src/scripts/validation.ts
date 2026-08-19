/**
 * The validation messages, in Romanian.
 *
 * The browser writes them in the language of its own interface, not in the
 * language of the page: a student with Chrome in English got „Please fill out
 * this field” in the middle of an entirely Romanian portal, and with
 * `minlength` got a sentence that counted the characters in English.
 *
 * The text is taken from `data-mesaj` when there is one, otherwise it is
 * derived from the field's own attributes — so a new field gets a fitting
 * message without anyone having to write one.
 */

function messageFor(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const own = field.dataset.mesaj
  if (own) return own

  const v = field.validity

  if (v.valueMissing) {
    return field instanceof HTMLSelectElement ? 'Alege o opțiune.' : 'Completează acest câmp.'
  }

  if (v.tooShort && 'minLength' in field && field.minLength > 0) {
    const missing = field.minLength - field.value.length
    return `Scrie cel puțin ${field.minLength} de caractere — mai ai ${missing}.`
  }

  if (v.tooLong && 'maxLength' in field && field.maxLength > 0) {
    return `Textul depășește ${field.maxLength} de caractere.`
  }

  if (v.typeMismatch) {
    if (field.getAttribute('type') === 'email') return 'Scrie o adresă de email validă.'
    if (field.getAttribute('type') === 'url') return 'Adresa trebuie să înceapă cu http:// sau https://.'
    return 'Valoarea nu are formatul așteptat.'
  }

  if (v.rangeUnderflow) return `Valoarea minimă este ${field.getAttribute('min')}.`
  if (v.rangeOverflow) return `Valoarea maximă este ${field.getAttribute('max')}.`
  if (v.stepMismatch) return 'Valoarea nu este permisă pentru acest câmp.'
  if (v.patternMismatch) return 'Formatul nu este cel așteptat.'

  return 'Valoarea nu este validă.'
}

export function start() {
  const fields = document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input, textarea, select')

  fields.forEach((field) => {
    field.addEventListener('invalid', () => {
      field.setCustomValidity(messageFor(field))
    })

    // The custom message has to be emptied before the next check, otherwise the
    // field stays invalid forever.
    const clearCustomValidity = () => field.setCustomValidity('')
    field.addEventListener('input', clearCustomValidity)
    field.addEventListener('change', clearCustomValidity)
  })
}
