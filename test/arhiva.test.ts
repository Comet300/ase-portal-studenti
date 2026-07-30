import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { citesteRanduriArhiva, nivelArhiva } from '../src/lib/arhiva.ts'

/**
 * Cititorul rândurilor de arhivă.
 *
 * Aceeași funcție citește ce se arată în previzualizare și ce se scrie în arhiva
 * publică. Dacă cele două s-ar despărți, previzualizarea ar arăta un tabel corect
 * și s-ar importa altul — de aceea testele de aici sunt despre ce *respinge*, nu
 * doar despre ce acceptă: fiecare respingere este un rând care nu ajunge greșit
 * într-un registru pe care îl citește toată facultatea.
 */

const RAND_BUN =
  'Ana Petre;MK-2021-0142;Marketing strategic;master;ro;Conf. univ. dr. Cristian Vasile;Strategii de preț;2022-07-05'

describe('citesteRanduriArhiva', () => {
  it('citește un rând complet', () => {
    const { bune, respinse } = citesteRanduriArhiva(RAND_BUN)
    assert.equal(respinse.length, 0)
    assert.deepEqual(bune[0], {
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
    const { bune, respinse } = citesteRanduriArhiva(
      ['Ana Petre;;;;;Cristian Vasile;Un titlu;', 'Ana Petre;;;;;;Un titlu;', ';;;;;Cristian Vasile;Un titlu;'].join(
        '\n',
      ),
    )
    assert.equal(bune.length, 1, 'doar primul are toate trei')
    assert.equal(respinse.length, 2)
    assert.match(respinse[0].motiv, /studentul, coordonatorul sau titlul/)
  })

  it('respinge o dată scrisă în cuvinte, în loc să o dea Postgresului', () => {
    const { bune, respinse } = citesteRanduriArhiva(RAND_BUN.replace('2022-07-05', 'iulie 2022'))
    assert.equal(bune.length, 0)
    assert.match(respinse[0].motiv, /AAAA-LL-ZZ/)
    assert.ok(respinse[0].motiv.includes('iulie 2022'), 'motivul citează valoarea')
  })

  it('respinge o dată care arată ISO dar nu există în calendar', () => {
    const { bune, respinse } = citesteRanduriArhiva(RAND_BUN.replace('2022-07-05', '2022-02-31'))
    assert.equal(bune.length, 0)
    assert.match(respinse[0].motiv, /nu există în calendar/)
  })

  it('acceptă un rând fără dată: nu toate susținerile au una înregistrată', () => {
    const { bune, respinse } = citesteRanduriArhiva(RAND_BUN.replace(';2022-07-05', ';'))
    assert.equal(respinse.length, 0)
    assert.equal(bune[0].defended, '')
  })

  it('numerotează rândurile cum le numără omul, de la 1, ignorând liniile goale', () => {
    const { respinse } = citesteRanduriArhiva(['', RAND_BUN, '   ', 'doar un nume', ''].join('\n'))
    assert.equal(respinse[0].numar, 2, 'al doilea rând cu conținut')
  })

  it('taie pe tab când nu există punct și virgulă — lipire directă din Excel', () => {
    const { bune } = citesteRanduriArhiva(RAND_BUN.replace(/;/g, '\t'))
    assert.equal(bune.length, 1)
    assert.equal(bune[0].studentName, 'Ana Petre')
    assert.equal(bune[0].title, 'Strategii de preț')
  })

  it('păstrează punctul și virgulă drept separator când există amândouă', () => {
    // Un titlu poate conține un tab lipit din foaie; separatorul rămâne „;”.
    const { bune } = citesteRanduriArhiva('Ana P;;;;;Cristian V;Titlu\tcu tab;')
    assert.equal(bune.length, 1)
    assert.equal(bune[0].title, 'Titlu\tcu tab')
  })

  it('taie spațiile din fiecare celulă', () => {
    const { bune } = citesteRanduriArhiva('  Ana Petre  ;  MK-1  ;;;;  Cristian V  ;  Titlu  ;  2022-07-05  ')
    assert.equal(bune[0].studentName, 'Ana Petre')
    assert.equal(bune[0].studentNumber, 'MK-1')
    assert.equal(bune[0].defended, '2022-07-05')
  })

  it('un text gol nu produce nici rânduri, nici erori', () => {
    assert.deepEqual(citesteRanduriArhiva('   \n\n  '), { bune: [], respinse: [] })
  })

  it('păstrează textul rândului respins, ca previzualizarea să îl poată arăta', () => {
    const stricat = 'doar un nume'
    const { respinse } = citesteRanduriArhiva(stricat)
    assert.equal(respinse[0].text, stricat)
  })
})

describe('nivelArhiva', () => {
  it('recunoaște cum scrie secretariatul', () => {
    for (const scris of ['master', 'Master', 'MASTER', ' m ', 'M']) {
      assert.equal(nivelArhiva(scris), 'master', `„${scris}”`)
    }
  })

  it('orice altceva este licență, inclusiv gol', () => {
    for (const scris of ['licenta', 'Licență', 'bachelor', '', 'x']) {
      assert.equal(nivelArhiva(scris), 'bachelor', `„${scris}”`)
    }
  })
})
