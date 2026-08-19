import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { queryOne } from '../../lib/db'
import { openFile } from '../../lib/files'
import { id as routeId } from '../../lib/ids'

/**
 * Attachment download.
 *
 * These are thesis chapters and datasets, not public images, so they are served
 * only to the two people in the conversation — and membership is checked in the
 * same query that fetches the file.
 */
/**
 * The types we serve for direct display rather than for download.
 *
 * The list is closed and is compared against the type recorded at upload time,
 * not against what the address says. An SVG, for example, is a document that can
 * run script, and for that reason it does not appear here, however much of an
 * „image” it may be.
 */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])

export const GET: APIRoute = async ({ params, locals, url, request }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const fileId = routeId(params.id ?? null)
  if (!fileId) return new Response('Fișierul nu a fost găsit', { status: 404 })

  const file = await queryOne<{
    conversation_id: string
    stored_name: string
    original_name: string
    mime: string | null
  }>(
    `SELECT f.conversation_id, f.stored_name, f.original_name, f.mime
       FROM files f
       JOIN conversations c ON c.id = f.conversation_id
      WHERE f.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [u.id, fileId],
  )

  if (!file?.conversation_id) return new Response('Fișierul nu a fost găsit', { status: 404 })

  const stored = await openFile(file.conversation_id, file.stored_name)
  if (!stored) return new Response('Fișierul nu a fost găsit', { status: 404 })

  const inline = url.searchParams.get('inline') === '1' && INLINE.has(file.mime ?? '')

  // Downloading somebody else's document leaves a trace; the inline preview in
  // the thread does not, otherwise every scroll through a conversation would
  // write a row.
  if (!inline) {
    await recordAccess({
      userId: u.id,
      action: 'descarca_fisier',
      subject: `${fileId} · ${file.original_name}`,
      request,
    })
  }

  return new Response(stored.stream, {
    headers: {
      'content-type': file.mime ?? 'application/octet-stream',
      'content-length': String(stored.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      'cache-control': 'private, no-store',
      // No sniffing and nothing active: even if the recorded type were lying,
      // the browser is not allowed to reinterpret it, nor to execute anything.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; object-src 'none'",
    },
  })
}
