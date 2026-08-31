import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isDepartmentHead } from '../../lib/auth'
import { execute, query, queryOne, transaction } from '../../lib/db'
import { formAction } from '../../lib/forms'
import { deadEnd, internalPath, redirectWithNotice } from '../../lib/http'
import { id as formId } from '../../lib/ids'
import {
  composeAccountRows,
  matchProgramme,
  parseAccountRows,
  type AccountRow,
  type ProgrammeChoice,
} from '../../lib/accounts'
import { MAX_IMPORT_ROWS } from '../../lib/tabular'
import { numar } from '../../lib/text'
import { LANGUAGE_LABELS, LEVEL_LABELS } from '../../lib/years'

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

/* Unde se întoarce un formular care nu și-a trimis propriul `redirect`.
 * Ecranul „Conturi” a fost împărțit; studenții se administrează de aici. */
const PAGE = '/profesor/facultate'

interface Programme extends ProgrammeChoice {
  id: string
}

/** The current year's programmes, so that a student can be tied to their group. */
async function currentProgrammes(): Promise<Programme[]> {
  const rows = await query<{ id: string; level: string; name: string; language: string }>(
    `SELECT id, level, name, language FROM study_programmes
      WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND is_active`,
  )
  return rows.map((p) => ({
    ...p,
    label: `${LEVEL_LABELS[p.level] ?? p.level} · ${p.name} · ${LANGUAGE_LABELS[p.language] ?? p.language}`,
  }))
}

/**
 * The rows that can be written, and the ones whose programme was not recognised.
 *
 * A row is identified by its address and not by its number: by the time it gets
 * here the list has been read, the empty lines dropped and the rejected ones
 * removed, so „rândul 34” would name a different row than the one the director
 * is looking at. The address is what they will search for anyway.
 */
function resolveProgrammes(rows: AccountRow[], programmes: Programme[]) {
  const writable: { row: AccountRow; programme: Programme | null }[] = []
  const refused: string[] = []

  for (const row of rows) {
    const match = matchProgramme(row.programme, programmes)
    if (!match.ok) {
      refused.push(`${row.email}: ${match.reason}`)
      continue
    }
    writable.push({ row, programme: match.programme })
  }
  return { writable, refused }
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
    /* The order is `ACCOUNT_COLUMNS`, field for field: the same reader parses
     * this line and the imported list, and it reads by position. Composed by
     * the same function the import uses, so that a name typed with a semicolon
     * in it does not open a tenth column here either. */
    const line = composeAccountRows([[
      String(form.get('nume') ?? ''),
      String(form.get('email') ?? ''),
      String(form.get('rol') ?? ''),
      String(form.get('numar_matricol') ?? ''),
      String(form.get('program') ?? ''),
      String(form.get('an') ?? ''),
      String(form.get('grupa') ?? ''),
      String(form.get('serie') ?? ''),
      String(form.get('initiala_tatalui') ?? ''),
    ]])

    // The same parsing as for the pasted list: one set of rules, not two.
    const { accepted, rejected } = parseAccountRows(line)
    if (accepted.length === 0) return back(rejected[0]?.reason ?? 'Rândul nu a putut fi citit.', true)

    const { writable, refused } = resolveProgrammes(accepted, await currentProgrammes())
    if (writable.length === 0) return back(refused[0] ?? 'Rândul nu a putut fi citit.', true)

    const insertResult = await adauga(writable, u!.id)
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

    /* The ceiling exists here as well as in the page, because the page is not a
     * defence: one transaction with a round trip per row is what stands behind
     * this, and a whole-faculty export pasted in by mistake would hold it open
     * for minutes. */
    const lineCount = raw.split('\n').filter((l) => l.trim()).length
    if (lineCount > MAX_IMPORT_ROWS) {
      return back(
        `Lista are ${numar(lineCount, 'rând', 'rânduri')}, peste plafonul de ${MAX_IMPORT_ROWS} pentru un import. Împarte-o pe promoții.`,
        true,
      )
    }

    const { accepted, rejected } = parseAccountRows(raw)
    if (accepted.length === 0) {
      return back(
        `Niciun rând nu a putut fi citit. ${rejected.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.reason}`).join('; ')}`,
        true,
      )
    }

    const { writable, refused } = resolveProgrammes(accepted, await currentProgrammes())
    if (writable.length === 0) {
      return back(`Niciun rând nu a putut fi scris. ${refused.slice(0, 3).join('; ')}`, true)
    }

    const insertResult = await adauga(writable, u!.id)

    await recordAccess({
      userId: u!.id, action: 'importa_studenti',
      subject: `import · ${accepted.length} rânduri citite`, rowCount: insertResult.inserted, request,
    })

    return back(
      `${numar(insertResult.inserted, 'cont adăugat', 'conturi adăugate')}.` +
        (insertResult.duplicate > 0 ? ` ${numar(insertResult.duplicate, 'exista deja', 'existau deja')}.` : '') +
        (rejected.length > 0
          ? ` ${numar(rejected.length, 'rând respins', 'rânduri respinse')} — ${rejected.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.reason}`).join('; ')}${rejected.length > 3 ? '; …' : ''}.`
          : '') +
        (refused.length > 0
          ? ` ${numar(refused.length, 'rând fără program', 'rânduri fără program')} — ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? '; …' : ''}.`
          : ''),
      rejected.length > 0 || refused.length > 0,
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
  randuri: { row: AccountRow; programme: Programme | null }[],
  createdBy: string,
): Promise<{ inserted: number; duplicate: number }> {
  return transaction(async (client) => {
    let inserted = 0
    for (const { row: r, programme: p } of randuri) {
      const { rowCount } = await client.query(
        `INSERT INTO users (email, name, role, student_number, programme_id,
                            program, specialization, study_language, study_year, study_group,
                            study_series, father_initial, created_by)
         VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, COALESCE($8, 'ro'), NULLIF($9, '')::int,
                 NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13)
         ON CONFLICT (email) DO NOTHING`,
        [
          r.email, r.name, r.role, r.studentNumber,
          p?.id ?? null, p?.level ?? null, p?.name ?? null, p?.language ?? null,
          r.year, r.group, r.series, r.fatherInitial, createdBy,
        ],
      )
      inserted += rowCount ?? 0

      /* A coordinator needs a row of seats from the day they are added.
       *
       * That INSERT lived only inside `openYear`, so anyone brought in after
       * the year had started showed zero seats on the allocation screen — every
       * read of the seats is a LEFT JOIN, so the missing row reads as a real
       * zero and the director has to type the numbers in by hand to correct a
       * number nobody set. Only for someone actually created: an existing
       * person already has theirs. */
      if (rowCount && r.role !== 'student') {
        await client.query(
          `INSERT INTO seat_allocations (teacher_id, academic_year_id)
           SELECT (SELECT id FROM users WHERE email = $1), y.id
             FROM academic_years y WHERE y.is_current
           ON CONFLICT DO NOTHING`,
          [r.email],
        )
      }
    }
    return { inserted, duplicate: randuri.length - inserted }
  })
}
