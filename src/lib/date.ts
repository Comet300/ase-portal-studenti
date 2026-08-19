/**
 * Dates, written in Romanian.
 *
 * In a file of its own, with no dependency at all, for two reasons that are in
 * fact the same one: formatting a date has nothing to do with the database, and
 * while it sat in `repo.ts` it could be neither tested nor imported in the
 * browser without dragging the Postgres connection along with it. A test that
 * needs `DATABASE_URL` in order to check that Sunday falls in the right week
 * never gets written.
 */


/* --- Romanian formatting --------------------------------------------------- */

export const MONTHS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

/** Monday first, as the whole portal groups: `getDay()` numbering is not this. */
export const WEEKDAYS = ['luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă', 'duminică']

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return withTime ? `${base}, ${formatTime(iso)}` : base
}

/**
 * Monday, as the grouping anchor.
 *
 * A consultation schedule is read by weeks — "what do I have this week" —
 * not as thirty rows one after another. The week starts on Monday, as in the
 * Romanian calendar, and `getDay()` puts Sunday at zero, so it is pushed to the
 * tail of the week that is ending.
 */
export function startOfWeek(iso: string): string {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  const zi = d.getDay()
  d.setDate(d.getDate() - (zi === 0 ? 6 : zi - 1))
  return localDay(d)
}

/**
 * The day, written from the local components.
 *
 * `toISOString()` goes through UTC, and the portal runs on `Europe/Bucharest`: at
 * midnight on Monday, the local time is 21:00 Sunday in UTC, so the day came out
 * one lower. The effect: every Monday fell into the week before, and the groups
 * of consultations were named „26 iulie – 1 august” — that is, Sunday to Saturday.
 * It looked plausible enough to go unnoticed.
 *
 * Exported because the pages compute their own „azi” for `min`/`max` on date
 * fields, and every one of them had written `toISOString().slice(0, 10)` —
 * the same bug, once per screen: between midnight and 03:00 in summer a
 * coordinator could publish consultation hours for a day already gone.
 */
export function localDay(d: Date): string {
  const l = String(d.getMonth() + 1).padStart(2, '0')
  const z = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${l}-${z}`
}

/**
 * What a week is called, relative to the one you are in.
 *
 * „Săptămâna 4–10 august” is exact, but „săptămâna aceasta” is what the eye is
 * looking for, and the two do not exclude each other: the first stays as a
 * subtitle.
 */
export function weekLabel(mondayIso: string, todayIso = localDay(new Date())) {
  const monday = new Date(mondayIso + 'T00:00:00')
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)

  const aceasta = startOfWeek(todayIso)
  const weeksAway = Math.round(
    (monday.getTime() - new Date(aceasta + 'T00:00:00').getTime()) / (7 * 86_400_000),
  )

  const name =
    weeksAway === 0
      ? 'Săptămâna aceasta'
      : weeksAway === 1
        ? 'Săptămâna viitoare'
        : weeksAway === -1
          ? 'Săptămâna trecută'
          : null

  const interval =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}–${sunday.getDate()} ${MONTHS[monday.getMonth()]}`
      : `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`

  return { name: name ?? interval, interval: name ? interval : null }
}

/**
 * „august 2026”, for the head of a group of files.
 *
 * The files of one supervision gather once a month — a chapter, a data set —
 * so the month is the only natural division in a list that keeps growing. The
 * year is written only when it is not the current one, otherwise it repeats in
 * every group header.
 */
export function monthLabel(iso: string, todayIso = localDay(new Date())): string {
  const d = new Date(iso)
  const currentYear = new Date(todayIso).getFullYear()
  return d.getFullYear() === currentYear
    ? MONTHS[d.getMonth()]
    : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'acum'
  if (min < 60) return `acum ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `acum ${hours} ${hours === 1 ? 'oră' : 'ore'}`
  const days = Math.floor(hours / 24)
  if (days < 30) return `acum ${days} ${days === 1 ? 'zi' : 'zile'}`
  return formatDate(iso)
}

export function shortMonth(iso: string): string {
  return MONTHS[new Date(iso).getMonth()].slice(0, 3)
}

/**
 * The six weeks a month is drawn on.
 *
 * A month grid is not the month: it starts on the Monday of the week the first
 * falls in, and it is always six rows — never five, even for a February that
 * fits in four. A panel that changes height between two months moves the „luna
 * următoare” button out from under the cursor that is pressing it.
 *
 * `new Date(an, luna, 1 - 3)` normalises into the previous month on its own, so
 * the edges of the year need no special case, and the days are read off the
 * local components: the grid drawn on screen is the calendar the reader lives in,
 * not the one in UTC.
 */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const shift = (first.getDay() + 6) % 7 // luni = 0
  return Array.from({ length: 42 }, (_, i) => localDay(new Date(year, month, 1 - shift + i)))
}

/** „2026-08-19” as a local date, or null when it is not a day at all. */
export function parseDay(iso: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!parts) return null
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  // 2026-02-31 parses field by field and lands in March; it is not a day.
  return localDay(d) === iso ? d : null
}
