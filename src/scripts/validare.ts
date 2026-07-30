/**
 * Mesajele de validare, în română.
 *
 * Browserul le scrie în limba interfeței lui, nu în limba paginii: un student cu
 * Chrome în engleză primea „Please fill out this field” în mijlocul unui portal
 * integral românesc, iar cu `minlength` primea o propoziție care număra
 * caracterele în engleză.
 *
 * Textul se ia din `data-mesaj` când există, altfel se derivă din chiar
 * atributele câmpului — deci un câmp nou primește un mesaj potrivit fără să fie
 * nevoie să scrie cineva unul.
 */

function mesajPentru(camp: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const propriu = camp.dataset.mesaj
  if (propriu) return propriu

  const v = camp.validity

  if (v.valueMissing) {
    return camp instanceof HTMLSelectElement ? 'Alege o opțiune.' : 'Completează acest câmp.'
  }

  if (v.tooShort && 'minLength' in camp && camp.minLength > 0) {
    const lipsa = camp.minLength - camp.value.length
    return `Scrie cel puțin ${camp.minLength} de caractere — mai ai ${lipsa}.`
  }

  if (v.tooLong && 'maxLength' in camp && camp.maxLength > 0) {
    return `Textul depășește ${camp.maxLength} de caractere.`
  }

  if (v.typeMismatch) {
    if (camp.getAttribute('type') === 'email') return 'Scrie o adresă de email validă.'
    if (camp.getAttribute('type') === 'url') return 'Adresa trebuie să înceapă cu http:// sau https://.'
    return 'Valoarea nu are formatul așteptat.'
  }

  if (v.rangeUnderflow) return `Valoarea minimă este ${camp.getAttribute('min')}.`
  if (v.rangeOverflow) return `Valoarea maximă este ${camp.getAttribute('max')}.`
  if (v.stepMismatch) return 'Valoarea nu este permisă pentru acest câmp.'
  if (v.patternMismatch) return 'Formatul nu este cel așteptat.'

  return 'Valoarea nu este validă.'
}

export function porneste() {
  const campuri = document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input, textarea, select')

  campuri.forEach((camp) => {
    camp.addEventListener('invalid', () => {
      camp.setCustomValidity(mesajPentru(camp))
    })

    // Mesajul propriu trebuie golit înainte de următoarea verificare, altfel
    // câmpul rămâne invalid pentru totdeauna.
    const curata = () => camp.setCustomValidity('')
    camp.addEventListener('input', curata)
    camp.addEventListener('change', curata)
  })
}
