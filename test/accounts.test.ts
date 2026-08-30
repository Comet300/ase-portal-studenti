import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAccountMapping,
  composeAccountRows,
  guessAccountMapping,
  matchProgramme,
  parseAccountRole,
  parseAccountRows,
} from '../src/lib/accounts.ts'

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

/**
 * The mapping of a foreign file onto the portal's nine columns.
 *
 * This is where a registrar's sheet stops being „a file” and becomes rows the
 * reader above can judge. Everything is tested against the shapes those sheets
 * actually have: the name split in two columns, the programme that is in the
 * file's title rather than in a column, and the semicolon inside a cell that
 * would otherwise open a tenth column.
 */
describe('guessAccountMapping', () => {
  it('recunoaște capul de tabel oricum ar fi scris', () => {
    const mapping = guessAccountMapping([
      'NR. MATRICOL', 'Numele', 'E-Mail', 'Programul de studiu', 'Anul', 'Grupă', 'Seria',
    ])
    assert.deepEqual(mapping[0], { kind: 'columns', columns: [1], joiner: ' ' })
    assert.deepEqual(mapping[1], { kind: 'columns', columns: [2], joiner: ' ' })
    assert.deepEqual(mapping[3], { kind: 'columns', columns: [0], joiner: ' ' })
    assert.deepEqual(mapping[4], { kind: 'columns', columns: [3], joiner: ' ' })
    assert.deepEqual(mapping[5], { kind: 'columns', columns: [4], joiner: ' ' })
    assert.deepEqual(mapping[6], { kind: 'columns', columns: [5], joiner: ' ' })
    assert.deepEqual(mapping[7], { kind: 'columns', columns: [6], joiner: ' ' })
  })

  /* A name split in two columns is the ordinary shape of these files, and the
     order is the register's: family name first, as it is printed on a request. */
  it('unește „Nume” cu „Prenume” de la sine', () => {
    const mapping = guessAccountMapping(['Nume', 'Prenume', 'Email'])
    assert.deepEqual(mapping[0], { kind: 'columns', columns: [0, 1], joiner: ' ' })
    assert.deepEqual(mapping[1], { kind: 'columns', columns: [2], joiner: ' ' })
  })

  /* „An” as a whole header is the year of study; „An” as a fragment is inside
     „Anul nașterii” and half the words in the language. */
  it('nu ia „Anul nașterii” drept an de studiu', () => {
    const mapping = guessAccountMapping(['Nume', 'Anul nașterii'])
    assert.equal(mapping[5]!.kind, 'none')
  })

  it('lasă necompletat ce nu găsește, în loc să ghicească', () => {
    const mapping = guessAccountMapping(['Coloana 1', 'Coloana 2'])
    assert.ok(mapping.every((s) => s.kind === 'none'))
  })

  it('nu dă aceeași coloană la două câmpuri', () => {
    const mapping = guessAccountMapping(['Nume', 'Nume complet'])
    const used = mapping.flatMap((s) => (s.kind === 'columns' ? s.columns : []))
    assert.equal(new Set(used).size, used.length)
  })
})

