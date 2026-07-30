import { ECRANE } from '../lib/navigare'

/**
 * Un singur câmp pentru tot portalul.
 *
 * Portalul are unsprezece ecrane, iar drumul către oricare dintre ele trece prin
 * bara laterală: pentru un coordonator care sare între coada de cereri, un fir de
 * discuție și programul de consultații de douăzeci de ori pe zi, sunt douăzeci de
 * traversări ale ecranului cu mouse-ul. Ctrl+K deschide o listă în care se scrie
 * unde vrei să ajungi.
 *
 * Nu este o căutare în date — nu caută studenți, nici teme, pentru că ar cere o
 * rută nouă și un index, iar catalogul are deja căutarea lui. Este navigație,
 * plus acțiunile pe care le are pagina curentă: exact ce este acum ascuns în
 * mobilier.
 */

interface Intrare {
  text: string
  /** Ce se vede sub text: unde duce sau ce fel de lucru este. */
  nota?: string
  href: string
  /** Cuvinte după care se mai poate găsi, în afară de text. */
  sinonime?: string
}

/** Diacriticele nu se scriu când te grăbești: „consultatii” trebuie să găsească „Consultații”. */
function plat(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
}

/**
 * Potrivire pe subsecvență, nu pe substring.
 *
 * „cst” găsește „Consultații”, cum se așteaptă oricine a folosit un câmp de
 * comenzi. Se întoarce un punctaj: literele lipite una de alta și potrivirea de
 * la începutul unui cuvânt cântăresc mai mult, ca „mes” să nu scoată „Teme
 * propuse” înaintea „Mesaje”.
 */
function punctaj(text: string, nevoie: string): number | null {
  if (!nevoie) return 0
  const t = plat(text)
  const n = plat(nevoie).replace(/\s+/g, '')
  let i = 0
  let scor = 0
  let ultima = -2
  for (const litera of n) {
    const gasit = t.indexOf(litera, i)
    if (gasit === -1) return null
    if (gasit === ultima + 1) scor += 3
    if (gasit === 0 || t[gasit - 1] === ' ') scor += 2
    ultima = gasit
    i = gasit + 1
  }
  // Un text scurt care conține tot ce ai scris este aproape sigur cel căutat.
  return scor - Math.floor(t.length / 12)
}

function construiesteIntrari(): Intrare[] {
  const nav = [...document.querySelectorAll<HTMLAnchorElement>('.nav__link, .nav-link')]
  const cunoscute = new Set<string>()
  const intrari: Intrare[] = []

  /* Destinațiile se iau din bara paginii, nu din tabelul de ecrane: bara știe deja
   * ce vede rolul curent, iar un student nu are ce căuta cu „Departament” în
   * listă doar pentru că ruta există. */
  for (const a of nav) {
    const cale = a.getAttribute('href') ?? ''
    if (!cale.startsWith('/') || cunoscute.has(cale)) continue
    cunoscute.add(cale)
    /* Fără notă: numele ecranului este de ajuns, iar „/coordonatori” scris sub
     * „Coordonatori & Teme” nu adaugă nimic pentru cine caută unde să meargă. */
    intrari.push({
      text: (ECRANE[cale.split('?')[0]] ?? a.textContent ?? '').trim(),
      href: cale,
    })
  }

  /* Acțiunile paginii curente: butoanele din antet și taburile secțiunilor sunt
   * exact lucrurile pentru care se traversează ecranul cu mouse-ul. */
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    '.content__header a[href], .topbar a[href].btn, .taburi a[href], .vederi a[href]',
  )) {
    const cale = a.getAttribute('href') ?? ''
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!cale.startsWith('/') || !text || cunoscute.has(cale + text)) continue
    cunoscute.add(cale + text)
    intrari.push({ text, nota: 'pe această pagină', href: cale })
  }

  return intrari.filter((i) => i.text)
}

