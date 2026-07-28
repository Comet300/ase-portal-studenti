import pg from 'pg'
import type { Database, Transaction } from '../ports'

/**
 * The PostgreSQL implementation of `Database`.
 *
 * One pool for the whole process. Timestamps are parsed to ISO strings rather
 * than `Date`: left at the driver default the same column arrives as an object
 * at row level but as a string inside `json_agg`, i.e. two shapes for one thing.
 */

const { Pool, types } = pg

for (const oid of [1184, 1114, 1082]) {
  types.setTypeParser(oid, (v: string) => (v === null ? null : new Date(v).toISOString()))
}

export function createPostgresDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  pool.on('error', (err) => console.error('[db] idle client error', err))

  /** Values travel only as `$n` parameters; there is no interpolating variant. */
  async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await pool.query(sql, params)
    return res.rows as T[]
  }

  return {
    query,

    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = await query<T>(sql, params)
      return rows[0] ?? null
    },

    async execute(sql: string, params: unknown[] = []): Promise<number> {
      const res = await pool.query(sql, params)
      return res.rowCount ?? 0
    },

    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn({
          async query(sql, params = []) {
            const res = await client.query(sql, params)
            return { rows: res.rows, rowCount: res.rowCount ?? 0 }
          },
        })
        await client.query('COMMIT')
        return out
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  }
}
