#!/usr/bin/env node
/**
 * Aplică `migrations/*.sql` în ordinea numelor de fișier.
 *
 * Fiecare fișier rulează în propria tranzacție și este înregistrat în
 * `schema_migrations`, deci un fișier care eșuează nu lasă schema pe jumătate,
 * iar o rulare repetată aplică doar ce e nou. Lock-ul consultativ serializează
 * două containere care pornesc în același timp.
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations')
const LOCK = 771_120_264

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL nu este setat')
  process.exit(1)
}

async function connectWithRetry(attempts = 12, delayMs = 2500) {
  for (let i = 1; i <= attempts; i++) {
    const client = new pg.Client({ connectionString })
    try {
      await client.connect()
      return client
    } catch (err) {
      await client.end().catch(() => {})
      if (i === attempts) throw err
      console.log(`[migrate] baza de date nu răspunde încă (${i}/${attempts})`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error('unreachable')
}

const client = await connectWithRetry()
await client.query(`SET TIME ZONE '${process.env.TZ ?? 'Europe/Bucharest'}'`)

try {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK])
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const { rows } = await client.query('SELECT version FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.version))

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()
  let count = 0

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(DIR, file), 'utf8')
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`[migrate] aplicat ${file}`)
      count++
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`[migrate] eșec la ${file}`)
      throw err
    }
  }

  console.log(count === 0 ? '[migrate] schema este la zi' : `[migrate] ${count} migrare(i) aplicate`)
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {})
  await client.end()
}
