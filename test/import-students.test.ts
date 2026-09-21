import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  describeCohort,
  normalizeRegistryCell,
  parseFatherInitials,
  parseStudyYear,
  matchCentre,
  programmeCell,
  registryDimensions,
} from '../src/lib/import/students.ts'
import {
  FORMS_OF_STUDY,
  FORM_WORDS,
  MAIN_LOCATION,
  programmeLabel,
  programmeTitle,
} from '../src/lib/programmes.mjs'
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

/**
 * A study programme the way the portal holds one, from its five facts.
 *
 * The name and the label are composed, never typed: that is the guarantee the
 * whole change rests on. A fixture that spelled them by hand would go on
 * passing after the composition changed, and the first thing anybody would hear
 * about it is a promotion imported onto no programme at all.
 */
function programme(
  level: string,
  form_of_study: string,
  specialisation: string,
  language: string,
  location = MAIN_LOCATION,
): ProgrammeChoice {
  const p = { level, form_of_study, specialisation, language, location }
  return { ...p, name: programmeTitle(p), label: programmeLabel(p) }
}

/** What migrations 0020 and 0023 seed, in the five columns 0024 gives them. */
const PROGRAMMES: ProgrammeChoice[] = [
  programme('bachelor', 'if', 'Marketing', 'ro'),
  programme('bachelor', 'if', 'Marketing', 'en'),
  programme('bachelor', 'ifr', 'Marketing', 'ro'),
  programme('bachelor', 'id', 'Marketing', 'ro'),
  programme('bachelor', 'id', 'Marketing', 'ro', 'Buzău'),
  programme('master', 'if', 'Cercetări de marketing', 'ro'),
  programme('master', 'if', 'Marketing și comunicare în afaceri', 'ro'),
  programme('master', 'if', 'Marketing online', 'ro'),
  programme('master', 'if', 'Relații publice în marketing', 'ro'),
  programme('master', 'if', 'Marketing strategic', 'ro'),
  programme('master', 'if', 'Managementul relațiilor cu clienții', 'ro'),
  programme('master', 'if', 'Managementul relațiilor cu clienții', 'en'),
  programme('master', 'if', 'Managementul marketingului', 'ro'),
]

/* The centres those programmes are taught at — which is what the registry's
   `denumire` is now resolved against, instead of a table of spellings written
   out in the importer. Derived from the fixture rather than listed, so a
   programme moved to a new centre cannot leave the two disagreeing. */
const CENTRES = [...new Set(PROGRAMMES.map((p) => p.location))]

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

/** The registry's five cells for one cohort, as the export writes them. */
const BUCHAREST = 'MRK - București'
const cohort = (
  cycle: string,
  form: string,
  specialisation: string,
  language: string,
  location = BUCHAREST,
) => ({ cycle, form, specialisation, language, location })

