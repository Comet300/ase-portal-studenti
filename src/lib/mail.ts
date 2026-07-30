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

/**
 * Textul dintr-un HTML, pentru clienții care nu îl randează.
 *
 * Nu e un parser: e o reducere suficient de bună pentru mesajele noastre, care
 * au o structură cunoscută. Butonul devine „Etichetă: adresă”, ca legătura să
 * rămână utilizabilă.
 */
function textDinHtml(htmlSursa: string): string {
  return htmlSursa
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const et = text.replace(/<[^>]+>/g, '').trim()
      return et && et !== href ? `${et}: ${href}` : href
    })
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

export function sendEmail(mail: MailMessage): Promise<MailResult> {
  /* Nicio expediere fără parte text.
   *
   * `MailMessage.text` exista de la început și niciunul dintre cele optsprezece
   * apeluri nu îl completa. Se derivă aici, o dată, în loc să fie scris de mână
   * în fiecare loc — și rămâne posibil să fie dat explicit, când merită. */
  return mailer.send(mail.text ? mail : { ...mail, text: textDinHtml(mail.html) })
}

/* --- templates ------------------------------------------------------------- */

const BRAND = '#990000'

/**
 * Un email al portalului.
 *
 * Construit pe tabel, nu pe `div`: motorul de randare Word din Outlook ignoră
 * `max-width` pe un bloc, așa că mesajul se întindea pe toată lățimea ferestrei
 * acolo unde citește jumătate din corpul didactic. Lățimea stă pe `<table>`,
 * unde o respectă toată lumea.
 *
 * `preheader` este linia de previzualizare din inbox. Fără ea, clientul de mail
 * arăta antetul — „Portal Studenți · Facultatea de Marketing” — la fiecare
 * mesaj, deci lista de emailuri era o coloană cu același rând repetat.
 */
export function template(
  title: string,
  body: SafeHtml,
  action?: { text: string; url: string },
  preheader?: string,
): string {
  return html`<!doctype html>
<html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f8f9fa">
${preheader ? html`<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f9fa">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
  style="width:560px;max-width:100%;background:#ffffff;border-radius:8px">
<tr><td style="padding:28px 32px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1e23">
  <div style="border-bottom:2px solid ${BRAND};padding-bottom:12px;margin-bottom:24px">
    <div style="font:600 16px/1.2 Georgia,serif;color:${BRAND}">Portal Studenți</div>
    <div style="font-size:12px;color:#5b6169;margin-top:2px">Facultatea de Marketing · ASE București</div>
  </div>
  <h1 style="font:600 20px/1.3 Georgia,serif;margin:0 0 16px">${title}</h1>
  ${body}
  ${
    action
      ? html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0">
           <tr><td style="background:${BRAND};border-radius:4px">
             <a href="${action.url}" style="display:inline-block;padding:12px 22px;color:#ffffff;
                text-decoration:none;font-weight:600;font-size:14px">${action.text}</a>
           </td></tr></table>
         <p style="font-size:12px;color:#5b6169;word-break:break-all">Dacă butonul nu funcționează, copiază adresa:<br>${action.url}</p>`
      : ''
  }
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e9ecef;font-size:12px;color:#5b6169">
    Mesaj automat din Portalul Studenți — Facultatea de Marketing, ASE București.
  </p>
</td></tr></table>
</td></tr></table>
</body></html>`.toString()
}

/**
 * Varianta text a aceluiași mesaj.
 *
 * Toate cele optsprezece locuri care trimiteau email trimiteau doar HTML, deși
 * portul îl accepta de la început. Un mesaj fără parte text primește un scor de
 * spam mai prost și nu se poate citi deloc într-un client text.
 */
export function plainText(title: string, body: string, action?: { text: string; url: string }): string {
  return [
    'PORTAL STUDENȚI · Facultatea de Marketing, ASE București',
    '',
    title.toUpperCase(),
    '',
    body.trim(),
    ...(action ? ['', `${action.text}: ${action.url}`] : []),
    '',
    '—',
    'Mesaj automat din Portalul Studenți.',
  ].join('\n')
}

/** A quoted block of something a person wrote. */
export function quote(text: string): SafeHtml {
  return html`<p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${text}</p>`
}
