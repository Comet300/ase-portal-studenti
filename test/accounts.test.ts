import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAccountRows, parseAccountRole } from '../src/lib/accounts.ts'

/**
 * The reader of lists of people.
 *
 * The same function decides what is shown in the preview and which accounts get
 * created. The tests are about what it *rejects*: every rejected row is an
 * account that does not get created wrongly, and a wrong account means a person
 * who cannot get in — signing in goes exclusively through the address written
 * here.
 */

const GOOD_ROW =
  'Ioana Dumitru;ioana.dumitru@stud.ase.ro;student;MK-2025-0142;Marketing;3;RO-1503;B;I.'

describe('parseAccountRows', () => {
  it('citește un rând complet', () => {
    const { accepted, rejected } = parseAccountRows(GOOD_ROW)
    assert.equal(rejected.length, 0)
    assert.deepEqual(accepted[0], {
      name: 'Ioana Dumitru',
      email: 'ioana.dumitru@stud.ase.ro',
      role: 'student',
      studentNumber: 'MK-2025-0142',
      programme: 'Marketing',
      year: '3',
      group: 'RO-1503',
      series: 'B',
      fatherInitial: 'I',
    })
  })

  it('cere numele și adresa; restul e opțional', () => {
    const { accepted, rejected } = parseAccountRows(
      ['Ana Pop;ana@x.ro;;;;;', ';ana@x.ro;student;;;;', 'Ana Pop;;student;;;;'].join('\n'),
    )
    assert.equal(accepted.length, 1)
    assert.equal(rejected.length, 2)
    assert.match(rejected[0].reason, /numele sau adresa/)
  })

  it('rolul lipsă înseamnă student — cazul cel mai frecvent', () => {
    assert.equal(parseAccountRows('Ana Pop;ana@x.ro;;;;;').accepted[0].role, 'student')
  })

  it('respinge o adresă care nu e adresă', () => {
    for (const bad of ['fara-arond', 'a@b', 'a b@x.ro', '@x.ro', 'a@']) {
      const { accepted, rejected } = parseAccountRows(`Ana Pop;${bad};student;;;;`)
      assert.equal(accepted.length, 0, `„${bad}” nu trebuie acceptat`)
      assert.match(rejected[0].reason, /adresă de email/)
    }
  })

  it('respinge un rol inventat, ca să nu creeze un cont cu drepturi greșite', () => {
    const { accepted, rejected } = parseAccountRows('Ana Pop;ana@x.ro;portar;;;;')
    assert.equal(accepted.length, 0)
    assert.match(rejected[0].reason, /nu e recunoscut/)
  })

  /* The duplicate is caught while reading, not in the database: otherwise the
   * first row would go in and the second would break the import halfway. */
  it('prinde aceeași adresă de două ori în aceeași listă', () => {
    const { accepted, rejected } = parseAccountRows(
      ['Ana Pop;ana@x.ro;student;;;;', 'Ana Popescu;ANA@X.RO;student;;;;'].join('\n'),
    )
    assert.equal(accepted.length, 1)
    assert.match(rejected[0].reason, /de două ori/)
  })

  it('normalizează adresa la litere mici — cheia de unicitate', () => {
    assert.equal(parseAccountRows('Ana;Ana.Pop@Stud.ASE.ro;student;;;;').accepted[0].email, 'ana.pop@stud.ase.ro')
  })

  it('respinge un an din afara intervalului', () => {
    assert.equal(parseAccountRows('Ana;ana@x.ro;student;;;9;').accepted.length, 0)
    assert.equal(parseAccountRows('Ana;ana@x.ro;student;;;3;').accepted.length, 1)
    assert.equal(parseAccountRows('Ana;ana@x.ro;student;;;;').accepted.length, 1, 'anul lipsă e permis')
  })

  /* The two columns were appended after „Grupa”, not slotted in beside „An”:
     reading is positional, so a list saved last term must keep meaning what it
     meant. These two cases are what would break if anybody moved them. */
  it('seria și inițiala lipsesc dintr-o listă veche, fără să respingă rândul', () => {
    const { accepted, rejected } = parseAccountRows(
      'Ana Pop;ana@x.ro;student;MK-1;Marketing;3;RO-1503',
    )
    assert.equal(rejected.length, 0)
    assert.equal(accepted[0].series, '')
    assert.equal(accepted[0].fatherInitial, '')
    assert.equal(accepted[0].group, 'RO-1503', 'grupa rămâne pe poziția ei')
  })

  it('normalizează seria la litere mari — „a” și „A” sunt aceeași serie', () => {
    assert.equal(parseAccountRows('Ana;ana@x.ro;student;;;;; a ;').accepted[0].series, 'A')
  })

  it('acceptă inițiala cu sau fără punct, și pe cea din două litere', () => {
    const rows = parseAccountRows(
      [
        'Ana;a@x.ro;student;;;;;A;I',
        'Bogdan;b@x.ro;student;;;;;A;i.',
        'Cristina;c@x.ro;student;;;;;A;Gh.',
      ].join('\n'),
    )
    assert.equal(rows.rejected.length, 0)
    assert.deepEqual(rows.accepted.map((r) => r.fatherInitial), ['I', 'I', 'Gh'])
  })

  /* A cell that slipped a column would otherwise be printed inside somebody's
     name on a document that gets signed at the secretariat. */
  it('respinge o inițială care e de fapt un cuvânt', () => {
    const { accepted, rejected } = parseAccountRows('Ana;ana@x.ro;student;;;;;A;Ionescu')
    assert.equal(accepted.length, 0)
    assert.match(rejected[0].reason, /inițiala tatălui/)
  })

  it('taie pe tab când nu există punct și virgulă — lipire din Excel', () => {
    const { accepted } = parseAccountRows(GOOD_ROW.replace(/;/g, '\t'))
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].email, 'ioana.dumitru@stud.ase.ro')
  })

  /* The numbering counts the rows *with content*, as in the archive import:
     whoever pastes from a spreadsheet has no empty lines, and if they do, they
     do not count them. Here „rândul 2” is the second row written, not the
     second line of the text. */
  it('numerotează rândurile cu conținut, sărind peste liniile goale', () => {
    const { rejected } = parseAccountRows(['', GOOD_ROW, '  ', 'Stricat;nu-e-email;student;;;;'].join('\n'))
    assert.equal(rejected[0].numar, 2, 'al doilea rând cu conținut')
  })

  it('un text gol nu produce nimic și nicio eroare', () => {
    assert.deepEqual(parseAccountRows('  \n\n '), { accepted: [], rejected: [] })
  })
})

describe('parseAccountRole', () => {
  it('recunoaște cum scrie secretariatul', () => {
    for (const s of ['', 'student', 'Student', 's']) assert.equal(parseAccountRole(s), 'student', `„${s}”`)
    for (const s of ['cadru didactic', 'Profesor', 'teacher', 'c']) assert.equal(parseAccountRole(s), 'teacher', `„${s}”`)
    for (const s of ['director', 'Head', 'director de departament']) assert.equal(parseAccountRole(s), 'head', `„${s}”`)
  })

  it('nu ghicește un rol pe care nu îl știe', () => {
    for (const s of ['portar', 'secretar', 'admin']) assert.equal(parseAccountRole(s), null, `„${s}”`)
  })
})
