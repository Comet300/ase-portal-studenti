import { defineMiddleware } from 'astro:middleware'
import { COOKIE_SESIUNE, utilizatorDinSesiune } from './lib/auth'

/**
 * Rutele de student sunt deschise tuturor rolurilor; zona profesorului cere rolul
 * `profesor` sau `director`, iar zona de departament cere `director`. Un utilizator
 * autentificat care nu are dreptul primește 404, nu 403: nu confirmăm existența
 * unei zone pe care nu o poate folosi.
 */

const NECESITA_AUTENTIFICARE = ['/cererile-mele', '/mesaje', '/consultatii', '/contul-meu']
const ZONA_PROFESOR = '/profesor'
const ZONA_DIRECTOR = '/profesor/departament'

export const onRequest = defineMiddleware(async (context, next) => {
  const sesiuneId = context.cookies.get(COOKIE_SESIUNE)?.value
  context.locals.utilizator = await utilizatorDinSesiune(sesiuneId)

  const cale = context.url.pathname
  const u = context.locals.utilizator

  const cereLogin =
    NECESITA_AUTENTIFICARE.some((p) => cale === p || cale.startsWith(p + '/')) ||
    cale.startsWith(ZONA_PROFESOR)

  if (cereLogin && !u) {
    return context.redirect(`/autentificare?redirect=${encodeURIComponent(cale)}`, 302)
  }

  if (cale.startsWith(ZONA_PROFESOR) && u && u.rol === 'student') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  if (cale.startsWith(ZONA_DIRECTOR) && u && u.rol !== 'director') {
    return new Response('Pagina nu a fost găsită', { status: 404 })
  }

  return next()
})
