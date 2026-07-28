/**
 * Identifiers arriving from a form or a URL.
 *
 * Every id in this schema is a uuid, and PostgreSQL raises on any value that is
 * not one — including the empty string. So a hand-edited field turned a "not
 * found" into a 500 and a stack trace in the logs.
 *
 * Invalid becomes `null` rather than `''` on purpose. A null parameter compares
 * to nothing (`WHERE id = NULL` matches no row) and passes through
 * `NULLIF($n, '')::uuid` unchanged, so both the required and the optional case
 * land on the answer the handler already knows how to give, with no extra
 * branch at the call site.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function id(value: FormDataEntryValue | string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  return UUID.test(raw) ? raw : null
}
