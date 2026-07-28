import type { APIRoute } from 'astro'
import { COOKIE_SESIUNE, creeazaSesiune, DEMO_MODE } from '../../lib/auth'
import { queryOne } from '../../lib/db'

/**
 * Intrare fără email pentru conturile demonstrative.
 *
 * Este o ocolire reală a autentificării, de aceea: se activează doar cu
 * DEMO_MODE=true, funcționează exclusiv pentru conturile marcate `cont_demo`, și
 * este anunțată vizibil în interfață. Cu DEMO_MODE dezactivat ruta răspunde 404,
 * ca să nu confirme nici măcar că există.
 */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!DEMO_MODE) {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  const date = await request.formData()
  const utilizatorId = String(date.get('utilizator_id') ?? '')
  const redirect = String(date.get('redirect') ?? '')

  const utilizator = await queryOne<{ id: string; rol: string }>(
    `SELECT id, rol FROM utilizatori WHERE id = $1 AND cont_demo = true`,
    [utilizatorId],
  )

  if (!utilizator) {
    return Response.redirect(
      new URL('/autentificare?eroare=' + encodeURIComponent('Cont demonstrativ inexistent.'), url),
      303,
    )
  }

  const sesiuneId = await creeazaSesiune(utilizator.id)

  cookies.set(COOKIE_SESIUNE, sesiuneId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30,
  })

  const implicit = utilizator.rol === 'student' ? '/cererile-mele' : '/profesor'
  return Response.redirect(new URL(redirect || implicit, url), 303)
}
