import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { citesteRanduriConturi, rolCont } from '../src/lib/conturi.ts'

/**
 * Cititorul listelor de oameni.
 *
 * Aceeași funcție decide ce se arată în previzualizare și ce conturi se creează.
 * Testele sunt despre ce *respinge*: fiecare rând respins e un cont care nu se
 * creează greșit, iar un cont greșit înseamnă un om care nu poate intra —
 * autentificarea trece exclusiv prin adresa scrisă aici.
 */

const BUN = 'Ioana Dumitru;ioana.dumitru@stud.ase.ro;student;MK-2025-0142;Marketing;3;RO-1503'

describe('citesteRanduriConturi', () => {
  it('citește un rând complet', () => {
    const { bune, respinse } = citesteRanduriConturi(BUN)
    assert.equal(respinse.length, 0)
    assert.deepEqual(bune[0], {
      name: 'Ioana Dumitru',
      email: 'ioana.dumitru@stud.ase.ro',
      role: 'student',
      studentNumber: 'MK-2025-0142',
      programme: 'Marketing',
      year: '3',
      group: 'RO-1503',
    })
  })

  it('cere numele și adresa; restul e opțional', () => {
    const { bune, respinse } = citesteRanduriConturi(
      ['Ana Pop;ana@x.ro;;;;;', ';ana@x.ro;student;;;;', 'Ana Pop;;student;;;;'].join('\n'),
    )
    assert.equal(bune.length, 1)
    assert.equal(respinse.length, 2)
    assert.match(respinse[0].motiv, /numele sau adresa/)
  })

  it('rolul lipsă înseamnă student — cazul cel mai frecvent', () => {
    assert.equal(citesteRanduriConturi('Ana Pop;ana@x.ro;;;;;').bune[0].role, 'student')
  })

  it('respinge o adresă care nu e adresă', () => {
    for (const rau of ['fara-arond', 'a@b', 'a b@x.ro', '@x.ro', 'a@']) {
      const { bune, respinse } = citesteRanduriConturi(`Ana Pop;${rau};student;;;;`)
      assert.equal(bune.length, 0, `„${rau}” nu trebuie acceptat`)
      assert.match(respinse[0].motiv, /adresă de email/)
    }
  })

  it('respinge un rol inventat, ca să nu creeze un cont cu drepturi greșite', () => {
    const { bune, respinse } = citesteRanduriConturi('Ana Pop;ana@x.ro;portar;;;;')
    assert.equal(bune.length, 0)
    assert.match(respinse[0].motiv, /nu e recunoscut/)
  })

  /* Duplicatul se prinde la citire, nu în baza de date: altfel primul rând ar
   * intra și al doilea ar rupe importul la jumătate. */
  it('prinde aceeași adresă de două ori în aceeași listă', () => {
    const { bune, respinse } = citesteRanduriConturi(
      ['Ana Pop;ana@x.ro;student;;;;', 'Ana Popescu;ANA@X.RO;student;;;;'].join('\n'),
    )
    assert.equal(bune.length, 1)
    assert.match(respinse[0].motiv, /de două ori/)
  })

  it('normalizează adresa la litere mici — cheia de unicitate', () => {
    assert.equal(citesteRanduriConturi('Ana;Ana.Pop@Stud.ASE.ro;student;;;;').bune[0].email, 'ana.pop@stud.ase.ro')
  })

  it('respinge un an din afara intervalului', () => {
    assert.equal(citesteRanduriConturi('Ana;ana@x.ro;student;;;9;').bune.length, 0)
    assert.equal(citesteRanduriConturi('Ana;ana@x.ro;student;;;3;').bune.length, 1)
    assert.equal(citesteRanduriConturi('Ana;ana@x.ro;student;;;;').bune.length, 1, 'anul lipsă e permis')
  })

  it('taie pe tab când nu există punct și virgulă — lipire din Excel', () => {
    const { bune } = citesteRanduriConturi(BUN.replace(/;/g, '\t'))
    assert.equal(bune.length, 1)
    assert.equal(bune[0].email, 'ioana.dumitru@stud.ase.ro')
  })

  /* Numerotarea contorizează rândurile *cu conținut*, ca la importul de arhivă:
     cine lipește dintr-o foaie de calcul nu are linii goale, iar dacă are, nu le
     numără. Aici „rândul 2” este al doilea rând scris, nu a doua linie din text. */
  it('numerotează rândurile cu conținut, sărind peste liniile goale', () => {
    const { respinse } = citesteRanduriConturi(['', BUN, '  ', 'Stricat;nu-e-email;student;;;;'].join('\n'))
    assert.equal(respinse[0].numar, 2, 'al doilea rând cu conținut')
  })

  it('un text gol nu produce nimic și nicio eroare', () => {
    assert.deepEqual(citesteRanduriConturi('  \n\n '), { bune: [], respinse: [] })
  })
})

describe('rolCont', () => {
  it('recunoaște cum scrie secretariatul', () => {
    for (const s of ['', 'student', 'Student', 's']) assert.equal(rolCont(s), 'student', `„${s}”`)
    for (const s of ['cadru didactic', 'Profesor', 'teacher', 'c']) assert.equal(rolCont(s), 'teacher', `„${s}”`)
    for (const s of ['director', 'Head', 'director de departament']) assert.equal(rolCont(s), 'head', `„${s}”`)
  })

  it('nu ghicește un rol pe care nu îl știe', () => {
    for (const s of ['portar', 'secretar', 'admin']) assert.equal(rolCont(s), null, `„${s}”`)
  })
})
