/**
 * The reader for account lists.
 *
 * An academic year starts with a list from the registry: two hundred rows
 * pasted out of a spreadsheet. The same function reads the rows both in the
 * page, for the preview, and in the route, when writing — as with the archive
 * import, and for the same reason: two readers would show one table and write
 * another.
 *
 * It has no dependencies, so that it can be imported in the browser too.
 */

/**
 * The columns, in the order they are read off the pasted line.
 *
 * The two new ones are appended, not slotted in beside „An” where a person
 * reading the sheet would expect the series to sit. Reading is positional, so
 * inserting a column mid-list would silently reinterpret every list a registrar
 * saved from a previous term — the year would land in the series and nothing
 * would report an error. The order of an existing paste stays valid forever.
 */
export const ACCOUNT_COLUMNS = [
  'Nume',
  'Email',
  'Rol',
  'Număr matricol',
  'Program',
  'An',
  'Grupa',
  'Serie',
  'Inițiala tatălui',
] as const

export type AccountRole = 'student' | 'teacher' | 'head'

export interface AccountRow {
  name: string
  email: string
  role: AccountRole
  studentNumber: string
  programme: string
  year: string
  group: string
  series: string
  /** „I.” in „Popescu I. Maria”, stored as the bare letter. */
  fatherInitial: string
}

export interface RejectedAccountRow {
  numar: number
  text: string
  reason: string
}

export interface ParsedAccounts {
  accepted: AccountRow[]
  rejected: RejectedAccountRow[]
}

/**
 * The address, checked just enough to catch typing mistakes, not to reject
 * strange but valid addresses. An `@` with something on either side, a dot in
 * the domain, no spaces. Reality tells the rest: the link either arrives or not.
 */
function looksLikeEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

/** „student”, „cadru didactic”, „director” — as the registry writes them. */
export function parseAccountRole(text: string): AccountRole | null {
  const t = text.trim().toLowerCase()
  if (!t || t === 'student' || t === 's') return 'student'
  if (['cadru', 'cadru didactic', 'profesor', 'teacher', 'p', 'c'].includes(t)) return 'teacher'
  if (['director', 'head', 'director de departament', 'd'].includes(t)) return 'head'
  return null
}

export function parseAccountRows(raw: string): ParsedAccounts {
  const accepted: AccountRow[] = []
  const rejected: RejectedAccountRow[] = []
  const seen = new Set<string>()

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const [index, line] of lines.entries()) {
    const numar = index + 1
    /* A tab wins whenever there is one.
     *
     * The rule used to be „tab only if there is no semicolon”, and it undid the
     * one protection the composer has: a mapped list where a name contains „;”
     * is written with tabs precisely so the semicolon stays inside its cell —
     * and this line then split that row on the semicolon again, moving the
     * address into the role. A tab arrives only from a paste or from the
     * composer, and neither puts one inside a field. */
    const sep = line.includes('\t') ? '\t' : ';'
    const [name, email, role, studentNumber, programme, year, group, series, fatherInitial] = line
      .split(sep)
      .map((c) => c.trim())

    if (!name || !email) {
      rejected.push({ numar, text: line, reason: 'lipsește numele sau adresa de email' })
      continue
    }
    if (!looksLikeEmail(email)) {
      rejected.push({ numar, text: line, reason: `„${email}” nu arată a adresă de email` })
      continue
    }

    /* Duplicates inside the same list stop here, not in the database: otherwise
     * the first row would go in and the second would raise a uniqueness error in
     * the middle of the import, exactly the pattern the archive import avoids. */
    const key = email.toLowerCase()
    if (seen.has(key)) {
      rejected.push({ numar, text: line, reason: `adresa „${email}” apare de două ori în listă` })
      continue
    }
    seen.add(key)

    const parsedRole = parseAccountRole(role ?? '')
    if (!parsedRole) {
      rejected.push({
        numar,
        text: line,
        reason: `rolul „${role}” nu e recunoscut (student, cadru didactic, director)`,
      })
      continue
    }

    const an = (year ?? '').trim()
    if (an && !/^[1-6]$/.test(an)) {
      rejected.push({ numar, text: line, reason: `anul „${an}” trebuie să fie între 1 și 6` })
      continue
    }

    /* The initial is checked the way the year is: one or two letters, with or
     * without the point the registrar sometimes types — „Gh.” is a real
     * Romanian initial, not a typing mistake. A whole cell that slipped a column
     * would otherwise end up printed inside somebody's name on a signed
     * document. An empty one stays legal: a rejected row is a person who cannot
     * sign in, and most lists arrive with the column half filled. */
    const initiala = (fatherInitial ?? '').trim().replace(/\.+$/, '')
    if (initiala && !/^[A-Za-zĂÂÎȘȚăâîșț]{1,2}$/.test(initiala)) {
      rejected.push({
        numar,
        text: line,
        reason: `inițiala tatălui „${initiala}” trebuie să fie una sau două litere (ex: I, Gh.)`,
      })
      continue
    }

    accepted.push({
      name,
      email: key,
      role: parsedRole,
      studentNumber: studentNumber ?? '',
      programme: programme ?? '',
      year: an,
      group: group ?? '',
      // „a” and „A” are the same series; without this the catalogue's filter
      // would offer both as separate cohorts.
      series: (series ?? '').trim().toLocaleUpperCase('ro-RO'),
      // The point is added where the name is printed, not stored: „I” and „I.”
      // arrive from the same spreadsheet in the same term.
      fatherInitial: initiala
        ? initiala.charAt(0).toLocaleUpperCase('ro-RO') + initiala.slice(1).toLocaleLowerCase('ro-RO')
        : '',
    })
  }

  return { accepted, rejected }
}

