/**
 * The reader for the registrar's file: .xlsx and delimited text, into cells.
 *
 * It stops one step before meaning. It answers „what is written in the file”,
 * as a matrix of strings; who is a student and what their address is stays the
 * job of `accounts.ts`, which reads the composed rows again in the route. So
 * this module never decides anything about a person, and the same import goes
 * through exactly one validating reader whether it started as a paste or as a
 * file.
 *
 * WHY IT IS WRITTEN BY HAND. The portal has four runtime dependencies. The
 * candidates for reading a workbook are an order of magnitude larger than the
 * portal itself, and the maintained build of the usual one is no longer on the
 * npm registry. An .xlsx is a ZIP of XML, and the ZIP *writer* next door
 * (`zip.ts`) was written by hand for the same reason; reading is the easier
 * half — the end record, the central directory, then `deflate-raw`, which the
 * platform decompresses on its own through `DecompressionStream`. That last
 * point is what decides it: no `node:zlib` import means one reader that runs
 * unchanged in the browser and in the route.
 *
 * WHY NOT „SAVE AS CSV”. Telling a Romanian secretariat to save as CSV is what
 * creates the encoding damage: Excel on a Romanian Windows writes the ANSI code
 * page, and the bytes E3 BA FE come back as `ăşţ` at best, `ãºþ` when read as
 * Western — mangled names in a register nobody re-reads. OOXML is UTF-8 by
 * definition, so the .xlsx the director already has is the *safer* path. CSV is
 * read too, with the encoding detected and shown, never guessed silently.
 *
 * WHAT IT DOES NOT DO. Number formats: a date cell comes back as the serial
 * number Excel stores („45678”), because the date-ness lives in `styles.xml`.
 * None of the fields an account needs is a date, but anything reading a date
 * out of a workbook has to parse the styles first.
 */

/**
 * The ceiling on a single import.
 *
 * A promotion is two hundred rows. Twenty thousand is a whole-faculty export
 * pasted in by mistake — a refusal that names the number is more useful than a
 * frozen tab, and the route repeats the check because the browser is not a
 * defence.
 */
export const MAX_IMPORT_ROWS = 1000

/** A zip bomb is a few kilobytes on the way in. This is what it may become. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

export type TextEncodingLabel =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1250'
  | 'windows-1252'

/** How the encoding is written where the director reads it. */
export const ENCODING_LABELS: Record<TextEncodingLabel, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'Unicode (UTF-16)',
  'utf-16be': 'Unicode (UTF-16)',
  'windows-1250': 'Windows-1250 (Europa Centrală)',
  'windows-1252': 'Windows-1252 (Europa Occidentală)',
}

export interface TabularSheet {
  name: string
  rows: string[][]
}

export interface TabularDocument {
  kind: 'xlsx' | 'text'
  sheets: TabularSheet[]
  /** Null for a workbook: OOXML is UTF-8 and there is nothing to detect. */
  encoding: TextEncodingLabel | null
  /** The delimiter actually used, for text. Null for a workbook. */
  delimiter: string | null
}

/* --- the text and its alphabet ---------------------------------------------- */

/**
 * The Romanian letters written the one way the portal writes them.
 *
 * `ş` U+015F and `ţ` U+0163 carry a cedilla and belong to Turkish; Romanian
 * uses the comma-below `ș` U+0219 and `ț` U+021B. Windows-1250 has only the
 * cedilla pair, so every file saved out of Excel on a Romanian machine arrives
 * in the wrong alphabet. Two alphabets inside one register is the kind of wrong
 * nobody notices until a name is searched for and does not come back.
 */
export function normalizeRomanian(text: string): string {
  return text
    .replace(/ş/g, 'ș')
    .replace(/Ş/g, 'Ș')
    .replace(/ţ/g, 'ț')
    .replace(/Ţ/g, 'Ț')
    .replace(/ /g, ' ')
}

/** Trimmed, in one alphabet, on a single line — a cell, as the reader wants it. */
function cleanCell(raw: string): string {
  return normalizeRomanian(raw).replace(/[\r\n\t]+/g, ' ').trim()
}

