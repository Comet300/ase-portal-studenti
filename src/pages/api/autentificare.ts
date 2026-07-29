import type { APIRoute } from 'astro'
import { createMagicLink, findUserByEmail } from '../../lib/auth'
import { template, sendEmail, html } from '../../lib/mail'
import { redirect } from '../../lib/http'

/**
 * Cere un magic link.
 *
 * Răspunsul este identic indiferent dacă adresa există sau nu: altfel formularul
 * devine un instrument de verificat cine are cont în portal.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const date = await request.formData()
  const email = String(date.get('email') ?? '').trim().toLowerCase()
  const redirectTo = String(date.get('redirect') ?? '')

  if (!email || !email.includes('@')) {
    // Adresa se întoarce cu eroarea: greșeala e aproape întotdeauna o literă.
    return redirect(
      `/autentificare?eroare=${encodeURIComponent('Adresa de email nu pare validă. Verifică dacă are @ și domeniul instituțional.')}` +
        `&email=${encodeURIComponent(email)}` +
        (redirectTo ? `&redirect=${encodeURIComponent(redirectTo)}` : ''),
    )
  }

  const utilizator = await findUserByEmail(email)

  if (utilizator) {
    const token = await createMagicLink(email, redirectTo || undefined)
    const baza = process.env.APP_BASE_URL ?? url.origin
    const link = `${baza}/intra?token=${token}`

    await sendEmail({
      to: email,
      subject: 'Link de autentificare — Portal Studenți',
      html: template(
        `Bine ai revenit, ${utilizator.name.split(' ')[0]}`,
        html`<p>Apasă butonul de mai jos pentru a intra în portal. Linkul este valabil
         <strong>20 de minute</strong> și poate fi folosit o singură dată.</p>
         <p style="color:#5b6169;font-size:13px">Dacă nu ai cerut tu acest link, ignoră mesajul —
         nimeni nu poate intra în contul tău fără el.</p>`,
        { text: 'Intră în portal', url: link },
      ),
      text: `Link de autentificare (valabil 20 de minute): ${link}`,
    })
  }

  return redirect('/autentificare?trimis=1')
}
