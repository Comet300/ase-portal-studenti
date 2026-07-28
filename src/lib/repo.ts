import { query, queryOne } from './db'

/**
 * Interogările aplicației.
 *
 * Nu există row-level security, deci fiecare funcție care atinge datele unui
 * profesor primește `profesorId` ca prim parametru și îl folosește în aceeași
 * instrucțiune care citește sau scrie. O verificare separată, înainte, ar lăsa
 * o fereastră între control și acțiune.
 */

export interface Etapa {
  id: string
  ordine: number
  titlu: string
  descriere: string | null
  interval_text: string
  data_inceput: string | null
  data_sfarsit: string | null
}

export interface RandCerere {
  id: string
  numar: string
  titlu_ro: string
  titlu_en: string | null
  scop_obiective: string
  status: 'ciorna' | 'in_asteptare' | 'aprobata' | 'respinsa'
  motiv_respingere: string | null
  depusa_la: string
  decisa_la: string | null
  student_id: string
  student_nume: string
  student_email: string
  numar_matricol: string | null
  program: 'licenta' | 'master' | null
  specializare: string | null
  profesor_id: string
  profesor_nume: string
  titlu_academic: string | null
}

const CAMPURI_CERERE = `
  c.id, c.numar, c.titlu_ro, c.titlu_en, c.scop_obiective, c.status, c.motiv_respingere,
  c.depusa_la, c.decisa_la,
  s.id AS student_id, s.nume AS student_nume, s.email AS student_email,
  s.numar_matricol, s.program, s.specializare,
  p.id AS profesor_id, p.nume AS profesor_nume, p.titlu_academic`

export const ETICHETE_STATUS: Record<string, string> = {
  ciorna: 'Ciornă',
  in_asteptare: 'În așteptare',
  aprobata: 'Aprobată',
  respinsa: 'Respinsă',
}

export const CLASA_STATUS: Record<string, string> = {
  ciorna: 'badge--ciorna',
  in_asteptare: 'badge--asteptare',
  aprobata: 'badge--aprobata',
  respinsa: 'badge--respinsa',
}

export function etape() {
  return query<Etapa>(`SELECT * FROM etape_sesiune ORDER BY ordine`)
}

/** Etapa în care ne aflăm acum, dacă există. */
export async function etapaCurenta(): Promise<Etapa | null> {
  return queryOne<Etapa>(
    `SELECT * FROM etape_sesiune
      WHERE data_inceput <= current_date AND data_sfarsit >= current_date
      ORDER BY ordine LIMIT 1`,
  )
}

/* --- profesor -------------------------------------------------------------- */

export function cereriProfesor(profesorId: string, status?: string) {
  return query<RandCerere>(
    `SELECT ${CAMPURI_CERERE}
       FROM cereri c
       JOIN utilizatori s ON s.id = c.student_id
       JOIN utilizatori p ON p.id = c.profesor_id
      WHERE c.profesor_id = $1
        AND ($2::text IS NULL OR c.status = $2)
      ORDER BY
        CASE c.status WHEN 'in_asteptare' THEN 0 ELSE 1 END,
        c.depusa_la DESC`,
    [profesorId, status ?? null],
  )
}

