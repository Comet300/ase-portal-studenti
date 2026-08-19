/**
 * Presence, drawn with a thick line.
 *
 * Not „3 minutes ago”: somebody else's exact minute count is surveillance, not
 * help. Three steps, just enough to answer the one question that matters — „is
 * there any point waiting for a reply now?”. Past half a day nothing is said any
 * more, because it no longer means anything.
 *
 * It sits in its own file, with no dependency at all: both the page, on the
 * server, and the discussion thread, in the browser, use it. `repo.ts` cannot be
 * imported in the client — it would drag the database connection and Node's file
 * modules along with it.
 */
export function prezenta(iso: string | null): string | null {
  if (!iso) return null
  const minute = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minute < 0) return null
  if (minute < 3) return 'în portal acum'
  if (minute < 60) return 'a fost în portal acum câteva minute'
  if (minute < 60 * 12) return 'a fost în portal astăzi'
  return null
}
