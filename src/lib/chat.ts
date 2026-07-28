import { execute, query, queryOne } from './db'

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
  last_message: string | null
  unread: number
}

export interface Message {
  id: string
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
  sender_name: string
  file_id: string | null
  file_name: string | null
}

/** Threads the user takes part in, most recently active first. */
export function myConversations(userId: string, asStudent: boolean) {
  const mine = asStudent ? 'student_id' : 'teacher_id'
  const theirs = asStudent ? 'teacher_id' : 'student_id'

  return query<Conversation>(
    `SELECT c.id, c.student_id, c.teacher_id, c.last_message_at,
            peer.id   AS peer_id,
            peer.name AS peer_name,
            COALESCE(peer.academic_title, peer.student_number) AS peer_detail,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT count(*)::int FROM messages m
              WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
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
            NULL::text AS last_message,
            0 AS unread
       FROM conversations c
       JOIN users peer
         ON peer.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END
      WHERE c.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [userId, conversationId],
  )
}

export function conversationMessages(userId: string, conversationId: string) {
  return query<Message>(
    `SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
            u.name AS sender_name,
            f.id AS file_id, f.original_name AS file_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN files f ON f.message_id = m.id
      WHERE m.conversation_id = $2
        AND (c.student_id = $1 OR c.teacher_id = $1)
      ORDER BY m.created_at`,
    [userId, conversationId],
  )
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
