import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

// Server-rendered throughout: every page depends on session, role, or live data.
// Standalone mode gives a single `node ./dist/server/entry.mjs` process, which is
// what the container runs.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 3000, host: true },

  /* Prefetch pe intenție, nu pe vizibilitate.
   *
   * Fiecare răspuns pentru un utilizator autentificat este `no-store`, deci un
   * prefetch în masă ar descărca pagini care nu pot fi refolosite — trafic pur
   * pierdut. Pe hover, în schimb, cererea pleacă exact înaintea clicului și
   * ajunge la timp, iar antetele pentru paginile GET permit revalidarea. */
  prefetch: { defaultStrategy: 'hover', prefetchAll: true },

  // Astro's origin check compares the Origin header against the URL it derives
  // from the request, and behind the tunnel it sees http while the browser sends
  // an https Origin — every form POST would 403. We turn it off here and enforce
  // the same rule in middleware against APP_BASE_URL instead, which is explicit
  // rather than dependent on a proxied protocol.
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
})
