import { execute } from './db'

/**
 * Urma pe care o lasă datele când pleacă din portal.
 *
 * Se înregistrează doar căile prin care datele personale ies: exporturile și
 * descărcarea fișierelor. Nu este un jurnal de aplicație și nu ține niciodată
 * conținut — cine, ce fel de acces, ce a atins, câte rânduri, când.
 *
 * Nu aruncă niciodată. Un jurnal care nu poate scrie nu are voie să oprească
 * acțiunea pe care o descrie: ar transforma un export reușit într-o eroare, iar
 * utilizatorul l-ar cere din nou.
 */
export type AccesTip =
  | 'export_coordonari'
  | 'export_cereri'
  | 'descarca_fisier'
  | 'descarca_document'
  | 'export_date_proprii'

export async function noteazaAcces(e: {
  userId: string
  action: AccesTip
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
 * Curățenia: un an este suficient pentru o verificare, nu pentru supraveghere.
 *
 * Chemată din măturarea de termene, care rulează oricum periodic.
 */
export async function curataJurnalul(): Promise<void> {
  try {
    await execute(`DELETE FROM access_log WHERE created_at < now() - interval '1 year'`)
  } catch (err) {
    console.error('[audit] curățenia a eșuat', err)
  }
}
