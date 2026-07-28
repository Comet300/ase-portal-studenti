import type { APIRoute } from 'astro'

/**
 * Liveness probe for the orchestrator.
 *
 * Deliberately touches no dependency: a health check that queries the database
 * turns a transient blip into a restart loop, which is worse than serving a
 * degraded page. Dependency health belongs in monitoring, not in a restart trigger.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