/**
 * The encoding, detected rather than asked for.
 *
 * The order matters. A BOM is a statement, so it wins. UTF-8 is
 * self-validating — an eight-bit legacy text essentially never passes a strict
 * decode by accident — so `fatal: true` separates it from everything else
 * without a heuristic.
 *
 * What is left is an ANSI page, and it is *not* scored against Windows-1252.
 * Scoring the two by how many Romanian letters they yield sounds right and is
 * pointless: Windows-1252 has no `ă`, no `ș` and no `ț` at all, so 1250 wins
 * every comparison by construction and the branch would be dead code. The same
 * bytes read `ăâîşţ` under 1250 and `ãâîºþ` under 1252, and 1250 is what a
 * Romanian Windows writes — so that is the fallback, said out loud on the
 * screen with a decoded name beside it, and overridable by hand for the file
 * that really did come from a Western machine.
 */
export function decodeTabularText(
  bytes: Uint8Array,
  forced?: TextEncodingLabel,
): { text: string; encoding: TextEncodingLabel } {
  if (forced) return { text: stripBom(decodeWith(bytes, forced)), encoding: forced }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeWith(bytes.subarray(3), 'utf-8'), encoding: 'utf-8' }
  }
  // Excel's „Unicode Text (*.txt)” — UTF-16, tab-delimited.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16le'), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16be'), encoding: 'utf-16be' }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf-8' }
  } catch {
    /* Not UTF-8. What is left is one of the two ANSI pages Excel writes. */
  }

  return { text: decodeWith(bytes, 'windows-1250'), encoding: 'windows-1250' }
}

function decodeWith(bytes: Uint8Array, label: TextEncodingLabel): string {
  return new TextDecoder(label).decode(bytes)
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/* --- delimited text --------------------------------------------------------- */

const DELIMITERS = [';', '\t', ',', '|'] as const

/**
 * A real reader, not `split`.
 *
 * Our own exports quote a field that contains a semicolon or a newline, so
 * without this the portal could not read back what it had just written; and one
 * name written „Popescu, Ion” shifts every column after it for the rest of the
 * row. Quoting follows the CSV convention: a quote opens a field only at its
 * start, `""` inside is a literal quote, and delimiters and line breaks inside
 * quotes are text.
 *
 * Rows with nothing in them are dropped, as in the paste reader: a spreadsheet
 * always ends with a few of them and nobody counts them when they say „row 12”.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endCell = () => {
    row.push(cleanCell(cell))
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"' && cell === '') {
      quoted = true
      continue
    }
    if (ch === delimiter) {
      endCell()
      continue
    }
    if (ch === '\r') {
      // CRLF is one line break, not two: Excel writes CRLF, the web writes LF.
      if (text[i + 1] === '\n') i++
      endRow()
      continue
    }
    if (ch === '\n') {
      endRow()
      continue
    }
    cell += ch
  }
  endRow()

  return rows.filter((r) => r.some((c) => c !== ''))
}

/**
 * Which character separates the columns.
 *
 * Counting occurrences is not enough — a list of theses contains more commas
 * than any delimiter. What tells a delimiter apart is that it produces the
 * *same* number of columns on every line: the candidate is judged by how many
 * rows agree on the column count, and only then by how many columns that is.
 * Romanian Excel writes `;`, so ties go to it, in the order below.
 */
export function sniffDelimiter(text: string): string {
  // A sample is enough, and it keeps four parses of a large file cheap.
  const sample = text.slice(0, 64 * 1024)
  let best = { delimiter: DELIMITERS[0] as string, score: -1 }

  for (const candidate of DELIMITERS) {
    const rows = parseDelimited(sample, candidate).slice(0, 30)
    if (rows.length === 0) continue

    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)

    let columns = 1
    let agreeing = 0
    for (const [n, times] of counts) {
      if (times > agreeing || (times === agreeing && n > columns)) {
        columns = n
        agreeing = times
      }
    }
    if (columns < 2) continue

    const score = (agreeing / rows.length) * Math.min(columns, 12)
    if (score > best.score) best = { delimiter: candidate, score }
  }

  return best.delimiter
}

/* --- the workbook ----------------------------------------------------------- */

interface ZipEntryRecord {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

const REFUSE_XLSX =
  'Salvează fișierul din nou ca .xlsx din Excel, sau lipește coloanele în caseta de mai jos.'

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8)
}
function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
}

/**
 * The central directory, read from the end backwards.
 *
 * The end record is the only structure whose position is knowable: it sits last
 * and can carry a comment of up to 64 KB, so it is found by scanning back for
 * its signature. Sizes are taken from the directory and never from the local
 * header — an entry written by a streaming producer leaves zeroes there and
 * puts the real numbers in a descriptor *after* the data, which is unreadable
 * without first knowing how long the data is.
 */
