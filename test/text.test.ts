import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { numar } from '../src/lib/text.ts'

/**
 * Acordul cu numeralul.
 *
 * Regula românească pentru „de” după 19 este exact felul de detaliu pe care un
 * portal îl scrie greșit peste tot și nimeni nu îl raportează, dar care face
 * textul să sune ca tradus automat. Aici se decide o dată.
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
    // Nici măcar 20,5 nu cere „de”: numeralul nu mai e întreg.
    assert.equal(numar(20.5, 'oră', 'ore'), '20,5 ore')
  })
})