describe('applyAccountMapping', () => {
  const rows = [
    ['Ștefănescu', 'Ioana', 'ioana@stud.ase.ro', '1503'],
    ['Țîrlea', 'Bogdan', 'bogdan@stud.ase.ro', '1504'],
  ]

  it('unește coloanele în ordinea aleasă, cu liantul ales', () => {
    const composed = applyAccountMapping(rows, [
      { kind: 'columns', columns: [1, 0], joiner: ' ' },
      { kind: 'columns', columns: [2], joiner: ' ' },
      { kind: 'none' }, { kind: 'none' }, { kind: 'none' },
      { kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' },
    ])
    assert.equal(composed[0][0], 'Ioana Ștefănescu')
    assert.equal(composed[1][1], 'bogdan@stud.ase.ro')
  })

  /* The registrar's file is one sheet per programme and per year, so it carries
     no „Program” column at all: one value for the whole file is the only way to
     import it without rewriting it in Excel first. */
  it('pune aceeași valoare pe toate rândurile', () => {
    const composed = applyAccountMapping(rows, [
      { kind: 'columns', columns: [0], joiner: ' ' },
      { kind: 'columns', columns: [2], joiner: ' ' },
      { kind: 'constant', value: 'student' },
      { kind: 'none' },
      { kind: 'constant', value: 'Marketing' },
      { kind: 'constant', value: '3' },
      { kind: 'columns', columns: [3], joiner: ' ' },
      { kind: 'none' }, { kind: 'none' },
    ])
    assert.deepEqual(composed[1], ['Țîrlea', 'bogdan@stud.ase.ro', 'student', '', 'Marketing', '3', '1504', '', ''])
  })

  it('sare peste bucata goală, ca să nu rămână liantul singur', () => {
    const composed = applyAccountMapping([['Popa', '']], [
      { kind: 'columns', columns: [0, 1], joiner: ' ' },
      { kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' },
      { kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' },
    ])
    assert.equal(composed[0][0], 'Popa')
  })
})

describe('composeAccountRows', () => {
  const empty = ['', '', '', '', '', '']

  it('scrie rândurile cu punct și virgulă, cum le citește cititorul', () => {
    const text = composeAccountRows([['Ana Pop', 'ana@x.ro', 'student', ...empty]])
    assert.equal(text, 'Ana Pop;ana@x.ro;student;;;;;;')
    assert.equal(parseAccountRows(text).accepted.length, 1)
  })

  /* A name with a semicolon in it would open a tenth column and move the
     address into the role. The reader takes a tab just as well, and the choice
     is made over the whole text: it decides line by line, so a document where
     only one row carries a „;” would be cut two different ways. */
  it('trece pe tab când o celulă conține punct și virgulă', () => {
    const text = composeAccountRows([
      ['Popescu; Ion', 'ion@x.ro', 'student', ...empty],
      ['Ana Pop', 'ana@x.ro', 'student', ...empty],
    ])
    assert.ok(!text.split('\n')[1].includes(';'), 'toate rândurile trec pe tab, nu doar cel vinovat')
    const { accepted } = parseAccountRows(text)
    assert.equal(accepted.length, 2)
    assert.equal(accepted[0].name, 'Popescu; Ion')
  })

  it('aplatizează rândul nou dintr-o celulă, ca să nu devină un rând de-al lui', () => {
    const text = composeAccountRows([['Ana\nPop', 'ana@x.ro', 'student', ...empty]])
    assert.equal(text.split('\n').length, 1)
    assert.equal(parseAccountRows(text).accepted[0].name, 'Ana Pop')
  })
})

describe('matchProgramme', () => {
  const programmes = [
    { level: 'bachelor', name: 'Marketing', language: 'ro', label: 'Licență · Marketing · Română' },
    { level: 'master', name: 'Marketing', language: 'en', label: 'Master · Marketing · Engleză' },
    { level: 'bachelor', name: 'Publicitate', language: 'ro', label: 'Licență · Publicitate · Română' },
  ]

  it('gol înseamnă „fără program”, nu o eroare — cadrele didactice nu au niciunul', () => {
    assert.deepEqual(matchProgramme('  ', programmes), { ok: true, programme: null })
  })

  it('găsește după nume când numele este al unui singur program', () => {
    const m = matchProgramme('publicitate', programmes)
    assert.ok(m.ok && m.programme?.level === 'bachelor')
  })

  /* „Marketing” is both bachelor in Romanian and master in English. The lookup
     by name kept whichever row the query returned last — a whole cohort tied to
     the wrong programme, with nothing anywhere saying so. */
  it('refuză un nume care aparține mai multor programe, în loc să aleagă unul', () => {
    const m = matchProgramme('Marketing', programmes)
    assert.ok(!m.ok && /mai multe variante/.test(m.reason))
  })

  /* The portal's own lists send the whole label for exactly the case above: it
     reads for a person and for the machine, and it is not ambiguous. */
  it('acceptă eticheta întreagă, cum o trimit listele portalului', () => {
    const m = matchProgramme('Master · Marketing · Engleză', programmes)
    assert.ok(m.ok && m.programme?.language === 'en')
  })

  it('refuză un program care nu există, ca să nu creeze studenți fără program', () => {
    const m = matchProgramme('Markting', programmes)
    assert.ok(!m.ok && /nu există în anul curent/.test(m.reason))
  })
})
