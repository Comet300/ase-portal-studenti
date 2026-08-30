import { execute, query, queryOne } from './db'
import type { LockReason } from './chat-lock'

/**
 * Messaging between a student and their supervisor.
 *
 * A conversation belongs to one (student, teacher) pair. Every query takes the
 * reader's id and applies it in the same statement, so nobody can open a thread
 * they are not part of.
 */

export interface Conversation {
  id: string
  student_id: string
  teacher_id: string
  last_message_at: string | null
  peer_id: string
  peer_name: string
  peer_detail: string | null
  /** When the other person was last in the portal. Only between the two of them. */
  peer_seen: string | null
  peer_avatar: string | null
  last_message: string | null
  unread: number
  /** Can it still be written to? A thread without a live pairing is read-only. */
  is_active: boolean
  /**
   * Why it is read-only, when it is. `null` while the pairing is live.
   *
   * Computed by both queries, not only by the one that opens a thread: the
   * pages fall back to `conversations[0]` when no thread is named in the
   * address, so a conversation that arrived through the list would have
   * carried a closed composer with nothing next to it saying why.
   */
  lock_reason: LockReason | null
}

export interface MessageFile {
  id: string
  name: string
  mime: string | null
}

export interface Message {
  id: string
  sender_id: string
  body: string
  /** `event` messages are things the portal did, not things a person typed. */
  kind: 'text' | 'event'
  event_type: string | null
  created_at: string
  read_at: string | null
  sender_name: string
  /**
   * The message's attachments, in upload order.
   *
   * A `LEFT JOIN` on `files` was enough while a message had at most one file.
   * Now that it can have several, that same join would return the message three
   * times — that is, three identical bubbles in the thread, with the same text.
   * They are aggregated in the query, not in the page.
   */
  files: MessageFile[]
}

/**
 * Is there still a live pairing between the two?
 *
 * A thread opened when a request was approved and stayed open forever —
 * including when the request was withdrawn or rejected afterwards. The result:
 * a student with no supervisor had a working conversation with a member of
 * staff who was not supervising them, and the POST accepted it, because it
 * authorised on membership of the conversation alone.
 *
 * The thread is not hidden — a rejection reason may be everything that was ever
 * said between them, and it has to stay findable there. It only becomes
 * read-only.
 */
const PAIRING_LIVE = `(
  peer.is_active
  AND (
    EXISTS (SELECT 1 FROM requests r
             WHERE r.student_id = c.student_id AND r.teacher_id = c.teacher_id
               AND r.status IN ('approved', 'pending'))
    OR EXISTS (SELECT 1 FROM invitations i
                WHERE i.student_id = c.student_id AND i.teacher_id = c.teacher_id
                  AND i.status IN ('pending', 'accepted'))
  )
)`

/**
 * Which of the ways the pair came apart is the one that happened.
 *
 * A message to somebody whose account has been closed was accepted, written and
 * then announced by an email to an address that can no longer sign in — so the
 * closed account comes first, before any request is looked at.
 *
 * Otherwise the answer is the last thing that happened between the two, across
 * both tables: a student who was refused in March and refused a proposal in May
 * is told about May. A `draft` request is nobody's link, so it falls through to
 * `never_linked` — which is also the answer for the thread a rejection opens
 * for a pair that never had anything else.
 */