export function porneste() {
  // Fără destinații nu are rost: pe ecranul de autentificare nu există navigație.
  const intrari = construiesteIntrari()
  if (intrari.length === 0) return

  const dialog = document.createElement('dialog')
  dialog.className = 'paleta'
  dialog.setAttribute('aria-label', 'Mergi la')

  const camp = document.createElement('input')
  camp.className = 'paleta__camp'
  camp.type = 'text'
  camp.placeholder = 'Scrie unde vrei să ajungi…'
  camp.setAttribute('aria-label', 'Caută în portal')
  camp.autocomplete = 'off'
  camp.setAttribute('role', 'combobox')
  camp.setAttribute('aria-expanded', 'true')
  camp.setAttribute('aria-controls', 'paleta-lista')

  const lista = document.createElement('ul')
  lista.className = 'paleta__lista'
  lista.id = 'paleta-lista'
  lista.setAttribute('role', 'listbox')

  const gol = document.createElement('p')
  gol.className = 'paleta__gol'
  gol.textContent = 'Nimic nu se potrivește.'
  gol.hidden = true

  const jos = document.createElement('p')
  jos.className = 'paleta__jos'
  jos.textContent = '↑↓ alegi · Enter deschizi · Esc închizi'

  dialog.append(camp, lista, gol, jos)
  document.body.appendChild(dialog)

  let vizibile: Intrare[] = []
  let ales = 0

  const deseneaza = () => {
    const nevoie = camp.value.trim()
    vizibile = intrari
      .map((i) => ({ i, s: Math.max(punctaj(i.text, nevoie) ?? -Infinity, punctaj(i.sinonime ?? '', nevoie) ?? -Infinity) }))
      .filter((x) => Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.i)

    ales = 0
    lista.textContent = ''
    gol.hidden = vizibile.length > 0

    vizibile.forEach((intrare, index) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.id = `paleta-op-${index}`
      li.setAttribute('aria-selected', String(index === ales))
      li.className = index === ales ? 'paleta__op is-ales' : 'paleta__op'

      const a = document.createElement('a')
      a.href = intrare.href
      a.tabIndex = -1
      const tare = document.createElement('strong')
      tare.textContent = intrare.text
      a.appendChild(tare)
      if (intrare.nota) {
        const mic = document.createElement('small')
        mic.textContent = intrare.nota
        a.appendChild(mic)
      }
      li.appendChild(a)
      // Mouse-ul mută selecția în loc să o dubleze: altfel Enter ar deschide
      // altceva decât ce e evidențiat sub cursor.
      li.addEventListener('mousemove', () => {
        if (ales === index) return
        ales = index
        marcheaza()
      })
      lista.appendChild(li)
    })

    marcheaza()
  }

  const marcheaza = () => {
    ;[...lista.children].forEach((li, index) => {
      li.className = index === ales ? 'paleta__op is-ales' : 'paleta__op'
      li.setAttribute('aria-selected', String(index === ales))
    })
    camp.setAttribute('aria-activedescendant', vizibile.length ? `paleta-op-${ales}` : '')
    lista.children[ales]?.scrollIntoView({ block: 'nearest' })
  }

  const deschide = () => {
    if (dialog.open) return
    camp.value = ''
    deseneaza()
    dialog.showModal()
    camp.focus()
  }

  camp.addEventListener('input', deseneaza)

  camp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      ales = Math.min(ales + 1, vizibile.length - 1)
      marcheaza()
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      ales = Math.max(ales - 1, 0)
      marcheaza()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = vizibile[ales]
      if (target) location.href = target.href
    }
  })

  /* Ctrl+K, și Cmd+K pe Mac. Nu se deschide peste un câmp în care se scrie: un
   * coordonator care tastează un mesaj și apasă Ctrl+K vrea altceva decât să îi
   * dispară textul sub un dialog. */
  document.addEventListener('keydown', (e) => {
    const esteK = e.key === 'k' || e.key === 'K'
    if (!esteK || !(e.ctrlKey || e.metaKey)) return
    const activ = document.activeElement
    const scrie =
      activ instanceof HTMLTextAreaElement ||
      (activ instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(activ.type))
    if (scrie && activ !== camp) return
    e.preventDefault()
    deschide()
  })

  // O deschidere și pentru cine nu are tastatură la îndemână.
  document.querySelectorAll('[data-paleta]').forEach((b) => b.addEventListener('click', deschide))
}
