import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { monthLabel, startOfWeek, weekLabel } from '../src/lib/date.ts'

/**
 * Grouping by week and by month.
 *
 * These are calendar functions, that is, exactly the place where mistakes do not
 * show: a wrongly computed „luni” moves a slot into a neighbouring week and
 * nobody notices until a consultation is missed. Sunday is the trap — `getDay()`
 * puts it at zero, so a Romanian week ends with the lowest-numbered day.
 */

describe('startOfWeek', () => {
  it('duce orice zi la lunea săptămânii ei', () => {
    // 2026-08-03 is a Monday.
    for (const [zi, expected] of [
      ['2026-08-03', '2026-08-03'], // Monday
      ['2026-08-05', '2026-08-03'], // Wednesday
      ['2026-08-08', '2026-08-03'], // Saturday
      ['2026-08-09', '2026-08-03'], // Sunday — the trap
      ['2026-08-10', '2026-08-10'], // the following Monday
    ] as const) {
      assert.equal(startOfWeek(zi + 'T12:00:00'), expected, zi)
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
  const today = '2026-08-05' // Wednesday

  it('numește săptămânile din jurul celei curente', () => {
    assert.equal(weekLabel('2026-08-03', today).name, 'Săptămâna aceasta')
    assert.equal(weekLabel('2026-08-10', today).name, 'Săptămâna viitoare')
    assert.equal(weekLabel('2026-07-27', today).name, 'Săptămâna trecută')
  })

  it('păstrează intervalul exact ca subtitlu al unui nume', () => {
    const e = weekLabel('2026-08-03', today)
    assert.equal(e.interval, '3–9 august')
  })

  it('o săptămână depărtată se numește prin interval, fără subtitlu', () => {
    const e = weekLabel('2026-09-14', today)
    assert.equal(e.name, '14–20 septembrie')
    assert.equal(e.interval, null, 'nu se repetă ce e deja în nume')
  })

  it('o săptămână care traversează două luni le scrie pe amândouă', () => {
    const e = weekLabel('2026-08-31', today)
    assert.equal(e.name, '31 august – 6 septembrie')
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
