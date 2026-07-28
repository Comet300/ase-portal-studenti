import { query, queryOne } from './db'

/**
 * Application queries.
 *
 * There is no row-level security, so every function touching a teacher's data
 * takes `teacherId` first and applies it in the same statement that reads or
 * writes. Checking separately beforehand would leave a gap between check and act.
 */

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
  status: 'draft' | 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  submitted_at: string
  decided_at: string | null
  student_id: string
  student_name: string
  student_email: string
  student_number: string | null
  program: 'bachelor' | 'master' | null
  specialization: string | null
  teacher_id: string
  teacher_name: string
  academic_title: string | null
}

const REQUEST_FIELDS = `
  r.id, r.number, r.title_ro, r.title_en, r.objectives, r.status, r.rejection_reason,
  r.submitted_at, r.decided_at,
  s.id AS student_id, s.name AS student_name, s.email AS student_email,
  s.student_number, s.program, s.specialization,
  t.id AS teacher_id, t.name AS teacher_name, t.academic_title`

/* --- user-facing Romanian labels ------------------------------------------- */

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Ciornă',
  pending: 'În așteptare',
  approved: 'Aprobată',
  rejected: 'Respinsă',
}

export const STATUS_CLASS: Record<string, string> = {
  draft: 'badge--ciorna',
  pending: 'badge--asteptare',
  approved: 'badge--aprobata',
  rejected: 'badge--respinsa',
}

export const MILESTONE_LABELS: Record<string, string> = {
  planned: 'Planificat',
  in_progress: 'În lucru',
  done: 'Finalizat',
}

export function programLabel(program: string | null): string {
  return program === 'master' ? 'Master' : 'Licență'
}

/* --- session calendar ------------------------------------------------------ */

export function stages() {
  return query<Stage>(`SELECT * FROM session_stages ORDER BY position`)
}

export function currentStage() {
  return queryOne<Stage>(
    `SELECT * FROM session_stages
      WHERE starts_on <= current_date AND ends_on >= current_date
      ORDER BY position LIMIT 1`,
  )
}

/* --- teacher --------------------------------------------------------------- */

export function teacherRequests(teacherId: string, status?: string) {
  return query<RequestRow>(
    `SELECT ${REQUEST_FIELDS}
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE r.teacher_id = $1 AND ($2::text IS NULL OR r.status = $2)
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.submitted_at DESC`,
    [teacherId, status ?? null],
  )
}

export function teacherStats(teacherId: string) {
  return queryOne<{
    pending: number
    approved: number
    rejected: number
    total: number
    avg_response_hours: number | null
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'pending')::int  AS pending,
       count(*) FILTER (WHERE status = 'approved')::int AS approved,
       count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       count(*)::int                                    AS total,
       round(avg(EXTRACT(EPOCH FROM (decided_at - submitted_at)) / 3600)
             FILTER (WHERE decided_at IS NOT NULL))::int AS avg_response_hours
     FROM requests WHERE teacher_id = $1`,
    [teacherId],
  )
}

export interface SupervisedStudent extends RequestRow {
  milestones_total: number
  milestones_done: number
  conversation_id: string | null
  unread: number
}

export function supervisedStudents(teacherId: string) {
  return query<SupervisedStudent>(
    `SELECT ${REQUEST_FIELDS},
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
      ORDER BY s.name`,
    [teacherId],
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
  methods: string | null
  prerequisites: string | null
  seats: number
  is_active: boolean
  taken: number
}

export function teacherTopics(teacherId: string) {
  return query<Topic>(
    `SELECT t.*,
            (SELECT count(*)::int FROM requests r
              WHERE r.topic_id = t.id AND r.status = 'approved') AS taken
       FROM topics t
      WHERE t.teacher_id = $1
      ORDER BY t.is_active DESC, t.created_at DESC`,
    [teacherId],
  )
}

export interface Slot {
  id: string
  starts_at: string
  ends_at: string
  mode: 'in_person' | 'online'
  location: string | null
  meeting_url: string | null
  capacity: number
  is_cancelled: boolean
  booked: number
  student_name: string | null
}

export function teacherSlots(teacherId: string) {
  return query<Slot>(
    `SELECT s.*,
            (SELECT count(*)::int FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked') AS booked,
            (SELECT u.name FROM bookings b JOIN users u ON u.id = b.student_id
              WHERE b.slot_id = s.id AND b.status = 'booked' LIMIT 1) AS student_name
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
      WHERE r.student_id = $1 AND r.status = 'approved'
      ORDER BY m.position, m.due_on NULLS LAST`,
    [studentId],
  )
}

/* --- public catalogue ------------------------------------------------------ */

export function supervisors() {
  return query<{
    id: string
    name: string
    email: string
    academic_title: string | null
    department: string | null
    office: string | null
    topic_count: number
  }>(
    `SELECT u.id, u.name, u.email, u.academic_title, u.department, u.office,
            (SELECT count(*)::int FROM topics t WHERE t.teacher_id = u.id AND t.is_active) AS topic_count
       FROM users u
      WHERE u.role IN ('teacher', 'head')
      ORDER BY u.name`,
  )
}

export function publicTopics() {
  return query<{
    id: string
    title: string
    description: string | null
    level: 'bachelor' | 'master'
    methods: string | null
    prerequisites: string | null
    teacher_id: string
    teacher_name: string
    department: string | null
  }>(
    `SELECT t.id, t.title, t.description, t.level, t.methods, t.prerequisites,
            u.id AS teacher_id, u.name AS teacher_name, u.department
       FROM topics t
       JOIN users u ON u.id = t.teacher_id
      WHERE t.is_active = true
      ORDER BY u.name, t.title`,
  )
}

/* --- Romanian formatting --------------------------------------------------- */

const MONTHS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return withTime ? `${base}, ${formatTime(iso)}` : base
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
