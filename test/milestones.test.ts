import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dueBucket,
  dueHint,
  daysUntil,
  groupMilestones,
  milestoneState,
} from '../src/lib/milestones.ts'

/**
 * The deadline vocabulary.
 *
 * None of this had a test, and two of the bugs it now pins were live: the
 * coordinator's list was in insertion order because `due_on` was only ever a
 * tiebreaker, and „Termen depășit” existed for the student and not for the
 * person who can act on it. Both are calendar arithmetic, so „today” is an
 * argument here rather than the clock.
 */

const AZI = '2026-08-19'

describe('milestoneState', () => {
  it('finalizat rămâne finalizat, oricât de vechi ar fi termenul', () => {
    assert.equal(milestoneState('done', '2020-01-01', AZI), 'done')
  })

  it('un termen trecut este depășit, indiferent de starea stocată', () => {
    assert.equal(milestoneState('planned', '2026-08-18', AZI), 'overdue')
    assert.equal(milestoneState('in_progress', '2026-08-18', AZI), 'overdue')
  })

  it('ziua termenului nu este încă o depășire', () => {
    assert.equal(milestoneState('planned', AZI, AZI), 'planned')
    assert.equal(milestoneState('in_progress', AZI, AZI), 'in_progress')
  })

  it('fără dată nu există depășire', () => {
    assert.equal(milestoneState('planned', null, AZI), 'planned')
    assert.equal(milestoneState('in_progress', null, AZI), 'in_progress')
  })

  /* The driver hands back `date` columns as UTC-midnight ISO strings, while the
   * process runs on Europe/Bucharest: comparing two `Date`s put the boundary
   * two hours out. Only the day is compared, so the timestamp cannot move it. */
  it('citește ziua din marca de timp completă, nu instantul', () => {
    assert.equal(milestoneState('planned', '2026-08-19T00:00:00.000Z', AZI), 'planned')
    assert.equal(milestoneState('planned', '2026-08-18T21:00:00.000Z', AZI), 'overdue')
  })
})

describe('daysUntil și dueHint', () => {
  it('numără zile întregi, în ambele sensuri', () => {
    assert.equal(daysUntil('2026-08-22', AZI), 3)
    assert.equal(daysUntil('2026-08-07', AZI), -12)
    assert.equal(daysUntil(null, AZI), null)
  })

  it('scrie relația în cuvinte, cu acordul numeralului', () => {
    assert.equal(dueHint(AZI, AZI), 'astăzi')
    assert.equal(dueHint('2026-08-20', AZI), 'mâine')
    assert.equal(dueHint('2026-08-18', AZI), 'ieri')
    assert.equal(dueHint('2026-08-22', AZI), 'în 3 zile')
    assert.equal(dueHint('2026-08-07', AZI), 'acum 12 zile')
    // Peste 19, româna cere „de”: 20 de zile, nu 20 zile.
    assert.equal(dueHint('2026-09-10', AZI), 'în 22 de zile')
  })
})

describe('groupMilestones', () => {
  const m = (title: string, due_on: string | null, status = 'planned') => ({
    title,
    due_on,
    status,
  })

  it('separă depășitele, următoarele și finalizatele', () => {
    const { overdue, upcoming, done } = groupMilestones(
      [m('a', '2026-08-01'), m('b', '2026-09-01'), m('c', '2026-07-01', 'done')],
      AZI,
    )
    assert.deepEqual(overdue.map((x) => x.title), ['a'])
    assert.deepEqual(upcoming.map((x) => x.title), ['b'])
    assert.deepEqual(done.map((x) => x.title), ['c'])
  })

  /* The bug the screen had: rows arrived in insertion order, so a February
   * deadline added after a June one sat below it for ever. */
  it('ordonează după dată, nu după ordinea în care au fost scrise', () => {
    const { upcoming } = groupMilestones(
      [m('iunie', '2027-06-20'), m('februarie', '2027-02-01'), m('aprilie', '2027-04-10')],
      AZI,
    )
    assert.deepEqual(upcoming.map((x) => x.title), ['februarie', 'aprilie', 'iunie'])
  })

  it('depășitele încep cu cel mai vechi', () => {
    const { overdue } = groupMilestones(
      [m('recent', '2026-08-15'), m('vechi', '2026-03-02')],
      AZI,
    )
    assert.deepEqual(overdue.map((x) => x.title), ['vechi', 'recent'])
  })

  it('finalizatele încep cu cel mai recent', () => {
    const { done } = groupMilestones(
      [m('vechi', '2026-01-10', 'done'), m('recent', '2026-06-10', 'done')],
      AZI,
    )
    assert.deepEqual(done.map((x) => x.title), ['recent', 'vechi'])
  })

  it('un termen fără dată stă la coadă, nu la sfârșitul calendarului', () => {
    const { upcoming } = groupMilestones(
      [m('nedatat', null), m('septembrie', '2026-09-01')],
      AZI,
    )
    assert.deepEqual(upcoming.map((x) => x.title), ['septembrie', 'nedatat'])
  })

  it('un termen finalizat nu ajunge niciodată în depășite', () => {
    const { overdue, done } = groupMilestones([m('vechi', '2020-01-01', 'done')], AZI)
    assert.equal(overdue.length, 0)
    assert.equal(done.length, 1)
  })
})

describe('dueBucket', () => {
  it('împarte viitorul în săptămâna aceasta, luna aceasta și mai târziu', () => {
    assert.equal(dueBucket(AZI, AZI), 'week')
    assert.equal(dueBucket('2026-08-26', AZI), 'week')
    assert.equal(dueBucket('2026-08-27', AZI), 'month')
    assert.equal(dueBucket('2026-09-18', AZI), 'month')
    assert.equal(dueBucket('2026-09-19', AZI), 'later')
    assert.equal(dueBucket(null, AZI), 'undated')
  })
})