const LOCK_REASON = `CASE
  WHEN ${PAIRING_LIVE} THEN NULL::text
  WHEN NOT peer.is_active THEN 'peer_inactive'
  ELSE COALESCE(
    (SELECT CASE
              WHEN latest.source = 'request'    AND latest.status = 'defended'  THEN 'defended'
              WHEN latest.source = 'request'    AND latest.status = 'rejected'  THEN 'request_rejected'
              WHEN latest.source = 'request'    AND latest.status = 'withdrawn' THEN 'request_withdrawn'
              WHEN latest.source = 'request'    AND latest.status = 'expired'   THEN 'request_expired'
              WHEN latest.source = 'invitation' AND latest.status = 'declined'  THEN 'invitation_declined'
              WHEN latest.source = 'invitation' AND latest.status = 'expired'   THEN 'invitation_expired'
            END
       FROM (
         SELECT 'request' AS source, r.status,
                COALESCE(r.defended_on::timestamptz, r.decided_at, r.updated_at) AS happened_at
           FROM requests r
          WHERE r.student_id = c.student_id AND r.teacher_id = c.teacher_id
         UNION ALL
         SELECT 'invitation', i.status,
                COALESCE(i.responded_at, i.expires_at, i.created_at)
           FROM invitations i
          WHERE i.student_id = c.student_id AND i.teacher_id = c.teacher_id
       ) latest
      ORDER BY latest.happened_at DESC NULLS LAST
      LIMIT 1),
    'never_linked')
END`

/** Threads the user takes part in, most recently active first. */
export function myConversations(userId: string, asStudent: boolean) {
  const mine = asStudent ? 'student_id' : 'teacher_id'
  const theirs = asStudent ? 'teacher_id' : 'student_id'

  return query<Conversation>(
    `SELECT c.id, c.student_id, c.teacher_id, c.last_message_at,
            peer.id   AS peer_id,
            peer.name AS peer_name,
            COALESCE(peer.academic_title, peer.student_number) AS peer_detail,
            peer.last_seen_at::text AS peer_seen,
            peer.avatar_path AS peer_avatar,
            /* A message that is only a file has no text, so the preview names
               it. Before, the literal „(fișier atașat)” was written into the body
               of the message, and the conversation list showed that string
               instead of the name of the document that had been sent — filler
               text that had escaped into production. */
            (SELECT COALESCE(
                      NULLIF(m.body, ''),
                      /* A message can carry several files: the preview names
                         the first and says how many more follow it, instead of
                         pretending a single one was sent. */
                      (SELECT CASE WHEN count(*) > 1
                                   THEN (array_agg(f.original_name ORDER BY f.position, f.created_at))[1]
                                        || ' + ' || (count(*) - 1) || ' altele'
                                   ELSE min(f.original_name) END
                         FROM files f WHERE f.message_id = m.id),
                      '(fără text)')
               FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT count(*)::int FROM messages m
              WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread,
            ${PAIRING_LIVE} AS is_active,
            ${LOCK_REASON} AS lock_reason
       FROM conversations c
       JOIN users peer ON peer.id = c.${theirs}
      WHERE c.${mine} = $1
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [userId],
  )
}

/** The requested conversation, but only if the user is part of it. */
export function myConversation(userId: string, conversationId: string) {
  return queryOne<Conversation>(
    `SELECT c.id, c.student_id, c.teacher_id, c.last_message_at,
            peer.id   AS peer_id,
            peer.name AS peer_name,
            COALESCE(peer.academic_title, peer.student_number) AS peer_detail,
            peer.last_seen_at::text AS peer_seen,
            peer.avatar_path AS peer_avatar,
            NULL::text AS last_message,
            0 AS unread,
            ${PAIRING_LIVE} AS is_active,
            ${LOCK_REASON} AS lock_reason
       FROM conversations c
       JOIN users peer
         ON peer.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END
      WHERE c.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [userId, conversationId],
  )
}

/** How many messages are fetched by default — from the tail, as in a messaging app. */
export const MESSAGES_PER_PAGE = 40

/**
 * The thread, from the tail forwards.
 *
 * All of it was fetched. A supervision lasts nine months, and a thread of three
 * hundred messages meant three hundred bubbles rendered so that the last five
 * could be read — attachments and all, and with the scroll going to the end, so
 * the work was visibly for nothing. The last `limit` are fetched, in ascending
 * order; the rest stays one click away.
 *
 * `olderCount` says whether anything is left before them, so that the page does
 * not offer a button that brings back nothing.
 */
