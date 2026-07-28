import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { APIRoute } from 'astro'
import { filePath } from '../../lib/files'

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

  const path = filePath(folder, name)
  if (!path) return new Response('Imaginea nu a fost găsită', { status: 404 })

  try {
    const info = await stat(path)
    const extension = name.split('.').pop()!.toLowerCase()

    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        'content-type': TYPES[extension] ?? 'application/octet-stream',
        'content-length': String(info.size),
        // The stored name contains a fresh uuid on every upload, so the URL
        // changes when the picture does and this can be cached hard.
        'cache-control': 'private, max-age=604800, immutable',
      },
    })
  } catch {
    return new Response('Imaginea nu a fost găsită', { status: 404 })
  }
}
