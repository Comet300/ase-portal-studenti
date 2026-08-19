import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArchiveRows, parseArchiveLevel } from '../src/lib/archive.ts'

/**
 * The reader for archive rows.
 *
 * The same function reads what is shown in the preview and what is written into
 * the public archive. If the two came apart, the preview would show one correct
 * table and a different one would be imported — which is why the tests here are
 * about what it *rejects*, not only about what it accepts: every rejection is a
 * row that does not end up wrong in a register the whole faculty reads.
 */

const GOOD_ROW =
  'Ana Petre;MK-2021-0142;Marketing strategic;master;ro;Conf. univ. dr. Cristian Vasile;Strategii de preț;2022-07-05'

describe('parseArchiveRows', () => {
  it('citește un rând complet', () => {
    const { accepted, rejected } = parseArchiveRows(GOOD_ROW)
    assert.equal(rejected.length, 0)
    assert.deepEqual(accepted[0], {
      studentName: 'Ana Petre',
      studentNumber: 'MK-2021-0142',
      programme: 'Marketing strategic',
      level: 'master',
      language: 'ro',
      teacherName: 'Conf. univ. dr. Cristian Vasile',
      title: 'Strategii de preț',
      defended: '2022-07-05',
    })
  })

  it('cere studentul, coordonatorul și titlul; restul sunt opționale', () => {
    const { accepted, rejected } = parseArchiveRows(
      ['Ana Petre;;;;;Cristian Vasile;Un titlu;', 'Ana Petre;;;;;;Un titlu;', ';;;;;Cristian Vasile;Un titlu;'].join(
        '\n',
      ),
    )
    assert.equal(accepted.length, 1, 'doar primul are toate trei')
    assert.equal(rejected.length, 2)
    assert.match(rejected[0].reason, /studentul, coordonatorul sau titlul/)
  })

  it('respinge o dată scrisă în cuvinte, în loc să o dea Postgresului', () => {
    const { accepted, rejected } = parseArchiveRows(GOOD_ROW.replace('2022-07-05', 'iulie 2022'))
    assert.equal(accepted.length, 0)
    assert.match(rejected[0].reason, /AAAA-LL-ZZ/)
    assert.ok(rejected[0].reason.includes('iulie 2022'), 'motivul citează valoarea')
  })

  it('respinge o dată care arată ISO dar nu există în calendar', () => {
    const { accepted, rejected } = parseArchiveRows(GOOD_ROW.replace('2022-07-05', '2022-02-31'))
    assert.equal(accepted.length, 0)
    assert.match(rejected[0].reason, /nu există în calendar/)
  })

  it('acceptă un rând fără dată: nu toate susținerile au una înregistrată', () => {
    const { accepted, rejected } = parseArchiveRows(GOOD_ROW.replace(';2022-07-05', ';'))
    assert.equal(rejected.length, 0)
    assert.equal(accepted[0].defended, '')
  })

  it('numerotează rândurile cum le numără omul, de la 1, ignorând liniile goale', () => {
    const { rejected } = parseArchiveRows(['', GOOD_ROW, '   ', 'doar un nume', ''].join('\n'))
    assert.equal(rejected[0].numar, 2, 'al doilea rând cu conținut')
  })

  it('taie pe tab când nu există punct și virgulă — lipire directă din Excel', () => {
    const { accepted } = parseArchiveRows(GOOD_ROW.replace(/;/g, '\t'))
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].studentName, 'Ana Petre')
    assert.equal(accepted[0].title, 'Strategii de preț')
  })

  it('păstrează punctul și virgulă drept separator când există amândouă', () => {
    // A title can contain a tab pasted in from the sheet; the separator stays „;”.
    const { accepted } = parseArchiveRows('Ana P;;;;;Cristian V;Titlu\tcu tab;')
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].title, 'Titlu\tcu tab')
  })

  it('taie spațiile din fiecare celulă', () => {
    const { accepted } = parseArchiveRows('  Ana Petre  ;  MK-1  ;;;;  Cristian V  ;  Titlu  ;  2022-07-05  ')
    assert.equal(accepted[0].studentName, 'Ana Petre')
    assert.equal(accepted[0].studentNumber, 'MK-1')
    assert.equal(accepted[0].defended, '2022-07-05')
  })

  it('un text gol nu produce nici rânduri, nici erori', () => {
    assert.deepEqual(parseArchiveRows('   \n\n  '), { accepted: [], rejected: [] })
  })

  it('păstrează textul rândului respins, ca previzualizarea să îl poată arăta', () => {
    const broken = 'doar un nume'
    const { rejected } = parseArchiveRows(broken)
    assert.equal(rejected[0].text, broken)
  })
})

describe('parseArchiveLevel', () => {
  it('recunoaște cum scrie secretariatul', () => {
    for (const written of ['master', 'Master', 'MASTER', ' m ', 'M']) {
      assert.equal(parseArchiveLevel(written), 'master', `„${written}”`)
    }
  })

  it('orice altceva este licență, inclusiv gol', () => {
    for (const written of ['licenta', 'Licență', 'bachelor', '', 'x']) {
      assert.equal(parseArchiveLevel(written), 'bachelor', `„${written}”`)
    }
  })
})
