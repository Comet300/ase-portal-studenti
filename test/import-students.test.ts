import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCOUNT_COLUMNS,
  applyAccountMapping,
  composeAccountRows,
  guessAccountMapping,
  matchProgramme,
  parseAccountRows,
  type ProgrammeChoice,
} from '../src/lib/accounts.ts'
import {
  REGISTRY_HEADER,
  REGISTRY_TEMPLATE_ROWS,
  deriveProgramme,
  normalizeRegistryCell,
  parseFatherInitials,
  parseStudyYear,
  programmeLabel,
} from '../src/lib/import/students.ts'
import { formatInitial, officialName } from '../src/lib/text.ts'

/**
 * The registry's export, read.
 *
 * Every case here is a measured property of the real file — 893 students, 25
 * columns — and each one of them used to cost rows: 323 refused for an initial
 * of two letters, 27 for a year written „3 Suplimentar”, 350 accepted and then
 * left on no programme. The counts are in the assertions' messages so a failure
 * says how many people it is about.
 */

/** What migrations 0020 and 0023 seed for the year under way. */
const PROGRAMMES: ProgrammeChoice[] = (
  [
    ['bachelor', 'Învățământ cu frecvență — RO', 'ro'],
    ['bachelor', 'Învățământ cu frecvență — EN', 'en'],
    ['bachelor', 'Învățământ fără frecvență', 'ro'],
    ['bachelor', 'Învățământ la distanță — București', 'ro'],
    ['bachelor', 'Învățământ la distanță — Buzău', 'ro'],
    ['master', 'Cercetări de marketing', 'ro'],
    ['master', 'Marketing și comunicare în afaceri', 'ro'],
    ['master', 'Marketing online', 'ro'],
    ['master', 'Relații publice în marketing', 'ro'],
    ['master', 'Marketing strategic', 'ro'],
    ['master', 'Managementul relațiilor cu clienții', 'ro'],
    ['master', 'Managementul relațiilor cu clienții', 'en'],
    ['master', 'Managementul marketingului', 'ro'],
  ] as const
).map(([level, name, language]) => ({
  level,
  name,
  language,
  label: programmeLabel({ level, name, language }),
}))

describe('normalizeRegistryCell', () => {
  /* The export pads every value to a fixed width and writes a missing one as
     the four letters NULL. Left alone, one student in this very file is called
     „NULL” and one address is refused with a message about an e-mail. */
  it('taie umplutura de lățime fixă', () => {
    assert.equal(normalizeRegistryCell('   SÂRBU    '), 'SÂRBU')
  })

  it('citește „NULL” ca valoare lipsă, nu ca text', () => {
    assert.equal(normalizeRegistryCell('NULL'), '')
    assert.equal(normalizeRegistryCell('  NULL  '), '')
  })

  /* The file carries the Turkish cedilla `ş`/`ţ`; the portal writes the
     Romanian comma-below `ș`/`ț`. Two alphabets in one register is a name that
     never comes back from a search. */
  it('trece sedila turcească în virgula românească', () => {
    assert.equal(normalizeRegistryCell('Relaţii publice în marketing'), 'Relații publice în marketing')
    assert.equal(normalizeRegistryCell('Marketing şi comunicare în afaceri'), 'Marketing și comunicare în afaceri')
  })

  it('nu confundă un nume cu valoarea lipsă', () => {
    assert.equal(normalizeRegistryCell('NULLA'), 'NULLA')
  })
})

describe('parseStudyYear', () => {
  it('citește anul obișnuit', () => {
    assert.deepEqual(parseStudyYear('3'), { year: '3', note: '' })
    assert.deepEqual(parseStudyYear('  2  '), { year: '2', note: '' })
  })

  /* Twenty-seven students in the real file. Refusing them meant twenty-seven
     people who could not sign in; truncating to „3” would have lost the one
     fact a coordinator needs before agreeing to supervise. */
  it('păstrează „Suplimentar” ca notă, nu îl aruncă și nu respinge rândul', () => {
    assert.deepEqual(parseStudyYear('3 Suplimentar'), { year: '3', note: 'An suplimentar' })
    assert.deepEqual(parseStudyYear('2 Suplimentar'), { year: '2', note: 'An suplimentar' })
  })

  it('anul lipsă este permis — jumătate din liste au coloana goală', () => {
    assert.deepEqual(parseStudyYear(''), { year: '', note: '' })
    assert.deepEqual(parseStudyYear('NULL'), { year: '', note: '' })
  })

  /* A cell that slipped a column must stop the row, not become a note printed
     next to a year. */
  it('respinge orice altceva', () => {
    for (const bad of ['9', '0', 'Marketing', '3 Marketing', 'trei', 'a@b.ro']) {
      assert.equal(parseStudyYear(bad), null, `„${bad}” nu trebuie citit ca an`)
    }
  })
})

