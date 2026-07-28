import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { execute, query, queryOne } from './db'

export type Rol = 'student' | 'profesor' | 'director'

export interface Utilizator {
  id: string
  email: string
  nume: string
  rol: Rol
  numar_matricol: string | null
  program: 'licenta' | 'master' | null
  specializare: string | null
  an_studiu: number | null
  titlu_academic: string | null
  departament: string | null
  birou: string | null
  capacitate_licenta: number
  capacitate_master: number
  cont_demo: boolean
}

export const COOKIE_SESIUNE = 'portal_sesiune'
const DURATA_SESIUNE_MS = 30 * 24 * 60 * 60 * 1000
const DURATA_LINK_MS = 20 * 60 * 1000

/** Modul demo permite intrarea fără email. Este o ocolire reală a autentificării. */
export const DEMO_MODE = process.env.DEMO_MODE === 'true'

const CAMPURI = `id, email, nume, rol, numar_matricol, program, specializare, an_studiu,
                 titlu_academic, departament, birou, capacitate_licenta, capacitate_master, cont_demo`

function amprenta(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Emite un magic link. Tokenul brut este returnat pentru a fi trimis prin email;
 * în bază rămâne doar amprenta lui, deci o citire a tabelei nu autentifică pe nimeni.
 */
export async function creeazaMagicLink(email: string, redirectLa?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await execute(
    `INSERT INTO tokenuri_magic_link (email, token_hash, redirect_la, expira_la)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
    [email.toLowerCase().trim(), amprenta(token), redirectLa ?? null, String(DURATA_LINK_MS)],
  )
  return token
}

/** Consumă tokenul o singură dată și returnează utilizatorul, dacă există. */
export async function consumaMagicLink(
  token: string,
): Promise<{ utilizator: Utilizator; redirectLa: string | null } | null> {
  if (!token) return null

  const rand = await queryOne<{ id: string; email: string; redirect_la: string | null }>(
    `UPDATE tokenuri_magic_link
        SET folosit_la = now()
      WHERE token_hash = $1
        AND folosit_la IS NULL
        AND expira_la > now()
      RETURNING id, email, redirect_la`,
    [amprenta(token)],
  )

  if (!rand) return null

  const utilizator = await queryOne<Utilizator>(
    `SELECT ${CAMPURI} FROM utilizatori WHERE lower(email) = lower($1)`,
    [rand.email],
  )

  if (!utilizator) return null
  return { utilizator, redirectLa: rand.redirect_la }
}

export async function creeazaSesiune(utilizatorId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  await execute(
    `INSERT INTO sesiuni (id, utilizator_id, expira_la)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [id, utilizatorId, String(DURATA_SESIUNE_MS)],
  )
  return id
}

export async function utilizatorDinSesiune(sesiuneId: string | undefined): Promise<Utilizator | null> {
  if (!sesiuneId) return null
  return queryOne<Utilizator>(
    `SELECT ${CAMPURI.split(',')
      .map((c) => `u.${c.trim()}`)
      .join(', ')}
       FROM sesiuni s
       JOIN utilizatori u ON u.id = s.utilizator_id
      WHERE s.id = $1 AND s.expira_la > now()`,
    [sesiuneId],
  )
}

export async function distrugeSesiune(sesiuneId: string | undefined): Promise<void> {
  if (!sesiuneId) return
  await execute('DELETE FROM sesiuni WHERE id = $1', [sesiuneId])
}

export async function utilizatorDupaEmail(email: string): Promise<Utilizator | null> {
  return queryOne<Utilizator>(`SELECT ${CAMPURI} FROM utilizatori WHERE lower(email) = lower($1)`, [
    email.trim(),
  ])
}

/** Conturile marcate ca demo, oferite pe pagina de autentificare când DEMO_MODE e activ. */
export async function conturiDemo(): Promise<Utilizator[]> {
  if (!DEMO_MODE) return []
  return query<Utilizator>(
    `SELECT ${CAMPURI} FROM utilizatori
      WHERE cont_demo = true
      ORDER BY CASE rol WHEN 'student' THEN 1 WHEN 'profesor' THEN 2 ELSE 3 END, nume`,
  )
}

export function esteProfesor(u: Utilizator | null): boolean {
  return u?.rol === 'profesor' || u?.rol === 'director'
}

export function esteDirector(u: Utilizator | null): boolean {
  return u?.rol === 'director'
}

/** Comparație în timp constant, pentru secrete scurte din formulare. */
export function egalitateSigura(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function initiale(nume: string): string {
  return nume
    .replace(/^(Prof\.|Conf\.|Lect\.|Asist\.|univ\.|dr\.|drd\.)\s*/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
