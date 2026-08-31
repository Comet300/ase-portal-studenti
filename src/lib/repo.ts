import { execute, query, queryOne } from './db'
import { capacityOf, freeFor, isFullFor } from './seats'
import type {
  Level as SeatLevel,
  TeacherCapacity as TeacherCapacityShape,
} from './seats'

/* Date formatting moved to `lib/date.ts` — it has nothing to do with the
 * database, and there it can be tested and imported in the browser. It is
 * re-exported from here so the thirty pages that imported it need not all
 * change. */
export {
  formatDate,
  formatTime,
  localDay,
  monthLabel,
  shortMonth,
  startOfWeek,
  timeAgo,
  weekLabel,
} from './date'

/* Same reasoning for the deadline vocabulary: the labels, the „overdue” state
 * and the grouping are calendar arithmetic, not queries. They moved to
 * `lib/milestones.ts` where a test can reach them, and are re-exported here
 * because eight screens import them from this module. */
export {
  BUCKET_LABELS,
  dueBucket,
  dueHint,
  daysUntil,
  groupMilestones,
  MILESTONE_LABELS,
  MILESTONE_STATE_CLASS,
  MILESTONE_STATE_LABELS,
  milestoneState,
} from './milestones'
export type { DueBucket, MilestoneState } from './milestones'

/**
 * Application queries.
 *
 * There is no row-level security, so every function touching a teacher's data
 * takes `teacherId` first and applies it in the same statement that reads or
 * writes. Checking separately beforehand would leave a gap between check and act.
 *
 * Everything that resets each year is scoped by `academic_year_id`. Callers pass
 * a year only when they are deliberately looking at a past one; otherwise the
 * statement resolves the current year itself, so no page can silently mix two.
 */

/** SQL for „the year the caller asked for, or the one running now”. */
const thisYear = (param: number) =>
  `COALESCE($${param}::uuid, (SELECT id FROM academic_years WHERE is_current))`

export interface Stage {
  id: string
  position: number
  title: string
  description: string | null
  interval_label: string
  starts_on: string | null
  ends_on: string | null
}

export interface RequestRow {
  id: string
  number: string
  title_ro: string
  title_en: string | null
  objectives: string
  motivation: string | null
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn' | 'defended'
  /* The programme the seat is charged to, pinned when the request was made.
   * Read off the student until this release, so moving a student between
   * programmes in March moved a seat consumed in October with them. */
  programme_id: string | null
  rejection_reason: string | null
  decision_note: string | null
  expires_at: string | null
  submitted_at: string
  decided_at: string | null
  student_id: string
  student_name: string
  student_email: string
  student_number: string | null
  program: 'bachelor' | 'master' | null
  specialization: string | null
  study_language: string
  study_group: string | null
  study_series: string | null
  study_year: number | null
  father_initial: string | null
  student_avatar: string | null
  teacher_id: string
  teacher_name: string
  academic_title: string | null
}

/**
 * Every field a request carries wherever it is shown.
 *
 * Kept as one list on purpose: the queue, the student's own view and the
 * archive render the same record, and a field selected in only one of them is
 * a field that silently disappears in the others — which is exactly how the
 * response deadline and the motivation went missing from the triage screen.
 */
const REQUEST_FIELDS = `
  r.id, r.number, r.title_ro, r.title_en, r.objectives, r.motivation,
  r.status, r.rejection_reason, r.decision_note, r.expires_at,
  r.submitted_at, r.decided_at, r.programme_id,
  s.id AS student_id, s.name AS student_name, s.email AS student_email,
  s.student_number, s.program, s.specialization, s.father_initial,
  s.study_language, s.study_group, s.study_series, s.study_year, s.avatar_path AS student_avatar,
  t.id AS teacher_id, t.name AS teacher_name, t.academic_title`

/* --- user-facing Romanian labels ------------------------------------------- */

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Ciornă',
  pending: 'În așteptare',
  approved: 'Aprobată',
  rejected: 'Respinsă',
  expired: 'Expirată',
  withdrawn: 'Retrasă',
  defended: 'Susținută',
}

export const STATUS_CLASS: Record<string, string> = {
  draft: 'badge--ciorna',
  pending: 'badge--asteptare',
  approved: 'badge--aprobata',
  rejected: 'badge--respinsa',
  // Expiry is not a refusal: nobody said no, the deadline simply passed.
  expired: 'badge--ciorna',
  withdrawn: 'badge--ciorna',
  defended: 'badge--aprobata',
}

export const INVITATION_LABELS: Record<string, string> = {
  pending: 'În așteptarea studentului',
  accepted: 'Acceptată',
  declined: 'Refuzată',
  expired: 'Expirată',
}

export function programLabel(program: string | null): string {
  return program === 'master' ? 'Master' : 'Licență'
}

/* --- session calendar ------------------------------------------------------ */

export function stages(yearId?: string) {
  return query<Stage>(
    `SELECT * FROM session_stages WHERE academic_year_id = ${thisYear(1)} ORDER BY position`,
    [yearId ?? null],
  )
}

export function currentStage(yearId?: string) {
  return queryOne<Stage>(
    `SELECT * FROM session_stages
      WHERE academic_year_id = ${thisYear(1)}
        AND starts_on <= current_date AND ends_on >= current_date
      ORDER BY position LIMIT 1`,
    [yearId ?? null],
  )
}

