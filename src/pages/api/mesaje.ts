import type { APIRoute } from 'astro'
import { myConversation } from '../../lib/chat'
import { lockNotice } from '../../lib/chat-lock'
import { queryOne, transaction } from '../../lib/db'
import { template, sendEmail, html, quote } from '../../lib/mail'
import { MAX_BYTES, isAllowedExtension, saveFile, mimeForExtension } from '../../lib/files'
import { deadEnd, redirect, redirectWithNotice, sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/** Sends a message, with an optional attachment. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const form = await request.formData()
  const conversationId = formId(form.get('conversation_id'))
  const body = String(form.get('body') ?? '').trim()
  const redirectTo = String(form.get('redirect') ?? '/mesaje')

  /* Several files, not one.
   *
   * A chapter arrives with the questionnaire and with the data file; that was
   * three messages for a single thought, each with its own email to the other
   * side. `getAll` because `get` returns only the first entry — exactly the
   * mistake that hid two delete buttons earlier in this audit. */
  const attachments = form
    .getAll('file')
    .filter((f): f is File => f instanceof File && f.size > 0)

  if (!conversationId) return deadEnd(400, 'Conversație neidentificată', 'Deschide conversația din lista de mesaje și încearcă din nou.')

  // Membership of the conversation is checked in the query.
  const conversation = await myConversation(u.id, conversationId)
  if (!conversation) return deadEnd(404, 'Conversația nu a fost găsită', 'Fie nu există, fie nu face parte din conversațiile tale.')

  /* Membership is not enough.
   *
   * A thread opened when a request was approved stayed usable even after the
   * request was withdrawn or rejected, and the POST accepted it because it only
   * checked whether you are one of the two parties. The thread stays readable;
   * writing requires a live link.
   *
   * The refusal had one wording for all eight ways a pair can come apart, and
   * the person never read it anyway: `redirectWithNotice` answers 303, the
   * composer's XHR follows that redirect transparently, lands in its success
   * branch and then navigates to the plain `redirect` field — dropping the
   * `?notificare` the notice travelled in. The message vanished, the typed text
   * was already cleared, and nothing on the screen said why.
   *
   * So the answer is negotiated: the XHR asks for JSON (scripts/chat.ts) and
   * gets a 403 it cannot mistake for success, with the reason in it. The plain
   * form — the portal works without JavaScript — keeps the redirect. */
  if (!conversation.is_active) {
    const notice = lockNotice(conversation.lock_reason, {
      name: conversation.peer_name,
      forStudent: conversation.student_id === u.id,
    })
    const message =
      notice?.body ??
      'Nu mai există o coordonare activă între voi. Poți citi conversația, dar nu mai poți scrie în ea.'

    if (request.headers.get('accept')?.includes('application/json')) {
      return new Response(JSON.stringify({ reason: conversation.lock_reason, message }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return redirectWithNotice(redirectTo, message, true)
  }

  if (!body && attachments.length === 0) {
    return redirect(redirectTo)
  }

  /* How many files may accompany a message.
   *
   * Not a technical limit, but a memory one: the bytes of all of them are read
   * before the transaction, so that a write error does not leave the message
   * without them. Ten × 15 MB is the ceiling, and it is stated. */
  const MAX_FILES = 10
  if (attachments.length > MAX_FILES) {
    return redirectWithNotice(
      redirectTo,
      `Poți atașa cel mult ${MAX_FILES} fișiere la un mesaj. Trimite restul într-un al doilea mesaj.`,
      true,
    )
  }

  // Checked before the bytes are read into memory: otherwise a 200 MB file is
  // loaded in full only to be refused at write time.
  const tooLarge = attachments.find((f) => f.size > MAX_BYTES)
  if (tooLarge) {
    return redirectWithNotice(
      redirectTo,
      `„${tooLarge.name}” depășește ${Math.round(MAX_BYTES / (1024 * 1024))} MB. Mesajul nu a fost trimis.`,
      true,
    )
  }

  // The check on the client can be bypassed; this one cannot.
  const disallowed = attachments.find((f) => !isAllowedExtension(f.name))
  if (disallowed) {
    return redirectWithNotice(
      redirectTo,
      `Tipul fișierului „${disallowed.name}” nu este acceptat. Trimite un document, o foaie de calcul, o imagine sau o arhivă.`,
      true,
    )
  }

  /* The message and its file go in together or not at all.
   *
   * Before, the message was written first, and an error while saving the file
   * was only a `console.error`: the sender saw the message sent without a paper
   * clip, the recipient got „(fișier atașat)” with no file, and the email
   * announced that something had arrived. Nobody found out the upload failed. */
  let messageId: string
  try {
    const cuOcteti = await Promise.all(
      attachments.map(async (f) => ({ fisier: f, bytes: Buffer.from(await f.arrayBuffer()) })),
    )

    messageId = await transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3) RETURNING id`,
        // An empty body, not filler text: the file is the message, and the
        // preview in the conversation list names it (lib/chat.ts).
        [conversationId, u.id, body],
      )
      const id = rows[0].id
      await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId])

      // The position is written explicitly: `now()` is fixed inside a
      // transaction, so all the rows would have the same `created_at` and the
      // ordering would fall back on the uuid.
      for (const [pozitie, { fisier, bytes }] of cuOcteti.entries()) {
        const stored = await saveFile(conversationId, fisier.name, bytes)
        await client.query(
          `INSERT INTO files (uploaded_by, conversation_id, message_id, original_name,
                              stored_name, mime, size_bytes, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [u.id, conversationId, id, fisier.name, stored, mimeForExtension(fisier.name), fisier.size, pozitie],
        )
      }
      return id
    })
  } catch (err) {
    console.error('[messages] mesajul nu a putut fi salvat', err)
    return redirectWithNotice(
      redirectTo,
      attachments.length > 0
        ? attachments.length === 1
          ? 'Fișierul nu a putut fi salvat, așa că mesajul nu a fost trimis. Încearcă din nou.'
          : 'Fișierele nu au putut fi salvate, așa că mesajul nu a fost trimis. Încearcă din nou.'
        : 'Mesajul nu a putut fi trimis. Încearcă din nou.',
      true,
    )
  }

  /* The email goes out only if it has someone to notify.
   *
   * The comment here promised from the start that the notification is sent
   * "only if the other party has not been active recently", but the code sent it
   * every time: an exchange of twenty replies meant twenty emails for a person
   * who had the thread open in front of them. */
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
    // Sending does not hold the response back: the sender used to wait for the
    // round trip to Resend before seeing their own message in the thread.
    void sendEmail({
      to: contact.email,
      subject: `Mesaj nou de la ${u.name}`,
      html: template(
        'Ai primit un mesaj',
        html`<p><strong>${u.name}</strong> ți-a scris în portal:</p>
         ${quote(
           body.slice(0, 500) ||
             (attachments.length > 1
               ? `A trimis ${attachments.length} fișiere: ${attachments.map((f) => f.name).join(', ')}`
               : `A trimis un fișier: ${attachments[0]?.name ?? 'document'}`),
         )}`,
        { text: 'Răspunde în portal', url: `${base}${redirectTo}` },
      ),
    }).catch((err) => console.error('[messages] notificarea nu a plecat', err))
  }

  return redirect(redirectTo)
}
