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
    const sep = line.includes('\t') && !line.includes(';') ? '\t' : ';'
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
