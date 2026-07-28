import { createHash, randomBytes } from 'node:crypto'
import { execute, query, queryOne } from './db'

export type Role = 'student' | 'teacher' | 'head'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  student_number: string | null
  program: 'bachelor' | 'master' | null
  specialization: string | null
  study_year: number | null
  academic_title: string | null
  department: string | null
  office: string | null
  bachelor_capacity: number
  master_capacity: number
  is_demo: boolean
}

export const SESSION_COOKIE = 'portal_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LINK_TTL_MS = 20 * 60 * 1000

/** Demo mode allows sign-in without email. It is a real authentication bypass. */
export const DEMO_MODE = process.env.DEMO_MODE === 'true'

const USER_FIELDS = `id, email, name, role, student_number, program, specialization, study_year,
                     academic_title, department, office, bachelor_capacity, master_capacity, is_demo`

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
    `SELECT ${USER_FIELDS} FROM users WHERE lower(email) = lower($1)`,
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
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  )
}

export async function destroySession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  await execute('DELETE FROM sessions WHERE id = $1', [sessionId])
}

export function findUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>(`SELECT ${USER_FIELDS} FROM users WHERE lower(email) = lower($1)`, [
    email.trim(),
  ])
}

/** Accounts offered on the sign-in page while demo mode is on. */
export function demoAccounts(): Promise<User[]> {
  if (!DEMO_MODE) return Promise.resolve([])
  return query<User>(
    `SELECT ${USER_FIELDS} FROM users
      WHERE is_demo = true
      ORDER BY CASE role WHEN 'student' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, name`,
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
