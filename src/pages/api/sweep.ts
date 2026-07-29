import type { APIRoute } from 'astro'
import { sweepDeadlines, lastSweepAt } from '../../lib/lifecycle'

/**
 * Termenele, rulate de un orar — nu de cine se nimerește să intre.
 *
 * Măturarea trăia în middleware: expira cereri și invitații doar dacă cineva
 * deschidea o pagină. Într-o vineri seara fără trafic, o cerere care trebuia
 * respinsă automat rămânea deschisă până luni, iar studentul aștepta degeaba un
 * termen care trecuse deja.
 *
 * Ruta este protejată de un secret propriu, nu de sesiune: o cheamă un
 * planificator, nu un om. Fără `SWEEP_TOKEN` configurat răspunde 404, ca să nu
 * existe o rută publică ce declanșează emailuri.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const asteptat = process.env.SWEEP_TOKEN
  if (!asteptat) return new Response('Pagina nu a fost găsită', { status: 404 })

  const primit = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (primit !== asteptat) return new Response('Neautorizat', { status: 401 })

  await sweepDeadlines(process.env.APP_BASE_URL ?? url.origin, { fortat: true })

  return new Response(JSON.stringify({ ok: true, ultima: lastSweepAt() }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
