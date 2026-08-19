import { createHash, randomBytes } from 'node:crypto'
import { execute, query, queryOne } from './db'

export type Role = 'student' | 'teacher' | 'head'

export type StudyLanguage = 'ro' | 'en' | 'fr' | 'de'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  student_number: string | null
  program: 'bachelor' | 'master' | null
  specialization: string | null
  study_year: number | null
  programme_id: string | null
  study_language: StudyLanguage
  study_group: string | null
  academic_title: string | null
  department: string | null
  office: string | null
  bio: string | null
  avatar_path: string | null
  interests: string | null
  website: string | null
  is_demo: boolean
}

export const SESSION_COOKIE = 'portal_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LINK_TTL_MS = 20 * 60 * 1000

/** Demo mode allows sign-in without email. It is a real authentication bypass. */
export const DEMO_MODE = process.env.DEMO_MODE === 'true'

const USER_FIELDS = `id, email, name, role, student_number, program, specialization, study_year,
                     programme_id, study_language, study_group,
                     academic_title, department, office, bio, avatar_path, interests, website, is_demo`

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Issues a sign-in link. The raw token is returned so it can be emailed; only
 * its digest is stored, so reading the table authenticates nobody.
 */
export async function createMagicLink(email: string, redirectTo?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await execute(
    `INSERT INTO magic_link_tokens (email, token_hash, redirect_to, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
    [email.toLowerCase().trim(), digest(token), redirectTo ?? null, String(LINK_TTL_MS)],
  )
  return token
}

/** Consumes the token exactly once and returns the matching user. */
export async function consumeMagicLink(
  token: string,
): Promise<{ user: User; redirectTo: string | null } | null> {
  if (!token) return null

  const row = await queryOne<{ email: string; redirect_to: string | null }>(
    `UPDATE magic_link_tokens
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING email, redirect_to`,
    [digest(token)],
  )
  if (!row) return null

  const user = await queryOne<User>(
    `SELECT ${USER_FIELDS} FROM users WHERE lower(email) = lower($1) AND is_active`,
    [row.email],
  )
  if (!user) return null

  return { user, redirectTo: row.redirect_to }
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [id, userId, String(SESSION_TTL_MS)],
  )
  return id
}

export function getUserFromSession(sessionId: string | undefined): Promise<User | null> {
  if (!sessionId) return Promise.resolve(null)
  return queryOne<User>(
    `SELECT ${USER_FIELDS.split(',').map((c) => `u.${c.trim()}`).join(', ')}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.is_active`,
    [sessionId],
  )
}

export async function destroySession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  await execute('DELETE FROM sessions WHERE id = $1', [sessionId])
}

/**
 * The account behind an address — only while it is still open.
 *
 * A deactivated account receives no sign-in link, and its sessions no longer
 * validate (see `getUserFromSession`). The sign-in route's answer stays
 * identical for an unknown address and for a closed one: otherwise the form
 * would say who was once in the portal.
 */
export function findUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT ${USER_FIELDS} FROM users WHERE lower(email) = lower($1) AND is_active`,
    [email.trim()],
  )
}

export interface DemoAccount extends User {
  /** Whether this student already has an approved supervisor. */
  has_supervisor: boolean
}

/**
 * Accounts offered on the sign-in page while demo mode is on.
 *
 * Carries whether a student is already supervised, because two student accounts
 * that look identical in a list are useless for testing: the whole point of the
 * second one is that it has no coordinator yet.
 */
export function demoAccounts(): Promise<DemoAccount[]> {
  if (!DEMO_MODE) return Promise.resolve([])
  return query<DemoAccount>(
    `SELECT ${USER_FIELDS.split(',').map((c) => `u.${c.trim()}`).join(', ')},
            EXISTS (
              SELECT 1 FROM requests r
               WHERE r.student_id = u.id AND r.status = 'approved'
            ) AS has_supervisor
       FROM users u
      WHERE u.is_demo = true
      ORDER BY CASE u.role WHEN 'student' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, u.name`,
  )
}

export function isTeacher(u: User | null): boolean {
  return u?.role === 'teacher' || u?.role === 'head'
}

export function isDepartmentHead(u: User | null): boolean {
  return u?.role === 'head'
}

/** Initials for avatars; Romanian academic titles are stripped first. */
export function initials(name: string): string {
  return name
    .replace(/^(?:(?:Prof|Conf|Lect|Asist|univ|dr|drd)\.\s*)+/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Romanian labels, user-facing. */
export const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  teacher: 'Cadru didactic',
  head: 'Director de departament',
}
