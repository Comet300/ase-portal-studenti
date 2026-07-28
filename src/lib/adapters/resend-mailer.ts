import { Resend } from 'resend'
import type { Mailer, MailMessage, MailResult } from '../ports'
import { escapeHtml } from '../markup'

/**
 * The Resend implementation of `Mailer`.
 *
 * `redirectTo` sends everything to a single real inbox with the intended
 * recipient shown in the subject and in a banner — the demo accounts use
 * @stud.ase.ro addresses that do not exist, and without this you would receive
 * dozens of messages with no idea who each was for.
 */

export interface ResendMailerOptions {
  apiKey?: string
  from: string
  redirectTo?: string
}

function redirectBanner(originalRecipient: string): string {
  return `<div style="margin:0 0 24px;padding:12px 16px;background:#fdf3e2;border-radius:4px;
    font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#8a5a00">
    <strong>Mod demonstrativ.</strong> Acest mail era adresat
    <strong>${escapeHtml(originalRecipient)}</strong> și a fost redirecționat aici.
  </div>`
}

export function createResendMailer(options: ResendMailerOptions): Mailer {
  const resend = options.apiKey ? new Resend(options.apiKey) : null
  const redirect = options.redirectTo?.trim()

  return {
    async send(message: MailMessage): Promise<MailResult> {
      if (!resend) {
        console.warn(
          `[mail] RESEND_API_KEY lipsește — mail nelivrat: "${message.subject}" → ${message.to}`,
        )
        return { ok: false, error: 'RESEND_API_KEY lipsește' }
      }

      const recipient = redirect || message.to
      const redirected = Boolean(redirect) && redirect !== message.to

      try {
        const { data, error } = await resend.emails.send({
          from: options.from,
          to: [recipient],
          subject: redirected ? `[→ ${message.to}] ${message.subject}` : message.subject,
          html: (redirected ? redirectBanner(message.to) : '') + message.html,
          text: message.text,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content:
              typeof a.content === 'string'
                ? Buffer.from(a.content).toString('base64')
                : a.content.toString('base64'),
            contentType: a.contentType,
          })),
        })

        if (error) {
          console.error('[mail] eroare Resend', error)
          return { ok: false, error: error.message }
        }

        // Logged so delivery is provable from the container logs: without an id
        // there is no way to tell "sent" from "silently dropped".
        console.log(`[mail] sent ${data?.id} → ${recipient} · ${message.subject}`)
        return { ok: true, id: data?.id }
      } catch (err) {
        console.error('[mail] excepție la trimitere', err)
        return { ok: false, error: String(err) }
      }
    },
  }
}
