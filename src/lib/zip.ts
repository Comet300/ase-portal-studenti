import { crc32 } from 'node:zlib'

/**
 * A ZIP without compression, written by hand.
 *
 * The reason it is not a dependency: the portal has three — `pg`, `resend`,
 * `astro` — and the only thing asked for here is to put ten files into an
 * envelope. The „store” method (0) compresses nothing, so it needs no algorithm
 * at all: it is only header, bytes, header, bytes, then a directory at the end.
 * The chapters of a thesis are .docx and .pdf anyway, that is, already
 * compressed — a deflate over them would win percentages and would bring in a
 * whole algorithm.
 *
 * The format is PKZIP APPNOTE 6.3.3, the part of it without which nothing opens
 * the archive: the signatures 0x04034b50 (file), 0x02014b50 (directory),
 * 0x06054b50 (end). It is written with Zip64 always absent, so the limit is
 * 4 GB per archive and 65,535 files; a conversation reaches neither, and the
 * 15 MB per file ceiling keeps it far from both.
 *
 * The date is written in the local header, not in the descriptor at the end:
 * the size and the CRC are known beforehand, because the files come from
 * memory.
 */

export interface ZipEntry {
  /** The name inside the archive. Cleaned here: separators would create folders. */
  nume: string
  bytes: Buffer
  /** The file's date, for what the archive shows when opened. */
  date?: Date
}

/**
 * The time in MS-DOS format: two bytes for the time, two for the date, with the
 * second divided by two (the format has five bits for it) and the years counted
 * from 1980. It is what every archiving program understands, Windows included.
 */
function dosTimestamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * A cleaned entry name.
 *
 * A `/` would create a folder, a `..` would climb out of it, and an empty name
 * would produce an entry that some programs refuse to extract. The original
 * names come from whoever uploaded the file, so they cannot be taken at their
 * word.
 */
function safeName(nume: string, fallback: string): string {
  const cleaned = nume
    .replace(/[/\\]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 180)
  return cleaned || fallback
}

/**
 * The names made unique inside the archive.
 *
 * Two students send „capitolul 2.docx” in the same conversation, or the same
 * student sends it twice: in one archive there would be two entries with one
 * name, and unzipping would keep one. The second one gets an index.
 */
function uniqueNames(nume: string[]): string[] {
  const seen = new Map<string, number>()
  return nume.map((n) => {
    const key = n.toLowerCase()
    const seenCount = seen.get(key) ?? 0
    seen.set(key, seenCount + 1)
    if (seenCount === 0) return n
    const dot = n.lastIndexOf('.')
    return dot > 0
      ? `${n.slice(0, dot)} (${seenCount + 1})${n.slice(dot)}`
      : `${n} (${seenCount + 1})`
  })
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  const cleanNames = uniqueNames(
    entries.map((i, idx) => safeName(i.nume, `fisier-${idx + 1}.bin`)),
  )

  entries.forEach((entry, idx) => {
    const nume = Buffer.from(cleanNames[idx], 'utf8')
    const checksum = crc32(entry.bytes)
    const size = entry.bytes.byteLength
    const { time, date } = dosTimestamp(entry.date ?? new Date())

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // minimum version: 2.0
    // Bit 11 says the name is UTF-8; without it the diacritics end up mojibake.
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8) // method: store
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(size, 18)
    localHeader.writeUInt32LE(size, 22)
    localHeader.writeUInt16LE(nume.byteLength, 26)
    localHeader.writeUInt16LE(0, 28) // no extra fields

    const directoryRecord = Buffer.alloc(46)
    directoryRecord.writeUInt32LE(0x02014b50, 0)
    directoryRecord.writeUInt16LE(20, 4) // written by version 2.0
    directoryRecord.writeUInt16LE(20, 6)
    directoryRecord.writeUInt16LE(0x0800, 8)
    directoryRecord.writeUInt16LE(0, 10)
    directoryRecord.writeUInt16LE(time, 12)
    directoryRecord.writeUInt16LE(date, 14)
    directoryRecord.writeUInt32LE(checksum, 16)
    directoryRecord.writeUInt32LE(size, 20)
    directoryRecord.writeUInt32LE(size, 24)
    directoryRecord.writeUInt16LE(nume.byteLength, 28)
    directoryRecord.writeUInt16LE(0, 30)
    directoryRecord.writeUInt16LE(0, 32)
    directoryRecord.writeUInt16LE(0, 34)
    directoryRecord.writeUInt16LE(0, 36)
    directoryRecord.writeUInt32LE(0, 38)
    directoryRecord.writeUInt32LE(offset, 42)

    parts.push(localHeader, nume, entry.bytes)
    directory.push(directoryRecord, nume)
    offset += localHeader.byteLength + nume.byteLength + size
  })

  const directoryBytes = Buffer.concat(directory)

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4) // a single volume
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(entries.length, 8)
  endRecord.writeUInt16LE(entries.length, 10)
  endRecord.writeUInt32LE(directoryBytes.byteLength, 12)
  endRecord.writeUInt32LE(offset, 16)
  endRecord.writeUInt16LE(0, 20) // no comment

  return Buffer.concat([...parts, directoryBytes, endRecord])
}
