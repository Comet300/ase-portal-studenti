import type { APIRoute } from 'astro'
import { openFile } from '../../lib/files'

/**
 * Profile pictures.
 *
 * Served from the uploads volume rather than from `public/`, because they arrive
 * after the build. The path is split and re-validated here; `filePath` rejects
 * anything that would resolve outside the uploads root, so a crafted URL cannot
 * read the rest of the disk.
 *
 * Pictures are visible to anyone signed in — the profile pages they belong to
 * are too, and a picture nobody may fetch is not a picture.
 */

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('Neautentificat', { status: 401 })

  const [folder, name, ...rest] = (params.cale ?? '').split('/')
  if (!folder || !name || rest.length > 0) {
    return new Response('Imaginea nu a fost găsită', { status: 404 })
  }

  const stored = await openFile(folder, name)
  if (!stored) return new Response('Imaginea nu a fost găsită', { status: 404 })

  const extension = name.split('.').pop()!.toLowerCase()

  return new Response(stored.stream, {
    headers: {
      'content-type': TYPES[extension] ?? 'application/octet-stream',
      'content-length': String(stored.size),
      // The stored name contains a fresh uuid on every upload, so the URL
      // changes when the picture does and this can be cached hard — privately,
      // never at a shared cache.
      'cache-control': 'private, max-age=604800, immutable',
    },
  })
}