/* --- mapping a foreign file onto these columns ------------------------------ */

/**
 * Where one of `ACCOUNT_COLUMNS` gets its value from.
 *
 * Three shapes, and the third is the one that matters most in practice: a
 * registrar's file is one sheet per programme and per year, so it carries no
 * „Rol”, „Program” or „An” column at all — those are in the file's *name*. A
 * constant applied to every row is what turns such a sheet into accounts
 * without anyone editing two hundred cells first.
 *
 * `columns` is a list, not one index, because the same file writes the family
 * name and the given name in two columns — and the order is the director's to
 * choose: the register writes family name first, and that is the order the
 * portal prints, but not every file agrees.
 */
export type AccountFieldSource =
  | { kind: 'none' }
  | { kind: 'columns'; columns: number[]; joiner: string }
  | { kind: 'constant'; value: string }

/** One source per column of `ACCOUNT_COLUMNS`, in the same order. */
export type AccountMapping = AccountFieldSource[]

/** The joiners offered, keyed by what they put between two columns. */
export const JOINERS: { value: string; text: string }[] = [
  { value: ' ', text: 'spațiu' },
  { value: '', text: 'nimic' },
  { value: '-', text: 'liniuță' },
  { value: '.', text: 'punct' },
  { value: ', ', text: 'virgulă' },
]

/**
 * The header text, compared the way a person compares it.
 *
 * „Număr matricol”, „NUMAR MATRICOL” and „Nr. Matricol” are the same column to
 * everyone except a string comparison. Diacritics are folded rather than
 * normalised, because a header is not stored anywhere — it only has to be
 * recognised.
 */
