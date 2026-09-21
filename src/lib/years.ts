import { query, queryOne, transaction } from './db'
import { LANGUAGE_WORDS, LEVEL_WORDS } from './programmes.mjs'

/**
 * The academic year.
 *
 * The faculty restarts each year: a new calendar, a new topic catalogue, new
 * seat allocations. People, past pairings and the archive carry over. Everything
 * that resets carries an `academic_year_id`, and almost every read is scoped to
 * the current year unless a page is explicitly looking backwards.
 */

export interface AcademicYear {
  id: string
  label: string
  starts_on: string
  ends_on: string
  is_current: boolean
  /* The department's norm for the year: what a coordinator's base is until
   * somebody decides otherwise about them (0019). Declared here because the
   * director's allocation form has to be able to name the number it is offering
   * to go back to — „pe norma anului” with no number beside it asks the reader
   * to remember what the norm is. The queries already read them: every one of
   * them is `SELECT *`. */
  default_bachelor_seats: number
  default_master_seats: number
}

export function currentYear(): Promise<AcademicYear | null> {
  return queryOne<AcademicYear>(`SELECT * FROM academic_years WHERE is_current LIMIT 1`)
}

/**
 * The running year's label, for page chrome.
 *
 * Every layout, title and footer names the session, so this is read on almost
 * every render — and it changes once a year. Memoised for a few minutes so the
 * header does not cost a query per page, and short enough that the change is
 * visible without a restart on the day the director opens a new year.
 */
let cachedLabel: { value: string; at: number } | null = null

export async function currentYearLabel(): Promise<string> {
  if (cachedLabel && Date.now() - cachedLabel.at < 5 * 60 * 1000) return cachedLabel.value
  const year = await currentYear().catch(() => null)
  const value = year?.label ?? ''
  cachedLabel = { value, at: Date.now() }
  return value
}

export function allYears(): Promise<AcademicYear[]> {
  return query<AcademicYear>(`SELECT * FROM academic_years ORDER BY starts_on DESC`)
}

export function yearById(id: string): Promise<AcademicYear | null> {
  return queryOne<AcademicYear>(`SELECT * FROM academic_years WHERE id = $1`, [id])
}

/**
 * Opens a new year and closes the one before it.
 *
 * Carrying the topic catalogue over is optional and off by default: a topic
 * proposed for last year's cohort is not automatically on offer again, and the
 * whole point of a new year is that the coordinator re-decides.
 */
