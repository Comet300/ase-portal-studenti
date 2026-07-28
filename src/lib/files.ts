import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/**
 * Attachments on disk, in the volume mounted at `UPLOADS_DIR`.
 *
 * The stored name is generated here rather than taken from the upload: no part
 * of a client-supplied filename reaches the path, so traversal is impossible by
 * construction rather than by filtering.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_BYTES = 15 * 1024 * 1024

export function uploadsRoot(): string {
  return resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'))
}

function extension(name: string): string {
  const raw = name.includes('.') ? name.split('.').pop()! : ''
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  return ext || 'bin'
}

/** Writes the file and returns the generated stored name. */
export async function saveFile(
  folder: string,
  originalName: string,
  bytes: Buffer,
): Promise<string> {
  if (!UUID_RE.test(folder)) throw new Error('Invalid folder id')
  if (bytes.byteLength > MAX_BYTES) throw new Error('File too large')

  const dir = join(uploadsRoot(), folder)
  await mkdir(dir, { recursive: true })

  const stored = `${randomUUID()}.${extension(originalName)}`
  await writeFile(join(dir, stored), bytes)
  return stored
}

/** Absolute path of a stored file, or `null` if it would escape the root. */
export function filePath(folder: string, name: string): string | null {
  if (!UUID_RE.test(folder)) return null
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(name)) return null

  const root = uploadsRoot()
  const path = resolve(join(root, folder, name))

  // Both segments are validated; still confirm the result stays inside the root.
  if (path !== root && !path.startsWith(root + sep)) return null
  return path
}
