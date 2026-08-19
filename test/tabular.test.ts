import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import {
  MAX_IMPORT_ROWS,
  decodeTabularText,
  normalizeRomanian,
  parseDelimited,
  readTabular,
  sniffDelimiter,
} from '../src/lib/tabular.ts'

/**
 * The reader of the registrar's file.
 *
 * Everything here is about a file that arrives wrong: saved on a Romanian
 * Windows, with a comma inside a name, with the columns of a sheet nobody
 * cleaned up. A row read wrongly becomes a person who cannot sign in, or worse,
 * a name spelled in an alphabet the portal does not use — so the reader is
 * tested on the failures, not on the file that was already correct.
 */

/* --- a workbook, built here ---------------------------------------------------
 *
 * There is no .xlsx fixture on disk: a binary file in the repository is one
 * nobody can read in a diff, and the point is precisely to prove that the
 * bytes a spreadsheet writes come back as cells. So the test writes a real
 * one — deflate-compressed, with shared strings, exactly as Excel does. */

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface ZipInput {
  name: string
  text: string
  /** „store”, to prove the reader accepts an uncompressed entry too. */
  stored?: boolean
}

async function buildZip(files: ZipInput[]): Promise<Uint8Array> {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const raw = Buffer.from(f.text, 'utf8')
    const data = f.stored ? raw : Buffer.from(await deflateRaw(raw))
    const sum = crc32(raw)

    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(f.stored ? 0 : 8, 8)
    head.writeUInt32LE(sum, 14)
    head.writeUInt32LE(data.byteLength, 18)
    head.writeUInt32LE(raw.byteLength, 22)
    head.writeUInt16LE(name.byteLength, 26)
    // An extra field in the local header and not in the central one: this is
    // the difference that makes a reader land inside the data if it reuses the
    // directory's lengths.
    const extra = Buffer.alloc(4)
    head.writeUInt16LE(extra.byteLength, 28)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(f.stored ? 0 : 8, 10)
    record.writeUInt32LE(sum, 16)
    record.writeUInt32LE(data.byteLength, 20)
    record.writeUInt32LE(raw.byteLength, 24)
    record.writeUInt16LE(name.byteLength, 28)
    record.writeUInt32LE(offset, 42)

    local.push(head, name, extra, data)
    central.push(record, name)
    offset += head.byteLength + name.byteLength + extra.byteLength + data.byteLength
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.byteLength, 12)
  end.writeUInt32LE(offset, 16)

  return new Uint8Array(Buffer.concat([...local, directory, end]))
}

const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
  <si><t>Nume</t></si>
  <si><t>Prenume</t></si>
  <si><t>E-mail</t></si>
  <si><r><t>Ștefă</t></r><r><t>nescu</t></r></si>
  <si><t>Ioana</t></si>
  <si><t>Țîrlea &amp; Fiii</t></si>
</sst>`

const SHEET_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="inlineStr"><is><t>ioana@stud.ase.ro</t></is></c><c r="E2"><v>3</v></c></row>
    <row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3" t="str"><v>fiii@x.ro</v></c></row>
  </sheetData>
</worksheet>`

const SHEET_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Restanțieri</t></is></c></row></sheetData>
</worksheet>`

/** The tab order is „Situație” first, and it is the second file in the archive. */
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Situație" sheetId="1" r:id="rId2"/>
    <sheet name="Restanțieri" sheetId="2" r:id="rId1"/>
  </sheets>
</workbook>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Target="sharedStrings.xml"/>
</Relationships>`

