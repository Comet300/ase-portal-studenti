import { query, queryOne, transaction } from './db'

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
}

export function currentYear(): Promise<AcademicYear | null> {
  return queryOne<AcademicYear>(`SELECT * FROM academic_years WHERE is_current LIMIT 1`)
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
  options: { copyStages: boolean; copyTopics: boolean; copyProgrammes: boolean },
): Promise<string> {
  return transaction(async (client) => {
    const { rows: previous } = await client.query<{ id: string }>(
      `SELECT id FROM academic_years WHERE is_current LIMIT 1`,
    )
    await client.query(`UPDATE academic_years SET is_current = false WHERE is_current`)

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO academic_years (label, starts_on, ends_on, is_current)
       VALUES ($1, $2::date, $3::date, true) RETURNING id`,
      [label, startsOn, endsOn],
    )
    const yearId = rows[0].id
    const from = previous[0]?.id

    if (from && options.copyProgrammes) {
      await client.query(
        `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years, is_active)
         SELECT $1, level, name, language, duration_years, is_active
           FROM study_programmes WHERE academic_year_id = $2
         ON CONFLICT DO NOTHING`,
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
      await client.query(
        `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                             methods, prerequisites, seats, is_active)
         SELECT $1, teacher_id, title, description, level, language,
                methods, prerequisites, seats, is_active
           FROM topics WHERE academic_year_id = $2 AND is_active`,
        [yearId, from],
      )
    }

    // Seats do not carry over as numbers, but every coordinator needs a row so
    // the director's allocation table is not empty on day one.
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
  name: string
  language: 'ro' | 'en' | 'fr' | 'de'
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
      ORDER BY p.level, p.name, p.language`,
    [yearId],
  )
}

/* --- user-facing Romanian labels -------------------------------------------- */

export const LANGUAGE_LABELS: Record<string, string> = {
  ro: 'Română',
  en: 'Engleză',
  fr: 'Franceză',
  de: 'Germană',
}

export const LEVEL_LABELS: Record<string, string> = {
  bachelor: 'Licență',
  master: 'Master',
}

export function languageLabel(code: string | null): string {
  return (code && LANGUAGE_LABELS[code]) || 'Română'
}

export function levelLabel(level: string | null): string {
  return (level && LEVEL_LABELS[level]) || 'Licență'
}

/** „Licență · Marketing · engleză” — the group a student belongs to, in one line. */
export function groupLabel(u: {
  program: string | null
  specialization: string | null
  study_language?: string | null
  study_year?: number | null
}): string {
  const parts = [levelLabel(u.program)]
  if (u.specialization) parts.push(u.specialization)
  if (u.study_language && u.study_language !== 'ro') {
    parts.push(languageLabel(u.study_language).toLowerCase())
  }
  if (u.study_year) parts.push(`anul ${u.study_year}`)
  return parts.join(' · ')
}