describe('deriveProgramme', () => {
  /**
   * The eleven cohorts of the real export, with the number of students in each.
   *
   * Nothing is derived any more: the registry states five facts, the portal
   * stores the same five, and the lookup is a comparison. The table that used
   * to translate „CU FRECVENȚĂ” + „Română” into the name „Învățământ cu
   * frecvență — RO” is gone, and with it the reason the faculty could run only
   * one licență specialisation.
   */
  const COHORTS: [number, ReturnType<typeof cohort>][] = [
    [388, cohort('LICENȚĂ', 'CU FRECVENȚĂ', 'Marketing', 'Română')],
    [82, cohort('LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Română')],
    [74, cohort('LICENȚĂ', 'CU FRECVENȚĂ', 'Marketing', 'Engleză')],
    [58, cohort('LICENȚĂ', 'FRECVENȚĂ REDUSĂ', 'Marketing', 'Română')],
    [77, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Marketing online', 'Română')],
    [67, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Marketing și comunicare în afaceri', 'Română')],
    [44, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Relații publice în marketing', 'Română')],
    [39, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Marketing strategic', 'Română')],
    [33, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Cercetări de marketing', 'Română')],
    [30, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Managementul relațiilor cu clienții', 'Engleză')],
    [1, cohort('MASTERAT', 'CU FRECVENȚĂ', 'Managementul marketingului', 'Română')],
  ]

  /** What the eleven must land on, written out so a change of rule is visible. */
  const EXPECTED = [
    'Licență · Marketing · învățământ cu frecvență · Română',
    'Licență · Marketing · învățământ la distanță · Română',
    'Licență · Marketing · învățământ cu frecvență · Engleză',
    'Licență · Marketing · învățământ cu frecvență redusă · Română',
    'Master · Marketing online · învățământ cu frecvență · Română',
    'Master · Marketing și comunicare în afaceri · învățământ cu frecvență · Română',
    'Master · Relații publice în marketing · învățământ cu frecvență · Română',
    'Master · Marketing strategic · învățământ cu frecvență · Română',
    'Master · Cercetări de marketing · învățământ cu frecvență · Română',
    'Master · Managementul relațiilor cu clienții · învățământ cu frecvență · Engleză',
    'Master · Managementul marketingului · învățământ cu frecvență · Română',
  ]

  it('duce fiecare din cele 11 promoții la programul ei', () => {
    COHORTS.forEach(([students, c], i) => {
      const found = deriveProgramme(c, PROGRAMMES)
      assert.equal(
        found?.label,
        EXPECTED[i],
        `${students} studenți: ${c.cycle} · ${c.form} · ${c.specialisation} · ${c.language} · ${c.location}`,
      )
    })
  })

  /* The five values, in the portal's own vocabulary, before anything is looked
     up: this is the whole of the translation that is left. */
  it('traduce vocabularul registrului în valorile stocate', () => {
    assert.deepEqual(registryDimensions(cohort('LICENȚĂ', 'FRECVENȚĂ REDUSĂ', 'Marketing', 'Română'), CENTRES), {
      level: 'bachelor',
      form_of_study: 'ifr',
      specialisation: 'Marketing',
      language: 'ro',
      location: 'București',
    })
    assert.deepEqual(registryDimensions(cohort('MASTERAT', 'LA DISTANȚĂ', 'Marketing online', 'Engleză', 'MRK - Buzău'), CENTRES), {
      level: 'master',
      form_of_study: 'id',
      specialisation: 'Marketing online',
      language: 'en',
      location: 'Buzău',
    })
  })

  it('citește și cu sedilă, și cu umplutură, ca în fișier', () => {
    const found = deriveProgramme(
      cohort('  LICENŢĂ ', ' CU FRECVENŢĂ  ', ' Marketing  ', ' Română ', '  MRK - Bucureşti '),
      PROGRAMMES,
    )
    assert.equal(found?.specialisation, 'Marketing')
    assert.equal(found?.form_of_study, 'if')
  })

  /* WHY THIS CHANGE EXISTS. Until now a licență programme WAS its form of
     study, so two cohorts differing only by specialisation were one row: one
     pot of seats, one catalogue, one line in every report, for two different
     groups of students. Neither could even be written down. */
  it('a doua specializare la licență se poate exprima și nu se ciocnește de prima', () => {
    const publicitate = programme('bachelor', 'if', 'Publicitate', 'ro')
    const withBoth = [...PROGRAMMES, publicitate]

    const marketing = deriveProgramme(cohort('LICENȚĂ', 'CU FRECVENȚĂ', 'Marketing', 'Română'), withBoth)
    const second = deriveProgramme(cohort('LICENȚĂ', 'CU FRECVENȚĂ', 'Publicitate', 'Română'), withBoth)

    assert.equal(marketing?.specialisation, 'Marketing')
    assert.equal(second?.specialisation, 'Publicitate')
    assert.notEqual(marketing?.label, second?.label, 'două promoții, două programe')
    assert.notEqual(marketing?.name, second?.name, 'și două etichete pe ecran')

    /* And the whole way through the reader, which is where the collision would
       actually have been paid for: two rows, two programmes, no merge. */
    const rows = [
      registryRow({ ...fields(SAMPLE), Specializare: 'Marketing', Email: 'a@stud.ase.ro' }),
      registryRow({ ...fields(SAMPLE), Specializare: 'Publicitate', Email: 'b@stud.ase.ro' }),
    ]
    const { accepted } = importRows(rows, withBoth)
    assert.equal(accepted.length, 2)
    assert.notEqual(accepted[0]!.programme, accepted[1]!.programme)
    for (const person of accepted) {
      const match = matchProgramme(person.programme, withBoth)
      assert.ok(match.ok && match.programme, `${person.email}: ${person.programme}`)
    }
  })

  /* „LA DISTANȚĂ” used to resolve to București because `denumire` said so on
     every row of the file — which is a fact invented about a student, and the
     day Buzău appears the invention becomes a whole cohort filed in the wrong
     city with nothing saying so. */
  it('citește centrul din „denumire”, nu îl presupune', () => {
    const buzau = deriveProgramme(
      cohort('LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Română', 'MRK - Buzău'),
      PROGRAMMES,
    )
    assert.equal(buzau?.location, 'Buzău')
    assert.equal(buzau?.label, 'Licență · Marketing · învățământ la distanță · Buzău · Română')

    const bucuresti = deriveProgramme(
      cohort('LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Română', 'MRK - București'),
      PROGRAMMES,
    )
    assert.notEqual(buzau?.label, bucuresti?.label, 'două centre, două programe')
  })

  /* WHY THE CENTRE IS NOT A TABLE IN THIS FILE ANY MORE. It was four
     hand-written spellings, which was right for the two centres that existed
     and wrong in shape: a second list of the faculty's centres, beside the one
     in the database. The day a director opened a third one, the importer would
     have gone on refusing every row of it until somebody edited a source file.
     The candidates are the stored centres now. */
  describe('matchCentre', () => {
    it('trece peste prefixul facultății și ajunge la centrul stocat', () => {
      assert.equal(matchCentre('MRK - București', CENTRES), 'București')
      assert.equal(matchCentre('MRK - Buzău', CENTRES), 'Buzău')
    })

    it('citește și o foaie scrisă de mână, cu orașul singur', () => {
      assert.equal(matchCentre('București', CENTRES), 'București')
      assert.equal(matchCentre('  bucureşti  ', CENTRES), 'București')
    })

    it('leagă prefixul de oraș și fără spații în jurul liniuței', () => {
      assert.equal(matchCentre('MRK-Buzău', CENTRES), 'Buzău')
    })

    /* A centre the faculty opens tomorrow resolves without this file changing —
       which is the whole reason the list is passed in. */
    it('un centru deschis după ziua de azi se potrivește fără să fie scris aici', () => {
      const withNew = [...CENTRES, 'Slobozia']
      assert.equal(matchCentre('MRK - Slobozia', withNew), 'Slobozia')
      assert.equal(matchCentre('MRK - Slobozia', CENTRES), null, 'cât timp nu există, nu se inventează')
    })

    it('scrierea exactă bate potrivirea fără diacritice', () => {
      const both = ['Buzau', 'Buzău']
      assert.equal(matchCentre('MRK - Buzău', both), 'Buzău')
      assert.equal(matchCentre('MRK - Buzau', both), 'Buzau')
    })

    it('alege centrul cel mai lung care se potrivește, nu primul', () => {
      const tricky = ['Vâlcea', 'Râmnicu Vâlcea']
      assert.equal(matchCentre('MRK - Râmnicu Vâlcea', tricky), 'Râmnicu Vâlcea')
    })

    it('o celulă goală nu este un centru', () => {
      assert.equal(matchCentre('', CENTRES), null)
      assert.equal(matchCentre('NULL', CENTRES), null)
    })
  })

  it('un centru necunoscut oprește rândul, nu îl trece pe București', () => {
    const strange = cohort('LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Română', 'MRK - Ploiești')
    assert.equal(registryDimensions(strange, CENTRES), null, 'nu se ghicește un centru')
    assert.equal(deriveProgramme(strange, PROGRAMMES), null)

    /* And it is loud: the cell names the five values, and the row is refused
       with them in the sentence the director reads in the preview. */
    const cell = programmeCell(strange, PROGRAMMES)
    assert.match(cell, /Ploiești/)
    const match = matchProgramme(cell, PROGRAMMES)
    assert.ok(!match.ok && /Ploiești/.test(match.reason), match.ok ? 'a fost acceptat' : match.reason)
  })

  it('o promoție necunoscută rămâne fără program, fără să inventeze unul', () => {
    assert.equal(deriveProgramme(cohort('DOCTORAT', 'CU FRECVENȚĂ', 'x', 'Română'), PROGRAMMES), null)
    assert.equal(deriveProgramme(cohort('LICENȚĂ', 'SERAL', 'Marketing', 'Română'), PROGRAMMES), null)
    /* Licență la distanță in English is a cohort the faculty does not run; the
       five values exist, no programme carries them, and that is a decision for
       the director rather than a nearest match for the importer. */
    assert.equal(deriveProgramme(cohort('LICENȚĂ', 'LA DISTANȚĂ', 'Marketing', 'Engleză'), PROGRAMMES), null)
  })

  /* A row with no cohort at all is a teacher, or a registrar's sheet with the
     columns blank. That is legal and has to stay silent — an „unknown cohort”
     made of five dashes would refuse every teacher in the list. */
  it('cinci celule goale înseamnă „fără program”, nu o promoție necunoscută', () => {
    assert.equal(describeCohort(cohort('', '', '', '', '')), '')
    assert.deepEqual(matchProgramme(programmeCell(cohort('', '', '', '', ''), PROGRAMMES), PROGRAMMES), {
      ok: true,
      programme: null,
    })
  })
})

/* --- the label, and the way back from it -------------------------------------- */

describe('eticheta programului', () => {
  /* The label is what the portal's own lists send and what every imported row
     is matched by. If it stopped resolving to the programme it was made from,
     every single import would land on no programme — so the round trip is
     checked on all thirteen, not on an example. */
  it('fiecare program se regăsește după propria etichetă', () => {
    for (const p of PROGRAMMES) {
      const match = matchProgramme(p.label, PROGRAMMES)
      assert.ok(match.ok && match.programme === p, `nu se regăsește: ${p.label}`)
    }
  })

  it('cele treisprezece etichete sunt distincte două câte două', () => {
    assert.equal(new Set(PROGRAMMES.map((p) => p.label)).size, PROGRAMMES.length)
  })

  /* The form of study is written out even when it is the ordinary one. It is
     the distinction the faculty actually makes at licență, and leaving it off
     would have made the two „cu frecvență” programmes read identically on the
     screen where a director moves a student between them. */
  it('scrie forma de învățământ și când este cea obișnuită', () => {
    assert.equal(
      programmeTitle({ level: 'bachelor', form_of_study: 'if', specialisation: 'Marketing', language: 'ro', location: 'București' }),
      'Marketing · învățământ cu frecvență',
    )
  })

  /* The centre is named only where it distinguishes: eleven options each ending
     in „· București” would bury the two that are not. Nothing is assumed on the
     way in — `location` is NOT NULL and the importer refuses a centre it cannot
     read — so this is presentation and not a default. */
  it('numește centrul doar când nu este cel principal', () => {
    const at = (location: string) =>
      programmeTitle({ level: 'bachelor', form_of_study: 'id', specialisation: 'Marketing', language: 'ro', location })
    assert.equal(at(MAIN_LOCATION), 'Marketing · învățământ la distanță')
    assert.equal(at('Buzău'), 'Marketing · învățământ la distanță · Buzău')
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
function importRows(rows: string[][], programmes: ProgrammeChoice[] = PROGRAMMES) {
  const mapping = guessAccountMapping(REGISTRY_HEADER)
  return parseAccountRows(composeAccountRows(applyAccountMapping(rows, mapping, programmes)))
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
      programme: 'Licență · Marketing · învățământ cu frecvență · Română',
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

  it('caută programul după cinci coloane, nu după „Specializare”', () => {
    const mapping = guessAccountMapping(REGISTRY_HEADER)
    assert.deepEqual(mapping[4], {
      kind: 'programme',
      cycle: REGISTRY_HEADER.indexOf('TipCicluStudii'),
      form: REGISTRY_HEADER.indexOf('FormaInvatamant'),
      specialisation: REGISTRY_HEADER.indexOf('Specializare'),
      language: REGISTRY_HEADER.indexOf('LimbaProgram'),
      location: REGISTRY_HEADER.indexOf('denumire'),
    })
  })

  it('„NULL” în inițiale nu respinge rândul și nu ajunge în nume', () => {
    const row = registryRow({
      TipCicluStudii: 'MASTERAT', FormaInvatamant: 'CU FRECVENȚĂ', denumire: BUCHAREST, AnStudiu: '2',
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

/* --- migration 0024, read as text --------------------------------------------- */

/**
 * The backfill, checked against the module it has to agree with.
 *
 * No database is reachable from a test, so the migration is read as the text it
 * is. That is enough for the two things that can actually go wrong with it and
 * would go unnoticed until a deploy: a programme that 0020 or 0023 seeded and
 * 0024 forgot — which becomes a row with the general rule's guess instead of
 * its real dimensions — and the title expression in the SQL drifting from
 * `programmeTitle`, which is how one programme becomes two rows on the next
 * seed and the importer stops matching the labels the portal itself writes.
 */
describe('migrarea 0024', () => {
  const read = (file: string) =>
    readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')

  const seeded = [
    ...read('0020_topic_shape.sql').matchAll(/\('(bachelor|master)',\s*'([^']+)',\s*'(ro|en)',\s*\d+\)/g),
    ...read('0023_registry_import.sql').matchAll(/\('(bachelor|master)',\s*'([^']+)',\s*'(ro|en)',\s*\d+\)/g),
  ].map((m) => ({ level: m[1]!, name: m[2]!, language: m[3]! }))

  const sql0024 = read('0024_programme_dimensions.sql')
  const backfilled = [
    ...sql0024.matchAll(
      /\('(bachelor|master)',\s*'([^']+)',\s*'(if|ifr|id)',\s*'([^']+)',\s*'([^']+)'\)/g,
    ),
  ].map((m) => ({
    level: m[1]!,
    name: m[2]!,
    form_of_study: m[3]!,
    specialisation: m[4]!,
    location: m[5]!,
  }))

  it('cele treisprezece rânduri semănate sunt toate acoperite', () => {
    assert.equal(seeded.length, 13, 'unsprezece din 0020 și două din 0023')
    for (const row of seeded) {
      const found = backfilled.find((b) => b.level === row.level && b.name === row.name)
      assert.ok(found, `0024 nu spune ce este „${row.name}” (${row.level})`)
      assert.ok(FORMS_OF_STUDY.includes(found!.form_of_study))
      assert.ok(found!.specialisation.length > 0)
      assert.ok(found!.location.length > 0)
    }
  })

  /* The five licență rows are the whole reason for the change: one
     specialisation, four forms, two centres — and the old `name` was the only
     place any of it was written down. */
  it('formele de la licență se citesc exact, nu se ghicesc', () => {
    const at = (name: string) => backfilled.find((b) => b.level === 'bachelor' && b.name === name)
    assert.equal(at('Învățământ cu frecvență — RO')?.form_of_study, 'if')
    assert.equal(at('Învățământ cu frecvență — EN')?.form_of_study, 'if')
    assert.equal(at('Învățământ fără frecvență')?.form_of_study, 'ifr')
    assert.equal(at('Învățământ la distanță — București')?.form_of_study, 'id')
    assert.equal(at('Învățământ la distanță — Buzău')?.form_of_study, 'id')
    assert.equal(at('Învățământ la distanță — Buzău')?.location, 'Buzău')
    for (const b of backfilled.filter((x) => x.level === 'bachelor')) {
      assert.equal(b.specialisation, 'Marketing', `licență: ${b.name}`)
    }
  })

  /* At master the name has always BEEN the specialisation, so the backfill must
     copy it and not reword it: a single retyped diacritic is a programme the
     registry's rows stop matching. */
  it('la master specializarea este numele, caracter cu caracter', () => {
    for (const b of backfilled.filter((x) => x.level === 'master')) {
      assert.equal(b.specialisation, b.name)
      assert.equal(b.form_of_study, 'if')
    }
  })

  /* The migration composes `name` in SQL and `programmeTitle` composes it in
     JavaScript. Two spellings of one rule is how a seeded programme and a
     migrated one become two rows for the same cohort. */
  it('cuvintele formelor din SQL sunt cele din `programmes.mjs`', () => {
    const words = Object.fromEntries(
      [...sql0024.matchAll(/WHEN '(if|ifr|id)'\s+THEN '([^']+)'/g)].map((m) => [m[1]!, m[2]!]),
    )
    assert.deepEqual(words, FORM_WORDS)
    assert.ok(
      sql0024.includes(`location <> '${MAIN_LOCATION}'`),
      'centrul principal este același în SQL și în modul',
    )
  })

  it('titlurile pe care le scrie 0024 sunt cele pe care le compune portalul', () => {
    for (const b of backfilled) {
      const title = programmeTitle({ ...b, language: 'ro' })
      assert.ok(title.startsWith(b.specialisation), `„${b.name}” → „${title}”`)
      assert.ok(title.includes(FORM_WORDS[b.form_of_study]!))
      assert.equal(title.includes(b.location), b.location !== MAIN_LOCATION)
    }
  })

  /* `name` is materialised from `programmeTitle`, and a dozen queries print
     `name` on its own — a coordinator's topic list, the catalogue, a seat
     withdrawal refusal, the audit log's subject. So two programmes that differ
     only by language have to differ in their title, or a director picks between
     two identical lines and the log records which one was touched ambiguously.
     This shipped wrong once: the title wrote the form and the centre but not
     the language, so both licență „cu frecvență” rows and both „Managementul
     relațiilor cu clienții” rows carried the same string. */
  it('două programe care diferă doar prin limbă au titluri diferite', () => {
    const ro = { level: 'bachelor', form_of_study: 'if', specialisation: 'Marketing', language: 'ro', location: MAIN_LOCATION }
    const en = { ...ro, language: 'en' }
    assert.notEqual(programmeTitle(ro), programmeTitle(en))
    assert.equal(programmeTitle(ro), 'Marketing · învățământ cu frecvență')
    assert.equal(programmeTitle(en), 'Marketing · învățământ cu frecvență · Engleză')
  })

  it('limba nu se scrie de două ori în eticheta completă', () => {
    const en = { level: 'master', form_of_study: 'if', specialisation: 'Marketing online', language: 'en', location: MAIN_LOCATION }
    const label = programmeLabel(en)
    assert.equal(label.split('Engleză').length - 1, 1, label)
  })

  it('cele treisprezece programe semănate au titluri distincte', () => {
    const titles = PROGRAMMES.map((p) => p.name)
    assert.equal(new Set(titles).size, titles.length, JSON.stringify(titles, null, 1))
  })

  it('0024 scrie și limba în `name`, nu doar forma și centrul', () => {
    assert.ok(/language\s*<>\s*'ro'/.test(sql0024), 'SQL compune numele cu limba')
    assert.ok(sql0024.includes("WHEN 'en' THEN 'Engleză'"), 'SQL folosește același cuvânt ca modulul')
  })

  /* A plain unique index, not a partial one: the database is going to be ported
     to MySQL, which has none, and five partial unique indexes are already a
     known cost of that port. */
  it('indexul de unicitate este simplu, nu parțial', () => {
    const index = sql0024.match(/CREATE UNIQUE INDEX idx_programmes_identity[\s\S]*?;/)?.[0] ?? ''
    assert.ok(index, 'indexul de identitate există')
    assert.ok(!/\bWHERE\b/i.test(index), 'fără WHERE: MySQL nu are indecși parțiali')
    for (const column of ['academic_year_id', 'level', 'form_of_study', 'specialisation', 'language', 'location']) {
      assert.ok(index.includes(column), `identitatea conține ${column}`)
    }
  })
})
