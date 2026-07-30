import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Attachment, Mailer, MailMessage, MailResult } from '../ports'

/**
 * Cutia poștală de pe disc.
 *
 * Portalul trimite douăsprezece feluri de mail — decizii, invitații, consultații
 * anulate, linkuri de acces — și niciunul nu se putea vedea în afara producției:
 * local nu pleca nimic, iar `console.warn` spunea doar că nu a plecat. Deci
 * fiecare schimbare de conținut sau de atașament se verifica pe oameni adevărați.
 *
 * Aici mailul se scrie ca fișier `.eml`, formatul pe care îl deschide orice client
 * de mail. Se dă dublu clic și se vede exact ce vede destinatarul: antetele,
 * randarea HTML, și dacă invitația din calendar se importă sau nu.
 *
 * MIME scris de mână, din același motiv ca zip-ul: `multipart/mixed` cu granițe
 * și base64 pe linii de 76 de caractere este o pagină de cod, iar o bibliotecă de
 * mail ar fi a patra dependență a portalului pentru o unealtă de dezvoltare.
 */

export interface DiskMailerOptions {
  from: string
  /** Unde se scriu fișierele. */
  dir: string
}

/** Antet care poate conține diacritice: RFC 2047, cuvânt codat în base64. */
function antet(valoare: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(valoare)) return valoare
  return `=?UTF-8?B?${Buffer.from(valoare, 'utf8').toString('base64')}?=`
}

/** Base64 pe linii de 76 de caractere, cum cere RFC 2045. */
function base64Rupt(b: Buffer): string {
  return (b.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
}

function parteAtasament(a: Attachment, granita: string): string {
  const octeti = typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : a.content
  return [
    `--${granita}`,
    `Content-Type: ${a.contentType ?? 'application/octet-stream'}; name="${a.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${a.filename}"`,
    '',
    base64Rupt(octeti),
    '',
  ].join('\r\n')
}

export function createDiskMailer(options: DiskMailerOptions): Mailer {
  return {
    async send(message: MailMessage): Promise<MailResult> {
      const granita = `portal-${randomUUID()}`
      const acum = new Date().toUTCString()

      const bucati = [
        `From: ${antet(options.from)}`,
        `To: ${message.to}`,
        `Subject: ${antet(message.subject)}`,
        `Date: ${acum}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${granita}"`,
        '',
        // Text și HTML în alternativă: clientul alege, ca la un mail adevărat.
        `--${granita}`,
        `Content-Type: multipart/alternative; boundary="${granita}-alt"`,
        '',
        ...(message.text
          ? [
              `--${granita}-alt`,
              'Content-Type: text/plain; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              base64Rupt(Buffer.from(message.text, 'utf8')),
              '',
            ]
          : []),
        `--${granita}-alt`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Rupt(Buffer.from(message.html, 'utf8')),
        '',
        `--${granita}-alt--`,
        '',
        ...(message.attachments ?? []).map((a) => parteAtasament(a, granita)),
        `--${granita}--`,
        '',
      ]

      /* Numele fișierului începe cu ora, ca `ls` să le dea în ordinea trimiterii,
       * și conține destinatarul și subiectul, ca să se poată găsi fără să fie
       * deschise unul câte unul. */
      const ceas = new Date().toISOString().replace(/[:.]/g, '-')
      const scurt = message.subject
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
        .toLowerCase()
      const nume = `${ceas}__${message.to.replace(/[^A-Za-z0-9@._-]/g, '_')}__${scurt || 'mail'}.eml`

      try {
        await mkdir(options.dir, { recursive: true })
        await writeFile(join(options.dir, nume), bucati.join('\r\n'), 'utf8')
      } catch (err) {
        // Aceeași promisiune ca la Resend: nu aruncă niciodată.
        console.error('[mail] nu s-a putut scrie în cutia de pe disc', err)
        return { ok: false, error: String(err) }
      }

      const cate = message.attachments?.length ?? 0
      console.log(
        `[mail] scris ${nume}${cate > 0 ? ` (${cate} ${cate === 1 ? 'atașament' : 'atașamente'})` : ''}`,
      )
      return { ok: true, id: nume }
    },
  }
}
