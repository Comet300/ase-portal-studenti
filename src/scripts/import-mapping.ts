/**
 * The import wizard: a file from the secretariat, mapped onto the portal's
 * columns.
 *
 * The registrar never sends the nine columns this portal reads, in this order.
 * They send the sheet they keep: „Nr. crt.”, the surname and the given name in
 * two columns, an e-mail somewhere on the right, and no „Program” column at all
 * because the programme is in the file's name. Until now the only way in was to
 * rearrange that sheet in Excel first, which is the work this screen exists to
 * remove.
 *
 * Everything happens here, in the page. Nothing is uploaded: the file is read
 * with `readTabular`, mapped, and composed into the same text box the paste
 * path has always used — so the route receives what it has always received and
 * reads it again with `parseAccountRows`, exactly as it does for a paste. That
 * is the whole trust model: the browser prepares, the server decides, and
 * neither a spreadsheet full of personal data nor a new endpoint has to exist.
 *
 * The preview is drawn by the same reader the route runs, so the table shown
 * and the accounts created cannot differ.
 */

import {
  ACCOUNT_COLUMNS,
  JOINERS,
  applyAccountMapping,
  composeAccountRows,
  guessAccountMapping,
  matchProgramme,
  parseAccountRows,
  type AccountFieldSource,
  type AccountMapping,
  type ProgrammeChoice,
} from '../lib/accounts'
import {
  ENCODING_LABELS,
  parseDelimited,
  readTabular,
  sniffDelimiter,
  type TabularDocument,
  type TextEncodingLabel,
} from '../lib/tabular'
import { numar } from '../lib/text'

/** Name and address: without them a row is not a person who can sign in. */
const REQUIRED_FIELDS = [0, 1]

/** The fields whose value, when constant, must come from a list and not a keyboard. */
const ROLE_FIELD = 2
const PROGRAMME_FIELD = 4
const YEAR_FIELD = 5

const ROLE_OPTIONS = [
  { value: 'student', text: 'Student' },
  { value: 'cadru didactic', text: 'Cadru didactic' },
  { value: 'director', text: 'Director de departament' },
]

interface ImportData {
  programme: ProgrammeChoice[]
  /** The addresses already in the portal, so „există deja” is said before the write. */
  existing: string[]
}

/** „A”, „B” … „AA” — the column as the spreadsheet names it. */
function columnLetter(index: number): string {
  let n = index + 1
  let text = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    text = String.fromCharCode(65 + rest) + text
    n = Math.floor((n - 1) / 26)
  }
  return text
}

