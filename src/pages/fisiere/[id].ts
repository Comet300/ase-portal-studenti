import type { APIRoute } from 'astro'
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
 * Tipurile pe care le servim spre afișare directă, nu spre descărcare.
 *
 * Lista este închisă și se compară cu tipul înregistrat la încărcare, nu cu ce
 * spune adresa. Un SVG, de exemplu, este un document care poate rula script și
 * de aceea nu apare aici, oricât de „imagine” ar fi.
 */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])

export const GET: APIRoute = async ({ params, locals, url }) => {
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

  return new Response(stored.stream, {
    headers: {
      'content-type': file.mime ?? 'application/octet-stream',
      'content-length': String(stored.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      'cache-control': 'private, no-store',
      // Fără sniffing și fără nimic activ: chiar dacă tipul înregistrat ar minți,
      // browserul nu are voie să îl reinterpreteze și nici să execute ceva.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; object-src 'none'",
    },
  })
}