/* --- teacher --------------------------------------------------------------- */

export function teacherRequests(teacherId: string, status?: string, yearId?: string) {
  return query<RequestRow>(
    `SELECT ${REQUEST_FIELDS}
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.teacher_id = $1 AND ($2::text IS NULL OR r.status = $2)
        AND r.academic_year_id = ${thisYear(3)}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.submitted_at DESC`,
    [teacherId, status ?? null, yearId ?? null],
  )
}

export function teacherStats(teacherId: string, yearId?: string) {
  return queryOne<{
    pending: number
    approved: number
    rejected: number
    expired: number
    total: number
    avg_response_hours: number | null
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'pending')::int  AS pending,
       count(*) FILTER (WHERE status = 'approved')::int AS approved,
       count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       count(*) FILTER (WHERE status = 'expired')::int  AS expired,
       count(*)::int                                    AS total,
       round(avg(EXTRACT(EPOCH FROM (decided_at - submitted_at)) / 3600)
             FILTER (WHERE decided_at IS NOT NULL))::int AS avg_response_hours
     FROM requests WHERE teacher_id = $1 AND academic_year_id = ${thisYear(2)}`,
    [teacherId, yearId ?? null],
  )
}

/* --- seats: a base per coordinator, extras earmarked per programme ---------- */

/**
 * Capacity, read once and shared.
 *
 * Everything that decides whether a coordinator can take one more student goes
 * through here: the three gates, the catalogue, the coordinator's dashboard and
 * the director's table. The department screen used to carry a hand-copied
 * duplicate of this SQL, which meant the one person who has to trust these
 * numbers was the one person capable of seeing a different set.
 *
 * The arithmetic itself is in `lib/seats.ts`, without a database, because it is
 * the part that has to be tested.
 */
export type { Capacity, Level, Pot, TeacherCapacity } from './seats'

/** Whoever the availability is being computed for. A `User` satisfies it. */
export interface SeatViewer {
  programme_id: string | null
  program: 'bachelor' | 'master' | null
}

interface BaseRow {
  teacher_id: string
  bachelor_base: number | null
  master_base: number | null
  norm_bachelor: number
  norm_master: number
}

interface PotRow {
  teacher_id: string
  level: SeatLevel
  programme_id: string | null
  programme_name: string | null
  granted: number
  taken: number
}

/**
 * Every coordinator's capacity for the year, keyed by coordinator.
 *
 * Two statements rather than one: the bases are one row per coordinator and the
 * pots are one row per (coordinator, level, programme), and folding them into a
 * single result would repeat each base once per programme and leave the caller
 * to un-repeat it. Both are small — one row per member of staff, one per
 * programme they have students in.
 */
export async function teacherCapacities(
  teacherId?: string | null,
  yearId?: string,
): Promise<Map<string, TeacherCapacityShape>> {
  const params = [teacherId ?? null, yearId ?? null]

  const bases = await query<BaseRow>(
    `SELECT t.id AS teacher_id, a.bachelor_base, a.master_base,
            COALESCE(y.default_bachelor_seats, 0) AS norm_bachelor,
            COALESCE(y.default_master_seats, 0)   AS norm_master
       FROM users t
       LEFT JOIN academic_years y ON y.id = ${thisYear(2)}
       LEFT JOIN seat_allocations a
         ON a.teacher_id = t.id AND a.academic_year_id = ${thisYear(2)}
      WHERE t.role IN ('teacher', 'head')
        AND ($1::uuid IS NULL OR t.id = $1)`,
    params,
  )

  /* A grant and a supervision are counted on the same (level, programme) key,
   * so the two halves are joined FULL OUTER: a programme can have an earmark
   * nobody has used yet, and it can have students with no earmark at all.
   *
   * The level of a supervision comes from the pinned programme, and falls back
   * to `users.program` only for the rows that predate `requests.programme_id`.
   * „defended” counts as taken: a bachelor's thesis defended in the February
   * session used to hand the seat back for the remaining seven months of the
   * year, which nobody had decided. */
  const pots = await query<PotRow>(
    `WITH gr AS (
       SELECT g.teacher_id, g.level, g.programme_id, SUM(g.seats)::int AS granted
         FROM seat_grants g
        WHERE g.academic_year_id = ${thisYear(2)} AND g.revoked_at IS NULL
          AND ($1::uuid IS NULL OR g.teacher_id = $1)
        GROUP BY 1, 2, 3
     ), tk AS (
       SELECT r.teacher_id, COALESCE(p.level, s.program) AS level, r.programme_id,
              count(*)::int AS taken
         FROM requests r
         JOIN users s ON s.id = r.student_id
         LEFT JOIN study_programmes p ON p.id = r.programme_id
        WHERE r.academic_year_id = ${thisYear(2)}
          AND r.status IN ('approved', 'defended')
          AND COALESCE(p.level, s.program) IN ('bachelor', 'master')
          AND ($1::uuid IS NULL OR r.teacher_id = $1)
        GROUP BY 1, 2, 3
     )
     SELECT COALESCE(gr.teacher_id, tk.teacher_id)   AS teacher_id,
            COALESCE(gr.level, tk.level)             AS level,
            COALESCE(gr.programme_id, tk.programme_id) AS programme_id,
            sp.name AS programme_name,
            COALESCE(gr.granted, 0) AS granted,
            COALESCE(tk.taken, 0)   AS taken
       FROM gr
       FULL OUTER JOIN tk
         ON tk.teacher_id = gr.teacher_id AND tk.level = gr.level
        AND tk.programme_id IS NOT DISTINCT FROM gr.programme_id
       LEFT JOIN study_programmes sp ON sp.id = COALESCE(gr.programme_id, tk.programme_id)`,
    params,
  )

  const byTeacher = new Map<string, { bachelor: PotRow[]; master: PotRow[] }>()
  for (const row of pots) {
    const entry = byTeacher.get(row.teacher_id) ?? { bachelor: [], master: [] }
    entry[row.level].push(row)
    byTeacher.set(row.teacher_id, entry)
  }

  const out = new Map<string, TeacherCapacityShape>()
  for (const b of bases) {
    const own = byTeacher.get(b.teacher_id) ?? { bachelor: [], master: [] }
    out.set(b.teacher_id, {
      teacher_id: b.teacher_id,
      bachelor: capacityOf({
        level: 'bachelor',
        base: b.bachelor_base ?? b.norm_bachelor,
        isNorm: b.bachelor_base === null,
        pots: own.bachelor,
      }),
      master: capacityOf({
        level: 'master',
        base: b.master_base ?? b.norm_master,
        isNorm: b.master_base === null,
        pots: own.master,
      }),
    })
  }
  return out
}

/** One coordinator's capacity. Empty rather than absent when they have no row. */
export async function teacherCapacity(
  teacherId: string,
  yearId?: string,
): Promise<TeacherCapacityShape> {
  const all = await teacherCapacities(teacherId, yearId)
  return (
    all.get(teacherId) ?? {
      teacher_id: teacherId,
      bachelor: capacityOf({ level: 'bachelor', base: 0, isNorm: false, pots: [] }),
      master: capacityOf({ level: 'master', base: 0, isNorm: false, pots: [] }),
    }
  )
}

export interface Seats {
  bachelor_seats: number
  master_seats: number
  bachelor_taken: number
  master_taken: number
  total_seats: number
  total_taken: number
  /**
   * Free at either level, ignoring who is asking.
   *
   * Kept for the screens that describe a coordinator to nobody in particular —
   * their own profile page, their own dashboard header. It is NOT a gate: a
   * gate knows which student is at the door and must call `freeFor` with their
   * programme, because most of this number can be reserved for programmes that
   * student is not in.
   */
  free: number
}

export async function teacherSeats(teacherId: string, yearId?: string): Promise<Seats> {
  const cap = await teacherCapacity(teacherId, yearId)
  return {
    bachelor_seats: cap.bachelor.total,
    master_seats: cap.master.total,
    bachelor_taken: cap.bachelor.taken,
    master_taken: cap.master.taken,
    total_seats: cap.bachelor.total + cap.master.total,
    total_taken: cap.bachelor.taken + cap.master.taken,
    free: cap.bachelor.free_any + cap.master.free_any,
  }
}

/**
 * The programmes of the year in view, for the pickers that earmark seats.
 *
 * Inactive ones are still listed when they already hold grants, so the ledger
 * can name what it is showing; the API refuses new grants to them.
 */
export interface SeatProgramme {
  id: string
  level: SeatLevel
  name: string
  language: string
  is_active: boolean
}

export function seatProgrammes(yearId?: string): Promise<SeatProgramme[]> {
  return query<SeatProgramme>(
    `SELECT p.id, p.level, p.name, p.language, p.is_active
       FROM study_programmes p
      WHERE p.academic_year_id = ${thisYear(1)}
      ORDER BY p.level, p.name, p.language`,
    [yearId ?? null],
  )
}

/** One entry of the grant ledger, as the director's screen reads it. */
export interface SeatGrant {
  id: string
  teacher_id: string
  teacher_name: string
  programme_id: string | null
  programme_name: string | null
  programme_language: string | null
  level: SeatLevel
  seats: number
  reason: string
  seat_request_id: string | null
  granted_by_name: string | null
  granted_at: string
  revoked_at: string | null
  revoked_by_name: string | null
  revoke_reason: string | null
}

export function seatGrants(
  options: { teacherId?: string; yearId?: string; liveOnly?: boolean } = {},
): Promise<SeatGrant[]> {
  return query<SeatGrant>(
    `SELECT g.id, g.teacher_id, t.name AS teacher_name,
            g.programme_id, p.name AS programme_name, p.language AS programme_language,
            g.level, g.seats, g.reason, g.seat_request_id,
            gb.name AS granted_by_name, g.granted_at,
            g.revoked_at, rb.name AS revoked_by_name, g.revoke_reason
       FROM seat_grants g
       JOIN users t ON t.id = g.teacher_id
       LEFT JOIN study_programmes p ON p.id = g.programme_id
       LEFT JOIN users gb ON gb.id = g.granted_by
       LEFT JOIN users rb ON rb.id = g.revoked_by
      WHERE g.academic_year_id = ${thisYear(2)}
        AND ($1::uuid IS NULL OR g.teacher_id = $1)
        AND ($3::boolean IS NOT TRUE OR g.revoked_at IS NULL)
      ORDER BY g.granted_at DESC`,
    [options.teacherId ?? null, options.yearId ?? null, options.liveOnly ?? null],
  )
}

export interface SupervisedStudent extends RequestRow {
  graduation_year_id: string | null
  milestones_total: number
  milestones_done: number
  /** Not done and past their date. The roster is a triage surface without it. */
  milestones_overdue: number
  conversation_id: string | null
  unread: number
}

export function supervisedStudents(teacherId: string, yearId?: string) {
  return query<SupervisedStudent>(
    `SELECT ${REQUEST_FIELDS}, r.graduation_year_id,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id) AS milestones_total,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id AND m.status = 'done') AS milestones_done,
            /* „4 din 5” reads the same whether the fifth is due next month or
               was due in March. Counted in SQL against current_date, next to
               the two counts it has to agree with. */
            (SELECT count(*)::int FROM milestones m
              WHERE m.request_id = r.id AND m.status <> 'done'
                AND m.due_on IS NOT NULL AND m.due_on < current_date) AS milestones_overdue,
            c.id AS conversation_id,
            COALESCE((SELECT count(*)::int FROM messages msg
                       WHERE msg.conversation_id = c.id
                         AND msg.sender_id = s.id
                         AND msg.read_at IS NULL), 0) AS unread
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
       LEFT JOIN conversations c ON c.student_id = r.student_id AND c.teacher_id = r.teacher_id
      WHERE r.teacher_id = $1 AND r.status = 'approved'
        AND r.academic_year_id = ${thisYear(2)}
      ORDER BY s.name`,
    [teacherId, yearId ?? null],
  )
}

export interface Milestone {
  id: string
  request_id: string
  title: string
  description: string | null
  due_on: string | null
  status: 'planned' | 'in_progress' | 'done'
  position: number
}

/**
 * The timeline a newly approved coordination starts with.
 *
 * A student whose request was just accepted otherwise opens the portal to an
 * empty page; these are the five checkpoints the faculty expects anyway, and the
 * coordinator edits or deletes them from the first consultation onwards.
 */
export const DEFAULT_MILESTONES: ReadonlyArray<readonly [string, string, number]> = [
  ['Stabilirea temei și a bibliografiei', 'Temă confirmată și minimum 20 de titluri bibliografice.', 0],
  ['Capitolul teoretic', 'Sinteza literaturii de specialitate și cadrul conceptual.', 45],
  ['Metodologia cercetării', 'Instrument de cercetare validat, eșantion stabilit.', 90],
  ['Colectarea și analiza datelor', 'Date colectate și prelucrate.', 135],
  ['Predarea formei finale', 'Lucrare completă și verificare antiplagiat.', 180],
]

export function seedMilestones(requestId: string) {
  return execute(
    `INSERT INTO milestones (request_id, title, description, due_on, position)
     SELECT $1, m.title, m.description, (current_date + (m.days || ' days')::interval)::date, m.position
       FROM unnest($2::text[], $3::text[], $4::int[], $5::int[])
            AS m(title, description, days, position)`,
    [
      requestId,
      DEFAULT_MILESTONES.map((m) => m[0]),
      DEFAULT_MILESTONES.map((m) => m[1]),
      DEFAULT_MILESTONES.map((m) => m[2]),
      DEFAULT_MILESTONES.map((_, i) => i),
    ],
  )
}

export function requestMilestones(teacherId: string, requestId: string) {
  return query<Milestone>(
    `SELECT m.id, m.request_id, m.title, m.description, m.due_on, m.status, m.position
       FROM milestones m
       JOIN requests r ON r.id = m.request_id
      WHERE m.request_id = $2 AND r.teacher_id = $1
      ORDER BY m.due_on NULLS LAST, m.position, m.title`,
    [teacherId, requestId],
  )
}

export interface TeacherMilestone extends Milestone {
  student_id: string
  student_name: string
  father_initial: string | null
  /** The thesis the deadline belongs to, so a shared row can still be told apart. */
  thesis_title: string
}

/**
 * Every deadline a coordinator is responsible for, across all their students.
 *
 * The screen could only ever ask about one student at a time — one select, one
 * page load — so „what is due this week” was a question the portal held the
 * answer to and could not be asked. Ordered by date for the same reason the
 * per-thesis list is: this is an agenda.
 */
export function teacherMilestones(teacherId: string, yearId?: string) {
  return query<TeacherMilestone>(
    `SELECT m.id, m.request_id, m.title, m.description, m.due_on, m.status, m.position,
            s.id AS student_id, s.name AS student_name, s.father_initial,
            r.title_ro AS thesis_title
       FROM milestones m
       JOIN requests r ON r.id = m.request_id
       JOIN users s ON s.id = r.student_id
      WHERE r.teacher_id = $1 AND r.status = 'approved'
        AND r.academic_year_id = ${thisYear(2)}
      ORDER BY m.due_on NULLS LAST, s.name, m.position`,
    [teacherId, yearId ?? null],
  )
}

export interface Topic {
  id: string
  title: string
  description: string | null
  level: 'bachelor' | 'master'
  language: 'ro' | 'en' | 'fr' | 'de'
  /** How the research is done: „anchetă, eșantion de 200”, not a method name. */
  methodology: string | null
  /** The field it belongs to: comportamentul consumatorului, retail, digital. */
  domain: string | null
  /** The study programme it is offered to; NULL on the topics written before
   * programmes were asked for, and on those the coordinator has not reopened. */
  programme_id: string | null
  programme_name: string | null
  is_active: boolean
  taken: number
}

export function teacherTopics(teacherId: string, yearId?: string) {
  return query<Topic>(
    `SELECT t.*, p.name AS programme_name,
            (SELECT count(*)::int FROM requests r
              WHERE r.topic_id = t.id AND r.status = 'approved') AS taken
       FROM topics t
       LEFT JOIN study_programmes p ON p.id = t.programme_id
      WHERE t.teacher_id = $1 AND t.academic_year_id = ${thisYear(2)}
      ORDER BY t.is_active DESC, t.created_at DESC`,
    [teacherId, yearId ?? null],
  )
}

export interface Slot {
  id: string
  starts_at: string
  ends_at: string
  mode: 'in_person' | 'online'
  location: string | null
  meeting_url: string | null
  note: string | null
  capacity: number
  is_cancelled: boolean
  booked: number
  /** Everyone who has taken a place, not just the first — a slot may hold several. */
  student_names: string[]
  /** Set when the interval was scheduled with one named student. */
  student_id: string | null
  invited_name: string | null
  /** Published for whoever books it, or scheduled with named students. */
  kind: 'open' | 'scheduled'
  /** Whom it is for: the whole faculty, or the students this person coordinates. */
  audience: 'public' | 'thesis'
  cancelled_reason: string | null
  cancelled_at: string | null
}

/**
 * The coordinator's intervals, from yesterday onwards.
 *
 * The short window is intended for the schedule screen: there the work is with
 * what comes next. History is asked for separately, via `teacherSlotHistory`.
 */
export function teacherSlots(teacherId: string) {
  return query<Slot>(
    `SELECT s.*,
            (SELECT count(*)::int FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked') AS booked,
            COALESCE((SELECT array_agg(u.name ORDER BY u.name)
                        FROM bookings b JOIN users u ON u.id = b.student_id
                       WHERE b.slot_id = s.id AND b.status = 'booked'), '{}') AS student_names,
            (SELECT u.name FROM users u WHERE u.id = s.student_id) AS invited_name
       FROM consultation_slots s
      WHERE s.teacher_id = $1 AND s.starts_at > now() - interval '1 day'
      ORDER BY s.starts_at`,
    [teacherId],
  )
}

/**
 * The consultations that took place.
 *
 * They existed nowhere. `teacherSlots` reaches one day back, and the archive
 * knows nothing about consultations at all — so „when did I last see this
 * student” and „how many consultations did I hold this semester” could not be
 * answered from the portal, even though the portal had scheduled every one of
 * them.
 *
 * Only the ones held are counted: a cancelled interval is not a meeting, and one
 * nobody booked did not happen. The academic year is the one the interval falls
 * in, so that history follows the archive's year selector.
 */
export function teacherSlotHistory(teacherId: string, yearId?: string) {
  return query<{
    id: string
    starts_at: string
    ends_at: string
    mode: string
    location: string | null
    note: string | null
    student_names: string[]
    booked: number
  }>(
    `SELECT s.id, s.starts_at, s.ends_at, s.mode, s.location, s.note,
            (SELECT count(*)::int FROM bookings b
              WHERE b.slot_id = s.id AND b.status = 'booked') AS booked,
            COALESCE((SELECT array_agg(u.name ORDER BY u.name)
                        FROM bookings b JOIN users u ON u.id = b.student_id
                       WHERE b.slot_id = s.id AND b.status = 'booked'), '{}') AS student_names
       FROM consultation_slots s
      WHERE s.teacher_id = $1
        AND s.ends_at < now()
        AND s.is_cancelled = false
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked')
        AND ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM academic_years y
               WHERE y.id = $2 AND s.starts_at::date BETWEEN y.starts_on AND y.ends_on))
      ORDER BY s.starts_at DESC
      LIMIT 200`,
    [teacherId, yearId ?? null],
  )
}

/* --- student --------------------------------------------------------------- */

export function studentRequests(studentId: string) {
  return query<RequestRow>(
    `SELECT ${REQUEST_FIELDS}
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.student_id = $1
      ORDER BY r.submitted_at DESC`,
    [studentId],
  )
}

export function studentMilestones(studentId: string) {
  return query<Milestone>(
    `SELECT m.id, m.request_id, m.title, m.description, m.due_on, m.status, m.position
       FROM milestones m
       JOIN requests r ON r.id = m.request_id
      WHERE r.student_id = $1 AND r.status IN ('approved', 'defended')
      ORDER BY m.due_on NULLS LAST, m.position, m.title`,
    [studentId],
  )
}

/* --- changes to an agreed thesis -------------------------------------------- */

export interface TitleChange {
  id: string
  request_id: string
  requested_by: string
  requester_name: string
  /** True when the coordinator applied it themselves — no decision was needed. */
  by_teacher: boolean
  old_title_ro: string
  old_title_en: string | null
  old_objectives: string
  new_title_ro: string
  new_title_en: string | null
  new_objectives: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  decision_note: string | null
  decided_at: string | null
  created_at: string
  /* The context every screen needs next to it, so a queue row is readable
     without a second query per line. */
  number: string
  student_id: string
  student_name: string
  student_number: string | null
  father_initial: string | null
  teacher_id: string
  teacher_name: string
  /** What the thesis is called right now — not necessarily `old_title_ro`. */
  current_title_ro: string
}

const TITLE_CHANGE_FIELDS = `
  tc.id, tc.request_id, tc.requested_by,
  tc.old_title_ro, tc.old_title_en, tc.old_objectives,
  tc.new_title_ro, tc.new_title_en, tc.new_objectives,
  tc.reason, tc.status, tc.decision_note, tc.decided_at, tc.created_at,
  (tc.requested_by = r.teacher_id) AS by_teacher,
  r.number, r.title_ro AS current_title_ro,
  s.id AS student_id, s.name AS student_name, s.student_number, s.father_initial,
  t.id AS teacher_id, t.name AS teacher_name,
  who.name AS requester_name`

const TITLE_CHANGE_JOINS = `
  FROM title_changes tc
  JOIN requests r ON r.id = tc.request_id
  JOIN users s ON s.id = r.student_id
  JOIN users t ON t.id = r.teacher_id
  JOIN users who ON who.id = tc.requested_by`

/**
 * The coordinator's queue of change requests, open ones first.
 *
 * Scoped to the running session for the same reason the roster is: a title
 * changed two years ago belongs to a closed archive, not to today's decisions.
 */
export function teacherTitleChanges(teacherId: string, yearId?: string) {
  return query<TitleChange>(
    `SELECT ${TITLE_CHANGE_FIELDS} ${TITLE_CHANGE_JOINS}
      WHERE r.teacher_id = $1
        AND r.academic_year_id = ${thisYear(2)}
      ORDER BY CASE tc.status WHEN 'pending' THEN 0 ELSE 1 END, tc.created_at DESC`,
    [teacherId, yearId ?? null],
  )
}

/**
 * Everything that ever happened to this student's thesis text.
 *
 * The coordinator's own edits are in here too: they are written as approved
 * rows rather than as a silent UPDATE, so „de ce se numește altfel decât în
 * cererea pe care am semnat-o” has an answer on the screen.
 */
export function studentTitleChanges(studentId: string) {
  return query<TitleChange>(
    `SELECT ${TITLE_CHANGE_FIELDS} ${TITLE_CHANGE_JOINS}
      WHERE r.student_id = $1
      ORDER BY tc.created_at DESC`,
    [studentId],
  )
}

/** The history of one thesis, oldest first — the printable document uses it. */
export function requestTitleChanges(requestId: string) {
  return query<TitleChange>(
    `SELECT ${TITLE_CHANGE_FIELDS} ${TITLE_CHANGE_JOINS}
      WHERE tc.request_id = $1 AND tc.status = 'approved'
      ORDER BY tc.created_at`,
    [requestId],
  )
}

/* --- public catalogue ------------------------------------------------------ */

export interface Supervisor {
  id: string
  name: string
  email: string
  academic_title: string | null
  department: string | null
  office: string | null
  bio: string | null
  avatar_path: string | null
  interests: string | null
  topic_count: number
  bachelor_seats: number
  master_seats: number
  bachelor_taken: number
  master_taken: number
  /** Free at each level with nobody in particular in mind — earmarks included. */
  bachelor_free: number
  master_free: number
  /**
   * Free for the student who is reading, at their own level and programme.
   * `null` when nobody is signed in: the catalogue can then only state totals.
   */
  free_for_viewer: number | null
  /**
   * Nothing left for the reader. With no reader, nothing left for anybody —
   * which is deliberately the weaker claim: greying out a coordinator who could
   * still take somebody is a worse error than showing one who cannot take you.
   */
  is_full: boolean
  capacity: TeacherCapacityShape
}

/**
 * The public catalogue of coordinators.
 *
 * A coordinator who has run out of seats is not hidden: students need to see
 * who is already taken and by whom, so the list carries the counts and a
 * `is_full` flag instead of quietly shrinking.
 *
 * Availability is relative to the reader. Extras are reserved to one study
 * programme, so „three seats free” is only true of somebody — the same
 * coordinator is full for Marketing and open for Finance at the same moment.
 * Pass the signed-in student and the answer is about them; pass nobody and the
 * page has to say the per-level totals instead of a single verdict.
 */
export async function supervisors(
  options: { yearId?: string; viewer?: SeatViewer | null } = {},
): Promise<Supervisor[]> {
  const rows = await query<Omit<Supervisor,
    'bachelor_free' | 'master_free' | 'free_for_viewer' | 'is_full' | 'capacity'>>(
    `SELECT t.id, t.name, t.email, t.academic_title, t.department, t.office,
            t.bio, t.avatar_path, t.interests,
            (SELECT count(*)::int FROM topics tp
              WHERE tp.teacher_id = t.id AND tp.is_active
                AND tp.academic_year_id = ${thisYear(1)}) AS topic_count,
            0 AS bachelor_seats, 0 AS master_seats, 0 AS bachelor_taken, 0 AS master_taken
       FROM users t
      WHERE t.role IN ('teacher', 'head')
      ORDER BY t.name`,
    [options.yearId ?? null],
  )

  const caps = await teacherCapacities(null, options.yearId)
  const viewer = options.viewer
  const viewerLevel = viewer?.program ?? null

  return rows.map((r) => {
    const cap = caps.get(r.id) ?? {
      teacher_id: r.id,
      bachelor: capacityOf({ level: 'bachelor', base: 0, isNorm: false, pots: [] }),
      master: capacityOf({ level: 'master', base: 0, isNorm: false, pots: [] }),
    }
    const forViewer = viewerLevel
      ? freeFor(viewerLevel === 'master' ? cap.master : cap.bachelor, viewer?.programme_id ?? null)
      : null

    return {
      ...r,
      bachelor_seats: cap.bachelor.total,
      master_seats: cap.master.total,
      bachelor_taken: cap.bachelor.taken,
      master_taken: cap.master.taken,
      bachelor_free: cap.bachelor.free_any,
      master_free: cap.master.free_any,
      free_for_viewer: forViewer,
      is_full: forViewer !== null
        ? forViewer === 0
        : cap.bachelor.free_any + cap.master.free_any === 0,
      capacity: cap,
    }
  })
}

export interface PublicTopic {
  id: string
  title: string
  description: string | null
  level: SeatLevel
  language: 'ro' | 'en' | 'fr' | 'de'
  methodology: string | null
  domain: string | null
  programme_id: string | null
  programme_name: string | null
  taken: number
  teacher_id: string
  teacher_name: string
  academic_title: string | null
  department: string | null
  /** At this topic's level, for the reader if there is one. */
  teacher_is_full: boolean
  /** Free at this topic's level, all programmes together. */
  teacher_free_at_level: number
}

/**
 * Every topic on offer, with the coordinator who proposed it.
 *
 * This is the other way into the catalogue: a student who knows what they want
 * to write about finds the topic first and the coordinator through it. The
 * fullness verdict is per topic, not per coordinator, because it is now decided
 * at the topic's own level — a coordinator with no bachelor seats left and five
 * master seats free was able to accept five bachelor students until this
 * release, and the catalogue said so.
 */
export async function publicTopics(
  options: { yearId?: string; viewer?: SeatViewer | null } = {},
): Promise<PublicTopic[]> {
  const rows = await query<Omit<PublicTopic, 'teacher_is_full' | 'teacher_free_at_level'>>(
    `SELECT t.id, t.title, t.description, t.level, t.language, t.methodology, t.domain,
            t.programme_id, p.name AS programme_name,
            (SELECT count(*)::int FROM requests r
              WHERE r.topic_id = t.id AND r.status IN ('approved', 'defended')) AS taken,
            u.id AS teacher_id, u.name AS teacher_name, u.academic_title, u.department
       FROM topics t
       JOIN users u ON u.id = t.teacher_id
       LEFT JOIN study_programmes p ON p.id = t.programme_id
      WHERE t.is_active = true AND t.academic_year_id = ${thisYear(1)}
      ORDER BY u.name, t.title`,
    [options.yearId ?? null],
  )

  const caps = await teacherCapacities(null, options.yearId)
  const viewer = options.viewer

  return rows.map((t) => {
    const cap = caps.get(t.teacher_id)
    const level = cap ? (t.level === 'master' ? cap.master : cap.bachelor) : null
    if (!level) return { ...t, teacher_is_full: true, teacher_free_at_level: 0 }

    /* Only the reader's own level is answered about them: a bachelor's student
     * looking at a master's topic cannot apply to it anyway, and pretending the
     * verdict is personal there would grey out a topic for the wrong reason. */
    const personal = viewer?.program === t.level
    return {
      ...t,
      teacher_is_full: personal
        ? isFullFor(level, viewer?.programme_id ?? null)
        : level.free_any === 0,
      teacher_free_at_level: level.free_any,
    }
  })
}

/* --- transparency: who coordinates whom ------------------------------------- */

export interface Pairing {
  request_id: string
  student_id: string
  student_name: string
  student_number: string | null
  program: string | null
  specialization: string | null
  study_language: string
  study_year: number | null
  study_series: string | null
  study_group: string | null
  father_initial: string | null
  teacher_id: string
  teacher_name: string
  academic_title: string | null
  title_ro: string
  decided_at: string | null
}

/**
 * Every confirmed pairing in a session, visible to anyone signed in.
 *
 * One coordinator takes many students; a student has exactly one coordinator —
 * the partial unique index on live requests is what guarantees the second half,
 * and this list is where both halves become visible to everyone.
 */
export function pairings(yearId?: string): Promise<Pairing[]> {
  return query<Pairing>(
    `SELECT r.id AS request_id, r.title_ro, r.decided_at,
            s.id AS student_id, s.name AS student_name, s.student_number, s.father_initial,
            s.program, s.specialization, s.study_language, s.study_year,
            s.study_series, s.study_group,
            t.id AS teacher_id, t.name AS teacher_name, t.academic_title
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.status = 'approved' AND r.academic_year_id = ${thisYear(1)}
      ORDER BY t.name, s.name`,
    [yearId ?? null],
  )
}

/* --- faculty-wide student directory ----------------------------------------- */

export interface DirectoryStudent {
  id: string
  name: string
  email: string
  student_number: string | null
  program: string | null
  specialization: string | null
  study_language: string
  study_group: string | null
  study_series: string | null
  study_year: number | null
  father_initial: string | null
  /** When they first signed in. NULL means the account was never used. */
  first_login_at: string | null
  avatar_path: string | null
  teacher_id: string | null
  teacher_name: string | null
  request_status: string | null
  /** The programme they are enrolled in, so a screen can filter by it. */
  programme_id: string | null
}

/** Every student in the session with their coordinator, if the request went through. */
export function studentDirectory(yearId?: string): Promise<DirectoryStudent[]> {
  return query<DirectoryStudent>(
    `SELECT s.id, s.name, s.email, s.student_number, s.program, s.specialization,
            s.study_language, s.study_group, s.study_series, s.study_year,
            s.father_initial, s.first_login_at::text, s.avatar_path, s.programme_id::text,
            t.id AS teacher_id, t.name AS teacher_name, r.status AS request_status
       FROM users s
       LEFT JOIN requests r
         ON r.student_id = s.id
        AND r.academic_year_id = ${thisYear(1)}
        AND r.status IN ('pending', 'approved')
       LEFT JOIN users t ON t.id = r.teacher_id
      WHERE s.role = 'student'
      /* Series before name: it is a column of the catalogue now, and a list
         ordered only by name interleaves three series into one illegible run. */
      ORDER BY s.program DESC, s.specialization, s.study_language,
               s.study_series NULLS LAST, s.name`,
    [yearId ?? null],
  )
}

/* --- the archive ------------------------------------------------------------ */

export interface ArchiveRow {
  source: 'portal' | 'import'
  student_name: string
  student_number: string | null
  programme: string | null
  level: string | null
  language: string | null
  teacher_name: string
  title_ro: string
  defended_on: string | null
  /** The newest handed-in file, when the thesis went through the portal. */
  thesis_file_id: string | null
  thesis_file_name: string | null
  thesis_uploaded_at: string | null
  /** Its coordinator, so the screen can offer the file to them as well. */
  teacher_id: string | null
}

/**
 * A session's finished pairings, portal-native and imported side by side.
 *
 * Filed under the session the thesis is defended in, not the one the
 * coordination started in — a student may choose a coordinator in the second
 * year and defend at the end of the third. `graduation_year_id` records the
 * difference when there is one; null means the two are the same.
 *
 * Years before the portal existed have no requests, only rows typed in by the
 * director; the archive has to read the same either way, so both are unioned
 * into one shape rather than shown as two lists.
 */
export function archiveRows(yearId: string): Promise<ArchiveRow[]> {
  return query<ArchiveRow>(
    /* The defence date, not the approval date.
     *
     * This used to read `decided_at`, that is the day the coordinator accepted
     * the request — a thesis approved in March and defended in July showed up in
     * the archive with March. They are two events months apart, and a faculty's
     * archive is exactly the place where the difference matters. When the defence
     * is not yet recorded, the column stays empty instead of lying. */
    /* The handed-in paper travels with the row.
     *
     * `LATERAL` and not a join: what is wanted is the newest version, one per
     * thesis, and a plain join would repeat the row once per version uploaded.
     * Imported rows have no file and say so with two nulls — those sessions
     * ended before the portal existed, and inventing a document for them would
     * be the archive lying about what it holds. */
    `SELECT 'portal'::text AS source, s.name AS student_name, s.student_number,
            s.specialization AS programme, s.program AS level, s.study_language AS language,
            t.name AS teacher_name, r.title_ro, r.defended_on::text AS defended_on,
            f.id::text AS thesis_file_id, f.original_name AS thesis_file_name,
            f.created_at::text AS thesis_uploaded_at,
            t.id::text AS teacher_id
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
       LEFT JOIN LATERAL (
         SELECT id, original_name, created_at
           FROM files
          WHERE request_id = r.id AND kind = 'thesis'
          ORDER BY created_at DESC
          LIMIT 1
       ) f ON true
      WHERE r.status IN ('approved', 'defended')
        AND COALESCE(r.graduation_year_id, r.academic_year_id) = $1
      UNION ALL
     SELECT 'import'::text, a.student_name, a.student_number, a.programme, a.level, a.language,
            a.teacher_name, a.title_ro, a.defended_on::text, NULL, NULL, NULL, NULL
       FROM archive_entries a
      WHERE a.academic_year_id = $1
      ORDER BY teacher_name, student_name`,
    [yearId],
  )
}

/**
 * Does the student have an approved request in the current session?
 *
 * The navigation bar uses it to say „Lucrarea mea” instead of „Cererile mele”:
 * once the coordination is confirmed, the screen is no longer about requests.
 */
export async function hasApprovedRequest(studentId: string): Promise<boolean> {
  const row = await queryOne<{ exista: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM requests
        WHERE student_id = $1
          -- A defended thesis stays the student's thesis: they did not lose it
          -- by finishing it, so the bar still says „Lucrarea mea”.
          AND status IN ('approved', 'defended')
          AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)
     ) AS exista`,
    [studentId],
  )
  return row?.exista ?? false
}
