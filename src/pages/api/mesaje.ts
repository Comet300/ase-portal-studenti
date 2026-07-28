import type { APIRoute } from 'astro'
import { myConversation } from '../../lib/chat'
import { queryOne, transaction } from '../../lib/db'
import { template, sendEmail } from '../../lib/mail'
import { saveFile } from '../../lib/files'
import { redirect } from '../../lib/http'

/** Trimite un mesaj, cu atașament opțional. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const form = await request.formData()
  const conversationId = String(form.get('conversation_id') ?? '')
  const body = String(form.get('body') ?? '').trim()
  const redirectTo = String(form.get('redirect') ?? '/mesaje')
  const file = form.get('file')

  if (!conversationId) return new Response('Conversație lipsă', { status: 400 })

  // Apartenența la conversație este verificată în interogare.
  const conversation = await myConversation(u.id, conversationId)
  if (!conversation) return new Response('Conversația nu a fost găsită', { status: 404 })

  if (!body && !(file instanceof File && file.size > 0)) {
    return redirect(redirectTo)
  }

  const messageId = await transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [conversationId, u.id, body || '(fișier atașat)'],
    )
    await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId])
    return rows[0].id
  })

  if (file instanceof File && file.size > 0) {
    try {
      const stored = await saveFile(conversationId, file.name, Buffer.from(await file.arrayBuffer()))
      await queryOne(
        `INSERT INTO files (uploaded_by, conversation_id, message_id, original_name, stored_name, mime, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [u.id, conversationId, messageId, file.name, stored, file.type || null, file.size],
      )
    } catch (err) {
      console.error('[messages] atașamentul nu a putut fi salvat', err)
    }
  }

  // Notificare pe email doar dacă interlocutorul nu a fost active recent.
  const recipient = await queryOne<{ email: string; name: string }>(
    `SELECT email, name FROM users WHERE id = $1`,
    [conversation.peer_id],
  )

  if (recipient) {
    const base = process.env.APP_BASE_URL ?? url.origin
    await sendEmail({
      to: recipient.email,
      subject: `Mesaj nou de la ${u.name}`,
      html: template(
        'Ai primit un mesaj',
        `<p><strong>${u.name}</strong> ți-a scris în portal:</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${
           body.slice(0, 500) || '(fișier atașat)'
         }</p>`,
        { text: 'Răspunde în portal', url: `${base}${redirectTo}` },
      ),
    })
  }

  return redirect(redirectTo)
}
