import { query, queryOne, transaction } from './db'
import { purgeAccessLog } from './audit'
import { postEvent } from './chat'
import { localDay, startOfWeek } from './date'
import { html, joinHtml, sendEmail, template } from './mail'
import { numar } from './text'

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
  father_initial: string | null
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
  s.name AS student_name, s.student_number, s.father_initial,
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
export function openInvitationFor(
  studentId: string,
  invitationId: string | null,
): Promise<Invitation | null> {
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
  /* Which study programme the extra seats are asked for. Extras are reserved
   * to one programme, so an ask that does not name one cannot be granted —
   * only the requests filed before this release have it empty. */
  programme_id: string | null
  programme_name: string | null
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
            sr.decision_note, sr.decided_at, sr.created_at, t.name AS teacher_name,
            sr.programme_id, p.name AS programme_name
       FROM seat_requests sr
       JOIN users t ON t.id = sr.teacher_id
       LEFT JOIN study_programmes p ON p.id = sr.programme_id
      WHERE ($1::uuid IS NULL OR sr.teacher_id = $1)
        AND sr.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
      ORDER BY CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END, sr.created_at DESC`,
    [options.teacherId ?? null],
  )
}

/**
 * Grants the seats and closes the request in one statement.
 *
 * The ledger row and the decision have to move together: a granted request
 * whose seats were never added is the kind of discrepancy nobody notices until
 * a coordinator is turned away from a student they were told they could take.
 *
 * The seats no longer land in `seat_allocations`. They used to be added into
 * the very column the director's form overwrites, so a coordinator at 43 lost
 * three seats — with a success notice — the next time that row was saved, and
 * afterwards nothing could say which of their seats were the norm and which
 * were granted. Extras live in `seat_grants` now, earmarked for the programme
 * the request named, and the base is a separate column no grant ever touches.
 *
 * Returns `null` when the request is no longer pending, and `'no-programme'`
 * when it predates the earmark and therefore cannot be granted as it stands:
 * an extra with no programme would be spendable by anyone, which is exactly
 * what this release removed.
 */
export async function grantSeats(
  headId: string,
  seatRequestId: string | null,
  note: string,
): Promise<SeatRequest | 'no-programme' | null> {
  return transaction(async (client) => {
    const { rows: open } = await client.query<{ programme_id: string | null }>(
      `SELECT programme_id FROM seat_requests WHERE id = $1 AND status = 'pending'`,
      [seatRequestId],
    )
    if (!open[0]) return null
    if (!open[0].programme_id) return 'no-programme'

    const { rows } = await client.query<SeatRequest & { academic_year_id: string }>(
      `UPDATE seat_requests
          SET status = 'approved', decision_note = NULLIF($3, ''), decided_by = $1, decided_at = now()
        WHERE id = $2 AND status = 'pending'
        RETURNING id, teacher_id, academic_year_id, level, programme_id, extra_seats, reason,
                  status, decision_note, decided_at, created_at`,
      [headId, seatRequestId, note],
    )
    const sr = rows[0]
    if (!sr) return null

    await client.query(
      `INSERT INTO seat_grants (academic_year_id, teacher_id, programme_id, level, seats,
                                reason, seat_request_id, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sr.academic_year_id, sr.teacher_id, sr.programme_id, sr.level, sr.extra_seats,
        sr.reason, sr.id, headId,
      ],
    )

    return sr
  })
}

/* --- the deadline ----------------------------------------------------------- */

/**
 * Turns undecided requests and unanswered invitations into decisions.
 *
 * Called by a scheduler through `/api/sweep`, and — as a safety net — by the
 * middleware, throttled to once every few minutes. Tied to traffic alone, a
 * request that had to be closed on Friday evening stayed open until Monday, and
 * the student waited on a deadline that had already passed.
 *
 * An advisory lock in Postgres holds the place of a single run: two simultaneous
 * calls are not allowed to send the same emails twice.
 *
 * Failures are written to the log and swallowed — a sweep that cannot run is not
 * allowed to bring a page down.
 */
let lastSweep = 0
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** When it last ran successfully; `/api/sanatate` can report it. */
export function lastSweepAt(): string | null {
  return lastSweep ? new Date(lastSweep).toISOString() : null
}