export async function openYear(
  label: string,
  startsOn: string,
  endsOn: string,
  options: {
    copyStages: boolean
    copyTopics: boolean
    copyProgrammes: boolean
    /** Carry each coordinator's base over, not just the empty rows. */
    copySeats: boolean
  },
): Promise<string> {
  return transaction(async (client) => {
    const { rows: previous } = await client.query<{ id: string }>(
      `SELECT id FROM academic_years WHERE is_current LIMIT 1`,
    )
    await client.query(`UPDATE academic_years SET is_current = false WHERE is_current`)

    /* The norm travels with the department, not with the calendar.
     *
     * Left to the column default, the first rollover after the seats rework
     * would quietly reset every coordinator who is on the norm to 5 and 3,
     * whatever the department had agreed. Carried over from the year being
     * closed, and only falling back to the default when there is no year to
     * carry it from. */
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO academic_years (label, starts_on, ends_on, is_current,
                                   default_bachelor_seats, default_master_seats)
       VALUES ($1, $2::date, $3::date, true,
               COALESCE((SELECT default_bachelor_seats FROM academic_years
                          WHERE id = $4::uuid), 5),
               COALESCE((SELECT default_master_seats FROM academic_years
                          WHERE id = $4::uuid), 3))
       RETURNING id`,
      [label, startsOn, endsOn, previous[0]?.id ?? null],
    )
    const yearId = rows[0].id
    const from = previous[0]?.id

    if (from && options.copyProgrammes) {
      /* The five facts travel with the programme.
       *
       * Copying level, name and language alone would have been enough before
       * migration 0024 and is a broken year after it: `form_of_study`,
       * `specialisation` and `location` are NOT NULL, so the insert would fail
       * outright — and if they were nullable, every programme of every new year
       * would start with no identity at all and the importer would match none
       * of them. */
      await client.query(
        `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years,
                                       is_active, form_of_study, specialisation, location)
         SELECT $1, level, name, language, duration_years,
                is_active, form_of_study, specialisation, location
           FROM study_programmes WHERE academic_year_id = $2
         ON CONFLICT DO NOTHING`,
        [yearId, from],
      )

      /* Students follow their programme into the new year.
       *
       * The copy above creates new rows, so without this every student would
       * still point at last year's programme: the new year's cohorts would all
       * read as empty while the students were plainly still there. Matched on
       * the five facts that identify a programme, not on the id, because the id
       * is exactly what changed — and not on `name` either, which is only the
       * label those five compose. */
      await client.query(
        `UPDATE users u
            SET programme_id = nou.id
           FROM study_programmes nou, study_programmes vechi
          WHERE u.programme_id = vechi.id
            AND vechi.academic_year_id = $2
            AND nou.academic_year_id = $1
            AND nou.level = vechi.level
            AND nou.form_of_study = vechi.form_of_study
            AND nou.specialisation = vechi.specialisation
            AND nou.language = vechi.language
            AND nou.location = vechi.location`,
        [yearId, from],
      )
    }
    if (from && options.copyStages) {
      await client.query(
        `INSERT INTO session_stages (academic_year_id, position, title, description, interval_label)
         SELECT $1, position, title, description, interval_label
           FROM session_stages WHERE academic_year_id = $2`,
        [yearId, from],
      )
    }
    if (from && options.copyTopics) {
      /* The programme travels by what it is, not by id: the new year has its
       * own `study_programmes` rows, so the old id points at last year's list.
       * The five facts are the same ones `users.programme_id` is re-pointed by
       * above. A topic whose programme was not carried over arrives without one
       * and is shown as such, rather than pointing at a programme from a
       * session that has ended. */
      await client.query(
        `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                             methodology, domain, programme_id, is_active)
         SELECT $1, t.teacher_id, t.title, t.description, t.level, t.language,
                t.methodology, t.domain, nou.id, t.is_active
           FROM topics t
           LEFT JOIN study_programmes vechi ON vechi.id = t.programme_id
           LEFT JOIN study_programmes nou
             ON nou.academic_year_id = $1
            AND nou.level = vechi.level
            AND nou.form_of_study = vechi.form_of_study
            AND nou.specialisation = vechi.specialisation
            AND nou.language = vechi.language
            AND nou.location = vechi.location
          WHERE t.academic_year_id = $2 AND t.is_active`,
        [yearId, from],
      )
    }

    /* Every coordinator needs a row, so that the director's allocation table is
     * not empty on the first day. The numbers are carried over on request.
     *
     * The allocations almost never change from one year to the next — they are
     * the real capacity of each member of staff — but they started at zero, so
     * the first thing to do in a new year was to type back in forty numbers the
     * portal already knew. It stays an option, because sometimes they really are
     * renegotiated. */
    /* Only the base travels. An extra was argued for one cohort, in one study
     * programme, in the year it was granted — carrying it over would re-fuse
     * exactly what the seats rework separated, and a coordinator would start
     * October with reserved seats nobody had asked for again. The ledger of
     * last year's grants stays where it is, attached to last year. */
    if (from && options.copySeats) {
      await client.query(
        `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_base, master_base)
         SELECT teacher_id, $1, bachelor_base, master_base
           FROM seat_allocations WHERE academic_year_id = $2
         ON CONFLICT (teacher_id, academic_year_id)
         DO UPDATE SET bachelor_base = EXCLUDED.bachelor_base,
                       master_base   = EXCLUDED.master_base`,
        [yearId, from],
      )
    }

    /* A row with both bases NULL is not an empty allocation any more: it reads
     * as „on the norm”, which is what a coordinator nobody has decided about
     * should be. It exists so the director's table lists everybody. */
    await client.query(
      `INSERT INTO seat_allocations (teacher_id, academic_year_id)
       SELECT id, $1 FROM users WHERE role IN ('teacher', 'head')
       ON CONFLICT DO NOTHING`,
      [yearId],
    )

    return yearId
  })
}

/* --- study programmes ------------------------------------------------------- */

export interface Programme {
  id: string
  academic_year_id: string
  level: 'bachelor' | 'master'
  /** The display title, composed from the five facts below by 0024 and by
   * every writer since. Presentation, never an identifier. */
  name: string
  language: 'ro' | 'en' | 'fr' | 'de'
  /** 'if' | 'ifr' | 'id' — cu frecvență, cu frecvență redusă, la distanță. */
  form_of_study: string
  specialisation: string
  /** The teaching centre: „București”, „Buzău”. */
  location: string
  duration_years: number
  is_active: boolean
  students: number
}

export function programmes(yearId: string): Promise<Programme[]> {
  return query<Programme>(
    `SELECT p.*,
            (SELECT count(*)::int FROM users u WHERE u.programme_id = p.id) AS students
       FROM study_programmes p
      WHERE p.academic_year_id = $1
      /* Specialisation first, then the form: the faculty runs one
         specialisation in four forms at licență, and ordering by the composed
         title would still do that — but only for as long as the title happens
         to start with the specialisation. */
      ORDER BY p.level, p.specialisation, p.form_of_study, p.language, p.location`,
    [yearId],
  )
}

/* --- teaching centres -------------------------------------------------------- */

/**
 * The centres the faculty teaches at.
 *
 * Global and not scoped to a year on purpose — see migration 0025: a building
 * exists whether or not this year's programmes use it, and `openYear` above
 * copies `location` forward verbatim, so a year-scoped table would make the
 * rollover depend on rows it does not create.
 *
 * `programmes` counts how many name each one, because that is the number that
 * decides whether a centre can be removed: the foreign key refuses a delete
 * while it is above zero, and a button that looks pressable and is not is worse
 * than one that says why.
 */
export interface TeachingLocation {
  name: string
  programmes: number
}

export function teachingLocations(): Promise<TeachingLocation[]> {
  return query<TeachingLocation>(
    `SELECT l.name,
            (SELECT count(*)::int FROM study_programmes p WHERE p.location = l.name) AS programmes
       FROM teaching_locations l
      ORDER BY l.name`,
  )
}

/* --- user-facing Romanian labels -------------------------------------------- */

/* The words themselves live in `programmes.mjs`, which the browser and the seed
 * script both run and this module cannot be: `db` opens a connection on its
 * first line. They were written out a second time here and a third time in
 * `import/students.ts`, and three copies of „Licență” is how an imported row
 * lands on no programme at all — the label is matched character for character. */
export const LANGUAGE_LABELS: Record<string, string> = LANGUAGE_WORDS

export const LEVEL_LABELS: Record<string, string> = LEVEL_WORDS

export function languageLabel(code: string | null): string {
  return (code && LANGUAGE_LABELS[code]) || 'Română'
}

export function levelLabel(level: string | null): string {
  return (level && LEVEL_LABELS[level]) || 'Licență'
}

/**
 * „Licență · Marketing · engleză · anul 3 · seria B” — the cohort a student
 * belongs to, in one line.
 *
 * The series is part of it because the faculty splits a year into series before
 * it splits it into groups, and six screens read this one function: adding it
 * here is what keeps the coordinator's list, the message panel and the profile
 * from each describing the same student differently. The group code itself
 * stays out — it belongs in a column of its own, next to the year, on the
 * screens that administer it.
 *
 * `study_series` is optional in the type on purpose: several callers select
 * only what they render, and a required field would break them at compile time
 * for a line they do not show.
 */
export function groupLabel(u: {
  program: string | null
  specialization: string | null
  study_language?: string | null
  study_year?: number | null
  study_series?: string | null
}): string {
  const parts = [levelLabel(u.program)]
  if (u.specialization) parts.push(u.specialization)
  if (u.study_language && u.study_language !== 'ro') {
    parts.push(languageLabel(u.study_language).toLowerCase())
  }
  if (u.study_year) parts.push(`anul ${u.study_year}`)
  if (u.study_series) parts.push(`seria ${u.study_series}`)
  return parts.join(' · ')
}

/**
 * The series, written the same way wherever it is stored.
 *
 * It is free text typed by hand, exactly like the group code — so „a”, „A” and
 * „ A ” would otherwise coexist and the catalogue's series filter would offer
 * all three as separate cohorts. Trimmed and upper-cased at every write point.
 */
export function normalizeSeries(raw: unknown): string {
  return String(raw ?? '').trim().toLocaleUpperCase('ro-RO')
}
