import type { APIRoute } from 'astro'
import { recordAccess } from '../../../lib/audit'
import { query, queryOne } from '../../../lib/db'
import { openFile } from '../../../lib/files'
import { id as routeId } from '../../../lib/ids'
import { buildZip } from '../../../lib/zip'

/**
 * All the files of a conversation, in one archive.
 *
 * At the end of a session a coordinator has to gather the chapters, the
 * questionnaire and the data file of every student — for the file, for the
 * board, for the plagiarism check. The file drawer showed them all and asked for
 * one click on each, with a „Salvează ca” after it; at nine files times twelve
 * students, this is the one part of the portal that gets done a hundred times.
 *
 * Ownership is checked in the same query that fetches the list, as when
 * downloading a single file: there is no parameter with which somebody could ask
 * for someone else's conversation.
 */

/* The archive is built in memory, so it has a ceiling.
 *
 * A conversation could in theory pile up hundreds of 15 MB files; holding them
 * all in memory at once would bring the process down, and a 500 response is
 * worse than a partial archive with a header that says what is missing. In
 * practice a thesis has ten files. */
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024

export const GET: APIRoute = async ({ params, locals, request }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const conversationId = routeId(params.id ?? null)
  if (!conversationId) return new Response('Conversația nu a fost găsită', { status: 404 })

  const conversation = await queryOne<{ id: string; peer_name: string }>(
    `SELECT c.id,
            (SELECT name FROM users
              WHERE id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END) AS peer_name
       FROM conversations c
      WHERE c.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [u.id, conversationId],
  )

  if (!conversation) return new Response('Conversația nu a fost găsită', { status: 404 })

  const fisiere = await query<{
    stored_name: string
    original_name: string
    created_at: string
  }>(
    `SELECT f.stored_name, f.original_name, f.created_at
       FROM files f
       JOIN conversations c ON c.id = f.conversation_id
      WHERE f.conversation_id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)
      ORDER BY f.created_at, f.position`,
    [u.id, conversationId],
  )

  if (fisiere.length === 0) {
    return new Response('Conversația nu are fișiere', { status: 404 })
  }

  const entries = []
  let total = 0
  let omise = 0

  for (const f of fisiere) {
    const stored = await openFile(conversationId, f.stored_name)
    // A row with no file on disk does not stop the archive: it is counted and said.
    if (!stored) {
      omise += 1
      continue
    }
    if (total + stored.size > MAX_ARCHIVE_BYTES) {
      omise += 1
      continue
    }
    entries.push({
      nume: f.original_name,
      bytes: Buffer.from(await new Response(stored.stream).arrayBuffer()),
      date: new Date(f.created_at),
    })
    total += stored.size
  }

  if (entries.length === 0) {
    return new Response('Fișierele nu au putut fi citite', { status: 404 })
  }

  const archive = buildZip(entries)

  await recordAccess({
    userId: u.id,
    action: 'descarca_arhiva',
    subject: `${conversationId} · ${conversation.peer_name}`,
    rowCount: entries.length,
    request,
  })

  /* The archive's name carries the name of the other person in the conversation:
   * twelve archives land in Downloads, and „fisiere.zip” twelve times helps
   * nobody. ASCII only, so that `filename=` stays valid under RFC 6266. */
  const peerSlug = (conversation.peer_name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  /* `Buffer` is a `Uint8Array`, but its type does not fit into `BodyInit`: hand
   * over exactly its slice of memory, without a copy. */
  const body = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer

  return new Response(body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(archive.byteLength),
      'content-disposition': `attachment; filename="fisiere-${peerSlug || 'conversatie'}.zip"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // How many went in and how many did not, in case the ceiling cut something.
      'x-fisiere-incluse': String(entries.length),
      ...(omise > 0 ? { 'x-fisiere-omise': String(omise) } : {}),
    },
  })
}
