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
  /** Când a fost celălalt ultima dată în portal. Doar între cei doi. */
  peer_seen: string | null
  peer_avatar: string | null
  last_message: string | null
  unread: number
  /** Se mai poate scrie? Un fir fără o legătură vie rămâne doar de citit. */
  is_active: boolean
}

export interface MesajFisier {
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
   * Atașamentele mesajului, în ordinea încărcării.
   *
   * Un `LEFT JOIN` pe `files` a fost de ajuns cât un mesaj avea cel mult un
   * fișier. De când poate avea mai multe, aceeași îmbinare ar întoarce mesajul de
   * trei ori — adică trei bule identice în fir, cu același text. Se adună în
   * interogare, nu în pagină.
   */
  files: MesajFisier[]
}

/**
 * Mai există o legătură vie între cei doi?
 *
 * Un fir se deschidea la aprobarea unei cereri și rămânea deschis pentru
 * totdeauna — inclusiv dacă cererea era retrasă sau respinsă după. Rezultatul:
 * un student fără coordonator avea o conversație funcțională cu un cadru
 * didactic care nu îl coordona, iar POST-ul o accepta, pentru că autoriza doar
 * pe apartenența la conversație.
 *
 * Firul nu se ascunde — un motiv de respingere poate fi tot ce s-a spus vreodată
 * între ei, iar acolo trebuie să rămână găsibil. Devine doar de citit.
 */
const PAIRING_LIVE = `(
  EXISTS (SELECT 1 FROM requests r
           WHERE r.student_id = c.student_id AND r.teacher_id = c.teacher_id
             AND r.status IN ('approved', 'pending'))
  OR EXISTS (SELECT 1 FROM invitations i
              WHERE i.student_id = c.student_id AND i.teacher_id = c.teacher_id
                AND i.status IN ('pending', 'accepted'))
)`

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
            /* Un mesaj care e doar un fișier nu are text, deci previzualizarea
               îl numește. Înainte se scria literal „(fișier atașat)” în corpul
               mesajului, iar lista de conversații arăta acel șir în loc de
               numele documentului trimis — un text de umplutură scăpat în
               producție. */
            (SELECT COALESCE(
                      NULLIF(m.body, ''),
                      /* Un mesaj poate purta mai multe fișiere: previzualizarea
                         numește primul și spune câte mai vin după el, în loc să
                         pretindă că a fost trimis unul singur. */
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
            ${PAIRING_LIVE} AS is_active
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
            ${PAIRING_LIVE} AS is_active
       FROM conversations c
       JOIN users peer
         ON peer.id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END
      WHERE c.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [userId, conversationId],
  )
}

/** Câte mesaje se aduc implicit — de la coadă, ca într-o aplicație de mesaje. */
export const MESAJE_PE_PAGINA = 40

/**
 * Firul, de la coadă înainte.
 *
 * Se aduceau toate. O coordonare ține nouă luni, iar un fir de trei sute de
 * mesaje însemna trei sute de bule randate ca să se citească ultimele cinci —
 * cu tot cu fișierele lor și cu derularea la final, deci munca era vizibil
 * degeaba. Se aduc ultimele `limita`, în ordine crescătoare; restul rămâne la un
 * clic distanță.
 *
 * `maiVechi` spune dacă a rămas ceva înaintea lor, ca pagina să nu ofere un buton
 * care nu aduce nimic.
 */
export async function conversationMessages(
  userId: string,
  conversationId: string,
  limita = MESAJE_PE_PAGINA,
): Promise<{ mesaje: Message[]; maiVechi: number }> {
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
      [userId, conversationId, limita],
    ),
    queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
      [userId, conversationId],
    ),
  ])

  return { mesaje, maiVechi: Math.max(0, (total?.n ?? 0) - mesaje.length) }
}

/**
 * Cât de departe a ajuns firul, fără să îl aducă.
 *
 * Sondajul care întreabă „a apărut ceva?” chema `conversationMessages`, deci
 * aducea tot firul — cu fișierele agregate pentru fiecare mesaj — la fiecare
 * cincisprezece secunde, ca să numere trei lucruri. Se numără în SQL. De când
 * firul se aduce paginat, ar fi și greșit: `total` ar fi fost mărimea ferestrei.
 */
export function firRezumat(userId: string, conversationId: string) {
  return queryOne<{ total: number; ultim: string | null; noi: number; peer_seen: string | null }>(
    `SELECT count(*)::int AS total,
            max(m.created_at)::text AS ultim,
            count(*) FILTER (WHERE m.sender_id <> $1 AND m.read_at IS NULL)::int AS noi,
            /* Prezența celuilalt, luată din aceeași interogare pe care firul
               deschis o face oricum la fiecare douăzeci de secunde: o cerere în
               plus doar pentru asta ar fi fost o cerere degeaba. Se vede doar
               între cei doi — apartenența e verificată chiar aici. */
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
 * „Am mai fost pe aici acum un minut.”
 *
 * Se scrie cel mult o dată pe minut, printr-un `WHERE` care compară ce e deja în
 * rând: altfel fiecare cerere a fiecărui utilizator ar fi un UPDATE. Nu aruncă —
 * un portal nu are voie să se oprească pentru că nu a putut nota o prezență.
 */
export async function atingePrezenta(userId: string): Promise<void> {
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
   * Ce anume s-a întâmplat, ca notificarea să poată duce acolo.
   *
   * Se scrie subiectul, nu o adresă: aceeași consultație are alt ecran pentru
   * student și pentru coordonator, iar o cale salvată acum ar fi îmbătrânit
   * odată cu rutele. Fără el, notificarea deschide firul de discuție.
   */
  subjectKind?: 'request' | 'invitation' | 'slot'
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
  subjectKind?: 'request' | 'invitation' | 'slot'
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

export interface Notificare {
  id: string
  event_type: string | null
  body: string
  created_at: string
  read_at: string | null
  conversation_id: string
  subject_kind: 'request' | 'invitation' | 'slot' | null
  subject_id: string | null
  /** Cine a produs evenimentul — celălalt din conversație, nu cititorul. */
  peer_name: string
}

/**
 * Ce s-a întâmplat, pentru cineva care tocmai s-a întors.
 *
 * Portalul scria de la început fiecare decizie ca eveniment în firul perechii —
 * aprobări, respingeri, propuneri, consultații programate, locuri alocate. Nu
 * exista însă niciun loc care să le arate laolaltă: un student care nu își
 * citea emailul nu avea de unde afla că i s-a răspuns decât deschizând pe rând
 * fiecare ecran.
 *
 * Fără tabel nou și fără coloană nouă: aceleași rânduri, citite altfel.
 */
export function recentEvents(userId: string, limit = 20) {
  return query<Notificare>(
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

/** Câte dintre ele nu au fost încă văzute. */
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
