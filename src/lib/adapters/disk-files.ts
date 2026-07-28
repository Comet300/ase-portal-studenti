import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { FileStore, StoredFile } from '../ports'

/**
 * The local-disk implementation of `FileStore`, backed by the volume mounted at
 * `UPLOADS_DIR`.
 *
 * The stored name is generated here rather than taken from the upload: no part
 * of a client-supplied filename reaches the path, so traversal is impossible by
 * construction rather than by filtering. Both identifiers are re-validated on
 * read, and the resolved path is confirmed to be inside the root even so.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORED_NAME = /^[a-f0-9-]+\.[a-z0-9]+$/

export const MAX_BYTES = 15 * 1024 * 1024

function extension(name: string): string {
  const raw = name.includes('.') ? name.split('.').pop()! : ''
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin'
}

export function createDiskFileStore(root: string): FileStore {
  const base = resolve(root)

  /** Absolute path, or `null` if it would escape the root. */
  function pathFor(folder: string, storedName: string): string | null {
    if (!UUID.test(folder) || !STORED_NAME.test(storedName)) return null
    const path = resolve(join(base, folder, storedName))
    if (path !== base && !path.startsWith(base + sep)) return null
    return path
  }

  return {
    async save(folder: string, originalName: string, bytes: Buffer): Promise<string> {
      if (!UUID.test(folder)) throw new Error('Invalid folder id')
      if (bytes.byteLength > MAX_BYTES) throw new Error('File too large')

      const dir = join(base, folder)
      await mkdir(dir, { recursive: true })

      const stored = `${randomUUID()}.${extension(originalName)}`
      await writeFile(join(dir, stored), bytes)
      return stored
    },

    async open(folder: string, storedName: string): Promise<StoredFile | null> {
      const path = pathFor(folder, storedName)
      if (!path) return null

      try {
        const info = await stat(path)
        return {
          stream: Readable.toWeb(createReadStream(path)) as ReadableStream,
          size: info.size,
        }
      } catch {
        return null
      }
    },
  }
}
