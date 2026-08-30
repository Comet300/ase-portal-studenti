import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { localDay, monthGrid, monthLabel, parseDay, startOfWeek, weekLabel } from '../src/lib/date.ts'

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

/**
 * The grid the picker is drawn on.
 *
 * Everything the panel shows comes out of here, so the traps are the ones a
 * calendar always has: the week that starts before the month does, February,
 * and the turn of the year. Six rows always — a panel that changes height
 * between two months moves its own „luna următoare” button out from under the
 * cursor pressing it.
 */
describe('monthGrid', () => {
  it('începe de luni și ține șase săptămâni întregi', () => {
    const august = monthGrid(2026, 7)
    assert.equal(august.length, 42)
    assert.equal(august[0], '2026-07-27', '1 august 2026 e sâmbătă, deci luna începe în iulie')
    assert.equal(august[41], '2026-09-06')
    for (let i = 0; i < 42; i += 7) {
      assert.equal(startOfWeek(august[i] + 'T12:00:00'), august[i], august[i] + ' e luni')
    }
  })

  it('nu sare peste zile și nu repetă niciuna', () => {
    const days = monthGrid(2026, 2) // martie 2026, cu schimbarea orei de vară
    assert.equal(new Set(days).size, 42, 'nicio zi de două ori')
    for (let i = 1; i < days.length; i++) {
      const before = new Date(days[i - 1] + 'T12:00:00')
      before.setDate(before.getDate() + 1)
      assert.equal(days[i], localDay(before), 'după ' + days[i - 1])
    }
  })

  it('trece peste capătul anului', () => {
    const january = monthGrid(2027, 0)
    assert.equal(january[0], '2026-12-28', '1 ianuarie 2027 e vineri')
    assert.ok(january.includes('2027-01-31'))
  })

  it('cuprinde februarie întreg, și pe cel de 29 de zile', () => {
    const bisect = monthGrid(2028, 1)
    assert.ok(bisect.includes('2028-02-29'), '2028 e an bisect')
    assert.ok(!monthGrid(2026, 1).includes('2026-02-29'))
  })
})

describe('localDay', () => {
  it('scrie ziua din componentele locale, nu din UTC', () => {
    // La miezul nopții, ora locală, `toISOString()` este încă în ziua trecută.
    assert.equal(localDay(new Date(2026, 7, 3, 0, 30)), '2026-08-03')
    assert.equal(localDay(new Date(2026, 0, 1, 1, 0)), '2026-01-01')
  })

  it('completează cu zero luna și ziua', () => {
    assert.equal(localDay(new Date(2026, 0, 5, 12, 0)), '2026-01-05')
  })
})

describe('parseDay', () => {
  it('citește o zi ISO ca dată locală', () => {
    const d = parseDay('2026-08-19')
    assert.equal(d?.getFullYear(), 2026)
    assert.equal(d?.getMonth(), 7)
    assert.equal(d?.getDate(), 19)
  })

  it('refuză ce nu este o zi', () => {
    // 31 februarie se citește câmp cu câmp și aterizează în martie: nu e o zi.
    assert.equal(parseDay('2026-02-31'), null)
    assert.equal(parseDay('2026-8-19'), null)
    assert.equal(parseDay(''), null)
    assert.equal(parseDay('2026-08-19T10:00:00'), null)
  })
})
