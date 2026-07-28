import { mailer } from './container'
import { escapeHtml, html, joinHtml, trusted, type SafeHtml } from './markup'
import type { Attachment, MailMessage, MailResult } from './ports'

/**
 * Outgoing email: the message, not the transport.
 *
 * Delivery is whichever `Mailer` implementation `container.ts` chose. What lives
 * here is the house style — one template, one button, one footer — and the rule
 * that message bodies are built with `html`, so anything interpolated into them
 * is escaped. These messages carry thesis titles and free text written by
 * students, and they are sent from the faculty's own verified domain.
 */

export type { Attachment, MailMessage, MailResult }
export { escapeHtml, html, joinHtml, trusted }
export type { SafeHtml }

export function sendEmail(mail: MailMessage): Promise<MailResult> {
  return mailer.send(mail)
}

/* --- templates ------------------------------------------------------------- */

const BRAND = '#990000'

export function template(
  title: string,
  body: SafeHtml,
  action?: { text: string; url: string },
): string {
  return html`<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1e23;max-width:560px">
  <div style="border-bottom:2px solid ${BRAND};padding-bottom:12px;margin-bottom:24px">
    <div style="font:600 16px/1.2 Georgia,serif;color:${BRAND}">Portal Studenți</div>
    <div style="font-size:12px;color:#5b6169;margin-top:2px">Facultatea de Marketing · ASE București</div>
  </div>
  <h1 style="font:600 20px/1.3 Georgia,serif;margin:0 0 16px">${title}</h1>
  ${body}
  ${
    action
      ? html`<p style="margin:28px 0"><a href="${action.url}"
           style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;
           padding:12px 22px;border-radius:4px;font-weight:600;font-size:14px">${action.text}</a></p>
         <p style="font-size:12px;color:#5b6169;word-break:break-all">Dacă butonul nu funcționează, copiază adresa:<br>${action.url}</p>`
      : ''
  }
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e9ecef;font-size:12px;color:#5b6169">
    Mesaj automat din Portalul Studenți — Facultatea de Marketing, ASE București.
  </p>
</div>`.toString()
}

/** A quoted block of something a person wrote. */
export function quote(text: string): SafeHtml {
  return html`<p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${text}</p>`
}
