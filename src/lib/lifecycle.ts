import { query, queryOne, transaction } from './db'
import { curataJurnalul } from './audit'
import { postEvent } from './chat'
import { html, sendEmail, template } from './mail'

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
  seatRequestId: string | null,
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
 * Chemată de un planificator prin `/api/sweep`, și — ca plasă de siguranță — de
 * middleware, limitată la o dată la câteva minute. Legată doar de trafic, o
 * cerere care trebuia închisă vineri seara rămânea deschisă până luni, iar
 * studentul aștepta un termen care trecuse deja.
 *
 * Un lock consultativ în Postgres ține locul unei singure rulări: două apeluri
 * simultane nu au voie să trimită de două ori aceleași emailuri.
 *
 * Eșecurile se scriu în jurnal și se înghit — o măturare care nu poate rula nu
 * are voie să doboare o pagină.
 */
let lastSweep = 0
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** Când a rulat ultima oară cu succes; `/api/sanatate` o poate raporta. */
export function lastSweepAt(): string | null {
  return lastSweep ? new Date(lastSweep).toISOString() : null
}

export async function sweepDeadlines(
  baseUrl: string,
  { fortat = false }: { fortat?: boolean } = {},
): Promise<void> {
  const now = Date.now()
  if (!fortat && now - lastSweep < SWEEP_INTERVAL_MS) return

  // Cheia este arbitrară, dar constantă: identifică *această* sarcină.
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

    /* Invitațiile expirate se anunțau nimănui.
     *
     * Un cadru didactic ținea un loc ocupat pentru un student care nu mai
     * răspundea, iar studentul nu afla niciodată că propunerea a căzut — starea
     * se schimba în tăcere, în baza de date. Aceeași buclă ca la cereri. */
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

    await curataJurnalul()
    const amintite = await trimiteMementouri(baseUrl)

    if (expired.length || lapsed.length || amintite) {
      console.log(
        `[sweep] ${expired.length} cereri expirate, ${lapsed.length} invitații expirate, ${amintite} mementouri`,
      )
    }
  } catch (err) {
    console.error('[sweep] eșec', err)
  } finally {
    // Lockul se eliberează chiar dacă măturarea a picat la jumătate; altfel
    // rularea următoare l-ar găsi ocupat pentru totdeauna.
    await queryOne(`SELECT pg_advisory_unlock(hashtext('sweep_deadlines'))`).catch(() => {})
  }
}

/* --- mementouri înainte de termen ------------------------------------------
 *
 * Portalul anunța termenele doar după ce treceau: cererea a expirat, invitația
 * a expirat. Anunțul de după constată o pierdere; cel dinainte o poate evita.
 *
 * Fiecare memento trece printr-o inserare în `notifications_sent` cu
 * `ON CONFLICT DO NOTHING`: dacă rândul exista deja, nu se trimite. Măturarea
 * rulează des și din două locuri, deci fără poarta asta același om ar primi
 * același memento de zece ori pe zi.
 */

/** Poarta: `true` dacă acum îi revine acestui apel să trimită. */
async function revendica(userId: string, kind: string, refId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `INSERT INTO notifications_sent (user_id, kind, ref_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING true AS ok`,
    [userId, kind, refId],
  )
  return Boolean(row?.ok)
}

async function trimiteMementouri(baseUrl: string): Promise<number> {
  let trimise = 0

  /* Coordonatorul, în ziua a cincea din șapte.
   *
   * Momentul în care mai poate răspunde fără ca portalul să decidă în locul lui.
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
    if (!(await revendica(c.teacher_id, 'cerere_expira', c.id))) continue
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
    trimise++
  }

  /* Studentul, cu două zile înainte ca propunerea primită să expire. */
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
    if (!(await revendica(i.student_id, 'invitatie_expira', i.id))) continue
    await sendEmail({
      to: i.student_email,
      subject: 'Propunerea de coordonare expiră în curând',
      html: template(
        'Mai ai două zile să răspunzi',
        html`<p>Bună, ${i.student_name.split(' ')[0]}. Propunerea de la ${i.teacher_name} expiră în
         mai puțin de două zile.</p>
         <p>Dacă o accepți, cererea ta este aprobată direct. Dacă o refuzi, locul se eliberează
         pentru altcineva — iar dacă nu răspunzi deloc, se închide singură.</p>`,
        { text: 'Vezi propunerea', url: `${baseUrl}/cererile-mele` },
      ),
    })
    trimise++
  }

  /* Studentul, cu trei zile înainte de un termen al lucrării, și în ziua lui. */
  const termene = await query<{
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

  for (const t of termene) {
    const cheie = t.zile === 0 ? 'termen_azi' : 'termen_3zile'
    if (!(await revendica(t.student_id, cheie, t.id))) continue
    await sendEmail({
      to: t.student_email,
      subject: t.zile === 0 ? `Astăzi este termenul: ${t.title}` : `Peste 3 zile: ${t.title}`,
      html: template(
        t.zile === 0 ? 'Termenul este astăzi' : 'Un termen se apropie',
        html`<p>Bună, ${t.student_name.split(' ')[0]}. Termenul <strong>${t.title}</strong>
         ${t.zile === 0 ? 'este astăzi' : 'este peste 3 zile'}.</p>
         <p>Dacă l-ai încheiat deja, marchează-l în portal ca să nu îți mai apară.</p>`,
        { text: 'Vezi termenele', url: `${baseUrl}/cererile-mele` },
      ),
    })
    trimise++
  }

  return trimise
}