function workbookFiles(): ZipInput[] {
  return [
    { name: '[Content_Types].xml', text: '<Types/>', stored: true },
    { name: 'xl/workbook.xml', text: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', text: RELS },
    { name: 'xl/sharedStrings.xml', text: SHARED_STRINGS },
    { name: 'xl/worksheets/sheet1.xml', text: SHEET_TWO },
    { name: 'xl/worksheets/sheet2.xml', text: SHEET_ONE },
  ]
}

/* --- the encoding ------------------------------------------------------------ */

describe('decodeTabularText', () => {
  it('taie BOM-ul, ca prima coloană să nu înceapă cu un caracter invizibil', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('Nume;Email', 'utf8')])
    const { text, encoding } = decodeTabularText(bytes)
    assert.equal(text, 'Nume;Email')
    assert.equal(encoding, 'utf-8')
  })

  it('recunoaște UTF-8 curat', () => {
    assert.deepEqual(decodeTabularText(new Uint8Array(Buffer.from('Ștefănescu', 'utf8'))), {
      text: 'Ștefănescu',
      encoding: 'utf-8',
    })
  })

  /* Exactly what Excel writes on a Romanian Windows through „Salvează ca CSV”.
     Read as UTF-8 it is invalid; read as Western it is „ãºþ”. */
  it('citește un fișier salvat de Excel românesc ca Windows-1250', () => {
    const bytes = new Uint8Array([0xe3, 0xe2, 0xee, 0xba, 0xfe])
    const { text, encoding } = decodeTabularText(bytes)
    assert.equal(encoding, 'windows-1250')
    assert.equal(text, 'ăâîşţ')
  })

  /* Windows-1252 has no ă, no ș and no ț, so it can never win a comparison
     counting Romanian letters. It stays a human decision, and that decision is
     obeyed exactly. */
  it('nu ghicește Windows-1252, dar îl acceptă când e cerut', () => {
    const bytes = new Uint8Array([0xe3, 0xba, 0xfe])
    assert.equal(decodeTabularText(bytes).encoding, 'windows-1250')
    assert.equal(decodeTabularText(bytes, 'windows-1252').text, 'ãºþ')
  })

  it('citește „Unicode Text” salvat din Excel, cu BOM UTF-16', () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from('Nume\tEmail', 'utf16le')])
    assert.equal(decodeTabularText(bytes).text, 'Nume\tEmail')
  })

  it('respectă codificarea impusă de om, când ghicitul a greșit', () => {
    const bytes = new Uint8Array([0xba])
    assert.equal(decodeTabularText(bytes, 'windows-1252').text, 'º')
  })
})

describe('normalizeRomanian', () => {
  /* The cedilla comes from Windows-1250 and from old files; the portal writes
     the comma below everywhere. Two alphabets in one register means a name that
     is no longer found when it is searched for. */
  it('trece cedila în virgulă dedesubt', () => {
    assert.equal(normalizeRomanian('Ştefan Ţîrlea'), 'Ștefan Țîrlea')
  })
})

/* --- delimited text ----------------------------------------------------------- */

