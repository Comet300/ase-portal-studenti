import type { APIRoute } from 'astro'
import { conversationMessages, myConversation } from '../../lib/chat'
import { sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/**
 * Câte mesaje are firul acum.
 *
 * Nimic nu ajungea într-o conversație deschisă fără reîncărcare manuală: doi
 * oameni care își scriau în același timp nu vedeau nimic până când unul dintre ei
 * apăsa F5. Aici se întoarce doar atât cât e nevoie ca să se decidă dacă merită
 * reîncărcat — un număr și ora ultimului mesaj, nu conținutul.
 *
 * Apartenența se verifică în aceeași interogare care aduce datele.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const conversationId = formId(url.searchParams.get('conversatie'))
  if (!conversationId) return new Response('{}', { headers: json })

  const conversation = await myConversation(u.id, conversationId)
  if (!conversation) return new Response('{}', { status: 404, headers: json })

  const messages = await conversationMessages(u.id, conversationId)
  const ultim = messages.at(-1)

  return new Response(
    JSON.stringify({
      total: messages.length,
      ultim: ultim?.created_at ?? null,
      // Câte dintre ele sunt de la interlocutor și încă necitite: doar acelea
      // justifică o întrerupere.
      noi: messages.filter((m) => m.sender_id !== u.id && !m.read_at).length,
    }),
    { headers: json },
  )
}

const json = { 'content-type': 'application/json', 'cache-control': 'no-store' }