export function start(): void {
  const form = document.querySelector<HTMLFormElement>('[data-import]')
  if (!form) return

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

  const fileField = el<HTMLInputElement>('import-fisier')
  const pasteField = el<HTMLTextAreaElement>('import-lipire')
  const status = el<HTMLParagraphElement>('import-stare')
  const failure = el<HTMLParagraphElement>('import-eroare')
  const encodingField = el<HTMLDivElement>('import-codificare-camp')
  const encoding = el<HTMLSelectElement>('import-codificare')
  const sheetStep = el<HTMLElement>('pas-foaie')
  const sheetField = el<HTMLDivElement>('import-foaie-camp')
  const sheet = el<HTMLSelectElement>('import-foaie')
  const headerToggle = el<HTMLInputElement>('import-cap')
  const skipField = el<HTMLInputElement>('import-sari')
  const firstRowsHead = el<HTMLTableRowElement>('import-antet')
  const firstRowsBody = el<HTMLTableSectionElement>('import-primele')
  const mappingStep = el<HTMLElement>('pas-potrivire')
  const mappingArea = el<HTMLDivElement>('potrivire')
  const mappingStatus = el<HTMLParagraphElement>('potrivire-stare')
  const textarea = el<HTMLTextAreaElement>('randuri')
  const previewArea = el<HTMLDivElement>('previzualizare')
  const previewHead = el<HTMLTableRowElement>('previzualizare-cap')
  const previewBody = el<HTMLTableSectionElement>('previzualizare-corp')
  const previewSummary = el<HTMLElement>('previzualizare-sumar')
  const rejectedArea = el<HTMLDivElement>('respinse')
  const rejectedList = el<HTMLUListElement>('respinse-lista')
  const submit = el<HTMLButtonElement>('trimite-import')

  if (!textarea || !previewArea || !previewHead || !previewBody || !previewSummary) return
  if (!rejectedArea || !rejectedList) return

  const island = document.getElementById('date-import')?.textContent ?? '{}'
  let data: ImportData = { programme: [], existing: [] }
  try {
    data = { programme: [], existing: [], ...(JSON.parse(island) as Partial<ImportData>) }
  } catch {
    /* An island that does not parse costs the programme check, not the import. */
  }
  const existing = new Set((data.existing ?? []).map((e) => e.toLowerCase()))

  let doc: TabularDocument | null = null
  let bytes: Uint8Array | null = null
  let fileName = ''
  let sheetIndex = 0
  let mapping: AccountMapping = ACCOUNT_COLUMNS.map(() => ({ kind: 'none' }) as AccountFieldSource)
  /** The rows of the preview, as cells — what an edited cell is written back into. */
  let cellRows: string[][] = []

  /* --- reading what the director gave us ---------------------------------- */

  const say = (message: string, isError = false) => {
    if (failure) {
      failure.textContent = isError ? message : ''
      failure.hidden = !isError
    }
    if (status && !isError) status.textContent = message
  }

  const rowsOfSheet = (): string[][] => {
    const all = doc?.sheets[sheetIndex]?.rows ?? []
    const skip = Math.max(0, Number(skipField?.value ?? 0) || 0)
    return all.slice(skip)
  }

  const headerRow = (): string[] => (headerToggle?.checked ? (rowsOfSheet()[0] ?? []) : [])

  const dataRows = (): string[][] => (headerToggle?.checked ? rowsOfSheet().slice(1) : rowsOfSheet())

  /** The widest row decides how many columns the mapping may choose from. */
  const columnCount = (): number => rowsOfSheet().reduce((w, r) => Math.max(w, r.length), 0)

  /**
   * Whether the first row is a header, guessed and then left to the director.
   *
   * A row of data carries an address, a header does not. It is the one signal
   * that holds for a file nobody has cleaned up — a registrar's sheet begins
   * with a title banner, a merged cell and a blank row before the real header,
   * and „Sari peste primele N rânduri” is what gets past those.
   */
  const looksLikeHeader = (rows: string[][]): boolean => {
    const first = rows[0]?.join(' ') ?? ''
    return !first.includes('@')
  }

  const showDocument = (next: TabularDocument, name: string) => {
    doc = next
    fileName = name
    sheetIndex = 0

    if (sheet && sheetField) {
      sheet.textContent = ''
      next.sheets.forEach((s, i) => {
        const option = document.createElement('option')
        option.value = String(i)
        option.textContent = `${s.name} · ${numar(s.rows.length, 'rând', 'rânduri')}`
        sheet.appendChild(option)
      })
      // The picker only earns its space when there is something to pick.
      sheetField.hidden = next.sheets.length < 2
    }
    // Only a decoded file has an encoding to argue with; a paste arrives as
    // text the browser already decoded, and the chooser would do nothing.
    if (encodingField) encodingField.hidden = next.encoding === null
    if (encoding && next.encoding) encoding.value = next.encoding

    if (headerToggle) headerToggle.checked = looksLikeHeader(next.sheets[0]?.rows ?? [])
    if (skipField) skipField.value = '0'

    if (sheetStep) sheetStep.hidden = false
    if (mappingStep) mappingStep.hidden = false

    describe()
    mapping = guessAccountMapping(headerRow())
    renderFirstRows()
    renderMapping()
    applyMapping()
  }

  /** „registru.xlsx · foaia „Situație” · 214 rânduri × 10 coloane · citit ca UTF-8”. */
  const describe = () => {
    if (!doc) return
    const current = doc.sheets[sheetIndex]
    if (!current) return

    const parts = [fileName || 'Text lipit']
    if (doc.sheets.length > 1) parts.push(`foaia „${current.name}”`)
    // The rows that will become accounts, not the rows in the file: the header
    // and whatever was skipped above it are not people.
    parts.push(`${numar(dataRows().length, 'rând de date', 'rânduri de date')} × ${numar(columnCount(), 'coloană', 'coloane')}`)
    if (doc.encoding) parts.push(`citit ca ${ENCODING_LABELS[doc.encoding]}`)
    if (doc.delimiter) {
      const named: Record<string, string> = { ';': 'punct și virgulă', ',': 'virgulă', '\t': 'tab', '|': 'bară' }
      parts.push(`separat prin ${named[doc.delimiter] ?? doc.delimiter}`)
    }
    say(parts.join(' · '))
  }

  const readFile = async () => {
    const file = fileField?.files?.[0]
    if (!file) return
    fileName = file.name
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
      const chosen = (encoding?.value ?? '') as TextEncodingLabel
      const doc = await readTabular(file.name, bytes, chosen ? { encoding: chosen } : {})
      showDocument(doc, file.name)
    } catch (err) {
      bytes = null
      say(err instanceof Error ? err.message : 'Fișierul nu a putut fi citit.', true)
    }
  }

  /* Pasting stays: it is the fastest way in when the columns are already
   * selected in Excel, and it is the only one that works with a file the
   * director cannot download twice. It goes through the same mapping — a paste
   * is a delimited text like any other. */
  const readPaste = () => {
    const text = pasteField?.value ?? ''
    if (!text.trim()) return
    const delimiter = sniffDelimiter(text)
    const rows = parseDelimited(text, delimiter)
    if (rows.length === 0) return
    bytes = null
    showDocument(
      { kind: 'text', sheets: [{ name: 'Text lipit', rows }], encoding: null, delimiter },
      '',
    )
  }

  /* --- step two: the sheet and the header ---------------------------------- */

  const renderFirstRows = () => {
    if (!firstRowsHead || !firstRowsBody) return
    const header = headerRow()
    const rows = dataRows().slice(0, 5)
    const width = columnCount()

    firstRowsHead.textContent = ''
    for (let c = 0; c < width; c++) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = header[c] ? `${columnLetter(c)} · ${header[c]}` : `Coloana ${columnLetter(c)}`
      firstRowsHead.appendChild(th)
    }

    firstRowsBody.textContent = ''
    for (const row of rows) {
      const tr = document.createElement('tr')
      for (let c = 0; c < width; c++) {
        const td = document.createElement('td')
        td.textContent = row[c] ?? ''
        tr.appendChild(td)
      }
      firstRowsBody.appendChild(tr)
    }
  }

  /* --- step three: the mapping --------------------------------------------- */

  const columnOptions = (selected: number): HTMLSelectElement => {
    const select = document.createElement('select')
    select.className = 'select select--mic'
    const header = headerRow()
    for (let c = 0; c < columnCount(); c++) {
      const option = document.createElement('option')
      option.value = String(c)
      option.textContent = header[c] ? `${columnLetter(c)} · ${header[c]}` : `Coloana ${columnLetter(c)}`
      option.selected = c === selected
      select.appendChild(option)
    }
    return select
  }

  const constantControl = (field: number, value: string): HTMLElement => {
    if (field === ROLE_FIELD || field === PROGRAMME_FIELD) {
      const select = document.createElement('select')
      select.className = 'select select--mic'
      const options =
        field === ROLE_FIELD
          ? ROLE_OPTIONS
          : [{ value: '', text: '— fără program —' }].concat(
              data.programme.map((p) => ({ value: p.label, text: p.label })),
            )
      for (const o of options) {
        const option = document.createElement('option')
        option.value = o.value
        option.textContent = o.text
        option.selected = o.value === value
        select.appendChild(option)
      }
      return select
    }

    const input = document.createElement('input')
    input.className = 'input input--mic'
    input.value = value
    if (field === YEAR_FIELD) {
      input.type = 'number'
      input.min = '1'
      input.max = '6'
    }
    return input
  }

  /**
   * One row of the mapping: the field, where it comes from, and a sample.
   *
   * The sample is the point. A dropdown showing „Coloana E” proves nothing; the
   * first row's real value, composed exactly as it will be written, is what
   * lets someone see in one glance that the surname and the given name came out
   * in the wrong order.
   */
  /** The sample cell of each field, kept so it can be refreshed in place. */
  const samples: HTMLElement[] = []

  /**
   * Only the samples redraw when a value changes.
   *
   * Rebuilding the whole mapping on every change threw the keyboard out of the
   * select that had just been used: the element the focus was on no longer
   * existed. The full redraw is kept for the changes that really do change the
   * shape of a row — a mode, a column added or removed.
   */
  const refreshSamples = () => {
    const first = dataRows()[0] ?? []
    const composed = applyAccountMapping([first], mapping)[0] ?? []
    samples.forEach((cell, field) => {
      cell.textContent = composed[field] || '—'
    })
  }

  const renderMapping = () => {
    if (!mappingArea) return
    // The header row belongs to the template; only the field rows are ours.
    mappingArea.querySelectorAll('.potrivire__rand').forEach((r) => r.remove())
    samples.length = 0
    const first = dataRows()[0] ?? []

    ACCOUNT_COLUMNS.forEach((columnName, field) => {
      const source = mapping[field] ?? { kind: 'none' }
      const row = document.createElement('div')
      row.className = 'potrivire__rand'

      const label = document.createElement('div')
      label.className = 'potrivire__camp'
      const strong = document.createElement('strong')
      strong.textContent = columnName
      label.appendChild(strong)
      if (REQUIRED_FIELDS.includes(field)) {
        const required = document.createElement('span')
        required.className = 'potrivire__cerut'
        required.textContent = 'obligatoriu'
        label.appendChild(required)
      }
      row.appendChild(label)

      const controls = document.createElement('div')
      controls.className = 'potrivire__sursa'

      const mode = document.createElement('select')
      mode.className = 'select select--mic'
      for (const o of [
        { value: 'coloane', text: 'Din fișier' },
        { value: 'constanta', text: 'Aceeași valoare' },
        { value: 'niciuna', text: 'Nimic' },
      ]) {
        const option = document.createElement('option')
        option.value = o.value
        option.textContent = o.text
        option.selected =
          (source.kind === 'columns' && o.value === 'coloane') ||
          (source.kind === 'constant' && o.value === 'constanta') ||
          (source.kind === 'none' && o.value === 'niciuna')
        mode.appendChild(option)
      }
      mode.setAttribute('aria-label', `Sursa pentru ${columnName}`)
      mode.addEventListener('change', () => {
        mapping[field] =
          mode.value === 'coloane'
            ? { kind: 'columns', columns: [0], joiner: ' ' }
            : mode.value === 'constanta'
              ? { kind: 'constant', value: '' }
              : { kind: 'none' }
        renderMapping()
        applyMapping()
      })
      controls.appendChild(mode)

      if (source.kind === 'columns') {
        /* Every handler reads the mapping as it is *now*, not as it was when the
         * row was drawn. With the captured value, choosing a second column
         * undid the first: the closure still held the list from the last full
         * redraw, and the redraw no longer happens on a plain value change. */
        const columnsNow = () => {
          const current = mapping[field]
          return current?.kind === 'columns' ? current : source
        }

        source.columns.forEach((column, position) => {
          const select = columnOptions(column)
          select.setAttribute('aria-label', `Coloana ${position + 1} pentru ${columnName}`)
          select.addEventListener('change', () => {
            const current = columnsNow()
            const next = [...current.columns]
            next[position] = Number(select.value)
            mapping[field] = { ...current, columns: next }
            refreshSamples()
            applyMapping()
          })
          controls.appendChild(select)

          if (source.columns.length > 1) {
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'btn btn--ghost btn--sm'
            remove.textContent = 'Scoate'
            remove.setAttribute('aria-label', `Scoate coloana ${position + 1} din ${columnName}`)
            remove.addEventListener('click', () => {
              const current = columnsNow()
              mapping[field] = { ...current, columns: current.columns.filter((_, i) => i !== position) }
              renderMapping()
              applyMapping()
            })
            controls.appendChild(remove)
          }
        })

        /* „Merge columns into fields”: the surname and the given name in two
         * columns is the ordinary shape of these files, and the order is the
         * director's — the register writes the family name first, but not
         * every file agrees. */
        const add = document.createElement('button')
        add.type = 'button'
        add.className = 'btn btn--ghost btn--sm'
        add.textContent = '+ altă coloană'
        add.setAttribute('aria-label', `Adaugă încă o coloană la ${columnName}`)
        add.addEventListener('click', () => {
          const current = columnsNow()
          mapping[field] = { ...current, columns: [...current.columns, 0] }
          renderMapping()
          applyMapping()
        })
        controls.appendChild(add)

        if (source.columns.length > 1) {
          const joiner = document.createElement('select')
          joiner.className = 'select select--mic'
          joiner.setAttribute('aria-label', `Ce se pune între coloanele din ${columnName}`)
          for (const j of JOINERS) {
            const option = document.createElement('option')
            option.value = j.value
            option.textContent = j.text
            option.selected = j.value === source.joiner
            joiner.appendChild(option)
          }
          joiner.addEventListener('change', () => {
            mapping[field] = { ...columnsNow(), joiner: joiner.value }
            refreshSamples()
            applyMapping()
          })
          controls.appendChild(joiner)
        }
      }

      if (source.kind === 'constant') {
        const control = constantControl(field, source.value)
        control.setAttribute('aria-label', `Valoarea pentru ${columnName}`)
        control.addEventListener('change', () => {
          mapping[field] = { kind: 'constant', value: (control as HTMLInputElement).value }
          refreshSamples()
          applyMapping()
        })
        controls.appendChild(control)
      }

      row.appendChild(controls)

      const sample = document.createElement('div')
      sample.className = 'potrivire__exemplu'
      const composed = applyAccountMapping([first], mapping)[0]?.[field] ?? ''
      sample.textContent = composed || '—'
      samples[field] = sample
      row.appendChild(sample)

      mappingArea.appendChild(row)
    })
  }

  /* --- step four: compose, then show what will be written ------------------ */

  const missingFields = (): string[] =>
    REQUIRED_FIELDS.filter((f) => (mapping[f] ?? { kind: 'none' }).kind === 'none').map(
      (f) => ACCOUNT_COLUMNS[f]!,
    )

  /**
   * The mapping written into the box the form actually submits.
   *
   * There is no second channel: what the wizard produces is text in the same
   * `randuri` field a paste goes into, and the route reads that text again with
   * its own reader. The wizard can therefore be wrong without being dangerous.
   */
  const applyMapping = () => {
    if (!doc) return
    // A field with no source composes an empty column, and a whole list of rows
    // rejected for „lipsește numele” is a worse answer than an empty box and a
    // sentence saying which field is missing.
    textarea.value =
      missingFields().length > 0
        ? ''
        : composeAccountRows(applyAccountMapping(dataRows(), mapping))
    renderPreview()
  }

  /**
   * What the mapping still leaves open, in one sentence under step three.
   *
   * It is written from the composed text and not from the mapping, so a cell
   * corrected by hand in the preview clears the warning it caused — the two
   * would otherwise disagree, and the one on screen would be the stale one.
   *
   * A value that matches no programme stops those rows on the server, so it is
   * said before the write rather than counted after it. A student with *no*
   * programme is accepted and then invisible: every catalogue, every
   * coordinator's list and every report filters by programme, and a registrar's
   * file has no programme column at all — the constant is one control away.
   */
  const reportMapping = () => {
    if (!mappingStatus) return
    const messages: string[] = []
    const missing = doc ? missingFields() : []

    if (missing.length > 0) {
      // Neither „fără el” nor „fără ea”: the field names have genders, the
      // sentence must not pick one and be wrong about the other.
      const named = missing.map((f) => `„${f}”`).join(' și ')
      messages.push(
        missing.length > 1
          ? `Alege de unde vin ${named}: fără aceste valori nu se poate deschide niciun cont.`
          : `Alege de unde vine ${named}: fără această valoare nu se poate deschide niciun cont.`,
      )
    } else {
      const { accepted } = parseAccountRows(textarea.value)
      const unknown = new Set<string>()
      for (const person of accepted) {
        const match = matchProgramme(person.programme, data.programme)
        if (!match.ok) unknown.add(person.programme)
      }
      const orphans = accepted.filter((p) => p.role === 'student' && !p.programme).length

      if (unknown.size > 0) {
        messages.push(
          `${numar(unknown.size, 'program nu este', 'programe nu sunt')} în anul curent: ` +
            `${[...unknown].map((p) => `„${p}”`).join(', ')}. ` +
            'Alege „Aceeași valoare” și programul din listă, sau adaugă-l întâi în „An universitar”. ' +
            'Rândurile acelea nu se scriu.',
        )
      }
      if (orphans > 0) {
        messages.push(
          `${numar(orphans, 'student rămâne', 'studenți rămân')} fără program, deci în afara ` +
            'listelor filtrate pe program. Fișierele secretariatului nu au coloana asta: ' +
            'pune-o la „Program” ca aceeași valoare pentru toți.',
        )
      }
    }

    mappingStatus.textContent = messages.join(' ')
    mappingStatus.hidden = messages.length === 0
  }

  /**
   * The preview: the same reader as the route, over the text that will be sent.
   *
   * The state column says in words what the tint says in colour, and it says it
   * before the write rather than in a message afterwards — „12 existau deja” in
   * a toast reads as success, and the director has no way to tell which twelve.
   */
  const renderPreview = () => {
    const { accepted, rejected } = parseAccountRows(textarea.value)
    cellRows = textarea.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(l.includes('\t') ? '\t' : ';').map((c) => c.trim()))

    previewArea.hidden = cellRows.length === 0

    previewHead.textContent = ''
    for (const columnName of ['Stare', ...ACCOUNT_COLUMNS]) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = columnName
      previewHead.appendChild(th)
    }

    /* Every row lands in exactly one bucket, and the summary is added up from
     * them. Counting „accepted” and „already there” separately produced a line
     * that said both „3 studenți” and „0 conturi se deschid” about the same
     * three rows — each number true on its own, together nonsense. */
    const withoutProgramme: string[] = []
    const counted = { opening: 0, already: 0, orphan: 0, broken: 0, students: 0 }
    let taken = 0

    previewBody.textContent = ''
    cellRows.forEach((cells, i) => {
      const tr = document.createElement('tr')
      const isRejected = rejected.some((r) => r.numar === i + 1)
      const person = isRejected ? null : (accepted[taken++] ?? null)

      const unresolved = person ? matchProgramme(person.programme, data.programme) : null
      let state = 'se adaugă'
      let badge = 'badge--aprobata'

      if (isRejected) {
        tr.className = 'rand-respins'
        state = 'de corectat'
        badge = 'badge--asteptare'
        counted.broken++
      } else if (unresolved && !unresolved.ok) {
        tr.className = 'rand-respins'
        state = 'fără program'
        badge = 'badge--asteptare'
        counted.orphan++
        if (person) withoutProgramme.push(`${person.email}: ${unresolved.reason}`)
      } else if (person && existing.has(person.email)) {
        tr.className = 'rand-existent'
        state = 'există deja'
        badge = 'badge--neutru'
        counted.already++
      } else {
        counted.opening++
        if (person?.role === 'student') counted.students++
      }

      const stateCell = document.createElement('td')
      const mark = document.createElement('span')
      mark.className = `badge ${badge}`
      mark.textContent = state
      stateCell.appendChild(mark)
      tr.appendChild(stateCell)

      /* The cells are fields, and an edit is written back into the box the
       * route reads — that is how the two broken rows out of two hundred get
       * corrected without having to be found inside the text first. */
      ACCOUNT_COLUMNS.forEach((columnName, column) => {
        const td = document.createElement('td')
        const input = document.createElement('input')
        input.className = 'input input--celula'
        input.value = cells[column] ?? ''
        input.setAttribute('aria-label', `${columnName}, rândul ${i + 1}`)
        input.addEventListener('change', () => {
          while (cellRows[i]!.length < ACCOUNT_COLUMNS.length) cellRows[i]!.push('')
          cellRows[i]![column] = input.value.trim()
          textarea.value = composeAccountRows(cellRows)
          renderPreview()
        })
        td.appendChild(input)
        tr.appendChild(td)
      })

      previewBody.appendChild(tr)
    })

    previewSummary.textContent =
      `${numar(counted.opening, 'cont se deschide', 'conturi se deschid')}` +
      (counted.students ? ` · ${numar(counted.students, 'student', 'studenți')}` : '') +
      (counted.already ? ` · ${numar(counted.already, 'cont există deja', 'conturi există deja')}` : '') +
      (counted.orphan ? ` · ${numar(counted.orphan, 'rând fără program', 'rânduri fără program')}` : '') +
      (counted.broken ? ` · ${numar(counted.broken, 'rând de corectat', 'rânduri de corectat')}` : '')

    const problems = [
      ...rejected.map((r) => `Rândul ${r.numar}: ${r.reason}`),
      ...withoutProgramme.map((p) => `Fără program — ${p}`),
    ]
    rejectedArea.hidden = problems.length === 0
    rejectedList.textContent = ''
    for (const problem of problems) {
      const li = document.createElement('li')
      li.textContent = problem
      rejectedList.appendChild(li)
    }

    if (submit) submit.disabled = textarea.value.trim() === ''
    reportMapping()
  }

  /* --- wiring --------------------------------------------------------------- */

  fileField?.addEventListener('change', () => void readFile())
  encoding?.addEventListener('change', () => {
    // Re-read the same bytes: the file is still in the field, and the director
    // has just told us the guess was wrong.
    if (bytes) void readFile()
  })
  pasteField?.addEventListener('paste', () => setTimeout(readPaste, 0))
  pasteField?.addEventListener('change', readPaste)

  sheet?.addEventListener('change', () => {
    sheetIndex = Number(sheet.value) || 0
    if (headerToggle) headerToggle.checked = looksLikeHeader(rowsOfSheet())
    describe()
    mapping = guessAccountMapping(headerRow())
    renderFirstRows()
    renderMapping()
    applyMapping()
  })

  for (const control of [headerToggle, skipField]) {
    control?.addEventListener('change', () => {
      describe()
      mapping = guessAccountMapping(headerRow())
      renderFirstRows()
      renderMapping()
      applyMapping()
    })
  }

  document.getElementById('verifica-randuri')?.addEventListener('click', renderPreview)
  textarea.addEventListener('paste', () => setTimeout(renderPreview, 0))
  textarea.addEventListener('change', renderPreview)

  // A list already in the box — a redraw after a failed submit, or a paste
  // straight into it — gets its preview without anyone asking.
  if (textarea.value.trim()) renderPreview()
  else if (submit) submit.disabled = true
}
