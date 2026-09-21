/**
 * Lets `node --test` import the application's own modules.
 *
 * The application is written for a bundler: `repo.ts` imports `'./db'`, without
 * an extension, as every Astro file in the project does. Bare Node ESM does not
 * guess extensions, so until now a test could only reach the few modules that
 * import nothing — `seats.ts`, `text.ts`, `date.ts`. Everything that touches the
 * database, which is everything that decides whether a student may be accepted,
 * was untestable for a reason that has nothing to do with the code.
 *
 * The alternative was to write the extensions into a hundred and fifty imports
 * across the project, which changes production code to suit the tests, or to
 * run the tests through Vite, which is a second build to keep in step with the
 * first. This is neither: one resolution hook, loaded with `--import`, in the
 * test harness only. What runs in production is unchanged and still resolved by
 * Astro.
 *
 * Only relative specifiers, and only when the file really exists — a package
 * name, a builtin or a specifier that already carries an extension falls
 * straight through to Node, so nothing about normal resolution changes.
 */

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* `.ts` first: where a module exists in both forms the TypeScript one is the
 * source of truth, and `.mjs` is there for the three files that must run on
 * bare Node (`defaults.mjs`, `programmes.mjs`, `romanian.mjs`). */
const CANDIDATES = ['.ts', '.mjs', '.js', '/index.ts']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (relative && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      for (const suffix of CANDIDATES) {
        const candidate = new URL(specifier + suffix, context.parentURL)
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(specifier + suffix, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
})
