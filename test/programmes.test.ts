import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAIN_LOCATION,
  normalizeLocation,
  programmeLabel,
  programmeTitle,
} from '../src/lib/programmes.mjs'

/**
 * A teaching centre, on the way in.
 *
 * `location` is part of what identifies a programme — the unique index of
 * migration 0024 has it — so two spellings of one city are two programmes, each
 * with its own seats, its own catalogue entry and half of one cohort's
 * students, and nothing anywhere saying they are the same people. Migration
 * 0025 stops a programme naming a centre that does not exist; this function is
 * what stops the centre table itself from collecting the near-duplicates one
 * level down.
 */
describe('normalizeLocation', () => {
  it('taie spațiile de la capete, care nu se văd pe ecran', () => {
    assert.equal(normalizeLocation('  Buzău '), 'Buzău')
    assert.equal(normalizeLocation('Buzău '), 'Buzău')
  })

  it('strânge spațiile dinăuntru la unul singur', () => {
    assert.equal(normalizeLocation('Râmnicu   Vâlcea'), 'Râmnicu Vâlcea')
    assert.equal(normalizeLocation('Râmnicu Vâlcea'), 'Râmnicu Vâlcea')
  })

  /* Windows-1250 has only the Turkish cedilla, so every value pasted out of an
     Excel saved on a Romanian machine arrives in the wrong alphabet. Two
     alphabets in one register is a centre that never comes back from a search
     — and here, a second programme for the same cohort. */
  it('trece sedila turcească în virgula românească, ca peste tot în portal', () => {
    assert.equal(normalizeLocation('Bucureşti'), 'București')
    assert.equal(normalizeLocation('Constanţa'), 'Constanța')
  })

  it('nu atinge literele mari și mici, pentru că nu are cum să le ghicească', () => {
    assert.equal(normalizeLocation('BUCUREȘTI'), 'BUCUREȘTI')
    assert.equal(normalizeLocation('râmnicu vâlcea'), 'râmnicu vâlcea')
  })

  it('o valoare lipsă rămâne goală, nu devine centrul principal', () => {
    assert.equal(normalizeLocation(null), '')
    assert.equal(normalizeLocation(undefined), '')
    assert.equal(normalizeLocation('   '), '')
    assert.notEqual(normalizeLocation(''), MAIN_LOCATION)
  })

  it('este idempotentă: ce a trecut o dată trece la fel a doua oară', () => {
    for (const raw of ['  Buzǎu ', 'Bucureşti', 'Râmnicu   Vâlcea', 'Buzău']) {
      assert.equal(normalizeLocation(normalizeLocation(raw)), normalizeLocation(raw))
    }
  })

  /* The point of all of the above, in the terms the database cares about: the
     three spellings that used to be three programmes are now one value, and a
     title composed from it is one title. */
  it('cele trei scrieri ale unui oraș devin o singură valoare, deci un singur program', () => {
    const spellings = ['Buzău', ' Buzău ', 'Buzău ']
    const centres = new Set(spellings.map(normalizeLocation))
    assert.equal(centres.size, 1, [...centres].join(' | '))

    const titles = new Set(
      spellings.map((location) =>
        programmeTitle({
          level: 'bachelor',
          form_of_study: 'id',
          specialisation: 'Marketing',
          language: 'ro',
          location: normalizeLocation(location),
        }),
      ),
    )
    assert.deepEqual([...titles], ['Marketing · învățământ la distanță · Buzău'])
  })

  it('centrul principal nu se scrie în titlu, dar se scrie în etichetă', () => {
    const p = {
      level: 'bachelor',
      form_of_study: 'if',
      specialisation: 'Marketing',
      language: 'ro',
      location: normalizeLocation(' Bucureşti '),
    }
    assert.equal(p.location, MAIN_LOCATION)
    assert.equal(programmeTitle(p), 'Marketing · învățământ cu frecvență')
    assert.equal(programmeLabel(p), 'Licență · Marketing · învățământ cu frecvență · Română')
  })
})