describe('parseDelimited', () => {
  it('ține virgula dinăuntrul ghilimelelor în aceeași celulă', () => {
    assert.deepEqual(parseDelimited('"Popescu, Ion";ion@x.ro', ';'), [['Popescu, Ion', 'ion@x.ro']])
  })

  it('ține și rândul nou dinăuntrul ghilimelelor', () => {
    assert.deepEqual(parseDelimited('"Ana\nMaria";ana@x.ro\nBogdan;b@x.ro', ';'), [
      ['Ana Maria', 'ana@x.ro'],
      ['Bogdan', 'b@x.ro'],
    ])
  })

  it('citește ghilimeaua dublată ca ghilimea', () => {
    assert.deepEqual(parseDelimited('"Zisă ""mica""";x@x.ro', ';'), [['Zisă "mica"', 'x@x.ro']])
  })

  it('CRLF este o singură trecere la rând nou', () => {
    assert.deepEqual(parseDelimited('a;b\r\nc;d\r\n', ';'), [
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('sare peste rândurile goale de la coada fișierului', () => {
    assert.deepEqual(parseDelimited('a;b\n;\n\n', ';'), [['a', 'b']])
  })

  it('poate citi înapoi ce exportă portalul', () => {
    // export-coordonari.ts quotes only where it must, with „;” and CRLF.
    const exported = 'Nume;Titlu\r\nAna Pop;"Marketing, teorie și practică"\r\n'
    assert.deepEqual(parseDelimited(exported, ';'), [
      ['Nume', 'Titlu'],
      ['Ana Pop', 'Marketing, teorie și practică'],
    ])
  })
})

describe('sniffDelimiter', () => {
  it('alege punctul și virgula, chiar dacă sunt mai multe virgule în text', () => {
    const text = 'Nume;Titlu\nAna Pop;Marketing, teorie, practică\nBogdan Ilie;Preț, cost, valoare'
    assert.equal(sniffDelimiter(text), ';')
  })

  it('alege virgula când ea este cea care taie coloane egale', () => {
    assert.equal(sniffDelimiter('a,b,c\nd,e,f\ng,h,i'), ',')
  })

  it('alege tabul, adică lipirea directă din Excel', () => {
    assert.equal(sniffDelimiter('Nume\tEmail\nAna\tana@x.ro'), '\t')
  })
})

/* --- the whole file ------------------------------------------------------------ */

describe('readTabular', () => {
  it('citește un .xlsx adevărat, cu deflate și șiruri partajate', async () => {
    const bytes = await buildZip(workbookFiles())
    const doc = await readTabular('registru.xlsx', bytes)

    assert.equal(doc.kind, 'xlsx')
    assert.equal(doc.encoding, null)
    // The order is the one in workbook.xml, not the order of the files in the
    // archive.
    assert.deepEqual(doc.sheets.map((s) => s.name), ['Situație', 'Restanțieri'])

    const rows = doc.sheets[0]!.rows
    assert.deepEqual(rows[0], ['Nume', 'Prenume', 'E-mail', '', ''])
    // A name written in two runs inside one „si” comes back whole, and the row
    // that skips column D stays empty exactly there.
    assert.deepEqual(rows[1], ['Ștefănescu', 'Ioana', 'ioana@stud.ase.ro', '', '3'])
    assert.deepEqual(rows[2], ['Țîrlea & Fiii', '', 'fiii@x.ro', '', ''])
  })

  it('citește și o intrare necomprimată, și una cu câmp suplimentar în antetul local', async () => {
    // „[Content_Types].xml” is written with „store”; were the lengths read from
    // the central directory instead of the local header, the read would start
    // four bytes early and the XML would be unreadable.
    const doc = await readTabular('x.xlsx', await buildZip(workbookFiles()))
    assert.equal(doc.sheets.length, 2)
  })

  it('refuză formatul vechi .xls și spune ce e de făcut', async () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])
    await assert.rejects(() => readTabular('vechi.xls', bytes), /salvează-l ca \.xlsx/i)
  })

  it('refuză un fișier care nu e nici arhivă, nici tabel', async () => {
    await assert.rejects(() => readTabular('gol.csv', new Uint8Array()), /gol/i)
  })

  it('citește un CSV cu BOM și punct și virgulă, ca cel salvat din Excel', async () => {
    const text = 'Nume;Email\r\nȘtefănescu Ioana;ioana@stud.ase.ro\r\n'
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(text, 'utf8')])
    const doc = await readTabular('lista.csv', bytes)

    assert.equal(doc.kind, 'text')
    assert.equal(doc.encoding, 'utf-8')
    assert.equal(doc.delimiter, ';')
    assert.deepEqual(doc.sheets[0]!.rows[1], ['Ștefănescu Ioana', 'ioana@stud.ase.ro'])
  })

  it('refuză un fișier peste plafon în loc să înghețe pagina', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Ana ${i};ana${i}@x.ro`)
    const bytes = new Uint8Array(Buffer.from(rows.join('\n'), 'utf8'))
    await assert.rejects(() => readTabular('mare.csv', bytes), new RegExp(String(MAX_IMPORT_ROWS)))
  })
})
