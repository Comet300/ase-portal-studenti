import { buildZip } from './zip.ts'

/**
 * One list, two files: .csv and .xlsx, from a single description of the columns.
 *
 * WHY BOTH. „Descarcă” means Excel to a secretariat, and Excel on a Romanian
 * Windows reads a UTF-8 .csv with the ANSI code page: `Ș` comes back as `ª`,
 * and a register of names nobody re-reads keeps the damage. The BOM in front of
 * the file fixes most of it, and the `;` separator matches the Romanian list
 * separator — but only .xlsx is UTF-8 by definition, so the workbook is the
 * honest answer and the csv is the one that opens anywhere else.
 *
 * WHY IT IS WRITTEN BY HAND. `tabular.ts` next door already *reads* .xlsx for
 * the same reason: the portal has four runtime dependencies, and the usual
 * workbook library is an order of magnitude larger than the portal. Writing is
 * the easier half — an .xlsx is a ZIP of four small XML files, and `zip.ts` is
 * the ZIP writer, also here, also hand-written.
 *
 * WHAT IT DOES NOT DO. No formats, no formulas, no column widths, no styles:
 * every cell is an inline string, including the ones that look like numbers.
 * A student number written as a number loses its leading zero, and a date
 * written as a serial becomes „45678” for whoever opens it — text is what a
 * register wants. `xl/styles.xml` is absent for the same reason: nothing here
 * needs it, and Excel is content without it.
 */

export interface Column<T> {
  /** The heading, in the words the screen uses. */
  header: string
  value: (row: T) => string | number | null | undefined
}

const text = (value: string | number | null | undefined): string =>
  value == null ? '' : String(value)

/**
 * A cell for the csv.
 *
 * Quoted only when it has to be: a semicolon, a quote or a line break inside a
 * field would otherwise shift every column after it. Quoting everything is also
 * valid, and the department export did exactly that — but a file where only the
 * three fields that need it carry quotes is one a person can read in a text
 * editor when the import goes wrong.
 */
export function csvCell(value: string | number | null | undefined): string {
  const s = text(value)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The whole csv: BOM, `;`, CRLF, and a final newline. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(';'),
    ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(';')),
  ]
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/**
 * XML text.
 *
 * The five predefined entities, plus the control characters XML 1.0 forbids
 * outright — a `\v` copied out of a spreadsheet into a name would produce a
 * workbook Excel refuses to open, with a message about unreadable content and
 * no mention of which cell.
 */
function xml(value: string): string {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** `A`, `B`, … `Z`, `AA` — the column's name in a cell reference. */
function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - rest) / 26)
  }
  return name
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

/**
 * The sheet's name, as Excel accepts it: at most 31 characters, without
 * `: \ / ? * [ ]`, and not empty. A refused name is a workbook that does not
 * open at all, so it is cut here rather than being passed on as written.
 */
function sheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31)
  return cleaned || 'Foaie1'
}

function worksheet<T>(columns: Column<T>[], rows: T[]): string {
  const row = (cells: string[], index: number) =>
    `<row r="${index}">` +
    cells
      .map(
        (value, c) =>
          `<c r="${columnName(c)}${index}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
      )
      .join('') +
    '</row>'

  const body = [
    row(columns.map((c) => c.header), 1),
    ...rows.map((r, i) => row(columns.map((c) => text(c.value(r))), i + 2)),
  ].join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** The workbook, as bytes. One sheet; that is all a list of students needs. */
export function toXlsx<T>(columns: Column<T>[], rows: T[], nume = 'Date'): Buffer {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(sheetName(nume))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const file = (nume: string, continut: string) => ({
    nume,
    bytes: Buffer.from(continut, 'utf8'),
  })

  return buildZip(
    [
      file('[Content_Types].xml', CONTENT_TYPES),
      file('_rels/.rels', ROOT_RELS),
      file('xl/workbook.xml', workbook),
      file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS),
      file('xl/worksheets/sheet1.xml', worksheet(columns, rows)),
    ],
    true,
  )
}

/**
 * A file name that survives the trip.
 *
 * `content-disposition` with a plain `filename=` carries only ASCII, so the
 * label of the year („2025–2026”, with an en dash) is scrubbed rather than sent
 * as bytes some proxy will mangle into a name nobody recognises.
 */
export function asciiFileName(nume: string): string {
  return nume.replace(/[^\x20-\x7e]+/g, '-').replace(/-+/g, '-')
}

export type SheetFormat = 'csv' | 'xlsx'

/** The format asked for in `?format=`, defaulting to the one Excel prefers. */
export function sheetFormat(value: string | null): SheetFormat {
  return value === 'csv' ? 'csv' : 'xlsx'
}

/**
 * The whole answer for an export route: bytes, type and file name, so that the
 * four routes that download a list cannot drift apart in their headers.
 */
export function sheetResponse<T>(
  format: SheetFormat,
  columns: Column<T>[],
  rows: T[],
  numeFisier: string,
): Response {
  const name = asciiFileName(numeFisier)

  if (format === 'csv') {
    return new Response(toCsv(columns, rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.csv"`,
      },
    })
  }

  const bytes = toXlsx(columns, rows, numeFisier)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.xlsx"`,
    },
  })
}
