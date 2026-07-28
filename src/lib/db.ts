import { database } from './container'
import type { Transaction } from './ports'

/**
 * Database access for the application.
 *
 * These are bound to whichever `Database` implementation `container.ts` chose;
 * the interface lives in `ports.ts`. Call sites import from here and never name
 * a driver, so replacing PostgreSQL means writing one adapter, not touching
 * thirty files.
 */

export type { Transaction }

/** Values travel only as `$n` parameters; there is no interpolating variant. */
export const query = database.query.bind(database)
export const queryOne = database.queryOne.bind(database)
export const execute = database.execute.bind(database)
export const transaction = database.transaction.bind(database)
