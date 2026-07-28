import { query, queryOne, transaction } from './db'
import { postEvent } from './chat'
import { sendEmail, template } from './mail'

/**
 * The parts of a coordination that happen on a clock or across two inboxes:
 * invitations from a coordinator, seat requests to the director, and the
 * deadline that turns silence into an answer.
 */

/** A coordinator has one week to answer a request; after that it is refused. */
export const DECISION_WINDOW_DAYS = 7

/** A student has two weeks to answer an invitation. */
export const INVITATION_WINDOW_DAYS = 14

/* --- invitations ------------------------------------------------------------ */

export interface Invitation {
  id: string
  teacher_id: string
  teacher_name: string
  academic_title: string | null
  student_id: string
  student_name: string
  student_number: string | null
  topic_id: string | null
  topic_title: string | null
  message: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  response_reason: string | null
  expires_at: string
  responded_at: string | null
  created_at: string
}

const INVITATION_FIELDS = `
  i.id, i.teacher_id, i.student_id, i.topic_id, i.message, i.status,
  i.response_reason, i.expires_at, i.responded_at, i.created_at,
  t.name AS teacher_name, t.academic_title,
  s.name AS student_name, s.student_number,
  tp.title AS topic_title`

const INVITATION_JOINS = `
  FROM invitations i
  JOIN users t ON t.id = i.teacher_id
  JOIN users s ON s.id = i.student_id
  LEFT JOIN topics tp ON tp.id = i.topic_id`

export function teacherInvitations(teacherId: string): Promise<Invitation[]> {
  return query<Invitation>(
    `SELECT ${INVITATION_FIELDS} ${INVITATION_JOINS}
      WHERE i.teacher_id = $1
      ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC`,
    [teacherId],
  )
}

export function studentInvitations(studentId: string): Promise<Invitation[]> {
  return query<Invitation>(
    `SELECT ${INVITATION_FIELDS} ${INVITATION_JOINS}
      WHERE i.student_id = $1
      ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC`,
    [studentId],
  )
}

/** The invitation, but only if it is this student's and still open. */
export function openInvitationFor(studentId: string, invitationId: string): Promise<Invitation | null> {
  return queryOne<Invitation>(
    `SELECT ${INVITATION_FIELDS} ${INVITATION_JOINS}
      WHERE i.id = $2 AND i.student_id = $1 AND i.status = 'pending' AND i.expires_at > now()`,
    [studentId, invitationId],
  )
}

/* --- seat requests ---------------------------------------------------------- */

export interface SeatRequest {
  id: string
  teacher_id: string
  teacher_name: string
  level: 'bachelor' | 'master'
  extra_seats: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export function seatRequests(options: { teacherId?: string } = {}): Promise<SeatRequest[]> {
  return query<SeatRequest>(
    `SELECT sr.id, sr.teacher_id, sr.level, sr.extra_seats, sr.reason, sr.status,
            sr.decision_note, sr.decided_at, sr.created_at, t.name AS teacher_name
       FROM seat_requests sr
       JOIN users t ON t.id = sr.teacher_id
      WHERE ($1::uuid IS NULL OR sr.teacher_id = $1)
        AND sr.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
      ORDER BY CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END, sr.created_at DESC`,
    [options.teacherId ?? null],
  )
}

/**
 * Grants the seats and closes the request in one statement.
 *
 * The allocation row and the decision have to move together: a granted request
 * whose seats were never added is the kind of discrepancy nobody notices until a
 * coordinator is turned away from a student they were told they could take.
 */
export async function grantSeats(
  headId: string,
  seatRequestId: string,
  note: string,
): Promise<SeatRequest | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<SeatRequest>(
      `UPDATE seat_requests
          SET status = 'approved', decision_note = NULLIF($3, ''), decided_by = $1, decided_at = now()
        WHERE id = $2 AND status = 'pending'
        RETURNING id, teacher_id, academic_year_id, level, extra_seats, reason, status,
                  decision_note, decided_at, created_at`,
      [headId, seatRequestId, note],
    )
    const sr = rows[0] as (SeatRequest & { academic_year_id: string }) | undefined
    if (!sr) return null

    const column = sr.level === 'master' ? 'master_seats' : 'bachelor_seats'
    await client.query(
      `INSERT INTO seat_allocations (teacher_id, academic_year_id, ${column}, set_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, academic_year_id)
       DO UPDATE SET ${column} = seat_allocations.${column} + EXCLUDED.${column},
                     set_by = EXCLUDED.set_by, updated_at = now()`,
      [sr.teacher_id, sr.academic_year_id, sr.extra_seats, headId],
    )

    return sr
  })
}

/* --- the deadline ----------------------------------------------------------- */

/**
 * Turns undecided requests and unanswered invitations into decisions.
 *
 * Runs from middleware rather than a scheduler, throttled to once every few
 * minutes: the portal is one container, and a request that expires a few minutes
 * late is still a week-old request. Failures are logged and swallowed — a sweep
 * that cannot run must never take a page down with it.
 */
let lastSweep = 0
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

export async function sweepDeadlines(baseUrl: string): Promise<void> {
  const now = Date.now()
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now

  try {
    const expired = await query<{
      id: string
      number: string
      title_ro: string
      student_id: string
      student_email: string
      student_name: string
      teacher_id: string
      teacher_name: string
    }>(
      `UPDATE requests r
          SET status = 'expired', decided_at = now(), updated_at = now(),
              rejection_reason = 'Cererea a expirat: coordonatorul nu a răspuns în termenul de '
                                 || ${DECISION_WINDOW_DAYS} || ' zile.'
        FROM users s, users t
       WHERE r.student_id = s.id AND r.teacher_id = t.id
         AND r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at <= now()
       RETURNING r.id, r.number, r.title_ro, s.id AS student_id, s.email AS student_email,
                 s.name AS student_name, t.id AS teacher_id, t.name AS teacher_name`,
    )

    for (const r of expired) {
      await postEvent({
        studentId: r.student_id,
        teacherId: r.teacher_id,
        senderId: r.teacher_id,
        eventType: 'request_expired',
        body: `Cererea ${r.number} a expirat după ${DECISION_WINDOW_DAYS} zile fără răspuns și a fost respinsă automat. Poți depune o cerere nouă către alt coordonator.`,
        createConversation: false,
      })

      await sendEmail({
        to: r.student_email,
        subject: `Cererea ${r.number} a expirat`,
        html: template(
          'Cererea ta a expirat',
          `<p>Bună, ${r.student_name.split(' ')[0]}. Cererea <strong>${r.number}</strong> pentru lucrarea
           „${r.title_ro}” nu a primit un răspuns de la ${r.teacher_name} în termenul de
           ${DECISION_WINDOW_DAYS} zile și a fost respinsă automat de portal.</p>
           <p>Poți depune imediat o cerere nouă, către alt coordonator.</p>`,
          { text: 'Vezi coordonatorii', url: `${baseUrl}/coordonatori` },
        ),
      })
    }

    const lapsed = await query<{ id: string }>(
      `UPDATE invitations SET status = 'expired', responded_at = now()
        WHERE status = 'pending' AND expires_at <= now()
        RETURNING id`,
    )

    if (expired.length || lapsed.length) {
      console.log(`[sweep] ${expired.length} cereri expirate, ${lapsed.length} invitații expirate`)
    }
  } catch (err) {
    console.error('[sweep] eșec', err)
  }
}
