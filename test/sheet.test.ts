import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asciiFileName, csvCell, sheetFormat, toCsv, toXlsx } from '../src/lib/sheet.ts'
import { readXlsx } from '../src/lib/tabular.ts'

/**
 * The two files a list turns into.
 *
 * The .xlsx is checked by reading it back with the portal's own reader — the
 * one the account import already uses — so the test proves the round trip a
 * secretariat actually performs: export, open, and in the worst case import
 * again.
 */

interface Student {
  name: string
  number: string | null
  programme: string
}

const columns = [
  { header: 'Student', value: (s: Student) => s.name },
  { header: 'Număr matricol', value: (s: Student) => s.number },
  { header: 'Program', value: (s: Student) => s.programme },
]

const rows: Student[] = [
  { name: 'Ștefan Ș. Popescu', number: '0123456', programme: 'Licență' },
  { name: 'Ana-Maria Lupu; sora', number: null, programme: 'Master' },
  { name: 'Ion "Ionuț" Marin', number: '9', programme: 'Licență' },
]

describe('csv', () => {
  it('începe cu BOM, ca Excel-ul românesc să citească diacriticele', () => {
    assert.equal(toCsv(columns, rows).charCodeAt(0), 0xfeff)
  })

  it('desparte cu punct și virgulă și termină rândurile cu CRLF', () => {
    const csv = toCsv(columns, rows)
    assert.match(csv, /Student;Număr matricol;Program\r\n/)
    assert.ok(csv.endsWith('\r\n'))
  })

  it('pune ghilimele doar unde ar sparge coloanele', () => {
    assert.equal(csvCell('Popescu'), 'Popescu')
    assert.equal(csvCell('Lupu; sora'), '"Lupu; sora"')
    assert.equal(csvCell('Ion "Ionuț"'), '"Ion ""Ionuț"""')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(0), '0')
  })

  it('scrie un rând gol ca celulă goală, nu ca „null”', () => {
    const linia = toCsv(columns, rows).split('\r\n')[2]
    assert.equal(linia, '"Ana-Maria Lupu; sora";;Master')
  })
})

describe('xlsx', () => {
  it('este o arhivă ZIP', () => {
    const bytes = toXlsx(columns, rows)
    assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  })

  it('se citește înapoi cu cititorul portalului, cu tot cu diacritice', async () => {
    const [sheet] = await readXlsx(toXlsx(columns, rows, 'Studenți'))

    assert.deepEqual(sheet.rows[0], ['Student', 'Număr matricol', 'Program'])
    assert.deepEqual(sheet.rows[1], ['Ștefan Ș. Popescu', '0123456', 'Licență'])
    assert.deepEqual(sheet.rows[3], ['Ion "Ionuț" Marin', '9', 'Licență'])
    assert.equal(sheet.rows.length, 4)
  })

  it('păstrează numărul matricol ca text, cu zeroul din față cu tot', async () => {
    const [sheet] = await readXlsx(toXlsx(columns, rows))
    assert.equal(sheet.rows[1][1], '0123456')
  })

  it('taie numele foii la ce acceptă Excel', async () => {
    const [sheet] = await readXlsx(toXlsx(columns, [], 'Studenții facultății / 2025–2026'))
    assert.ok(sheet.name.length <= 31)
    assert.doesNotMatch(sheet.name, /[:\\/?*[\]]/)
  })
})

describe('numele fișierului', () => {
  it('rămâne ASCII, ca antetul să nu ajungă mojibake', () => {
    assert.equal(asciiFileName('studenți-2025–2026'), 'studen-i-2025-2026')
  })

  it('implicit este workbook-ul, nu textul delimitat', () => {
    assert.equal(sheetFormat(null), 'xlsx')
    assert.equal(sheetFormat('csv'), 'csv')
    assert.equal(sheetFormat('altceva'), 'xlsx')
  })
})
