import type { APIRoute } from 'astro'
import { atingePrezenta, firRezumat, myConversation } from '../../lib/chat'
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

  // Numărat în SQL: aducea tot firul, cu fișierele fiecărui mesaj, ca să numere
  // trei lucruri — la fiecare cincisprezece secunde, pentru fiecare fir deschis.
  const rezumat = await firRezumat(u.id, conversationId)

  /* Firul deschis este și dovada că cel care îl citește e în portal. Se notează
   * aici, nu în middleware, pentru că aici se știe deja că e o pagină vie și nu
   * un prefetch sau o descărcare. */
  void atingePrezenta(u.id)

  return new Response(
    JSON.stringify({
      total: rezumat?.total ?? 0,
      ultim: rezumat?.ultim ?? null,
      // Câte sunt de la interlocutor și încă necitite: doar acelea justifică o
      // întrerupere.
      noi: rezumat?.noi ?? 0,
      // Momentul, nu un text: pagina îl scrie în cuvinte, gros.
      vazut: rezumat?.peer_seen ?? null,
    }),
    { headers: json },
  )
}

const json = { 'content-type': 'application/json', 'cache-control': 'no-store' }