describe('parseFatherInitials', () => {
  it('acceptă o singură inițială, cu sau fără punct', () => {
    assert.equal(parseFatherInitials('C'), 'C')
    assert.equal(parseFatherInitials('i.'), 'I')
  })

  /* „Gh.” is a real Romanian initial — Gheorghe is abbreviated with two
     letters, not one — and not a typing mistake to be cut down to „G”. */
  it('acceptă inițiala de două litere: „Gh.”', () => {
    assert.equal(parseFatherInitials('Gh.'), 'Gh')
    assert.equal(parseFatherInitials('GH'), 'Gh')
  })

  /* 329 rows of the real file. The one-initial rule refused every one of them. */
  it('acceptă două inițiale, forma a 329 de rânduri din fișierul real', () => {
    assert.equal(parseFatherInitials('M G'), 'M G')
    assert.equal(parseFatherInitials('l ș'), 'L Ș')
    assert.equal(parseFatherInitials('M.G.'), 'M G')
  })

  it('acceptă trei inițiale', () => {
    assert.equal(parseFatherInitials('S G C'), 'S G C')
  })

  it('goală și „NULL” înseamnă amândouă fără inițială', () => {
    assert.equal(parseFatherInitials(''), '')
    assert.equal(parseFatherInitials('NULL'), '')
  })

  /* A whole cell that slipped a column would otherwise be printed inside
     somebody's name on a document that gets signed at the secretariat. */
  it('respinge un cuvânt, o adresă și patru inițiale', () => {
    for (const bad of ['Ionescu', 'ana@x.ro', 'A B C D', 'Gheorghe M']) {
      assert.equal(parseFatherInitials(bad), null, `„${bad}” nu trebuie acceptat`)
    }
  })

  /* The parser decides what may be stored and `text.ts` decides how it is
     printed; they live in different modules on purpose, so this is the seam
     that stops them drifting — a form that cannot be printed is a student whose
     official name silently loses its initial. */
  it('tot ce se poate stoca se poate și tipări', () => {
    for (const raw of ['C', 'Gh.', 'M G', 'S G C', 'l ș']) {
      const stored = parseFatherInitials(raw)
      assert.notEqual(stored, null)
      assert.notEqual(formatInitial(stored), '', `„${stored}” trebuie să se poată tipări`)
    }
    assert.equal(formatInitial('M G'), 'M. G.')
    assert.equal(officialName({ name: 'SÂRBU MIHĂIȚĂ', father_initial: 'M G' }), 'SÂRBU M. G. MIHĂIȚĂ')
  })
})

