import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Attachment, Mailer, MailMessage, MailResult } from '../ports'

/**
 * The mailbox on disk.
 *
 * The portal sends twelve kinds of mail — decisions, invitations, cancelled
 * consultations, access links — and none of them could be seen outside
 * production: locally nothing went out, and `console.warn` only said that it had
 * not gone out. So every change of content or of attachment was checked on real
 * people.
 *
 * Here the mail is written as an `.eml` file, the format that any mail client
 * opens. Double-click it and you see exactly what the recipient sees: the
 * headers, the HTML rendering, and whether the calendar invitation imports.
 *
 * MIME written by hand, for the same reason as the zip: `multipart/mixed` with
 * boundaries and base64 on lines of 76 characters is one page of code, while a
 * mail library would be the portal's fourth dependency, for a development tool.
 */

export interface DiskMailerOptions {
  from: string
  /** Where the files are written. */
  dir: string
}

/** A header that may contain diacritics: RFC 2047, word encoded in base64. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** Base64 on lines of 76 characters, as RFC 2045 requires. */
function wrapBase64(b: Buffer): string {
  return (b.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
}

function attachmentPart(a: Attachment, boundary: string): string {
  const bytes = typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : a.content
  return [
    `--${boundary}`,
    `Content-Type: ${a.contentType ?? 'application/octet-stream'}; name="${a.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${a.filename}"`,
    '',
    wrapBase64(bytes),
    '',
  ].join('\r\n')
}

export function createDiskMailer(options: DiskMailerOptions): Mailer {
  return {
    async send(message: MailMessage): Promise<MailResult> {
      const boundary = `portal-${randomUUID()}`
      const now = new Date().toUTCString()

      const parts = [
        `From: ${encodeHeader(options.from)}`,
        `To: ${message.to}`,
        `Subject: ${encodeHeader(message.subject)}`,
        `Date: ${now}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        // Text and HTML as alternatives: the client picks, as with real mail.
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary="${boundary}-alt"`,
        '',
        ...(message.text
          ? [
              `--${boundary}-alt`,
              'Content-Type: text/plain; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              wrapBase64(Buffer.from(message.text, 'utf8')),
              '',
            ]
          : []),
        `--${boundary}-alt`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(Buffer.from(message.html, 'utf8')),
        '',
        `--${boundary}-alt--`,
        '',
        ...(message.attachments ?? []).map((a) => attachmentPart(a, boundary)),
        `--${boundary}--`,
        '',
      ]

      /* The file name starts with the time, so that `ls` gives them in the
       * order they were sent, and it holds the recipient and the subject, so
       * they can be found without being opened one by one. */
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const slug = message.subject
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
        .toLowerCase()
      const filename = `${stamp}__${message.to.replace(/[^A-Za-z0-9@._-]/g, '_')}__${slug || 'mail'}.eml`

      try {
        await mkdir(options.dir, { recursive: true })
        await writeFile(join(options.dir, filename), parts.join('\r\n'), 'utf8')
      } catch (err) {
        // The same promise as with Resend: it never throws.
        console.error('[mail] nu s-a putut scrie în cutia de pe disc', err)
        return { ok: false, error: String(err) }
      }

      const attachmentCount = message.attachments?.length ?? 0
      console.log(
        `[mail] scris ${filename}${attachmentCount > 0 ? ` (${attachmentCount} ${attachmentCount === 1 ? 'atașament' : 'atașamente'})` : ''}`,
      )
      return { ok: true, id: filename }
    },
  }
}
