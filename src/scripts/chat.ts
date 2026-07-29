/**
 * Firul de discuție, pe client.
 *
 * Restul portalului trimite prin POST clasic și reîncarcă pagina, ceea ce e în
 * regulă pentru un formular completat o dată. Într-o conversație nu este: la
 * fiecare replică se pierdea poziția în fir, iar mesajul tocmai trimis ajungea
 * sub marginea de jos. Aici — și numai aici — trimiterea se face din JavaScript.
 *
 * Formularul rămâne un formular adevărat: fără JavaScript se trimite normal.
 */

const MAX = 15 * 1024 * 1024
const APROAPE_DE_JOS = 200

function marime(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function acum(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'acum'
  if (min < 60) return `acum ${min} min`
  const ore = Math.floor(min / 60)
  if (ore < 24) return `acum ${ore} ${ore === 1 ? 'oră' : 'ore'}`
  const zile = Math.floor(ore / 24)
  return `acum ${zile} ${zile === 1 ? 'zi' : 'zile'}`
}

export function porneste() {
  const form = document.querySelector<HTMLFormElement>('.chat__compose')
  const input = document.querySelector<HTMLTextAreaElement>('.chat__input')
  const fisier = document.querySelector<HTMLInputElement>('.chat__compose input[type="file"]')
  const scroller = document.getElementById('chat-messages')
  const fir = document.querySelector<HTMLElement>('.chat__thread')

  /* --- timpul relativ nu mai îngheață la randare -------------------------- */
  const improspateaza = () => {
    document.querySelectorAll<HTMLTimeElement>('time[data-relativ]').forEach((t) => {
      const iso = t.getAttribute('datetime')
      if (iso) t.textContent = acum(iso)
    })
  }
  improspateaza()
  setInterval(improspateaza, 60_000)

  if (!form || !input || !scroller) return

  /* --- poziția în fir ------------------------------------------------------
   *
   * Saltul inițial este instantaneu — o derulare animată de la începutul unei
   * conversații lungi este o animație pe care nimeni nu a cerut-o. Abia după el
   * se activează derularea lină, pentru mesajele care urmează. */
  const laJos = (lin = false) => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: lin ? 'smooth' : 'auto' })
  }

  const aproapeDeJos = () =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < APROAPE_DE_JOS

  laJos()
  requestAnimationFrame(() => {
    scroller.style.scrollBehavior = 'smooth'
  })

  const pilulaNoi = document.getElementById('mesaje-noi')
  const arataPilula = () => {
    if (pilulaNoi) pilulaNoi.hidden = aproapeDeJos()
  }
  scroller.addEventListener('scroll', arataPilula, { passive: true })
  pilulaNoi?.addEventListener('click', () => laJos(true))
  arataPilula()

  /* --- atașamentul --------------------------------------------------------- */
  const chip = document.getElementById('atasament')
  const chipNume = document.getElementById('atasament-nume')
  const chipMarime = document.getElementById('atasament-marime')
  const chipBara = document.getElementById('atasament-bara')
  const scoate = document.getElementById('scoate-atasament')

  let inZbor: XMLHttpRequest | null = null

  function arataAtasament() {
    const f = fisier?.files?.[0]
    if (!f) {
      if (chip) chip.hidden = true
      return
    }
    if (f.size > MAX) {
      window.notifica?.(`„${f.name}” depășește 15 MB și nu poate fi atașat.`, 'error')
      if (fisier) fisier.value = ''
      if (chip) chip.hidden = true
      return
    }
    if (chipNume) chipNume.textContent = f.name
    if (chipMarime) chipMarime.textContent = marime(f.size)
    if (chipBara) chipBara.style.width = '0%'
    if (chip) chip.hidden = false
  }

  /** Un fișier venit din altă parte decât selectorul: tras, lipit, oricum. */
  function preia(f: File) {
    if (!fisier) return
    const dt = new DataTransfer()
    dt.items.add(f)
    fisier.files = dt.files
    arataAtasament()
    input?.focus()
  }

  fisier?.addEventListener('change', arataAtasament)

  document.getElementById('alege-fisier')?.addEventListener('click', () => fisier?.click())

  scoate?.addEventListener('click', () => {
    // Cât urcă fișierul, același buton oprește încărcarea.
    if (inZbor) {
      inZbor.abort()
      return
    }
    if (fisier) fisier.value = ''
    if (chip) chip.hidden = true
    input?.focus()
  })

  /* --- tras și lăsat peste fir ---------------------------------------------
   *
   * `dragenter` și `dragleave` se declanșează pentru fiecare copil peste care
   * trece cursorul, deci starea se ține cu un contor de adâncime, nu cu un
   * boolean care ar clipi. */
  if (fir) {
    let adancime = 0
    const opreste = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    fir.addEventListener('dragenter', (e) => {
      opreste(e)
      if (!e.dataTransfer?.types.includes('Files')) return
      adancime++
      fir.dataset.drop = ''
    })
    fir.addEventListener('dragover', opreste)
    fir.addEventListener('dragleave', (e) => {
      opreste(e)
      adancime = Math.max(0, adancime - 1)
      if (adancime === 0) delete fir.dataset.drop
    })
    fir.addEventListener('drop', (e) => {
      opreste(e)
      adancime = 0
      delete fir.dataset.drop
      const f = e.dataTransfer?.files?.[0]
      if (f) preia(f)
    })
  }

  // Un fișier scăpat pe lângă fir ar deschide browserul peste portal.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  /* --- lipit din clipboard -------------------------------------------------- */
  input.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file')
    if (!item) return
    const brut = item.getAsFile()
    if (!brut) return
    e.preventDefault()
    const ext = (brut.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    preia(new File([brut], brut.name || `captura-${Date.now()}.${ext}`, { type: brut.type }))
  })

  /* --- tastatura ------------------------------------------------------------ */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
      return
    }
    if (e.key !== 'Escape') return

    // Escape desface pe rând: întâi atașamentul, apoi textul, apoi focusul.
    e.stopPropagation()
    if (fisier?.files?.length) {
      fisier.value = ''
      if (chip) chip.hidden = true
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

  /* --- trimiterea ----------------------------------------------------------
   *
   * XMLHttpRequest, nu fetch: numai el raportează progresul unei încărcări, iar
   * un capitol de 12 MB fără niciun semn este exact momentul în care omul apasă
   * a doua oară. */
  function bulaProvizorie(text: string, numeFisier: string | null): HTMLElement {
    const el = document.createElement('article')
    el.className = 'bubble bubble--mine is-pending'

    if (text) {
      const p = document.createElement('p')
      p.className = 'bubble__text'
      p.textContent = text
      el.appendChild(p)
    }
    if (numeFisier) {
      const f = document.createElement('span')
      f.className = 'bubble__file'
      f.textContent = numeFisier
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
    const f = fisier?.files?.[0] ?? null

    if (!text && !f) {
      e.preventDefault()
      window.notifica?.('Scrie un mesaj sau atașează un fișier.', 'error')
      return
    }

    e.preventDefault()
    if (inZbor) return

    const date = new FormData(form)
    const bula = bulaProvizorie(text, f ? f.name : null)
    scroller.appendChild(bula)
    laJos(true)

    input.value = ''
    input.style.height = 'auto'
    input.focus()

    const xhr = new XMLHttpRequest()
    inZbor = xhr
    xhr.open('POST', form.action)
    xhr.setRequestHeader('accept', 'application/json')

    if (f && chipBara) {
      xhr.upload.addEventListener('progress', (ev) => {
        if (!ev.lengthComputable) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        chipBara.style.width = `${pct}%`
        if (chipMarime) chipMarime.textContent = `${pct}% din ${marime(f.size)}`
      })
    }

    const gata = () => {
      inZbor = null
      if (fisier) fisier.value = ''
      if (chip) chip.hidden = true
      if (chipBara) chipBara.style.width = '0%'
    }

    xhr.addEventListener('load', () => {
      gata()
      if (xhr.status >= 200 && xhr.status < 400) {
        // Firul se reîncarcă o dată, ca bula provizorie să fie înlocuită de cea
        // adevărată — cu ora, cu starea de citit și cu fișierul atașat.
        location.href = String(date.get('redirect') || location.pathname)
        return
      }
      esueaza(bula, date)
    })

    xhr.addEventListener('error', () => {
      gata()
      esueaza(bula, date)
    })

    xhr.addEventListener('abort', () => {
      gata()
      bula.remove()
      window.notifica?.('Trimiterea a fost oprită.')
    })

    xhr.send(date)
  })

  function esueaza(bula: HTMLElement, date: FormData) {
    bula.classList.remove('is-pending')
    bula.classList.add('is-failed')

    const meta = bula.querySelector('.bubble__time')
    if (meta) meta.textContent = 'netrimis'

    const reia = document.createElement('button')
    reia.type = 'button'
    reia.className = 'bubble__reia'
    reia.textContent = 'Reîncearcă'
    reia.addEventListener('click', () => {
      const x = new XMLHttpRequest()
      x.open('POST', form!.action)
      x.addEventListener('load', () => {
        if (x.status >= 200 && x.status < 400) {
          location.href = String(date.get('redirect') || location.pathname)
        }
      })
      x.send(date)
    })
    bula.appendChild(reia)

    window.notifica?.('Mesajul nu a plecat. Verifică legătura și reîncearcă.', 'error')
  }

  /* --- sertarul cu fișiere -------------------------------------------------- */
  const sertar = document.getElementById('fisiere-drawer')
  const comuta = document.getElementById('comuta-fisiere')

  const setSertar = (deschis: boolean) => {
    if (!sertar) return
    sertar.hidden = !deschis
    comuta?.setAttribute('aria-expanded', String(deschis))

    if (deschis) {
      sertar.querySelector<HTMLElement>('input, button, a')?.focus()
      return
    }
    // Focusul se întoarce doar dacă era înăuntru: altfel l-am fura de unde a
    // ajuns între timp.
    if (sertar.contains(document.activeElement)) comuta?.focus()
  }

  comuta?.addEventListener('click', () => setSertar(sertar?.hidden ?? true))
  document.getElementById('inchide-fisiere')?.addEventListener('click', () => setSertar(false))

  document.addEventListener('keydown', (e) => {
    if (e.target === input) return
    if (e.key === 'Escape' && sertar && !sertar.hidden) setSertar(false)
  })

  document.addEventListener('click', (e) => {
    if (!sertar || sertar.hidden) return
    const t = e.target as Node
    if (sertar.contains(t) || comuta?.contains(t)) return
    setSertar(false)
  })

  /* --- căutarea în sertar --------------------------------------------------- */
  const cauta = document.getElementById('cauta-fisier') as HTMLInputElement | null
  cauta?.addEventListener('input', () => {
    const q = cauta.value.trim().toLowerCase()
    let vizibile = 0
    sertar?.querySelectorAll<HTMLElement>('[data-nume-fisier]').forEach((li) => {
      const seVede = !q || (li.dataset.numeFisier ?? '').includes(q)
      li.hidden = !seVede
      if (seVede) vizibile++
    })
    const gol = document.getElementById('fisiere-fara-rezultat')
    if (gol) gol.hidden = vizibile > 0
  })

  /* --- primul mesaj -------------------------------------------------------- */
  document.querySelectorAll<HTMLButtonElement>('[data-inceput]').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = b.dataset.inceput ?? ''
      input.dispatchEvent(new Event('input'))
      input.focus()
    })
  })

  if (!scroller.querySelector('.bubble')) input.focus()
}
