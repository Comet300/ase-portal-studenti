/**
 * The reader for archive rows.
 *
 * It sits apart for a precise reason: the same function reads the rows both in
 * the page, for the preview, and in the route, when writing. If the preview had
 * its own reader, it would show one correct table and a different one would be
 * imported — exactly the kind of difference nobody notices until it is in the
 * public archive.
 *
 * What comes from the client is never trusted: the preview is a courtesy, and
 * the route reads the submitted text again from scratch.
 */

/** The columns, in the order they are pasted in from the spreadsheet. */
export const ARCHIVE_COLUMNS = [
  'Nume student',
  'Număr matricol',
  'Program',
  'Nivel',
  'Limbă',
  'Coordonator',
  'Titlul lucrării',
  'Data susținerii',
] as const

export interface ArchiveImportRow {
  studentName: string
  studentNumber: string
  programme: string
  level: string
  language: string
  teacherName: string
  title: string
  /** ISO, or empty. */
  defended: string
}

export interface RejectedArchiveRow {
  /** The row number in the text, from 1 — the way a person counts it too. */
  numar: number
  text: string
  reason: string
}

export interface ParsedArchive {
  accepted: ArchiveImportRow[]
  rejected: RejectedArchiveRow[]
}

/**
 * Semicolon, not comma: Romanian names and titles contain commas far more often
 * than semicolons. A tab works just as well, because that is what a direct
 * paste from Excel produces.
 */
/**
 * A date that exists in the calendar as well.
 *
 * `new Date('2022-02-31')` does not return NaN: JavaScript rolls the date over
 * the month and gives 3 March. So the "is not NaN" check let any invented day
 * through, and Postgres's `::date` refused it only in the middle of the import
 * — exactly the failure the validation existed in order to prevent. The
 * components are compared with the reconstructed date: if they moved, the day
 * did not exist.
 */
function dateExists(iso: string): boolean {
  const [an, month, zi] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(an, month - 1, zi))
  return (
    d.getUTCFullYear() === an && d.getUTCMonth() === month - 1 && d.getUTCDate() === zi
  )
}

export function parseArchiveRows(raw: string): ParsedArchive {
  const accepted: ArchiveImportRow[] = []
  const rejected: RejectedArchiveRow[] = []

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const [index, line] of lines.entries()) {
    const numar = index + 1
    const cells = line.split(line.includes('\t') && !line.includes(';') ? '\t' : ';').map((c) => c.trim())
    const [studentName, studentNumber, programme, level, language, teacherName, title, defended] = cells

    if (!studentName || !teacherName || !title) {
      rejected.push({
        numar,
        text: line,
        reason: 'lipsește studentul, coordonatorul sau titlul',
      })
      continue
    }

    const data = (defended ?? '').trim()
    // ISO only: "iulie 2024" is not a date for Postgres, and `::date` raised the
    // exception only in the middle of the import.
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      rejected.push({ numar, text: line, reason: `data „${data}” nu este în formatul AAAA-LL-ZZ` })
      continue
    }
    if (data && !dateExists(data)) {
      rejected.push({ numar, text: line, reason: `data „${data}” nu există în calendar` })
      continue
    }

    accepted.push({
      studentName,
      studentNumber: studentNumber ?? '',
      programme: programme ?? '',
      level: level ?? '',
      language: language ?? '',
      teacherName,
      title,
      defended: data,
    })
  }

  return { accepted, rejected }
}

/** The level, as a secretary writes it: "master", "M", anything else is bachelor. */
export function parseArchiveLevel(text: string): 'bachelor' | 'master' {
  return ['master', 'm'].includes(text.trim().toLowerCase()) ? 'master' : 'bachelor'
}