export async function conversationMessages(
  userId: string,
  conversationId: string,
  limit = MESSAGES_PER_PAGE,
): Promise<{ mesaje: Message[]; olderCount: number }> {
  const [mesaje, total] = await Promise.all([
    query<Message>(
      `SELECT * FROM (
         SELECT m.id, m.sender_id, m.body, m.kind, m.event_type, m.created_at, m.read_at,
                u.name AS sender_name,
                COALESCE(
                  (SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.original_name, 'mime', f.mime)
                                    ORDER BY f.position, f.created_at, f.id)
                     FROM files f WHERE f.message_id = m.id),
                  '[]'::jsonb
                ) AS files
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = $2
            AND (c.student_id = $1 OR c.teacher_id = $1)
          ORDER BY m.created_at DESC
          LIMIT $3
       ) recente
       ORDER BY created_at`,
      [userId, conversationId, limit],
    ),
    queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
      [userId, conversationId],
    ),
  ])

  return { mesaje, olderCount: Math.max(0, (total?.n ?? 0) - mesaje.length) }
}

/**
 * How far the thread has got, without fetching it.
 *
 * The poll that asks „has anything appeared?” called `conversationMessages`, so
 * it fetched the whole thread — with the files aggregated for every message —
 * every fifteen seconds, in order to count three things. The counting is done in
 * SQL. Now that the thread is fetched a page at a time it would also be wrong:
 * `total` would have been the size of the window.
 */
export function threadSummary(userId: string, conversationId: string) {
  return queryOne<{ total: number; ultim: string | null; noi: number; peer_seen: string | null }>(
    `SELECT count(*)::int AS total,
            max(m.created_at)::text AS ultim,
            count(*) FILTER (WHERE m.sender_id <> $1 AND m.read_at IS NULL)::int AS noi,
            /* The other person's presence, taken from the same query the open
               thread makes anyway every twenty seconds: one extra request just
               for this would have been a request for nothing. It is visible only
               between the two of them — membership is checked right here. */
            (SELECT p.last_seen_at::text FROM users p
              WHERE p.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END)
              AS peer_seen
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)
      GROUP BY c.student_id, c.teacher_id`,
    [userId, conversationId],
  )
}

/**
 * „I was around here a minute ago.”
 *
 * Written at most once a minute, through a `WHERE` that compares what is already
 * in the row: otherwise every request of every user would be an UPDATE. It does
 * not throw — a portal is not allowed to stop because it could not note a
 * presence.
 */
