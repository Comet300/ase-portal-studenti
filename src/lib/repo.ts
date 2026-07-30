import { execute, query, queryOne } from './db'

/* Formatarea datelor a plecat în `lib/date.ts` — nu are nimic de-a face cu baza
 * de date, iar acolo se poate testa și importa în browser. Se reexportă de aici,
 * ca cele treizeci de pagini care o importau să nu trebuiască schimbate toate. */
export {
  formatDate,
  formatTime,
  monthLabel,
  shortMonth,
  startOfWeek,
  timeAgo,
  weekLabel,
} from './date'

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
  study_year: number | null
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
  r.submitted_at, r.decided_at,
  s.id AS student_id, s.name AS student_name, s.email AS student_email,
  s.student_number, s.program, s.specialization,
  s.study_language, s.study_group, s.study_year, s.avatar_path AS student_avatar,
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
  // Expirarea nu este un refuz: nimeni nu a spus nu, doar a trecut termenul.
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

export const MILESTONE_LABELS: Record<string, string> = {
  planned: 'Planificat',
  in_progress: 'În lucru',
  done: 'Finalizat',
}

/**
 * Starea reală a unui termen, nu doar cea salvată.
 *
 * În bază există trei stări, niciuna dintre ele „întârziat”, așa că un termen
 * ratat arăta identic cu unul viitor: pe 29 iulie, „Predarea formei finale ·
 * 14 iulie” scria în continuare „Planificat”, iar pagina de start anunța drept
 * „următorul termen” unul trecut de cinci luni.
 *
 * Întârzierea nu se scrie în bază — se citește din calendar de fiecare dată,
 * pentru că altfel ar trebui ținută la zi de cineva.
 */
export type StareTermen = 'planned' | 'in_progress' | 'done' | 'overdue'

export function milestoneState(
  status: string,
  dueOn: string | null | undefined,
): StareTermen {
  if (status === 'done') return 'done'
  if (!dueOn) return status === 'in_progress' ? 'in_progress' : 'planned'

  const azi = new Date()
  azi.setHours(0, 0, 0, 0)
  return new Date(dueOn) < azi ? 'overdue' : status === 'in_progress' ? 'in_progress' : 'planned'
}

export const MILESTONE_STATE_LABELS: Record<StareTermen, string> = {
  planned: 'Planificat',
  in_progress: 'În lucru',
  done: 'Finalizat',
  overdue: 'Termen depășit',
}