export async function sweepDeadlines(
  baseUrl: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const now = Date.now()
  if (!force && now - lastSweep < SWEEP_INTERVAL_MS) return

  // The key is arbitrary but constant: it identifies *this* task.
  const lock = await queryOne<{ luat: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext('sweep_deadlines')) AS luat`,
  )
  if (!lock?.luat) return

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
        subjectKind: 'request',
        subjectId: r.id,
      })

      await sendEmail({
        to: r.student_email,
        subject: `Cererea ${r.number} a expirat`,
        html: template(
          'Cererea ta a expirat',
          html`<p>Bună, ${r.student_name.split(' ')[0]}. Cererea <strong>${r.number}</strong> pentru lucrarea
           „${r.title_ro}” nu a primit un răspuns de la ${r.teacher_name} în termenul de
           ${DECISION_WINDOW_DAYS} zile și a fost respinsă automat de portal.</p>
           <p>Poți depune imediat o cerere nouă, către alt coordonator.</p>`,
          { text: 'Vezi coordonatorii', url: `${baseUrl}/coordonatori` },
        ),
      })
    }

    /* Expired invitations were announced to nobody.
     *
     * A member of the teaching staff kept a seat held for a student who no
     * longer answered, and the student never found out that the proposal had
     * lapsed — the status changed silently, in the database. The same loop as
     * for requests. */
    const lapsed = await query<{
      id: string
      student_id: string
      student_name: string
      student_email: string
      teacher_id: string
      teacher_name: string
      teacher_email: string
    }>(
      `UPDATE invitations i SET status = 'expired', responded_at = now()
         FROM users s, users t
        WHERE i.student_id = s.id AND i.teacher_id = t.id
          AND i.status = 'pending' AND i.expires_at <= now()
       RETURNING i.id,
                 s.id AS student_id, s.name AS student_name, s.email AS student_email,
                 t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email`,
    )

    for (const i of lapsed) {
      await postEvent({
        studentId: i.student_id,
        teacherId: i.teacher_id,
        senderId: i.teacher_id,
        eventType: 'invitation_declined',
        body: `Propunerea de coordonare de la ${i.teacher_name} a expirat după ${INVITATION_WINDOW_DAYS} zile fără răspuns. Locul rezervat a fost eliberat.`,
        createConversation: false,
        subjectKind: 'invitation',
        subjectId: i.id,
      })

      await sendEmail({
        to: i.student_email,
        subject: 'Propunerea de coordonare a expirat',
        html: template(
          'Propunerea a expirat',
          html`<p>Bună, ${i.student_name.split(' ')[0]}. Propunerea de coordonare primită de la
           ${i.teacher_name} a expirat după ${INVITATION_WINDOW_DAYS} zile fără răspuns.</p>
           <p>Locul pe care îl ținea nu mai este rezervat, dar poți depune oricând o cerere
           obișnuită — către același coordonator sau către altul.</p>`,
          { text: 'Vezi coordonatorii', url: `${baseUrl}/coordonatori` },
        ),
      })

      await sendEmail({
        to: i.teacher_email,
        subject: `Propunerea către ${i.student_name} a expirat`,
        html: template(
          'Propunerea a expirat',
          html`<p>Propunerea trimisă lui ${i.student_name} a expirat după
           ${INVITATION_WINDOW_DAYS} zile fără răspuns. Locul pe care îl ținea s-a eliberat.</p>`,
          { text: 'Vezi propunerile', url: `${baseUrl}/profesor/studenti?sectiune=invitatii` },
        ),
      })
    }

    await purgeAccessLog()
    const remindersSent = await sendReminders(baseUrl)

    if (expired.length || lapsed.length || remindersSent) {
      console.log(
        `[sweep] ${expired.length} cereri expirate, ${lapsed.length} invitații expirate, ${remindersSent} mementouri`,
      )
    }
  } catch (err) {
    console.error('[sweep] eșec', err)
  } finally {
    // The lock is released even if the sweep failed halfway through; otherwise
    // the next run would find it taken forever.
    await queryOne(`SELECT pg_advisory_unlock(hashtext('sweep_deadlines'))`).catch(() => {})
  }
}

/* --- reminders before the deadline -----------------------------------------
 *
 * The portal announced deadlines only after they had passed: the request has
 * expired, the invitation has expired. The announcement afterwards records a
 * loss; the one beforehand can avoid it.
 *
 * Every reminder goes through an insert into `notifications_sent` with
 * `ON CONFLICT DO NOTHING`: if the row already existed, nothing is sent. The
 * sweep runs often and from two places, so without this gate the same person
 * would get the same reminder ten times a day.
 */

/** The gate: `true` if it now falls to this call to send. */
async function claimReminder(userId: string, kind: string, refId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `INSERT INTO notifications_sent (user_id, kind, ref_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING true AS ok`,
    [userId, kind, refId],
  )
  return Boolean(row?.ok)
}

/**
 * The same gate, but without the day in the key.
 *
 * `claimReminder` keys on `(user, kind, ref, sent_on)`, which is right for „three
 * days before” and „on the day”: those are two notices about one deadline, and
 * next year the same pair comes round legitimately. A weekly digest keyed the
 * same way would go out again every morning of that week, since `sent_on` moves.
 * Here the day is carried in `kind` instead, and the row is written only if
 * nothing with that key exists yet.
 *
 * The sweep is serialised by an advisory lock, so two callers cannot reach the
 * gap between the check and the insert; the primary key still refuses a
 * same-day repeat if one ever did.
 */
async function claimOnce(userId: string, kind: string, refId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `INSERT INTO notifications_sent (user_id, kind, ref_id)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications_sent
         WHERE user_id = $1 AND kind = $2 AND ref_id = $3)
     RETURNING true AS ok`,
    [userId, kind, refId],
  )
  return Boolean(row?.ok)
}

async function sendReminders(baseUrl: string): Promise<number> {
  let sent = 0

  /* The coordinator, on the fifth day out of seven.
   *
   * The moment when they can still answer without the portal deciding for them.
   */
  const cereri = await query<{
    id: string
    number: string
    title_ro: string
    expires_at: string
    teacher_id: string
    teacher_name: string
    teacher_email: string
    student_name: string
  }>(
    `SELECT r.id, r.number, r.title_ro, r.expires_at,
            t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email,
            s.name AS student_name
       FROM requests r
       JOIN users t ON t.id = r.teacher_id
       JOIN users s ON s.id = r.student_id
      WHERE r.status = 'pending'
        AND r.expires_at IS NOT NULL
        AND r.expires_at > now()
        AND r.expires_at <= now() + interval '2 days'`,
  )

  for (const c of cereri) {
    if (!(await claimReminder(c.teacher_id, 'cerere_expira', c.id))) continue
    const zile = Math.max(1, Math.ceil((new Date(c.expires_at).getTime() - Date.now()) / 86_400_000))
    await sendEmail({
      to: c.teacher_email,
      subject: `Mai ai ${zile === 1 ? 'o zi' : `${zile} zile`} să răspunzi la ${c.number}`,
      html: template(
        'O cerere așteaptă răspunsul tău',
        html`<p>Cererea <strong>${c.number}</strong> de la ${c.student_name}, pentru lucrarea
         „${c.title_ro}”, expiră în ${zile === 1 ? 'o zi' : `${zile} zile`}.</p>
         <p>Dacă nu răspunzi până atunci, portalul o respinge automat, iar studentul rămâne
         fără coordonator și trebuie să o ia de la capăt cu altcineva.</p>`,
        { text: 'Deschide cererea', url: `${baseUrl}/profesor/studenti?sectiune=cereri#cerere-${c.id}` },
      ),
    })
    sent++
  }

  /* The student, two days before the proposal received expires. */
  const invitatii = await query<{
    id: string
    expires_at: string
    student_id: string
    student_name: string
    student_email: string
    teacher_name: string
  }>(
    `SELECT i.id, i.expires_at,
            s.id AS student_id, s.name AS student_name, s.email AS student_email,
            t.name AS teacher_name
       FROM invitations i
       JOIN users s ON s.id = i.student_id
       JOIN users t ON t.id = i.teacher_id
      WHERE i.status = 'pending'
        AND i.expires_at > now()
        AND i.expires_at <= now() + interval '2 days'`,
  )

  for (const i of invitatii) {
    if (!(await claimReminder(i.student_id, 'invitatie_expira', i.id))) continue
    await sendEmail({
      to: i.student_email,
      subject: 'Propunerea de coordonare expiră în curând',
      html: template(
        'Mai ai două zile să răspunzi',
        html`<p>Bună, ${i.student_name.split(' ')[0]}. Propunerea de la ${i.teacher_name} expiră în
         mai puțin de două zile.</p>
         <p>Dacă o accepți, cererea ta este aprobată direct. Dacă o refuzi, locul se eliberează
         pentru altcineva — iar dacă nu răspunzi deloc, se închide singură.</p>`,
        { text: 'Vezi propunerea', url: `${baseUrl}/lucrarea-mea` },
      ),
    })
    sent++
  }

  /* The student, three days before a thesis deadline, and on the day itself. */
  const dueMilestones = await query<{
    id: string
    title: string
    due_on: string
    student_id: string
    student_name: string
    student_email: string
    zile: number
  }>(
    `SELECT m.id, m.title, m.due_on,
            s.id AS student_id, s.name AS student_name, s.email AS student_email,
            (m.due_on - current_date) AS zile
       FROM milestones m
       JOIN requests r ON r.id = m.request_id
       JOIN users s ON s.id = r.student_id
      WHERE m.status <> 'done'
        AND r.status = 'approved'
        AND m.due_on IN (current_date + 3, current_date)`,
  )

  for (const t of dueMilestones) {
    const reminderKind = t.zile === 0 ? 'termen_azi' : 'termen_3zile'
    if (!(await claimReminder(t.student_id, reminderKind, t.id))) continue
    await sendEmail({
      to: t.student_email,
      subject: t.zile === 0 ? `Astăzi este termenul: ${t.title}` : `Peste 3 zile: ${t.title}`,
      /* It used to end „marchează-l în portal ca să nu îți mai apară” — an
       * instruction for something the portal does not allow: the state of a
       * milestone is the coordinator's, `/api/termene` refuses anyone who is
       * not a member of staff, and the student's screen has no control at all.
       * Whoever followed the sentence looked for a button that was never there. */
      html: template(
        t.zile === 0 ? 'Termenul este astăzi' : 'Un termen se apropie',
        html`<p>Bună, ${t.student_name.split(' ')[0]}. Termenul <strong>${t.title}</strong>
         ${t.zile === 0 ? 'este astăzi' : 'este peste 3 zile'}.</p>
         <p>Dacă l-ai încheiat deja, scrie-i coordonatorului în conversație — el îl marchează
         ca finalizat.</p>`,
        { text: 'Vezi termenele', url: `${baseUrl}/lucrarea-mea` },
      ),
    })
    sent++
  }

  /* The coordinator, once a week, about what has been missed.
   *
   * Every milestone reminder went to the student and none to the person who
   * sets them: a coordinator with three students two weeks behind found out by
   * opening the screen, if they opened it. One message per coordinator, not one
   * per deadline — twelve late students used to be twelve separate emails in
   * every design that keyed this on the milestone.
   */
  const weekKey = `termene_depasite:${startOfWeek(localDay(new Date()))}`

  const behind = await query<{
    teacher_id: string
    teacher_name: string
    teacher_email: string
    total: number
    students: number
    examples: string[]
  }>(
    `SELECT t.id AS teacher_id, t.name AS teacher_name, t.email AS teacher_email,
            count(*)::int AS total,
            count(DISTINCT r.student_id)::int AS students,
            (array_agg(m.title || ' · ' || s.name || ' · ' || to_char(m.due_on, 'DD.MM.YYYY')
                       ORDER BY m.due_on))[1:5] AS examples
       FROM milestones m
       JOIN requests r ON r.id = m.request_id
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
      WHERE m.status <> 'done'
        AND r.status = 'approved'
        AND m.due_on IS NOT NULL
        AND m.due_on < current_date
        AND t.is_active
      GROUP BY t.id, t.name, t.email`,
  )

  for (const d of behind) {
    if (!(await claimOnce(d.teacher_id, weekKey, d.teacher_id))) continue
    await sendEmail({
      to: d.teacher_email,
      subject: `${numar(d.total, 'termen depășit', 'termene depășite')} la studenții tăi`,
      html: template(
        'Termene depășite',
        html`<p>La lucrările pe care le coordonezi sunt
         <strong>${numar(d.total, 'termen depășit', 'termene depășite')}</strong>, la
         ${numar(d.students, 'student', 'studenți')}.</p>
         <ul>${joinHtml(d.examples.map((e) => html`<li>${e}</li>`))}</ul>
         ${d.total > d.examples.length
           ? html`<p>Și încă ${numar(d.total - d.examples.length, 'termen', 'termene')}.</p>`
           : ''}
         <p>Un termen depășit nu se închide singur: îl muți, îl marchezi finalizat sau îl
         ștergi — din agenda termenelor.</p>`,
        { text: 'Deschide agenda termenelor', url: `${baseUrl}/profesor/studenti?sectiune=progres&vedere=toti` },
      ),
    })
    sent++
  }

  return sent
}
