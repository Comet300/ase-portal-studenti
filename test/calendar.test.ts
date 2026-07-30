import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { monthLabel, startOfWeek, weekLabel } from '../src/lib/date.ts'

/**
 * Gruparea pe săptămâni și pe luni.
 *
 * Sunt funcții de calendar, adică exact locul unde greșelile nu se văd: „luni”
 * calculat greșit mută un interval într-o săptămână vecină și nimeni nu observă
 * până nu se ratează o consultație. Duminica este capcana — `getDay()` o pune la
 * zero, deci o săptămână românească se termină cu ziua cu numărul cel mai mic.
 */

describe('startOfWeek', () => {
  it('duce orice zi la lunea săptămânii ei', () => {
    // 2026-08-03 este o luni.
    for (const [zi, aștept] of [
      ['2026-08-03', '2026-08-03'], // luni
      ['2026-08-05', '2026-08-03'], // miercuri
      ['2026-08-08', '2026-08-03'], // sâmbătă
      ['2026-08-09', '2026-08-03'], // duminică — capcana
      ['2026-08-10', '2026-08-10'], // luni următoare
    ] as const) {
      assert.equal(startOfWeek(zi + 'T12:00:00'), aștept, zi)
    }
  })

  it('trece corect peste începutul lunii și al anului', () => {
    assert.equal(startOfWeek('2026-01-01T09:00:00'), '2025-12-29', '1 ianuarie 2026 e joi')
    assert.equal(startOfWeek('2026-03-01T09:00:00'), '2026-02-23', '1 martie 2026 e duminică')
  })

  it('nu se mută în funcție de ora din zi', () => {
    assert.equal(startOfWeek('2026-08-05T00:10:00'), startOfWeek('2026-08-05T23:50:00'))
  })
})

describe('weekLabel', () => {
  const azi = '2026-08-05' // miercuri

  it('numește săptămânile din jurul celei curente', () => {
    assert.equal(weekLabel('2026-08-03', azi).nume, 'Săptămâna aceasta')
    assert.equal(weekLabel('2026-08-10', azi).nume, 'Săptămâna viitoare')
    assert.equal(weekLabel('2026-07-27', azi).nume, 'Săptămâna trecută')
  })

  it('păstrează intervalul exact ca subtitlu al unui nume', () => {
    const e = weekLabel('2026-08-03', azi)
    assert.equal(e.interval, '3–9 august')
  })

  it('o săptămână depărtată se numește prin interval, fără subtitlu', () => {
    const e = weekLabel('2026-09-14', azi)
    assert.equal(e.nume, '14–20 septembrie')
    assert.equal(e.interval, null, 'nu se repetă ce e deja în nume')
  })

  it('o săptămână care traversează două luni le scrie pe amândouă', () => {
    const e = weekLabel('2026-08-31', azi)
    assert.equal(e.nume, '31 august – 6 septembrie')
  })
})

describe('monthLabel', () => {
  it('scrie luna în românește, fără an, când e anul curent', () => {
    assert.equal(monthLabel('2026-08-14T10:00:00', '2026-07-30T10:00:00'), 'august')
  })

  it('adaugă anul când nu e cel curent, ca să nu pară din primăvară', () => {
    assert.equal(monthLabel('2025-04-14T10:00:00', '2026-07-30T10:00:00'), 'aprilie 2025')
  })
})
