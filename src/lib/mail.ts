import { Resend } from 'resend'

/**
 * Expedierea emailurilor.
 *
 * Portalul rulează cu date fictive, iar adresele conturilor demo (@stud.ase.ro)
 * nu există. `MAIL_REDIRECT_TO` redirecționează tot ce ar pleca spre o singură
 * cutie poștală reală, păstrând destinatarul original vizibil în mesaj — altfel
 * ai primi zeci de emailuri fără să știi cui erau adresate.
 */

const cheie = process.env.RESEND_API_KEY
const resend = cheie ? new Resend(cheie) : null

const EXPEDITOR = process.env.MAIL_FROM ?? 'Portal Studenți ASE <noreply@stargrid.dev>'
const REDIRECT = process.env.MAIL_REDIRECT_TO?.trim()

export interface Atasament {
  filename: string
  content: string | Buffer
  contentType?: string
}

export interface Mesaj {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Atasament[]
}

function bannerRedirect(destinatarOriginal: string): string {
  return `<div style="margin:0 0 24px;padding:12px 16px;background:#fdf3e2;border-radius:4px;
    font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#8a5a00">
    <strong>Mod demonstrativ.</strong> Acest mesaj era adresat
    <strong>${escapeHtml(destinatarOriginal)}</strong> și a fost redirecționat aici.
  </div>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function trimiteEmail(mesaj: Mesaj): Promise<{ ok: boolean; id?: string; eroare?: string }> {
  if (!resend) {
    console.warn(`[mail] RESEND_API_KEY lipsește — mesaj nelivrat: "${mesaj.subject}" → ${mesaj.to}`)
    return { ok: false, eroare: 'RESEND_API_KEY lipsește' }
  }

  const destinatar = REDIRECT || mesaj.to
  const redirectionat = Boolean(REDIRECT) && REDIRECT !== mesaj.to

  try {
    const { data, error } = await resend.emails.send({
      from: EXPEDITOR,
      to: [destinatar],
      subject: redirectionat ? `[→ ${mesaj.to}] ${mesaj.subject}` : mesaj.subject,
      html: (redirectionat ? bannerRedirect(mesaj.to) : '') + mesaj.html,
      text: mesaj.text,
      attachments: mesaj.attachments?.map((a) => ({
        filename: a.filename,
        content: typeof a.content === 'string' ? Buffer.from(a.content).toString('base64') : a.content.toString('base64'),
        contentType: a.contentType,
      })),
    })

    if (error) {
      console.error('[mail] eroare Resend', error)
      return { ok: false, eroare: error.message }
    }

    return { ok: true, id: data?.id }
  } catch (err) {
    console.error('[mail] excepție la trimitere', err)
    return { ok: false, eroare: String(err) }
  }
}

/* --- șabloane ------------------------------------------------------------- */

const CULOARE = '#990000'

export function sablon(titlu: string, corp: string, actiune?: { text: string; url: string }): string {
  return `<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1e23;max-width:560px">
  <div style="border-bottom:2px solid ${CULOARE};padding-bottom:12px;margin-bottom:24px">
    <div style="font:600 16px/1.2 Georgia,serif;color:${CULOARE}">Portal Studenți</div>
    <div style="font-size:12px;color:#5b6169;margin-top:2px">Facultatea de Marketing · ASE București</div>
  </div>
  <h1 style="font:600 20px/1.3 Georgia,serif;margin:0 0 16px">${escapeHtml(titlu)}</h1>
  ${corp}
  ${
    actiune
      ? `<p style="margin:28px 0"><a href="${actiune.url}"
           style="display:inline-block;background:${CULOARE};color:#fff;text-decoration:none;
           padding:12px 22px;border-radius:4px;font-weight:600;font-size:14px">${escapeHtml(actiune.text)}</a></p>
         <p style="font-size:12px;color:#5b6169;word-break:break-all">Dacă butonul nu funcționează, copiază adresa:<br>${actiune.url}</p>`
      : ''
  }
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e9ecef;font-size:12px;color:#5b6169">
    Mesaj automat — Sesiunea de Finalizare a Studiilor 2026.
  </p>
</div>`
}
