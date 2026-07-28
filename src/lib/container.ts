import { join } from 'node:path'
import { createDiskFileStore } from './adapters/disk-files'
import { createPostgresDatabase } from './adapters/postgres'
import { createResendMailer } from './adapters/resend-mailer'
import type { Database, FileStore, Mailer } from './ports'

/**
 * Where the implementations are chosen.
 *
 * The only file in the application that names PostgreSQL, Resend or the local
 * disk. Swapping one — a different mail provider, object storage instead of a
 * volume — is a change here plus a new file in `adapters/`, and nothing else.
 *
 * Constructed eagerly: a missing DATABASE_URL should stop the container at boot
 * with one clear line, not surface as a confusing failure on the first request.
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

export const database: Database = createPostgresDatabase(connectionString)

export const mailer: Mailer = createResendMailer({
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.MAIL_FROM ?? 'Portal Studenți ASE <noreply@stargrid.dev>',
  redirectTo: process.env.MAIL_REDIRECT_TO,
})

export const fileStore: FileStore = createDiskFileStore(
  process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'),
)
