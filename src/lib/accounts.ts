import {
  deriveProgramme,
  findRegistryColumns,
  foldForMatching,
  isNeverMappedHeader,
  normalizeRegistryCell,
  parseFatherInitials,
  parseStudyYear,
} from './import/students.ts'

/**
 * The reader for account lists.
 *
 * An academic year starts with a list from the registry: two hundred rows
 * pasted out of a spreadsheet. The same function reads the rows both in the
 * page, for the preview, and in the route, when writing — as with the archive
 * import, and for the same reason: two readers would show one table and write
 * another.
 *
 * It stays generic: what a father's initial may look like, what a year of study
 * may say and which programme a cohort belongs to are the registry's business,
 * and they are imported from `import/students.ts` rather than written twice.
 * The one dependency is that module, which runs in the browser as this one
 * does.
 */

/**
 * The columns, in the order they are read off the pasted line.
 *
 * The new ones are appended, not slotted in beside „An” where a person reading
 * the sheet would expect the series to sit. Reading is positional, so inserting
 * a column mid-list would silently reinterpret every list a registrar saved
 * from a previous term — the year would land in the series and nothing would
 * report an error. The order of an existing paste stays valid forever, which is
 * why „Finanțare” is tenth and not next to „Program” where it belongs by
 * meaning.
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
  'Finanțare',
] as const

export type AccountRole = 'student' | 'teacher' | 'head'

export interface AccountRow {
  name: string
  email: string
  role: AccountRole
  studentNumber: string
  programme: string
  year: string
  /**
   * What the registry wrote beside the year — „An suplimentar”, and nothing
   * else so far. Kept rather than dropped: it is the whole reason a student is
   * in a third year for the second time, and the coordinator would otherwise be
   * the last person in the faculty to know.
   */
  yearNote: string
  group: string
  series: string
  /** „I.” in „Popescu I. Maria”, stored as the bare letters: „I”, „M G”. */
  fatherInitial: string
  /** `FormaFinantare`: „Taxa”, „Buget RO”, „Bursier_RP” — as written. */
  funding: string
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
    /* Every cell is cleaned by the registry's own rule, not by `trim`.
     *
     * A row can reach this point without ever having passed through the file
     * reader — typed straight into the box the route re-reads, or pasted out of
     * the export into it. Those rows still carry the fixed-width padding, the
     * literal „NULL” where a value is missing and the cedilla `ş`/`ţ`; left
     * alone, one student was called „NULL” and one address was refused with a
     * message about an e-mail. */
    const [name, email, role, studentNumber, programme, year, group, series, fatherInitial, funding] =
      line.split(sep).map(normalizeRegistryCell)

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

    /* The year and the initial are judged by the registry's rules, imported
     * rather than written again here. Both used to live in this file as one
     * regular expression each — one digit, one or two letters — and both were
     * right for a list typed by hand and wrong for the file the registry
     * exports: 350 rows of 893 were refused between them. */
    const an = parseStudyYear(year)
    if (!an) {
      rejected.push({
        numar,
        text: line,
        reason: `anul „${year}” nu se poate citi — scrie o cifră de la 1 la 6, sau „3 Suplimentar”`,
      })
      continue
    }

    /* An empty initial stays legal: a rejected row is a person who cannot sign
     * in, and most lists arrive with the column half filled. */
    const initiala = parseFatherInitials(fatherInitial)
    if (initiala === null) {
      rejected.push({
        numar,
        text: line,
        reason:
          `inițiala tatălui „${fatherInitial}” nu se poate citi — una până la trei ` +
          'inițiale de câte una sau două litere (ex: I, Gh., M G)',
      })
      continue
    }

    accepted.push({
      name,
      email: key,
      role: parsedRole,
      studentNumber: studentNumber ?? '',
      programme: programme ?? '',
      year: an.year,
      yearNote: an.note,
      group: group ?? '',
      // „a” and „A” are the same series; without this the catalogue's filter
      // would offer both as separate cohorts.
      series: (series ?? '').toLocaleUpperCase('ro-RO'),
      fatherInitial: initiala,
      // Written as the registry writes it: the twelve values are the
      // secretariat's own vocabulary („Taxa”, „Buget RO”, „Bursier_RP”), and a
      // portal that renamed them would be describing a fact it does not own.
      funding: funding ?? '',
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
  /**
   * The fourth shape, and the registry's alone: a programme is not in a column.
   *
   * The export describes a cohort with four independent columns — cycle, form
   * of study, specialisation, language — while the portal's licență programme
   * IS the form of study. Joining the four with a separator would compose a
   * string that matches nothing; a constant would put all 893 students on one
   * programme. So this source names the four columns and lets
   * `deriveProgramme` answer, row by row.
   */
  | { kind: 'programme'; cycle: number; form: number; specialisation: number; language: number }

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
 * What each column is called in the files that actually arrive.
 *
 * `exact` matches the whole header, `loose` matches a word inside it, and
 * `weak` matches the whole header but loses to any exact one. The exact/loose
 * distinction exists because of „An”: as a whole header it is the year of
 * study, but as a fragment it is inside „Anul nașterii”, „An universitar” and
 * half the words in Romanian.
 *
 * The folding these are compared through lives in `import/students.ts` — and
 * with it the cut through `AnStudiu` and `FormaFinantare`, because the
 * registry's headers are the reason it has to do more than drop the marks.
 */
const HEADER_HINTS: { exact: string[]; weak?: string[]; loose: RegExp | null }[] = [
  {
    exact: ['nume', 'numele', 'nume complet', 'nume si prenume', 'numele studentului', 'student', 'nume student'],
    loose: /\bnume/,
  },
  {
    // „Adresa” alone is the e-mail in a sheet the secretariat wrote by hand,
    // and the postal address in the registry's export — which also carries an
    // „Email” column. Weak rather than exact so the real one always wins:
    // while both scored the same, the answer depended on which came first in
    // the file, and the wrong one refuses every row in the list.
    exact: ['email', 'e mail', 'mail', 'adresa de email', 'adresa email', 'adresa electronica'],
    weak: ['adresa'],
    loose: /\b(e ?mail|adresa de e ?mail|adresa electronica)\b/,
  },
  { exact: ['rol', 'calitate', 'tip'], loose: /\brol\b/ },
  { exact: ['nr matricol', 'numar matricol', 'matricol', 'marca'], loose: /matricol/ },
  {
    exact: ['program', 'program de studiu', 'programul de studiu', 'specializare', 'specializarea'],
    loose: /\b(program|specializar)/,
  },
  { exact: ['an', 'anul', 'an studiu', 'an de studiu', 'anul de studiu'], loose: null },
  { exact: ['grupa', 'grupa de studiu', 'gr'], loose: /\bgrup/ },
  { exact: ['serie', 'seria'], loose: /\bseri/ },
  {
    exact: ['initiala', 'initiale', 'initiala tatalui', 'initiala tata', 'tatal', 'initiala parintelui'],
    loose: /initial/,
  },
  {
    exact: ['finantare', 'forma finantare', 'forma de finantare', 'regim financiar'],
    loose: /finant/,
  },
]

/** „Program” — the field a registry export cannot fill from a single column. */
export const PROGRAMME_FIELD = 4

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
 *
 * Two columns it refuses to offer at all. The identity-card and domicile
 * headers are skipped outright (`isNeverMappedHeader`) — „SerieCI” matches the
 * study-series hint on the word „seri”, and an identity-card series in the
 * study series of a whole promotion is wrong in a way nothing downstream can
 * notice. And when the four cohort columns of a registry export are present,
 * „Program” is derived from them rather than taken from „Specializare”, which
 * at licență holds „Marketing” and matches no programme in the portal.
 */
export function guessAccountMapping(header: string[]): AccountMapping {
  const folded = header.map(foldForMatching)
  const used = new Set<number>()
  const mapping: AccountMapping = ACCOUNT_COLUMNS.map(() => ({ kind: 'none' }) as AccountFieldSource)

  const findColumn = (hints: (typeof HEADER_HINTS)[number]): number => {
    let best = -1
    let bestScore = 0
    folded.forEach((text, index) => {
      if (!text || used.has(index) || isNeverMappedHeader(header[index] ?? '')) return
      const score = hints.exact.includes(text)
        ? 3
        : hints.loose?.test(text)
          ? 2
          : hints.weak?.includes(text)
            ? 1
            : 0
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

  const registry = findRegistryColumns(header)
  if (registry) mapping[PROGRAMME_FIELD] = { kind: 'programme', ...registry }

  const givenName = folded.findIndex((t) => t === 'prenume' || /\bprenume\b/.test(t))
  const nameSource = mapping[0]
  if (givenName >= 0 && !used.has(givenName) && nameSource?.kind === 'columns') {
    mapping[0] = { kind: 'columns', columns: [...nameSource.columns, givenName], joiner: ' ' }
  }

  return mapping
}

/** One cell of one row, as the mapping composes it. */
function composeField(row: string[], source: AccountFieldSource): string {
  if (source.kind === 'constant') return normalizeRegistryCell(source.value)
  if (source.kind === 'programme') {
    /* An unrecognised cohort composes an empty cell rather than a refusal: the
     * import screen then names the value it could not place, in front of the
     * director, before anything is written. Refusing here would lose it. */
    return (
      deriveProgramme({
        cycle: row[source.cycle] ?? '',
        form: row[source.form] ?? '',
        specialisation: row[source.specialisation] ?? '',
        language: row[source.language] ?? '',
      })?.label ?? ''
    )
  }
  if (source.kind !== 'columns') return ''
  return source.columns
    .map((c) => normalizeRegistryCell(row[c]))
    .filter((v) => v !== '')
    .join(source.joiner)
    .trim()
}

/** The file's rows, in the portal's ten columns. */
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
