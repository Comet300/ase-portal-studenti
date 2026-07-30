import type { APIRoute } from 'astro'
import { createMagicLink, findUserByEmail } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
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

  /* O limită de debit, nu o poartă.
   *
   * Fiecare apăsare trimitea un email și crea un token: cu adresa altcuiva se
   * putea umple o cutie poștală instituțională, iar fără intenție rea un
   * utilizator nerăbdător primea cinci mesaje identice.
   *
   * Când limita e atinsă, răspunsul rămâne același `?trimis=1` — altfel diferența
   * dintre „limitat” și „trimis” ar spune cine are cont. */
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null

  await execute(`DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'`)

  const debit = await queryOne<{ pe_email: number; pe_ip: number }>(
    `SELECT
       count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '1 hour')::int AS pe_email,
       count(*) FILTER (WHERE ip = $2 AND $2 IS NOT NULL
                          AND created_at > now() - interval '1 hour')::int               AS pe_ip
     FROM login_attempts`,
    [email, ip],
  )

  const limitat = (debit?.pe_email ?? 0) >= 5 || (debit?.pe_ip ?? 0) >= 20
  if (limitat) {
    console.warn(`[auth] limită atinsă pentru ${email} (${debit?.pe_email}/h) ip ${ip} (${debit?.pe_ip}/h)`)
    return redirect(`/autentificare?trimis=1&email=${encodeURIComponent(email)}`)
  }

  await execute(`INSERT INTO login_attempts (email, ip) VALUES ($1, $2)`, [email, ip])

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

  /* Adresa merge înapoi în ecranul de confirmare.
   *
   * „Verifică-ți emailul” fără să spună care email lăsa pe cineva care a scris
   * greșit domeniul să aștepte un mesaj care nu avea unde să ajungă. Răspunsul
   * rămâne identic fie că adresa există sau nu — altfel formularul devine o
   * unealtă de aflat cine are cont — dar acum spune ce adresă a folosit. */
  return redirect(`/autentificare?trimis=1&email=${encodeURIComponent(email)}`)
}
