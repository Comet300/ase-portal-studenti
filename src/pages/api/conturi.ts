import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isDepartmentHead } from '../../lib/auth'
import { execute, query, queryOne, transaction } from '../../lib/db'
import { formAction } from '../../lib/forms'
import { deadEnd, internalPath, redirectWithNotice } from '../../lib/http'
import { id as formId } from '../../lib/ids'
import { parseAccountRows, parseAccountRole, type AccountRow } from '../../lib/accounts'
import { numar } from '../../lib/text'

/**
 * The portal's accounts: who comes in, who goes out, with what address.
 *
 * Until now there was no way at all. The only `INSERT INTO users` in the whole
 * project was in `scripts/seed.mjs`, so a cohort was populated by running a
 * script against production; nobody could be taken out; and a wrong address at
 * creation locked the person out for good, because authentication goes
 * exclusively through it.
 *
 * All the verbs belong to the department head — he is the one who keeps the
 * records — and all of them leave a trace in the access log: they are changes to
 * somebody else's identity, exactly the category the log exists for.
 */

const PAGE = '/profesor/conturi'

/** The current year's programmes, so that a student can be tied to their group. */
async function programmesByName() {
  const rows = await query<{ id: string; level: string; name: string; language: string }>(
    `SELECT id, level, name, language FROM study_programmes
      WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND is_active`,
  )
  const byName = new Map<string, (typeof rows)[number]>()
  for (const p of rows) byName.set(p.name.toLowerCase(), p)
  return byName
}

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isDepartmentHead(u)) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const form = await request.formData()
  const action = formAction(form)
  const backUrl = internalPath(String(form.get('redirect') ?? ''), PAGE)
  const back = (m: string, e = false) => redirectWithNotice(backUrl, m, e)

  /* --- add a single person ------------------------------------------------ */
  if (action === 'adauga') {
    const line = [
      String(form.get('nume') ?? ''),
      String(form.get('email') ?? ''),
      String(form.get('rol') ?? ''),
      String(form.get('numar_matricol') ?? ''),
      String(form.get('program') ?? ''),
      String(form.get('an') ?? ''),
      String(form.get('grupa') ?? ''),
    ].join(';')

    // The same parsing as for the pasted list: one set of rules, not two.
    const { accepted, rejected } = parseAccountRows(line)
    if (accepted.length === 0) return back(rejected[0]?.reason ?? 'Rândul nu a putut fi citit.', true)

    const insertResult = await adauga(accepted, u!.id, await programmesByName())
    if (insertResult.duplicate > 0) {
      return back(`Există deja un cont cu adresa ${accepted[0].email}.`, true)
    }

    await recordAccess({ userId: u!.id, action: 'adauga_cont', subject: accepted[0].email, rowCount: 1, request })
    return back(`${accepted[0].name} a fost adăugat. Poate intra cu un link cerut de pe pagina de autentificare.`)
  }

  /* --- the list pasted from the spreadsheet -------------------------------- */
  if (action === 'importa') {
    const raw = String(form.get('randuri') ?? '').trim()
    if (!raw) return back('Lipsesc rândurile de importat.', true)

    const { accepted, rejected } = parseAccountRows(raw)
    if (accepted.length === 0) {
      return back(
        `Niciun rând nu a putut fi citit. ${rejected.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.reason}`).join('; ')}`,
        true,
      )
    }

    const insertResult = await adauga(accepted, u!.id, await programmesByName())

    await recordAccess({
      userId: u!.id, action: 'adauga_cont',
      subject: `import · ${accepted.length} rânduri`, rowCount: insertResult.inserted, request,
    })

    return back(
      `${numar(insertResult.inserted, 'cont adăugat', 'conturi adăugate')}.` +
        (insertResult.duplicate > 0 ? ` ${numar(insertResult.duplicate, 'exista deja', 'existau deja')}.` : '') +
        (rejected.length > 0
          ? ` ${numar(rejected.length, 'rând respins', 'rânduri respinse')} — ${rejected.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.reason}`).join('; ')}${rejected.length > 3 ? '; …' : ''}.`
          : ''),
      rejected.length > 0,
    )
  }

  /* --- close / reopen access ----------------------------------------------- */
  if (action === 'dezactiveaza' || action === 'reactiveaza') {
    const cine = formId(form.get('utilizator_id'))
    const inchide = action === 'dezactiveaza'

    if (cine === u!.id) {
      return back('Nu îți poți închide propriul acces din acest ecran.', true)
    }

    const om = await queryOne<{ name: string; email: string }>(
      `UPDATE users
          SET is_active = $2, deactivated_at = CASE WHEN $2 THEN NULL ELSE now() END
        WHERE id = $1
        RETURNING name, email`,
      [cine, !inchide],
    )
    if (!om) return back('Persoana nu a fost găsită.', true)

    /* Open sessions do not survive the closing: otherwise somebody who has been
     * deactivated would stay inside until the cookie expires, that is, for up to
     * a month. */
    if (inchide) await execute('DELETE FROM sessions WHERE user_id = $1', [cine])

    await recordAccess({
      userId: u!.id,
      action: inchide ? 'dezactiveaza_cont' : 'reactiveaza_cont',
      subject: om.email, request,
    })

    return back(
      inchide
        ? `${om.name} nu mai are acces. Cererile și lucrările rămân în arhivă.`
        : `${om.name} are din nou acces.`,
    )
  }

  /* --- correct the address ------------------------------------------------- */
  if (action === 'schimba_email') {
    const cine = formId(form.get('utilizator_id'))
    const nou = String(form.get('email') ?? '').trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nou)) {
      return back('Adresa nouă nu arată a adresă de email.', true)
    }

    const ocupat = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 AND id <> $2`,
      [nou, cine],
    )
    if (ocupat) return back(`Adresa ${nou} este deja folosită de alt cont.`, true)

    /* The old address is read beforehand, explicitly.
     *
     * A `(SELECT email …)` inside `RETURNING` really would return the value from
     * before — the subquery sees the snapshot taken at the start of the
     * statement — but that is exactly the kind of correctness nobody can check by
     * reading the code, and the access log and the deletion of the links both
     * depend on it. */
    const inainte = await queryOne<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [cine],
    )
    if (!inainte) return back('Persoana nu a fost găsită.', true)

    await execute(`UPDATE users SET email = $2 WHERE id = $1`, [cine, nou])
    const om = { name: inainte.name, vechi: inainte.email }

    /* Changing the address is a change of identity: unused access links, issued
     * for the old address, are no longer allowed to work. */
    await execute(`DELETE FROM magic_link_tokens WHERE lower(email) = lower($1)`, [om.vechi])

    await recordAccess({
      userId: u!.id, action: 'schimba_email',
      subject: `${om.vechi} → ${nou}`, request,
    })

    return back(`Adresa lui ${om.name} a fost schimbată în ${nou}.`)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută.')
}

/**
 * Writes the rows, in a single transaction.
 *
 * `ON CONFLICT DO NOTHING` on the address: a repeated import does not duplicate
 * anybody and does not overwrite the data of someone already inside — if the
 * registry sends the list again with one column changed, the change is made
 * explicitly, not on the sly.
 */
async function adauga(
  randuri: AccountRow[],
  createdBy: string,
  programmes: Map<string, { id: string; level: string; name: string; language: string }>,
): Promise<{ inserted: number; duplicate: number }> {
  return transaction(async (client) => {
    let inserted = 0
    for (const r of randuri) {
      const p = r.programme ? programmes.get(r.programme.toLowerCase()) : undefined
      const { rowCount } = await client.query(
        `INSERT INTO users (email, name, role, student_number, programme_id,
                            program, specialization, study_language, study_year, study_group, created_by)
         VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, COALESCE($8, 'ro'), NULLIF($9, '')::int, NULLIF($10, ''), $11)
         ON CONFLICT (email) DO NOTHING`,
        [
          r.email, r.name, r.role, r.studentNumber,
          p?.id ?? null, p?.level ?? null, p?.name ?? null, p?.language ?? null,
          r.year, r.group, createdBy,
        ],
      )
      inserted += rowCount ?? 0
    }
    return { inserted, duplicate: randuri.length - inserted }
  })
}