export async function touchPresence(userId: string): Promise<void> {
  try {
    await execute(
      `UPDATE users
          SET last_seen_at = now()
        WHERE id = $1
          AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
      [userId],
    )
  } catch (err) {
    console.error('[prezență] nu a putut fi notată', err)
  }
}

/** Marks incoming messages as read — never the user's own. */
export function markRead(userId: string, conversationId: string) {
  return execute(
    `UPDATE messages m
        SET read_at = now()
      WHERE m.conversation_id = $2
        AND m.sender_id <> $1
        AND m.read_at IS NULL
        AND EXISTS (
              SELECT 1 FROM conversations c
               WHERE c.id = m.conversation_id AND (c.student_id = $1 OR c.teacher_id = $1)
            )`,
    [userId, conversationId],
  )
}

/**
 * Records something the portal did in the pair's thread.
 *
 * A decision reaches the student twice — by email, and here — because the thread
 * is where they will look for it a month later. It is stored as `kind = 'event'`
 * so the chat can render it as a record rather than as the coordinator typing.
 */
export async function postEvent(e: {
  studentId: string
  teacherId: string
  /** Whose name the event is attributed to; the actor, not the reader. */
  senderId: string
  eventType: string
  body: string
  /** Open the thread if the pair has none yet. Off for events that may precede one. */
  createConversation?: boolean
  /**
   * What exactly happened, so that the notification can lead there.
   *
   * The subject is stored, not an address: the same consultation has a different
   * screen for the student and for the coordinator, and a path saved now would
   * have aged along with the routes. Without it, the notification opens the
   * conversation thread.
   *
   * The list mirrors the CHECK constraint on the column exactly (migration
   * 0016). A value the constraint does not know is not a compile error and not
   * a runtime error either — `postEvent` swallows it — it is an event that
   * never reaches anybody, which is why the two lists are kept in step.
   */
  subjectKind?: 'request' | 'invitation' | 'slot' | 'change' | 'file'
  subjectId?: string | null
}): Promise<string | null> {
  // Never rejects. Every caller reaches this *after* committing the decision it
  // describes, so throwing here would turn a successful approval into a 500 —
  // and the coordinator would retry a request that no longer needs deciding.
  try {
    return await writeEvent(e)
  } catch (err) {
    console.error('[chat] evenimentul nu a putut fi scris în conversație', err)
    return null
  }
}

async function writeEvent(e: {
  studentId: string
  teacherId: string
  senderId: string
  eventType: string
  body: string
  createConversation?: boolean
  subjectKind?: 'request' | 'invitation' | 'slot' | 'change' | 'file'
  subjectId?: string | null
}): Promise<string | null> {
  const conversation = e.createConversation
    ? await queryOne<{ id: string }>(
        `INSERT INTO conversations (student_id, teacher_id, last_message_at)
         VALUES ($1, $2, now())
         ON CONFLICT (student_id, teacher_id)
         DO UPDATE SET last_message_at = now()
         RETURNING id`,
        [e.studentId, e.teacherId],
      )
    : await queryOne<{ id: string }>(
        `SELECT id FROM conversations WHERE student_id = $1 AND teacher_id = $2`,
        [e.studentId, e.teacherId],
      )

  if (!conversation) return null

  await execute(
    `INSERT INTO messages (conversation_id, sender_id, body, kind, event_type,
                           subject_kind, subject_id)
     VALUES ($1, $2, $3, 'event', $4, $5, $6)`,
    [conversation.id, e.senderId, e.body, e.eventType, e.subjectKind ?? null, e.subjectId ?? null],
  )
  await execute(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversation.id])

  return conversation.id
}

/** Opens (or returns) the thread with the supervisor who approved the request. */
export async function ensureSupervisorConversation(studentId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO conversations (student_id, teacher_id)
     SELECT r.student_id, r.teacher_id
       FROM requests r
      WHERE r.student_id = $1 AND r.status = 'approved'
      LIMIT 1
     ON CONFLICT (student_id, teacher_id) DO UPDATE SET student_id = EXCLUDED.student_id
     RETURNING id`,
    [studentId],
  )
  return row?.id ?? null
}

export interface NotificationRow {
  id: string
  event_type: string | null
  body: string
  created_at: string
  read_at: string | null
  conversation_id: string
  subject_kind: 'request' | 'invitation' | 'slot' | 'change' | null
  subject_id: string | null
  /** Who produced the event — the other party in the conversation, not the reader. */
  peer_name: string
}

/**
 * What happened, for somebody who has just come back.
 *
 * The portal wrote every decision as an event in the pair's thread from the
 * start — approvals, rejections, proposals, scheduled consultations, allocated
 * seats. There was, however, no place that showed them together: a student who
 * did not read their email had no way of finding out that they had been
 * answered other than by opening every screen in turn.
 *
 * No new table and no new column: the same rows, read differently.
 */
export function recentEvents(userId: string, limit = 20) {
  return query<NotificationRow>(
    `SELECT m.id, m.event_type, m.body, m.created_at, m.read_at, m.conversation_id,
            m.subject_kind, m.subject_id, peer.name AS peer_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users peer ON peer.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END
      WHERE m.kind = 'event'
        AND (c.student_id = $1 OR c.teacher_id = $1)
        AND m.sender_id <> $1
      ORDER BY m.created_at DESC
      LIMIT $2`,
    [userId, limit],
  )
}

/** How many of them have not been seen yet. */
export async function unreadEvents(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.kind = 'event'
        AND (c.student_id = $1 OR c.teacher_id = $1)
        AND m.sender_id <> $1
        AND m.read_at IS NULL`,
    [userId],
  )
  return row?.n ?? 0
}