describe('deriveProgramme', () => {
  /**
   * The eleven cohorts of the real export, with the number of students in each.
   *
   * At licență the registry writes „Marketing” in `Specializare` and the form
   * of study in `FormaInvatamant`; the portal does the opposite, and the form
   * IS the programme. That mismatch is what left 350 accepted rows on no
   * programme at all.
   */
  const COHORTS: [number, string, string, string, string, string][] = [
    [388, 'LICENȚĂ', 'CU FRECVENȚĂ', 'Marketing', 'Română', 'Licență · Învățământ cu frecvență — RO · Română'],
    [82, 'LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Română', 'Licență · Învățământ la distanță — București · Română'],
    [74, 'LICENȚĂ', 'CU FRECVENȚĂ', 'Marketing', 'Engleză', 'Licență · Învățământ cu frecvență — EN · Engleză'],
    [58, 'LICENȚĂ', 'FRECVENȚĂ REDUSĂ', 'Marketing', 'Română', 'Licență · Învățământ fără frecvență · Română'],
    [77, 'MASTERAT', 'CU FRECVENȚĂ', 'Marketing online', 'Română', 'Master · Marketing online · Română'],
    [67, 'MASTERAT', 'CU FRECVENȚĂ', 'Marketing și comunicare în afaceri', 'Română', 'Master · Marketing și comunicare în afaceri · Română'],
    [44, 'MASTERAT', 'CU FRECVENȚĂ', 'Relații publice în marketing', 'Română', 'Master · Relații publice în marketing · Română'],
    [39, 'MASTERAT', 'CU FRECVENȚĂ', 'Marketing strategic', 'Română', 'Master · Marketing strategic · Română'],
    [33, 'MASTERAT', 'CU FRECVENȚĂ', 'Cercetări de marketing', 'Română', 'Master · Cercetări de marketing · Română'],
    [30, 'MASTERAT', 'CU FRECVENȚĂ', 'Managementul relațiilor cu clienții', 'Engleză', 'Master · Managementul relațiilor cu clienții · Engleză'],
    [1, 'MASTERAT', 'CU FRECVENȚĂ', 'Managementul marketingului', 'Română', 'Master · Managementul marketingului · Română'],
  ]

  it('duce fiecare din cele 11 promoții la programul ei', () => {
    for (const [students, cycle, form, specialisation, language, label] of COHORTS) {
      const derived = deriveProgramme({ cycle, form, specialisation, language })
      assert.equal(derived?.label, label, `${students} studenți: ${cycle} · ${form} · ${specialisation}`)
    }
  })

  /* The whole point of the derivation: every one of those labels has to name a
     programme the portal really has, otherwise the row is accepted and then
     invisible on every screen that filters by programme. */
  it('fiecare program dedus există printre cele semănate de 0020 și 0023', () => {
    for (const [students, cycle, form, specialisation, language] of COHORTS) {
      const derived = deriveProgramme({ cycle, form, specialisation, language })
      const match = matchProgramme(derived?.label ?? '', PROGRAMMES)
      assert.ok(match.ok && match.programme, `${students} studenți fără program: ${specialisation}`)
    }
  })

  /* The registry says „reduced attendance”, the portal says „without
     attendance”. No fuzzy match would ever connect the two, and one that did
     would be connecting them by accident. */
  it('„FRECVENȚĂ REDUSĂ” este „Învățământ fără frecvență”, explicit', () => {
    const derived = deriveProgramme({
      cycle: 'LICENȚĂ', form: 'FRECVENȚĂ REDUSĂ', specialisation: 'Marketing', language: 'Română',
    })
    assert.equal(derived?.name, 'Învățământ fără frecvență')
  })

  it('citește și cu sedilă, și cu umplutură, ca în fișier', () => {
    const derived = deriveProgramme({
      cycle: '  LICENŢĂ ', form: ' CU FRECVENŢĂ  ', specialisation: 'Marketing', language: ' Română ',
    })
    assert.equal(derived?.name, 'Învățământ cu frecvență — RO')
  })

  it('o promoție necunoscută rămâne fără program, fără să inventeze unul', () => {
    assert.equal(deriveProgramme({ cycle: 'DOCTORAT', form: 'CU FRECVENȚĂ', specialisation: 'x', language: 'Română' }), null)
    assert.equal(deriveProgramme({ cycle: 'LICENȚĂ', form: 'SERAL', specialisation: 'Marketing', language: 'Română' }), null)
    assert.equal(deriveProgramme({ cycle: 'LICENȚĂ', form: 'LA DISTANȚĂ', specialisation: 'Marketing', language: 'Engleză' }), null)
  })
})

/* --- the whole way through, from the file's own columns ---------------------- */

/** One registry row, written as the export writes it: padded, cedilla, NULL. */
function registryRow(values: Partial<Record<string, string>>): string[] {
  return REGISTRY_HEADER.map((name) => values[name] ?? 'NULL')
}

const CNP_IN_THE_FILE = '1234567890123'

const SAMPLE = registryRow({
  TipCicluStudii: '  LICENŢĂ  ',
  FormaInvatamant: 'CU FRECVENŢĂ',
  denumire: 'MRK - București',
  AnStudiu: '3 Suplimentar',
  Specializare: 'Marketing  ',
  LimbaProgram: 'Română',
  Nume: 'SÂRBU ',
  Initiale: 'M G',
  Prenume: ' MIHĂIȚĂ - IRINEL',
  CNP: CNP_IN_THE_FILE,
  SerieCI: 'RT',
  NumarCI: '998877',
  Email: 'mihai.sarbu23@gmail.com',
  FormaFinantare: 'Buget RO',
})

/** Header → mapping → composed text → the reader the route runs. */
function importRows(rows: string[][]) {
  const mapping = guessAccountMapping(REGISTRY_HEADER)
  return parseAccountRows(composeAccountRows(applyAccountMapping(rows, mapping)))
}

