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
 * Mail transport.
 *
 * Selection is explicit, never inferred from whether a key happens to be
 * present. A Resend key reaches a local `.env` through a single copy-paste, and
 * an implicit "send if you have a key" rule turns that paste into real mail
 * landing in real students' inboxes while someone iterates on a template.
 *
 * So: `MAIL_TRANSPORT` decides, and it only defaults — to `resend` inside the
 * production container, to `disk` everywhere else. Choosing `resend` without a
 * key is a boot failure rather than a silent downgrade, because a downgrade
 * here means the portal looks healthy while nobody receives anything.
 *
 * The disk transport writes each message as an `.eml` file in `outbox/`. Those
 * open in any mail client, so a change to a template — including whether the
 * calendar invitation imports — is verified without sending anything.
 * `MAIL_REDIRECT_TO` is the other way to verify, with a real key: everything
 * lands in one real mailbox with the intended recipient named in the subject.
 */
type MailTransport = 'disk' | 'resend'

const from = process.env.MAIL_FROM ?? 'Portal Studenți ASE <noreply@stargrid.dev>'
const outbox = process.env.MAIL_OUTBOX ?? join(process.cwd(), 'outbox')

function chooseMailTransport(): MailTransport {
  const asked = process.env.MAIL_TRANSPORT
  if (asked === undefined || asked === '') {
    return process.env.NODE_ENV === 'production' ? 'resend' : 'disk'
  }
  if (asked !== 'disk' && asked !== 'resend') {
    throw new Error(`MAIL_TRANSPORT must be 'disk' or 'resend', got '${asked}'`)
  }
  return asked
}

const mailTransport = chooseMailTransport()

if (mailTransport === 'resend' && !process.env.RESEND_API_KEY) {
  throw new Error("MAIL_TRANSPORT is 'resend' but RESEND_API_KEY is not set")
}

export const mailer: Mailer =
  mailTransport === 'disk'
    ? createDiskMailer({ from, dir: outbox })
    : createResendMailer({
        apiKey: process.env.RESEND_API_KEY!,
        from,
        redirectTo: process.env.MAIL_REDIRECT_TO,
      })

/* Said once at boot: otherwise the only way to find out whether mail leaves the
 * machine is for it to leave the machine. */
console.log(
  mailTransport === 'disk'
    ? `[mail] transport=disk dir=${outbox} (nothing leaves this machine)`
    : `[mail] transport=resend ${process.env.MAIL_REDIRECT_TO ? `redirect=${process.env.MAIL_REDIRECT_TO}` : 'recipients=real'}`,
)

export const fileStore: FileStore = createDiskFileStore(
  process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'),
)
