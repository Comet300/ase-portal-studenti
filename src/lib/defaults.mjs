/**
 * What the portal assumes when nothing is configured.
 *
 * A fresh clone has no `.env` — the file is gitignored, because it carries the
 * production database and a mail key. Until now that meant `npm run dev` exited
 * on the first line with „DATABASE_URL nu este setat”, and whoever wanted to
 * look at the portal had to be told four values before seeing a screen.
 *
 * These are the values a local copy needs, and only a local copy: the address
 * of the database `compose.yml` starts, on a port nobody else uses. Anything
 * set in the environment wins over them — production sets all of it, and this
 * file is never consulted there.
 *
 * Written in plain JavaScript on purpose: the migration and seed scripts run on
 * bare Node, without a TypeScript step, and they need the same value the app
 * uses. One place, three readers.
 */

/** The database `compose.yml` brings up, on a port chosen not to clash. */
export const DEV_DATABASE_URL = 'postgres://postgres:dev@localhost:55432/portal'

/** Where the dev server listens, and therefore what the emails link to. */
export const DEV_PORT = 3000
export const DEV_BASE_URL = `http://localhost:${DEV_PORT}`

/** The name of the container `npm start` looks after. */
export const DEV_DB_CONTAINER = 'portal-pg-dev'

const isProduction = () => process.env.NODE_ENV === 'production'

/**
 * The connection string, with the local default behind it.
 *
 * In production the default is not offered at all: a deployment that lost its
 * `DATABASE_URL` must stop with one clear line, not quietly try to reach a
 * database on somebody's laptop.
 */
export function databaseUrl() {
  const set = process.env.DATABASE_URL
  if (set) return set
  if (isProduction()) return null
  return DEV_DATABASE_URL
}

/**
 * Whether the sign-in page offers the demonstration accounts.
 *
 * It is a real authentication bypass, so it stays off in production unless
 * somebody asks for it in writing. Locally it is on by default: without it the
 * only way in is a link written as an `.eml` file into `outbox/`, which is a
 * fair amount of ceremony for someone who cloned the repository to look around.
 */
export function demoMode() {
  const asked = process.env.DEMO_MODE
  if (asked !== undefined) return asked === 'true'
  return !isProduction()
}
