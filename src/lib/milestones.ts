/* The extension is written out, unlike everywhere else in `src/lib`.
 *
 * This module exists in order to be testable, and `node --test` resolves ESM
 * the way the specification does: extensionless relative specifiers do not
 * exist for it. Vite and `astro check` accept the explicit form as well, so the
 * `.ts` here is what lets the same file serve the pages and the test runner. */
import { localDay } from './date.ts'
import { numar } from './text.ts'

/**
 * What a deadline is, as far as a screen is concerned.
 *
 * Split out of `repo.ts` for the same reason `date.ts` was: none of it touches
 * the database, and while it lived next to the queries it could not be tested —
 * importing `repo.ts` drags the connection pool in with it. `repo.ts` re-exports
 * everything below, so the pages that already imported it need not change.
 */

export const MILESTONE_LABELS: Record<string, string> = {
  planned: 'Planificat',
  in_progress: 'În lucru',
  done: 'Finalizat',
}

/**
 * The real state of a milestone, not just the stored one.
 *
 * The database has three states, none of them „overdue”, so a missed milestone
 * looked identical to a future one: on 29 July, „Predarea formei finale ·
 * 14 iulie” still read „Planificat”, and the start page announced as the „next
 * milestone” one five months past.
 *
 * Being overdue is not written to the database — it is read off the calendar
 * every time, because otherwise somebody would have to keep it up to date.
 */
export type MilestoneState = 'planned' | 'in_progress' | 'done' | 'overdue'

/**
 * The comparison is between two `YYYY-MM-DD` strings, not between two `Date`s.
 *
 * `due_on` arrives as a UTC midnight ISO string (the driver parses `date` that
 * way, see adapters/postgres.ts) while `new Date()` is local midnight in
 * Bucharest — two instants two hours apart for the same calendar day. Comparing
 * the days as text removes the question entirely, and makes „today” an argument
 * a test can supply.
 */
export function day(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = String(iso).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

export function milestoneState(
  status: string,
  dueOn: string | null | undefined,
  today: string = localDay(new Date()),
): MilestoneState {
  if (status === 'done') return 'done'
  const due = day(dueOn)
  if (!due) return status === 'in_progress' ? 'in_progress' : 'planned'
  if (due < today) return 'overdue'
  return status === 'in_progress' ? 'in_progress' : 'planned'
}

export const MILESTONE_STATE_LABELS: Record<MilestoneState, string> = {
  planned: 'Planificat',
  in_progress: 'În lucru',
  done: 'Finalizat',
  overdue: 'Termen depășit',
}

export const MILESTONE_STATE_CLASS: Record<MilestoneState, string> = {
  planned: 'badge--ciorna',
  in_progress: 'badge--in-lucru',
  done: 'badge--aprobata',
  overdue: 'badge--respinsa',
}

/** Whole days from `today` to the deadline; negative once it has passed. */
export function daysUntil(
  dueOn: string | null | undefined,
  today: string = localDay(new Date()),
): number | null {
  const due = day(dueOn)
  if (!due) return null
  return Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000)
}

/**
 * „în 3 zile”, „acum 12 zile” — the half of a date that answers the question.
 *
 * A coordinator reading „10 martie” has to work out where that is relative to
 * today before the row means anything. Both are shown: the date is the fact,
 * this is the reading of it.
 */
export function dueHint(
  dueOn: string | null | undefined,
  today: string = localDay(new Date()),
): string | null {
  const d = daysUntil(dueOn, today)
  if (d === null) return null
  if (d === 0) return 'astăzi'
  if (d === 1) return 'mâine'
  if (d === -1) return 'ieri'
  return d > 0 ? `în ${numar(d, 'zi', 'zile')}` : `acum ${numar(-d, 'zi', 'zile')}`
}

export interface MilestoneLike {
  status: string
  due_on: string | null
}

/**
 * The three piles a coordinator actually keeps.
 *
 * One undifferentiated list makes „who is late” a reading exercise across
 * twenty rows. Overdue first and oldest first — the most missed deadline is the
 * one to open a conversation about; then what is coming, nearest first, with
 * the undated ones at the back because they cannot be scheduled against;
 * finished work last and most recent first, since it is consulted, not worked
 * on.
 */
export function groupMilestones<T extends MilestoneLike>(
  list: readonly T[],
  today: string = localDay(new Date()),
): { overdue: T[]; upcoming: T[]; done: T[] } {
  const overdue: T[] = []
  const upcoming: T[] = []
  const done: T[] = []

  for (const m of list) {
    if (m.status === 'done') done.push(m)
    else if (milestoneState(m.status, m.due_on, today) === 'overdue') overdue.push(m)
    else upcoming.push(m)
  }

  const byDate = (dir: 1 | -1) => (a: T, b: T) => {
    const x = day(a.due_on)
    const y = day(b.due_on)
    // Undated rows sit at the end of every pile, in both directions: a deadline
    // with no date is not „the furthest away”, it is unscheduled.
    if (!x && !y) return 0
    if (!x) return 1
    if (!y) return -1
    return x < y ? -dir : x > y ? dir : 0
  }

  overdue.sort(byDate(1))
  upcoming.sort(byDate(1))
  done.sort(byDate(-1))

  return { overdue, upcoming, done }
}

/**
 * Which stretch of the calendar a deadline falls in.
 *
 * The upcoming pile is still a list of dates; these are the three buckets a
 * coordinator plans in. „Luna aceasta” is the next thirty days rather than the
 * calendar month, because on 29 August a calendar month leaves two days in it
 * and everything else in „mai târziu”.
 */
export type DueBucket = 'week' | 'month' | 'later' | 'undated'

export const BUCKET_LABELS: Record<DueBucket, string> = {
  week: 'Săptămâna aceasta',
  month: 'Luna aceasta',
  later: 'Mai târziu',
  undated: 'Fără termen',
}

export function dueBucket(
  dueOn: string | null | undefined,
  today: string = localDay(new Date()),
): DueBucket {
  const d = daysUntil(dueOn, today)
  if (d === null) return 'undated'
  if (d <= 7) return 'week'
  if (d <= 30) return 'month'
  return 'later'
}
