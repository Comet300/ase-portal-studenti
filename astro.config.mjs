import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

// Server-rendered throughout: every page depends on session, role, or live data.
// Standalone mode gives a single `node ./dist/server/entry.mjs` process, which is
// what the container runs.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 3000, host: true },
  devToolbar: { enabled: false },
})
