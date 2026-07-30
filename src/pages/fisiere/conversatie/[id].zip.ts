import type { APIRoute } from 'astro'
import { noteazaAcces } from '../../../lib/audit'
import { query, queryOne } from '../../../lib/db'
import { openFile } from '../../../lib/files'
import { id as routeId } from '../../../lib/ids'
import { construiesteZip } from '../../../lib/zip'

/**
 * Toate fișierele unei conversații, într-o arhivă.
 *
 * La final de sesiune un coordonator are de strâns capitolele, chestionarul și
 * fișierul de date ale fiecărui student — pentru dosar, pentru comisie, pentru
 * verificarea antiplagiat. Sertarul de fișiere le arăta pe toate și cerea un clic
 * pentru fiecare, cu un „Salvează ca” după el; la nouă fișiere ori doisprezece
 * studenți, aceasta este singura parte a portalului care se face de o sută de ori.
 *
 * Apartenența se verifică în aceeași interogare care aduce lista, ca la
 * descărcarea unui singur fișier: nu există parametru cu care cineva să ceară
 * conversația altcuiva.
 */

/* Arhiva se construiește în memorie, deci are un plafon.
 *
 * O conversație ar putea aduna teoretic sute de fișiere de 15 MB; a le ține pe
 * toate deodată în memorie ar dărâma procesul, iar un răspuns 500 este mai rău
 * decât o arhivă parțială cu un antet care spune ce lipsește. În practică o
 * lucrare are zece fișiere. */
const MAX_ARHIVA = 80 * 1024 * 1024

export const GET: APIRoute = async ({ params, locals, request }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const conversationId = routeId(params.id ?? null)
  if (!conversationId) return new Response('Conversația nu a fost găsită', { status: 404 })

  const conversatie = await queryOne<{ id: string; peer_name: string }>(
    `SELECT c.id,
            (SELECT name FROM users
              WHERE id = CASE WHEN c.student_id = $1 THEN c.teacher_id ELSE c.student_id END) AS peer_name
       FROM conversations c
      WHERE c.id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)`,
    [u.id, conversationId],
  )

  if (!conversatie) return new Response('Conversația nu a fost găsită', { status: 404 })

  const fisiere = await query<{
    stored_name: string
    original_name: string
    created_at: string
  }>(
    `SELECT f.stored_name, f.original_name, f.created_at
       FROM files f
       JOIN conversations c ON c.id = f.conversation_id
      WHERE f.conversation_id = $2 AND (c.student_id = $1 OR c.teacher_id = $1)
      ORDER BY f.created_at, f.position`,
    [u.id, conversationId],
  )

  if (fisiere.length === 0) {
    return new Response('Conversația nu are fișiere', { status: 404 })
  }

  const intrari = []
  let total = 0
  let omise = 0

  for (const f of fisiere) {
    const stocat = await openFile(conversationId, f.stored_name)
    // Un rând fără fișier pe disc nu oprește arhiva: se numără și se spune.
    if (!stocat) {
      omise += 1
      continue
    }
    if (total + stocat.size > MAX_ARHIVA) {
      omise += 1
      continue
    }
    intrari.push({
      nume: f.original_name,
      octeti: Buffer.from(await new Response(stocat.stream).arrayBuffer()),
      data: new Date(f.created_at),
    })
    total += stocat.size
  }

  if (intrari.length === 0) {
    return new Response('Fișierele nu au putut fi citite', { status: 404 })
  }

  const arhiva = construiesteZip(intrari)

  await noteazaAcces({
    userId: u.id,
    action: 'descarca_arhiva',
    subject: `${conversationId} · ${conversatie.peer_name}`,
    rowCount: intrari.length,
    request,
  })

  /* Numele arhivei poartă numele celuilalt din conversație: în Descărcări ajung
   * douăsprezece arhive, iar „fisiere.zip” de douăsprezece ori nu ajută pe nimeni.
   * Doar ASCII, ca `filename=` să rămână valid conform RFC 6266. */
  const cinE = (conversatie.peer_name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  /* `Buffer` este un `Uint8Array`, dar tipul lui nu intră în `BodyInit`: se dă
   * exact felia lui de memorie, fără copie. */
  const corp = arhiva.buffer.slice(
    arhiva.byteOffset,
    arhiva.byteOffset + arhiva.byteLength,
  ) as ArrayBuffer

  return new Response(corp, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(arhiva.byteLength),
      'content-disposition': `attachment; filename="fisiere-${cinE || 'conversatie'}.zip"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Câte au intrat și câte nu, pentru cazul în care plafonul a tăiat ceva.
      'x-fisiere-incluse': String(intrari.length),
      ...(omise > 0 ? { 'x-fisiere-omise': String(omise) } : {}),
    },
  })
}