export function statisticiProfesor(profesorId: string) {
  return queryOne<{
    in_asteptare: number
    aprobate: number
    respinse: number
    total: number
    ore_raspuns_mediu: number | null
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'in_asteptare')::int AS in_asteptare,
       count(*) FILTER (WHERE status = 'aprobata')::int     AS aprobate,
       count(*) FILTER (WHERE status = 'respinsa')::int     AS respinse,
       count(*)::int                                        AS total,
       round(avg(EXTRACT(EPOCH FROM (decisa_la - depusa_la)) / 3600)
             FILTER (WHERE decisa_la IS NOT NULL))::int      AS ore_raspuns_mediu
     FROM cereri WHERE profesor_id = $1`,
    [profesorId],
  )
}

export interface StudentCoordonat extends RandCerere {
  jaloane_total: number
  jaloane_finalizate: number
  conversatie_id: string | null
  mesaje_necitite: number
}

export function studentiCoordonati(profesorId: string) {
  return query<StudentCoordonat>(
    `SELECT ${CAMPURI_CERERE},
            (SELECT count(*)::int FROM jaloane j WHERE j.cerere_id = c.id) AS jaloane_total,
            (SELECT count(*)::int FROM jaloane j WHERE j.cerere_id = c.id AND j.status = 'finalizat') AS jaloane_finalizate,
            conv.id AS conversatie_id,
            COALESCE((
              SELECT count(*)::int FROM mesaje m
               WHERE m.conversatie_id = conv.id
                 AND m.expeditor_id = s.id
                 AND m.citit_la IS NULL
            ), 0) AS mesaje_necitite
       FROM cereri c
       JOIN utilizatori s ON s.id = c.student_id
       JOIN utilizatori p ON p.id = c.profesor_id
       LEFT JOIN conversatii conv ON conv.student_id = c.student_id AND conv.profesor_id = c.profesor_id
      WHERE c.profesor_id = $1 AND c.status = 'aprobata'
      ORDER BY s.nume`,
    [profesorId],
  )
}

export interface Jalon {
  id: string
  cerere_id: string
  titlu: string
  descriere: string | null
  termen: string | null
  status: 'planificat' | 'in_lucru' | 'finalizat'
  ordine: number
}

/** Jaloanele unei cereri, cu proprietatea verificată în aceeași instrucțiune. */
export function jaloaneCerere(profesorId: string, cerereId: string) {
  return query<Jalon>(
    `SELECT j.id, j.cerere_id, j.titlu, j.descriere, j.termen, j.status, j.ordine
       FROM jaloane j
       JOIN cereri c ON c.id = j.cerere_id
      WHERE j.cerere_id = $2 AND c.profesor_id = $1
      ORDER BY j.ordine, j.termen NULLS LAST`,
    [profesorId, cerereId],
  )
}

export function temeProfesor(profesorId: string) {
  return query<{
    id: string
    titlu: string
    descriere: string | null
    nivel: 'licenta' | 'master'
    metode: string | null
    prerechizite: string | null
    locuri: number
    activa: boolean
    ocupate: number
  }>(
    `SELECT t.*,
            (SELECT count(*)::int FROM cereri c
              WHERE c.tema_id = t.id AND c.status = 'aprobata') AS ocupate
       FROM teme t
      WHERE t.profesor_id = $1
      ORDER BY t.activa DESC, t.creat_la DESC`,
    [profesorId],
  )
}

export function sloturiProfesor(profesorId: string) {
  return query<{
    id: string
    start_la: string
    sfarsit_la: string
    mod: 'fizic' | 'online'
    locatie: string | null
    link_online: string | null
    capacitate: number
    anulat: boolean
    rezervari: number
    student_nume: string | null
  }>(
    `SELECT s.*,
            (SELECT count(*)::int FROM rezervari r WHERE r.slot_id = s.id AND r.status = 'rezervata') AS rezervari,
            (SELECT u.nume FROM rezervari r JOIN utilizatori u ON u.id = r.student_id
              WHERE r.slot_id = s.id AND r.status = 'rezervata' LIMIT 1) AS student_nume
       FROM sloturi_consultatii s
      WHERE s.profesor_id = $1 AND s.start_la > now() - interval '1 day'
      ORDER BY s.start_la`,
    [profesorId],
  )
}

/* --- student --------------------------------------------------------------- */

export function cereriStudent(studentId: string) {
  return query<RandCerere>(
    `SELECT ${CAMPURI_CERERE}
       FROM cereri c
       JOIN utilizatori s ON s.id = c.student_id
       JOIN utilizatori p ON p.id = c.profesor_id
      WHERE c.student_id = $1
      ORDER BY c.depusa_la DESC`,
    [studentId],
  )
}

export function jaloaneStudent(studentId: string) {
  return query<Jalon>(
    `SELECT j.id, j.cerere_id, j.titlu, j.descriere, j.termen, j.status, j.ordine
       FROM jaloane j
       JOIN cereri c ON c.id = j.cerere_id
      WHERE c.student_id = $1 AND c.status = 'aprobata'
      ORDER BY j.ordine, j.termen NULLS LAST`,
    [studentId],
  )
}

/* --- catalog public -------------------------------------------------------- */

export function coordonatori() {
  return query<{
    id: string
    nume: string
    email: string
    titlu_academic: string | null
    departament: string | null
    birou: string | null
    teme: number
  }>(
    `SELECT u.id, u.nume, u.email, u.titlu_academic, u.departament, u.birou,
            (SELECT count(*)::int FROM teme t WHERE t.profesor_id = u.id AND t.activa) AS teme
       FROM utilizatori u
      WHERE u.rol IN ('profesor', 'director')
      ORDER BY u.nume`,
  )
}

export function temePublice() {
  return query<{
    id: string
    titlu: string
    descriere: string | null
    nivel: 'licenta' | 'master'
    metode: string | null
    prerechizite: string | null
    profesor_id: string
    profesor_nume: string
    departament: string | null
  }>(
    `SELECT t.id, t.titlu, t.descriere, t.nivel, t.metode, t.prerechizite,
            u.id AS profesor_id, u.nume AS profesor_nume, u.departament
       FROM teme t
       JOIN utilizatori u ON u.id = t.profesor_id
      WHERE t.activa = true
      ORDER BY u.nume, t.titlu`,
  )
}

/* --- format ---------------------------------------------------------------- */

const LUNI = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

export function dataRo(iso: string | null, cuOra = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const baza = `${d.getDate()} ${LUNI[d.getMonth()]} ${d.getFullYear()}`
  if (!cuOra) return baza
  return `${baza}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function oraRo(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function acumRelativ(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'acum'
  if (min < 60) return `acum ${min} min`
  const ore = Math.floor(min / 60)
  if (ore < 24) return `acum ${ore} ${ore === 1 ? 'oră' : 'ore'}`
  const zile = Math.floor(ore / 24)
  if (zile < 30) return `acum ${zile} ${zile === 1 ? 'zi' : 'zile'}`
  return dataRo(iso)
}
