import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { APIRoute } from 'astro'
import { queryOne } from '../../lib/db'
import { filePath } from '../../lib/files'

/**
 * Attachment download.
 *
 * These are thesis chapters and datasets, not public images, so they are served
 * only to the two people in the conversation — and membership is checked in the
 * same query that fetches the file.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

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
    [u.id, params.id],
  )

  if (!file?.conversation_id) return new Response('Fișierul nu a fost găsit', { status: 404 })

  const path = filePath(file.conversation_id, file.stored_name)
  if (!path) return new Response('Fișierul nu a fost găsit', { status: 404 })

  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return new Response('Fișierul nu a fost găsit', { status: 404 })
    size = info.size
  } catch {
    return new Response('Fișierul nu a fost găsit', { status: 404 })
  }

  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream

  return new Response(stream, {
    headers: {
      'content-type': file.mime ?? 'application/octet-stream',
      'content-length': String(size),
      // User-supplied content is never rendered in our origin.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=0, must-revalidate',
    },
  })
}
