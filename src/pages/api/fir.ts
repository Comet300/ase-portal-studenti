import type { APIRoute } from 'astro'
import { touchPresence, threadSummary, myConversation } from '../../lib/chat'
import { sessionExpired } from '../../lib/http'
import { id as formId } from '../../lib/ids'

/**
 * How many messages the thread has right now.
 *
 * Nothing reached an open conversation without a manual reload: two people
 * writing to each other at the same time saw nothing until one of them pressed
 * F5. Only as much is returned here as is needed to decide whether a reload is
 * worth it — a count and the time of the last message, not the content.
 *
 * Membership is checked in the same query that fetches the data.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const conversationId = formId(url.searchParams.get('conversatie'))
  if (!conversationId) return new Response('{}', { headers: json })

  const conversation = await myConversation(u.id, conversationId)
  if (!conversation) return new Response('{}', { status: 404, headers: json })

  // Counted in SQL: it used to fetch the whole thread, with every message's
  // files, in order to count three things — every fifteen seconds, for every
  // open thread.
  const summary = await threadSummary(u.id, conversationId)

  /* An open thread is also proof that whoever is reading it is in the portal. It
   * is recorded here, not in the middleware, because here it is already known
   * that this is a live page and not a prefetch or a download. */
  void touchPresence(u.id)

  return new Response(
    JSON.stringify({
      total: summary?.total ?? 0,
      ultim: summary?.ultim ?? null,
      // How many are from the other party and still unread: only those justify
      // an interruption.
      noi: summary?.noi ?? 0,
      // The moment, not a text: the page writes it out in words, thickly.
      vazut: summary?.peer_seen ?? null,
    }),
    { headers: json },
  )
}

const json = { 'content-type': 'application/json', 'cache-control': 'no-store' }
