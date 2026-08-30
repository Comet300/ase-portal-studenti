import type { APIRoute } from 'astro'
import { createMagicLink, findUserByEmail } from '../../lib/auth'
import { execute, queryOne } from '../../lib/db'
import { template, sendEmail, html } from '../../lib/mail'
import { redirect } from '../../lib/http'

/**
 * Ask for a magic link.
 *
 * The answer is identical whether the address exists or not: otherwise the form
 * becomes an instrument for checking who has an account in the portal.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const form = await request.formData()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const redirectTo = String(form.get('redirect') ?? '')

  if (!email || !email.includes('@')) {
    // The address goes back with the error: the mistake is almost always a letter.
    return redirect(
      `/autentificare?eroare=${encodeURIComponent('Adresa de email nu pare validă. Verifică dacă are @ și domeniul instituțional.')}` +
        `&email=${encodeURIComponent(email)}` +
        (redirectTo ? `&redirect=${encodeURIComponent(redirectTo)}` : ''),
    )
  }

  /* A rate limit, not a gate.
   *
   * Every press sent an email and created a token: with somebody else's address
   * an institutional mailbox could be filled up, and with no ill intent at all
   * an impatient user received five identical messages.
   *
   * When the limit is reached the answer stays the same `?trimis=1` — otherwise
   * the difference between „limitat” and „trimis” would tell who has an account. */
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null

  await execute(`DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'`)

  const attemptCounts = await queryOne<{ pe_email: number; pe_ip: number }>(
    `SELECT
       count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '1 hour')::int AS pe_email,
       count(*) FILTER (WHERE ip = $2 AND $2 IS NOT NULL
                          AND created_at > now() - interval '1 hour')::int               AS pe_ip
     FROM login_attempts`,
    [email, ip],
  )

  const rateLimited = (attemptCounts?.pe_email ?? 0) >= 5 || (attemptCounts?.pe_ip ?? 0) >= 20
  if (rateLimited) {
    console.warn(`[auth] limită atinsă pentru ${email} (${attemptCounts?.pe_email}/h) ip ${ip} (${attemptCounts?.pe_ip}/h)`)
    return redirect(`/autentificare?trimis=1&email=${encodeURIComponent(email)}`)
  }

  await execute(`INSERT INTO login_attempts (email, ip) VALUES ($1, $2)`, [email, ip])

  const user = await findUserByEmail(email)

  if (user) {
    const token = await createMagicLink(email, redirectTo || undefined)
    const baza = process.env.APP_BASE_URL ?? url.origin
    const link = `${baza}/intra?token=${token}`

    await sendEmail({
      to: email,
      subject: 'Link de autentificare — Portal Studenți',
      html: template(
        `Bine ai revenit, ${user.name.split(' ')[0]}`,
        html`<p>Apasă butonul de mai jos pentru a intra în portal. Linkul este valabil
         <strong>20 de minute</strong> și poate fi folosit o singură dată.</p>
         <p style="color:#5b6169;font-size:13px">Dacă nu ai cerut tu acest link, ignoră mesajul —
         nimeni nu poate intra în contul tău fără el.</p>`,
        { text: 'Intră în portal', url: link },
      ),
      text: `Link de autentificare (valabil 20 de minute): ${link}`,
    })
  }

  /* The address goes back into the confirmation screen.
   *
   * „Verifică-ți emailul” without saying which email left somebody who mistyped
   * the domain waiting for a message that had nowhere to arrive. The answer
   * stays identical whether the address exists or not — otherwise the form
   * becomes a tool for finding out who has an account — but now it says which
   * address was used. */
  return redirect(`/autentificare?trimis=1&email=${encodeURIComponent(email)}`)
}
