import type { APIRoute } from 'astro'
import { noteazaAcces } from '../../lib/audit'
import { query, queryOne } from '../../lib/db'
import { sessionExpired } from '../../lib/http'

/**
 * Copia datelor proprii, la cerere și fără cerere.
 *
 * Dreptul de acces (art. 15) nu are nevoie de un formular și de un răspuns în
 * treizeci de zile dacă portalul poate răspunde singur: toate datele sunt aici,
 * legate de un id pe care sesiunea îl cunoaște deja.
 *
 * Fiecare interogare pornește de la `u.id`, deci nu există parametru cu care
 * cineva să ceară datele altcuiva. Conținutul fișierelor nu intră — se listează
 * numele și mărimea, iar fișierele se descarcă din conversație.
 */
export const GET: APIRoute = async ({ locals, request }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const [cont, cereri, mesaje, fisiere, rezervari, invitatii] = await Promise.all([
    queryOne(
      `SELECT name, email, role, student_number, program, specialization,
              study_language, study_group, study_year, bio, created_at
         FROM users WHERE id = $1`,
      [u.id],
    ),
    query(
      `SELECT r.number, r.title_ro, r.title_en, r.objectives, r.motivation, r.status,
              r.rejection_reason, r.decision_note, r.submitted_at, r.decided_at,
              r.defended_on, r.grade, t.name AS coordonator, y.label AS sesiune
         FROM requests r
         JOIN users t ON t.id = r.teacher_id
         LEFT JOIN academic_years y ON y.id = r.academic_year_id
        WHERE r.student_id = $1 OR r.teacher_id = $1
        ORDER BY r.submitted_at`,
      [u.id],
    ),
    query(
      `SELECT m.created_at, m.kind, m.event_type, m.body,
              (m.sender_id = $1) AS scris_de_mine, p.name AS cu
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN users p ON p.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END
        WHERE c.student_id = $1 OR c.teacher_id = $1
        ORDER BY m.created_at`,
      [u.id],
    ),
    query(
      `SELECT f.original_name, f.mime, f.size_bytes, f.created_at,
              (f.uploaded_by = $1) AS incarcat_de_mine
         FROM files f
         JOIN conversations c ON c.id = f.conversation_id
        WHERE c.student_id = $1 OR c.teacher_id = $1
        ORDER BY f.created_at`,
      [u.id],
    ),
    query(
      `SELECT s.starts_at, s.ends_at, s.mode, s.location, b.subject, b.status,
              t.name AS coordonator
         FROM bookings b
         JOIN consultation_slots s ON s.id = b.slot_id
         JOIN users t ON t.id = s.teacher_id
        WHERE b.student_id = $1
        ORDER BY s.starts_at`,
      [u.id],
    ),
    query(
      `SELECT i.message, i.status, i.response_reason, i.created_at, i.responded_at,
              t.name AS de_la, s.name AS catre
         FROM invitations i
         JOIN users t ON t.id = i.teacher_id
         JOIN users s ON s.id = i.student_id
        WHERE i.student_id = $1 OR i.teacher_id = $1
        ORDER BY i.created_at`,
      [u.id],
    ),
  ])

  await noteazaAcces({ userId: u.id, action: 'export_date_proprii', request })

  const date = {
    generat_la: new Date().toISOString(),
    despre:
      'Copia datelor tale din Portalul Studenți — Facultatea de Marketing, ASE București. ' +
      'Conținutul fișierelor nu este inclus: se descarcă din conversație.',
    cont,
    cereri,
    invitatii,
    consultatii: rezervari,
    mesaje,
    fisiere,
  }

  return new Response(JSON.stringify(date, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="datele-mele.json"',
      'cache-control': 'private, no-store',
    },
  })
}
