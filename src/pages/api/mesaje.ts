import type { APIRoute } from 'astro'
import { myConversation } from '../../lib/chat'
import { queryOne, transaction } from '../../lib/db'
import { template, sendEmail, html, quote } from '../../lib/mail'
import { MAX_BYTES, extensiePermisa, saveFile, tipDupaExtensie } from '../../lib/files'
import { deadEnd, redirect, redirectWithNotice, sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/** Trimite un mesaj, cu atașament opțional. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const form = await request.formData()
  const conversationId = formId(form.get('conversation_id'))
  const body = String(form.get('body') ?? '').trim()
  const redirectTo = String(form.get('redirect') ?? '/mesaje')
  const file = form.get('file')

  if (!conversationId) return deadEnd(400, 'Conversație neidentificată', 'Deschide conversația din lista de mesaje și încearcă din nou.')

  // Apartenența la conversație este verificată în interogare.
  const conversation = await myConversation(u.id, conversationId)
  if (!conversation) return deadEnd(404, 'Conversația nu a fost găsită', 'Fie nu există, fie nu face parte din conversațiile tale.')

  if (!body && !(file instanceof File && file.size > 0)) {
    return redirect(redirectTo)
  }

  const atasament = file instanceof File && file.size > 0 ? file : null

  // Verificat înainte de a citi octeții în memorie: altfel un fișier de 200 MB
  // este încărcat integral doar ca să fie refuzat la scriere.
  if (atasament && atasament.size > MAX_BYTES) {
    return redirectWithNotice(
      redirectTo,
      `„${atasament.name}” depășește ${Math.round(MAX_BYTES / (1024 * 1024))} MB. Mesajul nu a fost trimis.`,
      true,
    )
  }

  // Verificarea de pe client poate fi ocolită; aceasta nu.
  if (atasament && !extensiePermisa(atasament.name)) {
    return redirectWithNotice(
      redirectTo,
      `Tipul fișierului „${atasament.name}” nu este acceptat. Trimite un document, o foaie de calcul, o imagine sau o arhivă.`,
      true,
    )
  }

  /* Mesajul și fișierul lui intră împreună sau deloc.
   *
   * Înainte, mesajul se scria primul, iar o eroare la salvarea fișierului era
   * doar un `console.error`: expeditorul vedea mesajul trimis fără agrafă,
   * destinatarul primea „(fișier atașat)” fără fișier, iar emailul anunța că a
   * sosit ceva. Nimeni nu afla că încărcarea a eșuat. */
  let messageId: string
  try {
    const octeti = atasament ? Buffer.from(await atasament.arrayBuffer()) : null

    messageId = await transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3) RETURNING id`,
        // Corp gol, nu un text de umplutură: fișierul este mesajul, iar
        // previzualizarea din lista de conversații îl numește (lib/chat.ts).
        [conversationId, u.id, body],
      )
      const id = rows[0].id
      await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId])

      if (atasament && octeti) {
        const stored = await saveFile(conversationId, atasament.name, octeti)
        await client.query(
          `INSERT INTO files (uploaded_by, conversation_id, message_id, original_name, stored_name, mime, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.id, conversationId, id, atasament.name, stored, tipDupaExtensie(atasament.name), atasament.size],
        )
      }
      return id
    })
  } catch (err) {
    console.error('[messages] mesajul nu a putut fi salvat', err)
    return redirectWithNotice(
      redirectTo,
      atasament
        ? 'Fișierul nu a putut fi salvat, așa că mesajul nu a fost trimis. Încearcă din nou.'
        : 'Mesajul nu a putut fi trimis. Încearcă din nou.',
      true,
    )
  }

  /* Emailul pleacă doar dacă are pe cine anunța.
   *
   * Comentariul de aici promitea de la început că notificarea se trimite „doar
   * dacă interlocutorul nu a fost activ recent”, dar codul o trimitea de
   * fiecare dată: un schimb de douăzeci de replici însemna douăzeci de emailuri
   * pentru un om care avea firul deschis în fața lui. */
  const contact = await queryOne<{ email: string; name: string; taci: boolean }>(
    `SELECT p.email,
            p.name,
            (EXISTS (SELECT 1 FROM messages m
                      WHERE m.conversation_id = $2 AND m.sender_id = $3
                        AND m.read_at > now() - interval '10 minutes')
             OR EXISTS (SELECT 1 FROM messages m
                         WHERE m.conversation_id = $2 AND m.sender_id = $3
                           AND m.id <> $4 AND m.created_at > now() - interval '15 minutes')
            ) AS taci
       FROM users p
      WHERE p.id = $1`,
    [conversation.peer_id, conversationId, u.id, messageId],
  )

  if (contact && !contact.taci) {
    const base = process.env.APP_BASE_URL ?? url.origin
    // Trimiterea nu ține răspunsul în loc: expeditorul aștepta drumul până la
    // Resend înainte să vadă propriul mesaj în fir.
    void sendEmail({
      to: contact.email,
      subject: `Mesaj nou de la ${u.name}`,
      html: template(
        'Ai primit un mesaj',
        html`<p><strong>${u.name}</strong> ți-a scris în portal:</p>
         ${quote(body.slice(0, 500) || `A trimis un fișier: ${atasament?.name ?? 'document'}`)}`,
        { text: 'Răspunde în portal', url: `${base}${redirectTo}` },
      ),
    }).catch((err) => console.error('[messages] notificarea nu a plecat', err))
  }

  return redirect(redirectTo)
}