function readZipDirectory(bytes: Uint8Array): ZipEntryRecord[] {
  const limit = Math.max(0, bytes.length - 22 - 0xffff)
  let end = -1
  for (let i = bytes.length - 22; i >= limit; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error(`Fișierul nu este un .xlsx valid. ${REFUSE_XLSX}`)

  const count = u16(bytes, end + 10)
  const directoryOffset = u32(bytes, end + 16)
  /* Zip64 keeps the real numbers in a separate record. A sheet of two hundred
   * rows never reaches four gigabytes, so rather than read a format this will
   * never meet, it refuses and says what to do. */
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error(`Fișierul este salvat în format Zip64, pe care portalul nu îl citește. ${REFUSE_XLSX}`)
  }

  const entries: ZipEntryRecord[] = []
  let at = directoryOffset
  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) break
    const nameLength = u16(bytes, at + 28)
    const extraLength = u16(bytes, at + 30)
    const commentLength = u16(bytes, at + 32)
    entries.push({
      name: new TextDecoder('utf-8').decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: u16(bytes, at + 10),
      compressedSize: u32(bytes, at + 20),
      uncompressedSize: u32(bytes, at + 24),
      localOffset: u32(bytes, at + 42),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * One entry's bytes.
 *
 * The local header's own name and extra lengths are read again here and are not
 * the ones from the directory: they legitimately differ — a producer may put an
 * alignment field in one and not the other — and using the directory's lengths
 * lands the read a few bytes inside the data. It is the single trap in reading
 * a ZIP.
 */
async function readZipEntry(bytes: Uint8Array, entry: ZipEntryRecord): Promise<string> {
  if (entry.uncompressedSize > MAX_INFLATED_BYTES) {
    throw new Error(`Fișierul este prea mare pentru a fi citit în pagină. ${REFUSE_XLSX}`)
  }
  const at = entry.localOffset
  if (u32(bytes, at) !== 0x04034b50) throw new Error(`Fișierul .xlsx este deteriorat. ${REFUSE_XLSX}`)

  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28)
  const raw = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return new TextDecoder('utf-8').decode(raw)
  if (entry.method !== 8) {
    throw new Error(`Fișierul .xlsx folosește o compresie necunoscută. ${REFUSE_XLSX}`)
  }
  return new TextDecoder('utf-8').decode(await inflateRaw(raw))
}

/* --- the XML inside it ------------------------------------------------------- */

/**
 * The XML is swept with regular expressions, not parsed.
 *
 * A worksheet is a flat sequence of `<row>` and `<c>`; there is no recursion to
 * follow and no namespace to resolve, so a parser would be a dependency (or a
 * `DOMParser`, which does not exist on the server) bought for nothing.
 */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    // Excel escapes the line breaks a cell may contain; they become spaces in
    // `cleanCell` anyway, but as literal `_x000D_` they would be printed.
    .replace(/_x000D_/g, ' ')
    .replace(/_x000A_/g, ' ')
    .replace(/&amp;/g, '&')
}