describe('exportul registrului, citit cap-coadă', () => {
  it('citește un rând real cu tot ce are el ciudat', () => {
    const { accepted, rejected } = importRows([SAMPLE])
    assert.equal(rejected.length, 0)
    assert.deepEqual(accepted[0], {
      name: 'SÂRBU MIHĂIȚĂ - IRINEL',
      email: 'mihai.sarbu23@gmail.com',
      role: 'student',
      studentNumber: '',
      programme: 'Licență · Învățământ cu frecvență — RO · Română',
      year: '3',
      yearNote: 'An suplimentar',
      group: '',
      series: '',
      fatherInitial: 'M G',
      funding: 'Buget RO',
    })
  })

  /**
   * The CNP is a specially regulated national identifier and the portal has no
   * feature that uses it. A surplus column is ignored, never a reason to
   * reject — so the row comes in, and the number does not.
   */
  it('trece peste CNP fără să îl stocheze și fără să respingă rândul', () => {
    const { accepted, rejected } = importRows([SAMPLE])
    assert.equal(rejected.length, 0, 'o coloană în plus nu respinge niciodată un rând')
    const stored = Object.values(accepted[0]!).join(' | ')
    assert.ok(!stored.includes(CNP_IN_THE_FILE), `CNP-ul nu are voie să ajungă în cont: ${stored}`)
  })

  /**
   * „SerieCI” is the series of the IDENTITY CARD, not the study series. A
   * mapping that lands it in „Serie” is silently wrong for all 893 students and
   * nothing downstream can tell.
   */
  it('nu pune seria cărții de identitate în seria de studiu', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    const serie = REGISTRY_HEADER.indexOf('SerieCI')
    const numar = REGISTRY_HEADER.indexOf('NumarCI')

    for (const [field, source] of mapping.entries()) {
      if (source.kind !== 'columns') continue
      assert.ok(
        !source.columns.includes(serie) && !source.columns.includes(numar),
        `„${ACCOUNT_COLUMNS[field]}” nu are voie să citească din SerieCI/NumarCI`,
      )
    }
    assert.equal(importRows([SAMPLE]).accepted[0]!.series, '', 'seria de studiu rămâne goală')
  })

  it('nu citește nici CNP, nici telefon, nici adresa de domiciliu', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    const forbidden = ['CNP', 'DataNastere', 'Sex', 'telefon1', 'telefon2', 'EmitentCI', 'DataCI', 'LocDom', 'JudDom']
      .map((name) => REGISTRY_HEADER.indexOf(name))

    for (const source of mapping) {
      if (source.kind !== 'columns') continue
      for (const column of source.columns) {
        assert.ok(!forbidden.includes(column), `coloana „${REGISTRY_HEADER[column]}” nu se citește`)
      }
    }
  })

  /* „Adresa” is the e-mail in a sheet written by hand and the postal address in
     this export, which also has „Email”. While the two scored the same, the
     answer depended on which came first in the file — and the wrong one refuses
     every row in the list. */
  it('ia adresa de email din „Email”, nu din „Adresa”', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.deepEqual(mapping[1], {
      kind: 'columns',
      columns: [REGISTRY_HEADER.indexOf('Email')],
      joiner: ' ',
    })
  })

  it('compune numele din „Nume” și „Prenume”, în ordinea registrului', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.deepEqual(mapping[0], {
      kind: 'columns',
      columns: [REGISTRY_HEADER.indexOf('Nume'), REGISTRY_HEADER.indexOf('Prenume')],
      joiner: ' ',
    })
  })

  it('găsește anul în „AnStudiu” și finanțarea în „FormaFinantare”', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.deepEqual(mapping[5], { kind: 'columns', columns: [REGISTRY_HEADER.indexOf('AnStudiu')], joiner: ' ' })
    assert.deepEqual(mapping[9], { kind: 'columns', columns: [REGISTRY_HEADER.indexOf('FormaFinantare')], joiner: ' ' })
  })

  it('deduce programul din patru coloane, nu din „Specializare”', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.deepEqual(mapping[4], {
      kind: 'programme',
      cycle: REGISTRY_HEADER.indexOf('TipCicluStudii'),
      form: REGISTRY_HEADER.indexOf('FormaInvatamant'),
      specialisation: REGISTRY_HEADER.indexOf('Specializare'),
      language: REGISTRY_HEADER.indexOf('LimbaProgram'),
    })
  })

  it('„NULL” în inițiale nu respinge rândul și nu ajunge în nume', () => {
    const row = registryRow({
      TipCicluStudii: 'MASTERAT', FormaInvatamant: 'CU FRECVENȚĂ', AnStudiu: '2',
      Specializare: 'Marketing online', LimbaProgram: 'Română',
      Nume: 'POPA', Initiale: 'NULL', Prenume: 'ANDREI',
      Email: 'andrei.popa@stud.ase.ro', FormaFinantare: 'Taxa',
    })
    const { accepted, rejected } = importRows([row])
    assert.equal(rejected.length, 0)
    assert.equal(accepted[0]!.fatherInitial, '')
    assert.equal(accepted[0]!.name, 'POPA ANDREI')
  })

  /* Two rows of the real file have a broken or missing address and are the two
     the director corrects in the preview. Everything else comes in. */
  it('respinge adresa stricată și pe cea lipsă, și numai pe ele', () => {
    const broken = registryRow({ ...fields(SAMPLE), Email: 'hana 155@yahoo.com' })
    const missing = registryRow({ ...fields(SAMPLE), Email: 'NULL' })
    const { accepted, rejected } = importRows([SAMPLE, broken, missing])

    assert.equal(accepted.length, 1)
    assert.equal(rejected.length, 2)
    assert.match(rejected[0]!.reason, /adresă de email/)
    assert.match(rejected[1]!.reason, /numele sau adresa/)
  })
})

