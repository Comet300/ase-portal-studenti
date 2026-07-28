/**
 * Identifiers arriving from a form.
 *
 * Every id in this schema is a uuid, and PostgreSQL raises on a value that is
 * not one — so a hand-edited field turns a "not found" into a 500 and a stack
 * trace in the logs. Reading ids through here makes malformed input indistinct
 * from absent input, which is what the handlers already know how to answer.
 *
 * Optional fields keep the empty string, because that is what the SQL below
 * expects for `NULLIF($n, '')::uuid`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The value if it is a uuid, otherwise the empty string. */
export function id(value: FormDataEntryValue | null): string {
  const raw = String(value ?? '').trim()
  return UUID.test(raw) ? raw : ''
}
