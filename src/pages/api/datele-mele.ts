import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { query, queryOne } from '../../lib/db'
import { sessionExpired } from '../../lib/http'

/**
 * A copy of one's own data, on demand and without an application.
 *
 * The right of access (art. 15) needs neither a form nor an answer within
 * thirty days if the portal can answer on its own: all the data is here, tied
 * to an id the session already knows.
 *
 * Every query starts from `u.id`, so there is no parameter with which someone
 * could ask for somebody else's data. The contents of the files are not
 * included — the name and the size are listed, and the files themselves are
 * downloaded from the conversation.
 */
export const GET: APIRoute = async ({ locals, request }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const [cont, cereri, mesaje, fisiere, rezervari, invitatii] = await Promise.all([
    queryOne(
      /* Field names are added, never renamed: this file is downloaded and kept,
       * and somebody's script that reads `study_group` must keep reading it a
       * year from now. `first_login_at` is here because it is stored about the
       * person and the notice says so — the copy has to be complete. */
      `SELECT name, email, role, student_number, father_initial, program, specialization,
              study_language, study_group, study_series, study_year, bio, created_at,
              first_login_at
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

  await recordAccess({ userId: u.id, action: 'export_date_proprii', request })

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
