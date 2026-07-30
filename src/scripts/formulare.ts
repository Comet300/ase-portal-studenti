/**
 * Comportamentul comun al formularelor.
 *
 * Portalul trimite totul prin POST clasic urmat de redirect. E o alegere bună —
 * merge fără JavaScript, nu ține stare pe client — dar lasă patru goluri pe care
 * fiecare pagină le simțea: nimic nu arată că cererea a plecat, un al doilea
 * clic trimite din nou, câmpurile lungi nu spun cât mai au, iar o validare
 * respinsă de server aruncă tot ce s-a scris.
 *
 * Se rezolvă o singură dată, aici, pentru toate cele 35 de formulare.
 */

const PREFIX = 'portal:form:'

/* --- starea de trimitere ---------------------------------------------------
 *
 * `disabled` ar fi mai simplu, dar un buton dezactivat nu își mai trimite
 * perechea nume/valoare — iar butoanele care poartă „actiune” chiar au nevoie
 * de ea. `aria-disabled` plus paza de mai jos opresc al doilea clic fără să
 * schimbe ce se trimite. */
function marcheazaTrimiterea(form: HTMLFormElement, submitter: HTMLElement | null) {
  form.dataset.seTrimite = ''
  document.documentElement.dataset.seIncarca = ''

  const buton = (submitter as HTMLButtonElement | null) ?? form.querySelector('button[type="submit"]')
  if (buton instanceof HTMLElement && buton.classList.contains('btn')) {
    buton.dataset.loading = ''
    buton.setAttribute('aria-disabled', 'true')
  }
}

/* --- ce s-a scris se păstrează ---------------------------------------------
 *
 * Serverul răspunde la o validare picată cu un redirect care poartă doar
 * mesajul, nu și valorile. Le punem deoparte înainte de plecare și le punem
 * înapoi dacă ne întoarcem pe aceeași pagină cu o eroare. Parolele și fișierele
 * nu se salvează niciodată. */
function cheiaFormularului(form: HTMLFormElement): string {
  const id = form.id || form.getAttribute('action') || 'form'
  return `${PREFIX}${location.pathname}:${id}`
}

function pastreaza(form: HTMLFormElement) {
  try {
    const date: Record<string, string> = {}
    for (const camp of Array.from(form.elements)) {
      if (!(camp instanceof HTMLInputElement ||
            camp instanceof HTMLTextAreaElement ||
            camp instanceof HTMLSelectElement)) continue
      if (!camp.name || camp.type === 'password' || camp.type === 'file' || camp.type === 'hidden') continue
      if (camp instanceof HTMLInputElement && (camp.type === 'checkbox' || camp.type === 'radio')) {
        if (camp.checked) date[`${camp.name}::${camp.value}`] = 'on'
        continue
      }
      if (camp.value) date[camp.name] = camp.value
    }
    sessionStorage.setItem(cheiaFormularului(form), JSON.stringify(date))
  } catch {
    // Memoria de sesiune poate fi plină sau blocată; păstrarea e un plus, nu o condiție.
  }
}

function reia(form: HTMLFormElement) {
  let date: Record<string, string>
  try {
    const brut = sessionStorage.getItem(cheiaFormularului(form))
    if (!brut) return
    date = JSON.parse(brut)
  } catch {
    return
  }

  for (const camp of Array.from(form.elements)) {
    if (!(camp instanceof HTMLInputElement ||
          camp instanceof HTMLTextAreaElement ||
          camp instanceof HTMLSelectElement)) continue
    if (!camp.name) continue
    if (camp instanceof HTMLInputElement && (camp.type === 'checkbox' || camp.type === 'radio')) {
      if (`${camp.name}::${camp.value}` in date) camp.checked = true
      continue
    }
    const valoare = date[camp.name]
    if (valoare !== undefined && !camp.value) camp.value = valoare
  }

  form.dispatchEvent(new Event('reluat'))
}

function uita(form: HTMLFormElement) {
  try {
    sessionStorage.removeItem(cheiaFormularului(form))
  } catch {
    /* vezi mai sus */
  }
}

/* --- câmpurile care cresc odată cu textul --------------------------------- */
function creste(camp: HTMLTextAreaElement) {
  camp.style.height = 'auto'
  camp.style.height = `${Math.min(camp.scrollHeight, 320)}px`
}

/* --- contorul de caractere -------------------------------------------------
 *
 * Un minim impus de server pe care nu îl vezi este o capcană: scrii, trimiți,
 * pierzi tot. Contorul arată pragul ca stare, nu ca aritmetică. */
function legContor(contor: HTMLElement) {
  const camp = document.getElementById(contor.dataset.contorPentru ?? '')
  if (!(camp instanceof HTMLTextAreaElement || camp instanceof HTMLInputElement)) return

  const min = Number(contor.dataset.min ?? 0)
  const max = Number(contor.dataset.max ?? camp.getAttribute('maxlength') ?? 0)

  const arata = () => {
    const n = camp.value.length
    contor.classList.toggle('is-sub-minim', min > 0 && n < min)
    contor.classList.toggle('is-aproape-plin', max > 0 && n > max - 100)

    if (min > 0 && n < min) {
      const lipsa = min - n
      contor.textContent = `încă ${lipsa} ${lipsa === 1 ? 'caracter' : 'caractere'} până la minimum`
      return
    }
    contor.textContent = max > 0 ? `${n} / ${max} caractere` : `${n} caractere`
  }

  camp.addEventListener('input', arata)
  camp.form?.addEventListener('reluat', arata)
  arata()
}

export function porneste() {
  const eEroare = new URLSearchParams(location.search).get('tip') === 'error'

  document.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    // Formularele de căutare și filtrele nu au ce pierde și nu trebuie blocate.
    const efemer = form.method.toLowerCase() === 'get'

    if (!efemer) {
      if (eEroare) reia(form)
      else uita(form)
    }

    form.addEventListener('submit', (e) => {
      if (form.dataset.seTrimite !== undefined) {
        e.preventDefault()
        return
      }
      if (e.defaultPrevented) return
      if (!efemer) pastreaza(form)
      marcheazaTrimiterea(form, (e as SubmitEvent).submitter)
    })
  })

  document.querySelectorAll<HTMLTextAreaElement>('textarea[data-autogrow]').forEach((camp) => {
    camp.addEventListener('input', () => creste(camp))
    camp.form?.addEventListener('reluat', () => creste(camp))
    creste(camp)
  })

  document.querySelectorAll<HTMLElement>('[data-contor-pentru]').forEach(legContor)
}