function attribute(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`))
  return m ? decodeXml(m[1]!) : null
}

/** „AB” → 27: the column letters, base 26 with no zero. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? ''
  let n = 0
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

/**
 * The shared strings, in one pass.
 *
 * The runs of one string are concatenated: a name where the secretariat bolded
 * the family name is stored as several `<t>` inside one `<si>`, and taking only
 * the first would import half of it.
 */
function readSharedStrings(xml: string): string[] {
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? []
  return items.map((si) =>
    (si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((t) => decodeXml(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')))
      .join(''),
  )
}

function readSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowTags = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []

  for (const rowTag of rowTags) {
    const cells: string[] = []
    const cellTags = rowTag.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []
    let next = 0

    for (const cellTag of cellTags) {
      const head = cellTag.match(/^<c\b[^>]*?\/?>/)?.[0] ?? ''
      const reference = attribute(head, 'r')
      // A cell without `r=` follows the previous one; with it, the gaps in a
      // sparse row are real empty columns and have to stay empty.
      const at = reference ? columnIndex(reference) : next
      next = at + 1
      while (cells.length < at) cells.push('')

      const type = attribute(head, 't')
      let value = ''
      if (type === 'inlineStr') {
        value = (cellTag.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((t) => decodeXml(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')))
          .join('')
      } else {
        const v = cellTag.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
        const raw = v ? decodeXml(v[1]!) : ''
        value = type === 's' ? (shared[Number(raw)] ?? '') : raw
      }
      cells[at] = cleanCell(value)
    }
    rows.push(cells)
  }

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  return rows
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
    .filter((r) => r.some((c) => c !== ''))
}

/** The sheets in the order the tabs are shown, which is not the file order. */
function sheetOrder(workbookXml: string, relsXml: string): { name: string; path: string }[] {
  const targets = new Map<string, string>()
  for (const tag of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = attribute(tag, 'Id')
    const target = attribute(tag, 'Target')
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  }

  const sheets: { name: string; path: string }[] = []
  for (const tag of workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = attribute(tag, 'name') ?? 'Foaie'
    const id = attribute(tag, 'r:id') ?? attribute(tag, 'id')
    const target = id ? targets.get(id) : undefined
    if (target) sheets.push({ name, path: `xl/${target}` })
  }
  return sheets
}

export async function readXlsx(bytes: Uint8Array): Promise<TabularSheet[]> {
  const entries = readZipDirectory(bytes)
  const find = (name: string) => entries.find((e) => e.name === name)
  const read = async (name: string) => {
    const entry = find(name)
    return entry ? readZipEntry(bytes, entry) : ''
  }

  const shared = readSharedStrings(await read('xl/sharedStrings.xml'))
  const workbookXml = await read('xl/workbook.xml')
  const relsXml = await read('xl/_rels/workbook.xml.rels')

  let wanted = workbookXml && relsXml ? sheetOrder(workbookXml, relsXml) : []
  if (wanted.length === 0) {
    // A workbook with no readable index: the worksheets are taken in file
    // order, which is right often enough and wrong visibly — the sheet picker
    // shows the names.
    wanted = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      .map((e) => ({ name: e.name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, ''), path: e.name }))
  }
  if (wanted.length === 0) throw new Error(`Fișierul nu conține nicio foaie de calcul. ${REFUSE_XLSX}`)

  const sheets: TabularSheet[] = []
  for (const sheet of wanted) {
    const entry = find(sheet.path)
    if (!entry) continue
    sheets.push({ name: sheet.name, rows: readSheet(await readZipEntry(bytes, entry), shared) })
  }
  if (sheets.length === 0) throw new Error(`Fișierul nu conține nicio foaie de calcul. ${REFUSE_XLSX}`)
  return sheets
}

/* --- the one entry point ----------------------------------------------------- */

/**
 * A file, whatever it is, as sheets of cells.
 *
 * The kind is decided by the first bytes and not by the name: a `.csv` renamed
 * from a workbook is a common way to lose an afternoon, and the message that
 * names the real format is what ends it.
 */
export async function readTabular(
  fileName: string,
  bytes: Uint8Array,
  options: { encoding?: TextEncodingLabel; delimiter?: string } = {},
): Promise<TabularDocument> {
  if (bytes.length === 0) throw new Error('Fișierul este gol.')

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const sheets = await readXlsx(bytes)
    countRows(sheets)
    return { kind: 'xlsx', sheets, encoding: null, delimiter: null }
  }
  /* The old binary Excel format. It is not a ZIP and has nothing in common with
   * one; it gets its own sentence because „nu este un .xlsx valid” would send
   * the director looking for a broken file instead of pressing „Save as”. */
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new Error(
      'Fișierul este în formatul vechi .xls. Deschide-l în Excel și salvează-l ca .xlsx sau .csv.',
    )
  }

  const { text, encoding } = decodeTabularText(bytes, options.encoding)
  const delimiter = options.delimiter ?? sniffDelimiter(text)
  const rows = parseDelimited(text, delimiter)
  if (rows.length === 0) throw new Error('Fișierul nu conține niciun rând.')

  const sheets = [{ name: fileName || 'Fișier', rows }]
  countRows(sheets)
  return { kind: 'text', sheets, encoding, delimiter }
}

function countRows(sheets: TabularSheet[]): void {
  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `Foaia „${sheet.name}” are ${sheet.rows.length} rânduri, peste limita de ${MAX_IMPORT_ROWS} pentru un import. Împarte fișierul pe promoții.`,
      )
    }
  }
}
