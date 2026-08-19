import { execute } from './db'

/**
 * The trail the data leaves when it goes out of the portal.
 *
 * Only the ways personal data leaves are recorded: the exports and the file
 * downloads. This is not an application log and it never holds content — who,
 * what kind of access, what was touched, how many rows, when.
 *
 * It never throws. A log that cannot write is not allowed to stop the action
 * it describes: it would turn a successful export into an error, and the user
 * would ask for it again.
 */
export type AccessAction =
  | 'export_coordonari'
  | 'export_cereri'
  | 'descarca_fisier'
  | 'descarca_arhiva'
  | 'descarca_document'
  | 'export_date_proprii'
  /* Changes to somebody else's identity: who was added, whose access was
     closed, whose address was changed. They are exactly the category the log
     exists for — more than the reads, these change who can get in. */
  | 'adauga_cont'
  | 'dezactiveaza_cont'
  | 'reactiveaza_cont'
  | 'schimba_email'

export async function recordAccess(e: {
  userId: string
  action: AccessAction
  subject?: string | null
  rowCount?: number | null
  request?: Request
}): Promise<void> {
  const ip =
    e.request?.headers.get('cf-connecting-ip') ??
    e.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null

  try {
    await execute(
      `INSERT INTO access_log (user_id, action, subject, row_count, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.userId, e.action, e.subject ?? null, e.rowCount ?? null, ip],
    )
  } catch (err) {
    console.error('[audit] accesul nu a putut fi înregistrat', err)
  }
}

/**
 * Housekeeping: one year is enough for a check, not for surveillance.
 *
 * Called from the milestone sweep, which runs periodically anyway.
 */
export async function purgeAccessLog(): Promise<void> {
  try {
    await execute(`DELETE FROM access_log WHERE created_at < now() - interval '1 year'`)
  } catch (err) {
    console.error('[audit] curățenia a eșuat', err)
  }
}
