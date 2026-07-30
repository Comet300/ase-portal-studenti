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

/* Aceeași listă ca pe server (lib/files.ts). E scrisă de două ori pentru că
 * scriptul de pe client nu poate importa din modulele de server, dar verificarea
 * care contează rămâne cea din API. */
const EXTENSII = new Set([
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'xls', 'xlsx', 'csv', 'ods',
  'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'zip',
])

function extensiaAcceptata(nume: string): boolean {
  const parte = nume.split('.').pop()
  return !!parte && parte !== nume && EXTENSII.has(parte.toLowerCase())
}

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

  /* --- atașamentele --------------------------------------------------------
   *
   * Mai multe, nu unul. Un capitol vine cu chestionarul și cu fișierul de date,
   * iar înainte însemna trei mesaje pentru un singur gând — și trei emailuri
   * către celălalt.
   *
   * Lista se ține aici, nu în `input.files`: un `drop` sau un `paste` trebuie să
   * *adauge*, iar atribuirea către `files` înlocuiește tot. `input.files` se
   * rescrie din listă la fiecare schimbare, ca trimiterea fără JavaScript să
   * rămână corectă. */
  const strat = document.getElementById('atasamente')
  const lista = document.getElementById('atasamente-lista')
  const chipBara = document.getElementById('atasamente-bara')

  const MAX_FISIERE = 10
  let alese: File[] = []
  let inZbor: XMLHttpRequest | null = null

  /** Două fișiere sunt „același” dacă au nume, mărime și dată identice. */
  const cheia = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

  function scrieInCamp() {
    if (!fisier) return
    const dt = new DataTransfer()
    for (const f of alese) dt.items.add(f)
    fisier.files = dt.files
  }

  function deseneaza() {
    if (!lista || !strat) return
    lista.textContent = ''

    for (const [i, f] of alese.entries()) {
      const li = document.createElement('li')
      li.className = 'atasament'

      const icoana = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icoana.setAttribute('viewBox', '0 0 24 24')
      icoana.setAttribute('fill', 'none')
      icoana.setAttribute('stroke', 'currentColor')
      icoana.setAttribute('stroke-width', '1.6')
      icoana.setAttribute('aria-hidden', 'true')
      const cale = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      cale.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6')
      icoana.appendChild(cale)

      const corp = document.createElement('span')
      corp.className = 'atasament__corp'
      const nume = document.createElement('strong')
      nume.textContent = f.name
      nume.title = f.name
      const dim = document.createElement('small')
      dim.className = 'muted'
      dim.textContent = marime(f.size)
      corp.append(nume, dim)

      const scoate = document.createElement('button')
      scoate.className = 'atasament__scoate'
      scoate.type = 'button'
      scoate.setAttribute('aria-label', `Elimină ${f.name}`)
      scoate.textContent = '✕'
      scoate.addEventListener('click', () => {
        // Cât urcă, același buton oprește încărcarea în loc să scoată un fișier.
        if (inZbor) {
          inZbor.abort()
          return
        }
        alese.splice(i, 1)
        scrieInCamp()
        deseneaza()
        input?.focus()
      })

      li.append(icoana, corp, scoate)
      lista.appendChild(li)
    }

    strat.hidden = alese.length === 0
    if (chipBara) chipBara.style.width = '0%'
  }

  /**
   * Adaugă fișiere la cele deja alese, refuzând ce nu are ce căuta acolo.
   *
   * Refuzul vine înainte de încărcare, nu după ce urcă 15 MB degeaba, iar
   * duplicatele se opresc aici: același fișier tras de două ori ar ajunge de două
   * ori în conversație, cu două rânduri în sertar.
   */
  function adauga(fisiereNoi: File[]) {
    const respinse: string[] = []
    let plin = false

    for (const f of fisiereNoi) {
      if (alese.length >= MAX_FISIERE) {
        plin = true
        break
      }
      if (f.size > MAX) {
        window.notifica?.(`„${f.name}” depășește 15 MB și nu poate fi atașat.`, 'error')
        continue
      }
      if (!extensiaAcceptata(f.name)) {
        respinse.push(f.name)
        continue
      }
      if (alese.some((g) => cheia(g) === cheia(f))) continue
      alese.push(f)
    }

    if (respinse.length === 1) {
      window.notifica?.(
        `„${respinse[0]}” nu este un tip acceptat. Trimite un document, o foaie de calcul, o imagine sau o arhivă.`,
        'error',
      )
    } else if (respinse.length > 1) {
      window.notifica?.(
        `${respinse.length} fișiere nu au un tip acceptat: ${respinse.join(', ')}.`,
        'error',
      )
    }
    if (plin) {
      window.notifica?.(
        `Cel mult ${MAX_FISIERE} fișiere la un mesaj. Restul se trimit într-un al doilea mesaj.`,
        'error',
      )
    }

    scrieInCamp()
    deseneaza()
  }

  /** Fișiere venite din altă parte decât selectorul: trase, lipite, oricum. */
  function preia(...noi: File[]) {
    adauga(noi)
    input?.focus()
  }

  /* Selectorul înlocuiește, nu adaugă: ce a rămas de la o alegere anterioară e
   * deja în listă, iar `input.files` este rescris din ea imediat după. */
  fisier?.addEventListener('change', () => {
    const dinSelector = [...(fisier.files ?? [])]
    adauga(dinSelector.filter((f) => !alese.some((g) => cheia(g) === cheia(f))))
  })

  document.getElementById('alege-fisier')?.addEventListener('click', () => fisier?.click())

  /* Unele browsere restaurează câmpurile la Înapoi, inclusiv fișierele: lista se
   * ia de la ce este deja în câmp, altfel stratul rămâne ascuns peste fișiere pe
   * care formularul le-ar trimite oricum. */
  if (fisier?.files?.length) adauga([...fisier.files])

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
      // Toate, nu primul: cine trage trei fișiere le-a ales pe trei.
      const noi = [...(e.dataTransfer?.files ?? [])]
      if (noi.length) preia(...noi)
    })
  }

  // Un fișier scăpat pe lângă fir ar deschide browserul peste portal.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  /* --- lipit din clipboard -------------------------------------------------- */
  input.addEventListener('paste', (e) => {
    const itemi = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file')
    if (!itemi.length) return
    const noi = itemi
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null)
      .map((brut, idx) => {
        const ext = (brut.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        // Numele lipsește la o captură de ecran; două lipite deodată nu au voie
        // să primească același nume inventat.
        return brut.name
          ? brut
          : new File([brut], `captura-${Date.now()}-${idx + 1}.${ext}`, { type: brut.type })
      })
    if (!noi.length) return
    e.preventDefault()
    preia(...noi)
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
    // Escape scoate ultimul atașament, nu toate: pe rând, ca orice desfacere.
    if (alese.length) {
      alese.pop()
      scrieInCamp()
      deseneaza()
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
  function bulaProvizorie(text: string, numeFisiere: string[]): HTMLElement {
    const el = document.createElement('article')
    el.className = 'bubble bubble--mine is-pending'

    if (text) {
      const p = document.createElement('p')
      p.className = 'bubble__text'
      p.textContent = text
      el.appendChild(p)
    }
    for (const nume of numeFisiere) {
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

    if (!text && alese.length === 0) {
      e.preventDefault()
      window.notifica?.('Scrie un mesaj sau atașează un fișier.', 'error')
      return
    }

    e.preventDefault()
    if (inZbor) return

    const date = new FormData(form)
    const numeAlese = alese.map((f) => f.name)
    const octetiTotal = alese.reduce((n, f) => n + f.size, 0)
    const bula = bulaProvizorie(text, numeAlese)
    scroller.appendChild(bula)
    laJos(true)

    input.value = ''
    input.style.height = 'auto'
    input.focus()

    const xhr = new XMLHttpRequest()
    inZbor = xhr
    xhr.open('POST', form.action)
    xhr.setRequestHeader('accept', 'application/json')

    /* Progresul este al cererii, deci al tuturor fișierelor împreună — de aceea
     * bara este una, sub strat, iar mărimea scrisă este suma lor. */
    if (alese.length > 0 && chipBara) {
      const primaDimensiune = lista?.querySelector<HTMLElement>('.atasament__corp small')
      xhr.upload.addEventListener('progress', (ev) => {
        if (!ev.lengthComputable) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        chipBara.style.width = `${pct}%`
        if (primaDimensiune && alese.length === 1) {
          primaDimensiune.textContent = `${pct}% din ${marime(octetiTotal)}`
        }
      })
    }

    const gata = () => {
      inZbor = null
      alese = []
      if (fisier) fisier.value = ''
      deseneaza()
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

  /* --- sertarul cu contextul lucrării -------------------------------------- */

  /* Sub 1200px coloana din dreapta nu încape, iar până acum pur și simplu
   * dispărea: titlul lucrării, termenele și coordonatorul nu existau pe tabletă
   * și pe telefon. Aceeași mecanică ca la fișiere — deschis, se aude ca sertar;
   * la lățime mare butonul nu se vede, deci `hidden` nu se pune niciodată și
   * coloana rămâne coloană. */
  const context = document.getElementById('chat-context')
  const comutaContext = document.getElementById('comuta-context')

  const setContext = (deschis: boolean) => {
    if (!context) return
    context.hidden = !deschis
    comutaContext?.setAttribute('aria-expanded', String(deschis))
    if (deschis) {
      context.querySelector<HTMLElement>('a, button')?.focus()
      return
    }
    if (context.contains(document.activeElement)) comutaContext?.focus()
  }

  // Pornește închis pe ecran îngust, fără să atingă nimic pe ecran lat.
  if (context && comutaContext && comutaContext.offsetParent !== null) {
    context.hidden = true
  }

  comutaContext?.addEventListener('click', () => setContext(context?.hidden ?? true))
  document.getElementById('inchide-context')?.addEventListener('click', () => setContext(false))

  /* Trecerea peste 1200px cu sertarul închis lăsa coloana ascunsă pe un ecran
   * unde ea trebuie să fie mereu vizibilă. */
  const lat = window.matchMedia('(min-width: 1201px)')
  const potrivesteLatimea = () => {
    if (!context) return
    if (lat.matches) context.hidden = false
    else if (comutaContext?.getAttribute('aria-expanded') !== 'true') context.hidden = true
  }
  lat.addEventListener('change', potrivesteLatimea)
  potrivesteLatimea()

  document.addEventListener('keydown', (e) => {
    if (e.target === input) return
    if (e.key === 'Escape' && sertar && !sertar.hidden) setSertar(false)
    if (e.key === 'Escape' && context && !context.hidden && comutaContext?.offsetParent !== null) {
      setContext(false)
    }
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

    /* Fișierele stau acum pe luni, iar o lună din care nu mai rămâne nimic după
     * filtrare ar fi un cap de grup fără grup — „august, 3 fișiere”, urmat de
     * nimic. Grupul dispare împreună cu conținutul lui. */
    sertar?.querySelectorAll<HTMLElement>('[data-luna]').forEach((grup) => {
      const cuFisiere = [...grup.querySelectorAll<HTMLElement>('[data-nume-fisier]')]
      grup.hidden = cuFisiere.length > 0 && cuFisiere.every((li) => li.hidden)
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

  /* --- mesajele care sosesc între timp -------------------------------------
   *
   * Nimic nu ajungea într-o conversație deschisă fără reîncărcare manuală: doi
   * oameni care își scriau simultan nu vedeau nimic până apăsa unul F5.
   *
   * Interogarea este ieftină — un număr, nu conținut — și se oprește complet
   * când fila nu e la vedere, ca un portal lăsat deschis peste noapte să nu
   * ceară nimic. Când apare ceva, pagina nu se schimbă sub mână: apare o pilulă
   * pe care o apeși dacă vrei. */
  const idConversatie = new URLSearchParams(location.search).get('conversatie')
  const pilula = document.getElementById('mesaje-primite')

  if (idConversatie && pilula) {
    /* Reperul este câte mesaje avea firul, nu câte s-au randat: fereastra e de
     * patruzeci, iar un fir de trei sute ar fi părut brusc plin de mesaje noi. */
    const dinPagina = Number(
      document.querySelector<HTMLElement>('.chat')?.dataset.total ?? '',
    )
    const start = Number.isFinite(dinPagina) && dinPagina > 0
      ? dinPagina
      : scroller.querySelectorAll('.bubble, .eveniment').length
    let cunoscute = start

    const verifica = async () => {
      if (document.hidden || inZbor) return
      try {
        const r = await fetch(`/api/fir?conversatie=${encodeURIComponent(idConversatie)}`, {
          headers: { accept: 'application/json' },
        })
        if (!r.ok) return
        const d = (await r.json()) as { total?: number }
        if (typeof d.total !== 'number' || d.total <= cunoscute) return

        cunoscute = d.total
        const cate = d.total - start
        pilula.textContent =
          cate === 1 ? '1 mesaj nou — arată' : `${cate} mesaje noi — arată`
        pilula.hidden = false
      } catch {
        // O rețea căzută nu are voie să umple consola: reîncercăm la următorul tic.
      }
    }

    pilula.addEventListener('click', () => location.reload())

    setInterval(verifica, 20_000)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) verifica()
    })
  }
}
