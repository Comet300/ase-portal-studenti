import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatInitial, numar, officialName } from '../src/lib/text.ts'

/**
 * Agreement with the numeral.
 *
 * The Romanian rule for „de” after 19 is exactly the kind of detail a portal
 * gets wrong everywhere and nobody ever reports, but which makes the text read
 * like machine translation. It is settled here, once.
 */

describe('numar', () => {
  it('singularul, pentru unu', () => {
    assert.equal(numar(1, 'consultație', 'consultații'), '1 consultație')
    assert.equal(numar(1, 'oră', 'ore'), '1 oră')
  })

  it('pluralul simplu, de la doi la nouăsprezece', () => {
    assert.equal(numar(2, 'oră', 'ore'), '2 ore')
    assert.equal(numar(19, 'oră', 'ore'), '19 ore')
  })

  it('„de” de la douăzeci în sus — regula pe care o pierde toată lumea', () => {
    assert.equal(numar(20, 'oră', 'ore'), '20 de ore')
    assert.equal(numar(45, 'cerere', 'cereri'), '45 de cereri')
    assert.equal(numar(100, 'oră', 'ore'), '100 de ore')
  })

  it('se uită la ultimele două cifre, nu la mărimea numărului', () => {
    assert.equal(numar(101, 'oră', 'ore'), '101 ore')
    assert.equal(numar(119, 'oră', 'ore'), '119 ore')
    assert.equal(numar(120, 'oră', 'ore'), '120 de ore')
    assert.equal(numar(1000, 'oră', 'ore'), '1000 de ore')
  })

  it('zero este plural', () => {
    assert.equal(numar(0, 'consultație', 'consultații'), '0 consultații')
  })

  it('zecimalele se scriu cu virgulă și merg la plural', () => {
    assert.equal(numar(1.5, 'oră', 'ore'), '1,5 ore')
    assert.equal(numar(2.5, 'oră', 'ore'), '2,5 ore')
    // Not even 20,5 takes „de”: the numeral is no longer a whole number.
    assert.equal(numar(20.5, 'oră', 'ore'), '20,5 ore')
  })
})

/**
 * The official name.
 *
 * Three printed documents depend on it, and the secretariat matches them
 * against the register by exactly this form: „Popescu I. Maria”, not
 * „Popescu Maria”.
 */
describe('officialName', () => {
  it('pune inițiala după numele de familie', () => {
    assert.equal(officialName({ name: 'Popescu Maria', father_initial: 'I' }), 'Popescu I. Maria')
    assert.equal(officialName({ name: 'Popescu Maria', father_initial: 'I.' }), 'Popescu I. Maria')
  })

  it('păstrează toate prenumele', () => {
    assert.equal(
      officialName({ name: 'Popescu Ana Maria', father_initial: 'gh' }),
      'Popescu Gh. Ana Maria',
    )
  })

  /* Cadrele didactice nu au inițiala în evidență, și nici un student al cărui
     rând nu a fost completat încă — numele lor trebuie să rămână neatins. */
  it('fără inițială, numele rămâne exact cum e scris', () => {
    assert.equal(officialName({ name: 'Prof. univ. dr. Elena Radu' }), 'Prof. univ. dr. Elena Radu')
    assert.equal(officialName({ name: 'Popescu Maria', father_initial: '' }), 'Popescu Maria')
    assert.equal(officialName({ name: 'Popescu Maria', father_initial: null }), 'Popescu Maria')
  })

  it('un singur cuvânt primește inițiala la sfârșit, nu se pierde', () => {
    assert.equal(officialName({ name: 'Popescu', father_initial: 'I' }), 'Popescu I.')
  })
})

describe('formatInitial', () => {
  it('acceptă una sau două litere, cu sau fără punct', () => {
    assert.equal(formatInitial('i'), 'I.')
    assert.equal(formatInitial('I.'), 'I.')
    assert.equal(formatInitial('GH'), 'Gh.')
    assert.equal(formatInitial('ș'), 'Ș.')
  })

  it('nu scrie nimic pentru o celulă care nu e o inițială', () => {
    for (const bad of ['', null, undefined, 'Ionescu', '3', 'I-'] as const) {
      assert.equal(formatInitial(bad), '', `„${bad}”`)
    }
  })
})
