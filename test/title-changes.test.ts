import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeChanges,
  hasThesisChanges,
  normalizeThesis,
  thesisDiff,
  validateThesis,
} from '../src/lib/title-changes.ts'

/**
 * The rules of a title change, without a database.
 *
 * The transactional half — apply and close in one statement — has no harness in
 * this suite, so the parts a person can get wrong on their own are pinned here:
 * what counts as a change at all, and what the refusal says.
 */

const current = {
  title_ro: 'Impactul recenziilor video asupra intenției de cumpărare',
  title_en: null,
  objectives: 'Lucrarea urmărește relația dintre recenziile video și intenția de cumpărare.',
}

describe('normalizeThesis', () => {
  it('golul din titlul englez devine null, nu șir gol', () => {
    assert.equal(normalizeThesis({ title_ro: 'x', title_en: '   ' }).title_en, null)
  })

  it('strânge spațiile din titlu, dar păstrează rândurile obiectivelor', () => {
    const f = normalizeThesis({
      title_ro: '  Titlu   cu   spații  ',
      objectives: '  primul rând\n\nal doilea  ',
    })
    assert.equal(f.title_ro, 'Titlu cu spații')
    assert.equal(f.objectives, 'primul rând\n\nal doilea')
  })
})

describe('validateThesis', () => {
  it('acceptă o modificare completă', () => {
    assert.equal(validateThesis(current), null)
  })

  it('refuză titlul lipsă și spune ce urmează', () => {
    const msg = validateThesis({ ...current, title_ro: '' })
    assert.match(msg ?? '', /obligatoriu/)
    assert.match(msg ?? '', /trimite din nou/)
  })

  it('spune câte caractere mai lipsesc, cu acordul numeralului', () => {
    const msg = validateThesis({ ...current, objectives: 'prea scurt' })
    assert.match(msg ?? '', /încă 30 de caractere/)
  })

  it('refuză un titlu peste limita coloanei', () => {
    assert.match(validateThesis({ ...current, title_ro: 'a'.repeat(201) }) ?? '', /Scurtează/)
  })
})

describe('thesisDiff', () => {
  it('nu vede nicio schimbare când textele sunt identice', () => {
    assert.deepEqual(thesisDiff(current, { ...current }), [])
    assert.equal(hasThesisChanges(current, { ...current }), false)
  })

  it('vede doar câmpurile care chiar diferă', () => {
    const changes = thesisDiff(current, { ...current, title_ro: 'Alt titlu' })
    assert.deepEqual(changes.map((c) => c.field), ['title_ro'])
    assert.equal(changes[0].from, current.title_ro)
    assert.equal(changes[0].to, 'Alt titlu')
  })

  /* A title added in English is a change from nothing; „—” is what every screen
   * prints for an absent value, so the diff shows the same thing. */
  it('adăugarea titlului englez pornește de la „—”', () => {
    const changes = thesisDiff(current, { ...current, title_en: 'Video reviews' })
    assert.equal(changes[0].from, '—')
    assert.equal(changes[0].to, 'Video reviews')
  })
})

describe('describeChanges', () => {
  it('numește ce s-a schimbat, nu câte', () => {
    const changes = thesisDiff(current, {
      title_ro: 'Alt titlu',
      title_en: 'Another title',
      objectives: 'Alte obiective, suficient de lungi pentru a trece de pragul de patruzeci.',
    })
    assert.equal(describeChanges(changes), 'titlul, titlul în engleză și obiectivele')
    assert.equal(describeChanges(changes.slice(0, 1)), 'titlul')
    assert.equal(describeChanges([]), '')
  })
})