export const MILESTONE_STATE_CLASS: Record<StareTermen, string> = {
  planned: 'badge--ciorna',
  in_progress: 'badge--in-lucru',
  done: 'badge--aprobata',
  overdue: 'badge--respinsa',
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

/* --- seats: allocated by the director, spent by approvals ------------------- */

export interface Seats {
  bachelor_seats: number
  master_seats: number
  bachelor_taken: number
  master_taken: number
  total_seats: number
  total_taken: number
  free: number
}

/**
 * Seat counts for a coordinator, as SQL fragments.
 *
 * The year comes from the parameter rather than from the joined allocation row:
 * a coordinator the head has not allocated seats to yet has no row at all, and
 * reading the year off it would report zero students supervised rather than zero
 * seats available — two very different facts.
 */
const seatColumns = (yearParam: number) => `
  COALESCE(a.bachelor_seats, 0) AS bachelor_seats,
  COALESCE(a.master_seats, 0)   AS master_seats,
  (SELECT count(*)::int FROM requests r JOIN users s2 ON s2.id = r.student_id
    WHERE r.teacher_id = t.id AND r.status = 'approved'
      AND r.academic_year_id = ${thisYear(yearParam)} AND s2.program = 'bachelor') AS bachelor_taken,
  (SELECT count(*)::int FROM requests r JOIN users s2 ON s2.id = r.student_id
    WHERE r.teacher_id = t.id AND r.status = 'approved'
      AND r.academic_year_id = ${thisYear(yearParam)} AND s2.program = 'master')   AS master_taken`

export async function teacherSeats(teacherId: string, yearId?: string): Promise<Seats> {
  const row = await queryOne<Omit<Seats, 'total_seats' | 'total_taken' | 'free'>>(
    `SELECT ${seatColumns(2)}
       FROM users t
       LEFT JOIN seat_allocations a
         ON a.teacher_id = t.id AND a.academic_year_id = ${thisYear(2)}
      WHERE t.id = $1`,
    [teacherId, yearId ?? null],
  )
  const seats = row ?? { bachelor_seats: 0, master_seats: 0, bachelor_taken: 0, master_taken: 0 }
  const total_seats = seats.bachelor_seats + seats.master_seats
  const total_taken = seats.bachelor_taken + seats.master_taken
  return { ...seats, total_seats, total_taken, free: Math.max(0, total_seats - total_taken) }
}

export interface SupervisedStudent extends RequestRow {
  graduation_year_id: string | null
  milestones_total: number
  milestones_done: number
  conversation_id: string | null
  unread: number
}

export function supervisedStudents(teacherId: string, yearId?: string) {
  return query<SupervisedStudent>(
    `SELECT ${REQUEST_FIELDS}, r.graduation_year_id,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id) AS milestones_total,
            (SELECT count(*)::int FROM milestones m WHERE m.request_id = r.id AND m.status = 'done') AS milestones_done,
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
      ORDER BY m.position, m.due_on NULLS LAST`,
    [teacherId, requestId],
  )
}

export interface Topic {
  id: string
  title: string
  description: string | null
  level: 'bachelor' | 'master'
  language: 'ro' | 'en' | 'fr' | 'de'
  methods: string | null
  prerequisites: string | null
  seats: number
  is_active: boolean
  taken: number
}

export function teacherTopics(teacherId: string, yearId?: string) {
  return query<Topic>(
    `SELECT t.*,
            (SELECT count(*)::int FROM requests r
              WHERE r.topic_id = t.id AND r.status = 'approved') AS taken
       FROM topics t
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
}

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
      ORDER BY m.position, m.due_on NULLS LAST`,
    [studentId],
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
  /** No free seat left at either level — still listed, but no longer bookable. */
  is_full: boolean
}

/**
 * The public catalogue of coordinators.
 *
 * A coordinator who has run out of seats is not hidden: students need to see who
 * is already taken and by whom, so the list carries the counts and a `is_full`
 * flag instead of quietly shrinking.
 */
export function supervisors(yearId?: string): Promise<Supervisor[]> {
  return query<Supervisor>(
    `SELECT t.id, t.name, t.email, t.academic_title, t.department, t.office,
            t.bio, t.avatar_path, t.interests,
            (SELECT count(*)::int FROM topics tp
              WHERE tp.teacher_id = t.id AND tp.is_active
                AND tp.academic_year_id = ${thisYear(1)}) AS topic_count,
            ${seatColumns(1)},
            -- Counted exactly as seatColumns counts it, level by level: a
            -- supervised student whose programme was never set would otherwise
            -- fill a seat here and none there, and the two numbers on the same
            -- card would disagree.
            (COALESCE(a.bachelor_seats, 0) + COALESCE(a.master_seats, 0)) <= (
              SELECT count(*)::int FROM requests r
                JOIN users s3 ON s3.id = r.student_id
               WHERE r.teacher_id = t.id AND r.status = 'approved'
                 AND r.academic_year_id = ${thisYear(1)}
                 AND s3.program IN ('bachelor', 'master')
            ) AS is_full
       FROM users t
       LEFT JOIN seat_allocations a
         ON a.teacher_id = t.id AND a.academic_year_id = ${thisYear(1)}
      WHERE t.role IN ('teacher', 'head')
      ORDER BY t.name`,
    [yearId ?? null],
  )
}

export interface PublicTopic {
  id: string
  title: string
  description: string | null
  level: 'bachelor' | 'master'
  language: 'ro' | 'en' | 'fr' | 'de'
  methods: string | null
  prerequisites: string | null
  seats: number
  taken: number
  teacher_id: string
  teacher_name: string
  academic_title: string | null
  department: string | null
  teacher_is_full: boolean
}

/**
 * Every topic on offer, with the coordinator who proposed it.
 *
 * This is the other way into the catalogue: a student who knows what they want
 * to write about finds the topic first and the coordinator through it.
 */
export function publicTopics(yearId?: string): Promise<PublicTopic[]> {
  return query<PublicTopic>(
    `SELECT t.id, t.title, t.description, t.level, t.language, t.methods, t.prerequisites, t.seats,
            (SELECT count(*)::int FROM requests r
              WHERE r.topic_id = t.id AND r.status = 'approved') AS taken,
            u.id AS teacher_id, u.name AS teacher_name, u.academic_title, u.department,
            (COALESCE(a.bachelor_seats, 0) + COALESCE(a.master_seats, 0)) <= (
              SELECT count(*)::int FROM requests r2
               WHERE r2.teacher_id = u.id AND r2.status = 'approved'
                 AND r2.academic_year_id = t.academic_year_id
            ) AS teacher_is_full
       FROM topics t
       JOIN users u ON u.id = t.teacher_id
       LEFT JOIN seat_allocations a
         ON a.teacher_id = u.id AND a.academic_year_id = t.academic_year_id
      WHERE t.is_active = true AND t.academic_year_id = ${thisYear(1)}
      ORDER BY u.name, t.title`,
    [yearId ?? null],
  )
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
            s.id AS student_id, s.name AS student_name, s.student_number,
            s.program, s.specialization, s.study_language, s.study_year,
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
  study_year: number | null
  avatar_path: string | null
  teacher_id: string | null
  teacher_name: string | null
  request_status: string | null
}

/** Every student in the session with their coordinator, if the request went through. */
export function studentDirectory(yearId?: string): Promise<DirectoryStudent[]> {
  return query<DirectoryStudent>(
    `SELECT s.id, s.name, s.email, s.student_number, s.program, s.specialization,
            s.study_language, s.study_group, s.study_year, s.avatar_path,
            t.id AS teacher_id, t.name AS teacher_name, r.status AS request_status
       FROM users s
       LEFT JOIN requests r
         ON r.student_id = s.id
        AND r.academic_year_id = ${thisYear(1)}
        AND r.status IN ('pending', 'approved')
       LEFT JOIN users t ON t.id = r.teacher_id
      WHERE s.role = 'student'
      ORDER BY s.program DESC, s.specialization, s.study_language, s.name`,
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
    /* Data susținerii, nu data aprobării.
     *
     * Aici se scria `decided_at`, adică ziua în care coordonatorul a acceptat
     * cererea — o lucrare aprobată în martie și susținută în iulie apărea în
     * arhivă cu martie. Sunt două evenimente la câteva luni distanță, iar arhiva
     * unei facultăți este exact locul unde diferența contează. Când susținerea nu
     * e încă înregistrată, coloana rămâne goală în loc să mintă. */
    `SELECT 'portal'::text AS source, s.name AS student_name, s.student_number,
            s.specialization AS programme, s.program AS level, s.study_language AS language,
            t.name AS teacher_name, r.title_ro, r.defended_on::text AS defended_on
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.status IN ('approved', 'defended')
        AND COALESCE(r.graduation_year_id, r.academic_year_id) = $1
      UNION ALL
     SELECT 'import'::text, a.student_name, a.student_number, a.programme, a.level, a.language,
            a.teacher_name, a.title_ro, a.defended_on::text
       FROM archive_entries a
      WHERE a.academic_year_id = $1
      ORDER BY teacher_name, student_name`,
    [yearId],
  )
}

/**
 * Are studentul o cerere aprobată în sesiunea curentă?
 *
 * Bara de navigație o folosește ca să spună „Lucrarea mea” în loc de „Cererile
 * mele”: după ce coordonarea e confirmată, ecranul nu mai este despre cereri.
 */
export async function hasApprovedRequest(studentId: string): Promise<boolean> {
  const row = await queryOne<{ exista: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM requests
        WHERE student_id = $1
          -- O lucrare susținută rămâne lucrarea studentului: nu a pierdut-o
          -- terminând-o, deci bara spune în continuare „Lucrarea mea”.
          AND status IN ('approved', 'defended')
          AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)
     ) AS exista`,
    [studentId],
  )
  return row?.exista ?? false
}