function foldHeader(text: string): string {
  return text
    .normalize('NFD')
    // U+0326, the comma below, sits outside the block the other marks live
    // in. Left in, the rule underneath would read it as punctuation and
    // „Număr” would fold to „numa r” — two words, matching no header at all.
    .replace(/[\u0300-\u036f\u0326]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * What each column is called in the files that actually arrive.
 *
 * `exact` matches the whole header, `loose` matches a word inside it. The
 * distinction exists because of „An”: as a whole header it is the year of
 * study, but as a fragment it is inside „Anul nașterii”, „An universitar” and
 * half the words in Romanian.
 */
const HEADER_HINTS: { exact: string[]; loose: RegExp | null }[] = [
  {
    exact: ['nume', 'numele', 'nume complet', 'nume si prenume', 'numele studentului', 'student', 'nume student'],
    loose: /\bnume/,
  },
  {
    // „Adresa” alone is the e-mail here, but „Adresa de domiciliu” is not: a
    // postal address mapped into this field rejects every row in the list.
    exact: ['email', 'e mail', 'mail', 'adresa de email', 'adresa email', 'adresa', 'adresa electronica'],
    loose: /\b(e ?mail|adresa de e ?mail|adresa electronica)\b/,
  },
  { exact: ['rol', 'calitate', 'tip'], loose: /\brol\b/ },
  { exact: ['nr matricol', 'numar matricol', 'matricol', 'marca'], loose: /matricol/ },
  {
    exact: ['program', 'program de studiu', 'programul de studiu', 'specializare', 'specializarea'],
    loose: /\b(program|specializar)/,
  },
  { exact: ['an', 'anul', 'an de studiu', 'anul de studiu'], loose: null },
  { exact: ['grupa', 'grupa de studiu', 'gr'], loose: /\bgrup/ },
  { exact: ['serie', 'seria'], loose: /\bseri/ },
  {
    exact: ['initiala', 'initiala tatalui', 'initiala tata', 'tatal', 'initiala parintelui'],
    loose: /initial/,
  },
]

/**
 * The mapping guessed from the header row.
 *
 * A guess saves the work; it does not replace the decision. Every guess is
 * shown next to a sample cell from the first row of data, and every one of them
 * can be changed — the screen is built so that a wrong guess is visible before
 * anything is written, not after.
 *
 * The one composition it proposes by itself is „Nume” + „Prenume”: a file that
 * splits the name in two is the ordinary case, and leaving the director to
 * assemble it by hand on the very first field would make the mapping look
 * harder than it is.
 */
export function guessAccountMapping(header: string[]): AccountMapping {
  const folded = header.map(foldHeader)
  const used = new Set<number>()
  const mapping: AccountMapping = ACCOUNT_COLUMNS.map(() => ({ kind: 'none' }) as AccountFieldSource)

  const findColumn = (hints: (typeof HEADER_HINTS)[number]): number => {
    let best = -1
    let bestScore = 0
    folded.forEach((text, index) => {
      if (!text || used.has(index)) return
      const score = hints.exact.includes(text) ? 2 : hints.loose?.test(text) ? 1 : 0
      if (score > bestScore) {
        best = index
        bestScore = score
      }
    })
    return best
  }

  ACCOUNT_COLUMNS.forEach((_, field) => {
    const at = findColumn(HEADER_HINTS[field]!)
    if (at < 0) return
    used.add(at)
    mapping[field] = { kind: 'columns', columns: [at], joiner: ' ' }
  })

  const givenName = folded.findIndex((t) => t === 'prenume' || /\bprenume\b/.test(t))
  const nameSource = mapping[0]
  if (givenName >= 0 && !used.has(givenName) && nameSource?.kind === 'columns') {
    mapping[0] = { kind: 'columns', columns: [...nameSource.columns, givenName], joiner: ' ' }
  }

  return mapping
}

/** One cell of one row, as the mapping composes it. */
function composeField(row: string[], source: AccountFieldSource): string {
  if (source.kind === 'constant') return source.value.trim()
  if (source.kind !== 'columns') return ''
  return source.columns
    .map((c) => (row[c] ?? '').trim())
    .filter((v) => v !== '')
    .join(source.joiner)
    .trim()
}

/** The file's rows, in the portal's nine columns. */
export function applyAccountMapping(rows: string[][], mapping: AccountMapping): string[][] {
  return rows.map((row) => ACCOUNT_COLUMNS.map((_, field) => composeField(row, mapping[field] ?? { kind: 'none' })))
}

/**
 * The composed rows, as the text the route will read again.
 *
 * The delimiter is chosen for the whole text, not per row: the reader decides
 * it line by line, so a document where one name carries a semicolon and the
 * rest do not would be split two different ways inside a single import. If any
 * cell anywhere contains a semicolon, the whole text switches to tabs — which
 * the reader prefers over the semicolon exactly so that this composition
 * survives it.
 */
export function composeAccountRows(rows: string[][]): string {
  // A tab inside a cell is flattened first: it is the one character that
  // survives neither delimiter, and it can only have come from a paste.
  const cells = rows.map((row) => row.map((c) => c.replace(/[\r\n\t]+/g, ' ').trim()))
  const separator = cells.some((row) => row.some((c) => c.includes(';'))) ? '\t' : ';'
  return cells.map((row) => row.join(separator)).join('\n')
}

/* --- tying a row to a programme --------------------------------------------- */

/**
 * A study programme, as much of it as matching needs.
 *
 * The label is passed in rather than composed here: the Romanian names of the
 * levels and languages live in `years.ts`, which reads the database and
 * therefore cannot be imported into a module the browser also runs.
 */
export interface ProgrammeChoice {
  level: string
  name: string
  language: string
  /** „Licență · Marketing · Română” — and also the value that identifies it. */
  label: string
}

export type ProgrammeMatch<T> = { ok: true; programme: T | null } | { ok: false; reason: string }

/**
 * The programme a row asks for, or the reason it cannot be given one.
 *
 * An empty cell is legal and means „none”: teachers have no programme, and half
 * the lists arrive with the column blank. A name that matches nothing is *not*
 * legal, and this is the change of mind: it used to become `NULL` quietly, so
 * a list with „Markting” in one column produced two hundred students who then
 * appeared on no programme-filtered screen at all — not on the coordinator's
 * list, not in the catalogue, not in the reports. It is better to refuse the
 * row and say which value was not recognised.
 *
 * The full label matches first, and that is why the portal's own lists send the
 * label rather than the bare name: a programme is unique on (year, level, name,
 * language), so „Marketing” alone is not an identifier — it exists at bachelor
 * in Romanian and at master in English, and a lookup keyed on the name kept
 * whichever row the query happened to return last. A bare name is still
 * accepted, because that is what a registrar's file contains, but only while it
 * points at exactly one programme.
 */
export function matchProgramme<T extends ProgrammeChoice>(raw: string, programmes: T[]): ProgrammeMatch<T> {
  const text = (raw ?? '').trim()
  if (!text) return { ok: true, programme: null }

  const key = text.toLocaleLowerCase('ro-RO')
  const exact = programmes.find((p) => p.label.toLocaleLowerCase('ro-RO') === key)
  if (exact) return { ok: true, programme: exact }

  const byName = programmes.filter((p) => p.name.toLocaleLowerCase('ro-RO') === key)
  if (byName.length === 1) return { ok: true, programme: byName[0]! }
  if (byName.length > 1) {
    return {
      ok: false,
      reason: `programul „${text}” există în mai multe variante (${byName.map((p) => p.label).join(', ')}) — alege-l din listă, nu dintr-o coloană`,
    }
  }
  return { ok: false, reason: `programul „${text}” nu există în anul curent` }
}
