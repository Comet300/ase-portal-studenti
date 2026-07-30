import { join } from 'node:path'
import { createDiskFileStore } from './adapters/disk-files'
import { createPostgresDatabase } from './adapters/postgres'
import { createDiskMailer } from './adapters/disk-mailer'
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

/**
 * Care poștaș.
 *
 * `MAIL_TRANSPORT=disk`, sau lipsa cheii Resend, scrie mailurile ca fișiere
 * `.eml` în `outbox/` în loc să nu trimită nimic. Se deschid cu dublu clic în
 * orice client de mail, deci se vede exact ce vede destinatarul — inclusiv dacă
 * invitația din calendar se importă. Înainte, un mail netrimis local era o linie
 * de `console.warn`, așa că fiecare schimbare de conținut se verifica pe oameni.
 *
 * Pe producție rămâne Resend. `MAIL_REDIRECT_TO` este cealaltă cale de verificare
 * cu cheie adevărată: totul ajunge într-o singură cutie reală, cu destinatarul
 * intenționat scris în subiect.
 */
const from = process.env.MAIL_FROM ?? 'Portal Studenți ASE <noreply@stargrid.dev>'
const peDisc = process.env.MAIL_TRANSPORT === 'disk' || !process.env.RESEND_API_KEY

export const mailer: Mailer = peDisc
  ? createDiskMailer({
      from,
      dir: process.env.MAIL_OUTBOX ?? join(process.cwd(), 'outbox'),
    })
  : createResendMailer({
      apiKey: process.env.RESEND_API_KEY,
      from,
      redirectTo: process.env.MAIL_REDIRECT_TO,
    })

export const fileStore: FileStore = createDiskFileStore(
  process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'),
)