/** A registry row back as a map, so a variant can change one cell of it. */
function fields(row: string[]): Record<string, string> {
  return Object.fromEntries(REGISTRY_HEADER.map((name, i) => [name, row[i] ?? '']))
}

/* --- the template the faculty downloads -------------------------------------- */

describe('șablonul de import', () => {
  /* The template and the parser live in the same module precisely so they
     cannot drift: a template whose header the wizard maps wrongly is worse than
     none, because it looks official. */
  it('are capul de tabel pe care ghicitorul îl potrivește corect', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.equal(mapping[0]!.kind, 'columns', '„Nume” se potrivește')
    assert.equal(mapping[1]!.kind, 'columns', '„Email” se potrivește')
    assert.equal(mapping[4]!.kind, 'programme', '„Program” se deduce')
    assert.equal(mapping[5]!.kind, 'columns', '„An” se potrivește')
    assert.equal(mapping[8]!.kind, 'columns', '„Inițiala tatălui” se potrivește')
    assert.equal(mapping[9]!.kind, 'columns', '„Finanțare” se potrivește')
  })

  it('are 25 de coloane, în ordinea exportului', () => {
    assert.equal(REGISTRY_HEADER.length, 25)
    assert.equal(REGISTRY_HEADER[0], 'TipCicluStudii')
    assert.equal(REGISTRY_HEADER[24], 'FormaFinantare')
    for (const row of REGISTRY_TEMPLATE_ROWS) assert.equal(row.length, 25)
  })

  it('rândurile de exemplu se citesc fără niciun rând respins', () => {
    const { accepted, rejected } = importRows(REGISTRY_TEMPLATE_ROWS)
    assert.deepEqual(rejected, [])
    assert.equal(accepted.length, REGISTRY_TEMPLATE_ROWS.length)
  })

  it('fiecare rând de exemplu nimerește un program care există', () => {
    for (const person of importRows(REGISTRY_TEMPLATE_ROWS).accepted) {
      const match = matchProgramme(person.programme, PROGRAMMES)
      assert.ok(match.ok && match.programme, `${person.email}: ${person.programme}`)
    }
  })

  it('arată formele care rupeau importul: „3 Suplimentar” și două inițiale', () => {
    const { accepted } = importRows(REGISTRY_TEMPLATE_ROWS)
    assert.ok(accepted.some((p) => p.yearNote === 'An suplimentar'))
    assert.ok(accepted.some((p) => p.fatherInitial.includes(' ')))
  })

  /* A specimen CNP in a file everyone downloads is a specimen somebody pastes a
     real one over. The example cells say what happens to those columns
     instead. */
  it('nu conține niciun CNP sau număr de buletin plauzibil', () => {
    for (const row of REGISTRY_TEMPLATE_ROWS) {
      for (const [index, cell] of row.entries()) {
        const column = REGISTRY_HEADER[index]!
        if (!['CNP', 'SerieCI', 'NumarCI', 'DataNastere', 'DataCI', 'telefon1', 'telefon2'].includes(column)) continue
        assert.equal(cell, 'nu se importă', `„${column}” nu are voie să arate a valoare reală`)
      }
    }
  })
})
