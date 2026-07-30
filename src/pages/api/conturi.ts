import type { APIRoute } from 'astro'
import { noteazaAcces } from '../../lib/audit'
import { isDepartmentHead } from '../../lib/auth'
import { execute, query, queryOne, transaction } from '../../lib/db'
import { formAction } from '../../lib/forms'
import { deadEnd, internalPath, redirectWithNotice } from '../../lib/http'
import { id as formId } from '../../lib/ids'
import { citesteRanduriConturi, rolCont, type RandCont } from '../../lib/conturi'
import { numar } from '../../lib/text'

/**
 * Conturile portalului: cine intră, cine iese, cu ce adresă.
 *
 * Până acum nu exista nicio cale. Singurul `INSERT INTO users` din tot proiectul
 * era în `scripts/seed.mjs`, deci o promoție se popula rulând un script pe
 * producție; nimeni nu putea fi scos; iar o adresă greșită la creare închidea
 * omul pe dinafară definitiv, fiindcă autentificarea trece exclusiv prin ea.
 *
 * Toate verbele sunt ale directorului de departament — el ține evidența — și
 * toate lasă urmă în jurnalul de acces: sunt schimbări asupra identității altcuiva,
 * exact categoria pentru care jurnalul există.
 */

const PAGE = '/profesor/conturi'

/** Programele anului curent, ca să se poată lega un student de grupa lui. */
async function programePeNume() {
  const rows = await query<{ id: string; level: string; name: string; language: string }>(
    `SELECT id, level, name, language FROM study_programmes
      WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current) AND is_active`,
  )
  const harta = new Map<string, (typeof rows)[number]>()
  for (const p of rows) harta.set(p.name.toLowerCase(), p)
  return harta
}

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isDepartmentHead(u)) {
    return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')
  }

  const form = await request.formData()
  const action = formAction(form)
  const inapoi = internalPath(String(form.get('redirect') ?? ''), PAGE)
  const back = (m: string, e = false) => redirectWithNotice(inapoi, m, e)

  /* --- adaugă o singură persoană ------------------------------------------ */
  if (action === 'adauga') {
    const linie = [
      String(form.get('nume') ?? ''),
      String(form.get('email') ?? ''),
      String(form.get('rol') ?? ''),
      String(form.get('numar_matricol') ?? ''),
      String(form.get('program') ?? ''),
      String(form.get('an') ?? ''),
      String(form.get('grupa') ?? ''),
    ].join(';')

    // Aceeași citire ca la lista lipită: un singur set de reguli, nu două.
    const { bune, respinse } = citesteRanduriConturi(linie)
    if (bune.length === 0) return back(respinse[0]?.motiv ?? 'Rândul nu a putut fi citit.', true)

    const scrise = await adauga(bune, u!.id, await programePeNume())
    if (scrise.duplicate > 0) {
      return back(`Există deja un cont cu adresa ${bune[0].email}.`, true)
    }

    await noteazaAcces({ userId: u!.id, action: 'adauga_cont', subject: bune[0].email, rowCount: 1, request })
    return back(`${bune[0].name} a fost adăugat. Poate intra cu un link cerut de pe pagina de autentificare.`)
  }

  /* --- lista lipită din foaia de calcul ------------------------------------ */
  if (action === 'importa') {
    const brut = String(form.get('randuri') ?? '').trim()
    if (!brut) return back('Lipsesc rândurile de importat.', true)

    const { bune, respinse } = citesteRanduriConturi(brut)
    if (bune.length === 0) {
      return back(
        `Niciun rând nu a putut fi citit. ${respinse.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.motiv}`).join('; ')}`,
        true,
      )
    }

    const scrise = await adauga(bune, u!.id, await programePeNume())

    await noteazaAcces({
      userId: u!.id, action: 'adauga_cont',
      subject: `import · ${bune.length} rânduri`, rowCount: scrise.noi, request,
    })

    return back(
      `${numar(scrise.noi, 'cont adăugat', 'conturi adăugate')}.` +
        (scrise.duplicate > 0 ? ` ${numar(scrise.duplicate, 'exista deja', 'existau deja')}.` : '') +
        (respinse.length > 0
          ? ` ${numar(respinse.length, 'rând respins', 'rânduri respinse')} — ${respinse.slice(0, 3).map((r) => `rândul ${r.numar}: ${r.motiv}`).join('; ')}${respinse.length > 3 ? '; …' : ''}.`
          : ''),
      respinse.length > 0,
    )
  }

  /* --- închide / redeschide accesul ---------------------------------------- */
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

    /* Sesiunile deschise nu supraviețuiesc închiderii: altfel cineva dezactivat
     * ar rămâne înăuntru până expiră cookie-ul, adică până la o lună. */
    if (inchide) await execute('DELETE FROM sessions WHERE user_id = $1', [cine])

    await noteazaAcces({
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

  /* --- corectează adresa --------------------------------------------------- */
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

    /* Adresa veche se citește înainte, explicit.
     *
     * Un `(SELECT email …)` în `RETURNING` chiar ar întoarce valoarea dinainte —
     * subinterogarea vede instantaneul de la începutul instrucțiunii — dar asta
     * este exact felul de corectitudine pe care nimeni nu o poate verifica citind
     * codul, iar jurnalul de acces și ștergerea linkurilor depind de ea. */
    const inainte = await queryOne<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [cine],
    )
    if (!inainte) return back('Persoana nu a fost găsită.', true)

    await execute(`UPDATE users SET email = $2 WHERE id = $1`, [cine, nou])
    const om = { name: inainte.name, vechi: inainte.email }

    /* Schimbarea adresei este o schimbare de identitate: linkurile de acces
     * nefolosite, emise pentru adresa veche, nu mai au voie să funcționeze. */
    await execute(`DELETE FROM magic_link_tokens WHERE lower(email) = lower($1)`, [om.vechi])

    await noteazaAcces({
      userId: u!.id, action: 'schimba_email',
      subject: `${om.vechi} → ${nou}`, request,
    })

    return back(`Adresa lui ${om.name} a fost schimbată în ${nou}.`)
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută.')
}

/**
 * Scrie rândurile, într-o singură tranzacție.
 *
 * `ON CONFLICT DO NOTHING` pe adresă: un import repetat nu dublează pe nimeni și
 * nu suprascrie datele cuiva care e deja înăuntru — dacă secretariatul retrimite
 * lista cu o coloană schimbată, schimbarea se face explicit, nu pe furiș.
 */
async function adauga(
  randuri: RandCont[],
  deCatre: string,
  programe: Map<string, { id: string; level: string; name: string; language: string }>,
): Promise<{ noi: number; duplicate: number }> {
  return transaction(async (client) => {
    let noi = 0
    for (const r of randuri) {
      const p = r.programme ? programe.get(r.programme.toLowerCase()) : undefined
      const { rowCount } = await client.query(
        `INSERT INTO users (email, name, role, student_number, programme_id,
                            program, specialization, study_language, study_year, study_group, created_by)
         VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, COALESCE($8, 'ro'), NULLIF($9, '')::int, NULLIF($10, ''), $11)
         ON CONFLICT (email) DO NOTHING`,
        [
          r.email, r.name, r.role, r.studentNumber,
          p?.id ?? null, p?.level ?? null, p?.name ?? null, p?.language ?? null,
          r.year, r.group, deCatre,
        ],
      )
      noi += rowCount ?? 0
    }
    return { noi, duplicate: randuri.length - noi }
  })
}
