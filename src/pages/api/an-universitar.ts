import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, query, queryOne, transaction } from '../../lib/db'
import { deadEnd, redirectWithNotice } from '../../lib/http'
import { parseArchiveRows, parseArchiveLevel } from '../../lib/archive'
import { formAction } from '../../lib/forms'
import { FORMS_OF_STUDY, normalizeLocation, programmeTitle } from '../../lib/programmes.mjs'
import { numar } from '../../lib/text'
import { openYear } from '../../lib/years'
import { id as formId } from '../../lib/ids'

/**
 * The academic year, and everything that resets with it.
 *
 * Opening a year is the single most destructive-looking action in the portal —
 * it moves every student-facing screen to an empty calendar and an empty topic
 * catalogue. It is not destructive: nothing is deleted, the previous year keeps
 * its requests and becomes archive. What carries over is chosen explicitly,
 * because the point of a new year is that the department re-decides.
 */

const PAGE = '/profesor/an-universitar'

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!isDepartmentHead(u)) return deadEnd(404, 'Pagina nu a fost găsită', 'Adresa aceasta nu duce nicăieri în portal.')

  const form = await request.formData()
  const action = formAction(form)
  const back = (message: string, isError = false) => redirectWithNotice(PAGE, message, isError)

  if (action === 'deschide_an') {
    const label = String(form.get('eticheta') ?? '').trim()
    const startsOn = String(form.get('inceput') ?? '').trim()
    const endsOn = String(form.get('sfarsit') ?? '').trim()

    if (!label || !startsOn || !endsOn) {
      return back('Completează denumirea și cele două date.', true)
    }
    if (startsOn >= endsOn) return back('Data de început este după data de sfârșit.', true)

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM academic_years WHERE label = $1`,
      [label],
    )
    if (existing) return back(`Anul „${label}” există deja.`, true)

    /* Turning the year over cannot be undone.
     *
     * The current session goes into the archive with everything it holds, the
     * coordinations end, the catalogue empties — on a single click, from a form
     * that sits open on the screen. The confirmation is not a checkbox but the
     * label of the year being closed, written by hand: the one gesture that
     * cannot be made out of reflex. It is compared against the current year in
     * the database, not against what the page submitted. */
    const currentYearRow = await queryOne<{ label: string }>(
      `SELECT label FROM academic_years WHERE is_current`,
    )
    /* The hyphen stands in for the dash.
     *
     * The label is „2025–2026”, with an en dash — a character that does not
     * exist on the Romanian keyboard. Demanding it exactly would have made the
     * gate impossible to pass without copying from the page, which turns the
     * confirmation into copying, that is into exactly the reflex it is trying
     * to stop. */
    const normalizeDashes = (t: string) => t.replace(/[\u2010-\u2015]/g, '-')
    const confirmare = String(form.get('confirmare') ?? '').trim()
    if (currentYearRow && normalizeDashes(confirmare) !== normalizeDashes(currentYearRow.label)) {
      return back(
        `Scrie exact „${currentYearRow.label}” în câmpul de confirmare ca să închizi sesiunea în curs.`,
        true,
      )
    }

    await openYear(label, startsOn, endsOn, {
      copyStages: form.get('preia_etape') === 'da',
      copyTopics: form.get('preia_teme') === 'da',
      copyProgrammes: form.get('preia_programe') === 'da',
      copySeats: form.get('preia_locuri') === 'da',
    })

    /* The next step is named, because it is the one nothing on this screen does.
     * Opening a year carries the *existing* people forward — it never brings a
     * new cohort into being, and the director who has just archived a session
     * is exactly the person about to look for where the first-year list goes. */
    return back(
      `Anul ${label} este deschis. Sesiunea anterioară a trecut în arhivă. ` +
        'Urmează promoția nouă: se adaugă din Conturi → „Importă o promoție”.',
    )
  }

  /* A programme is five answers now, not a name typed into a box.
   *
   * The box was the whole problem. „Învățământ la distanță — Buzău” typed into
   * it was a form of study, a centre and an unstated specialisation in one
   * string, and nothing downstream could take it apart — which is why a second
   * licență specialisation could not be expressed at all. The five fields are
   * what the registry has always sent and what `study_programmes` has carried
   * since migration 0024; the name is composed from them, so the label on every
   * screen is the same one the importer matches against, character for
   * character. */
  if (action === 'adauga_program') {
    const level = String(form.get('nivel') ?? '')
    const specialisation = String(form.get('specializare') ?? '').trim()
    const formOfStudy = String(form.get('forma') ?? '')
    const location = normalizeLocation(form.get('locatie'))
    const language = String(form.get('limba') ?? 'ro')
    const years = Number(form.get('durata') ?? 3)

    if (!['bachelor', 'master'].includes(level)) return back('Nivel invalid.', true)
    if (!['ro', 'en', 'fr', 'de'].includes(language)) return back('Limbă invalidă.', true)
    if (!FORMS_OF_STUDY.includes(formOfStudy)) {
      return back('Alege forma de învățământ: cu frecvență, cu frecvență redusă sau la distanță.', true)
    }
    if (!specialisation) {
      return back('Scrie specializarea — „Marketing”, „Marketing online”.', true)
    }

    /* The centre is chosen, not typed, and this is the server's half of that.
     *
     * The screen offers the centres that exist, so the only way to arrive here
     * with an unknown one is a hand-made POST or a form filled before another
     * director removed the centre. Either way the insert below would otherwise
     * be refused by the foreign key with „violates foreign key constraint”,
     * which tells the director nothing about what to do next. */
    const centre = await queryOne<{ name: string }>(
      `SELECT name FROM teaching_locations WHERE name = $1`,
      [location],
    )
    if (!centre) {
      return back(
        location
          ? `Centrul „${location}” nu este în lista facultății, iar un program nu poate fi predat undeva ce nu există. Adaugă-l mai întâi cu „Adaugă un centru”, apoi reia programul.`
          : 'Alege centrul în care se predă. Dacă lipsește din listă, adaugă-l cu „Adaugă un centru”.',
        true,
      )
    }

    const dimensions = {
      level,
      form_of_study: formOfStudy,
      specialisation,
      language,
      location,
    }
    const name = programmeTitle(dimensions)

    /* The conflict is on the identity, not on the name. On the name it would
     * have matched a programme by what it is CALLED: renaming a label would
     * have opened a second row for the same cohort, and the seats, topics and
     * students would have stayed on the first one. */
    await execute(
      `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years,
                                     form_of_study, specialisation, location)
       VALUES ((SELECT id FROM academic_years WHERE is_current), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (academic_year_id, level, form_of_study, specialisation, language, location)
       DO UPDATE SET duration_years = EXCLUDED.duration_years,
                     name = EXCLUDED.name,
                     is_active = true`,
      [
        level, name, language, Math.min(6, Math.max(1, Math.trunc(years) || 3)),
        formOfStudy, specialisation, location,
      ],
    )

    return back(`Programul „${name}” a fost adăugat.`)
  }

  /* --- the teaching centres ------------------------------------------------- */

  /* Opening a centre is its own act, on its own button.
   *
   * It used to be a side effect of typing a programme: the „Centrul” field was
   * free text with a `datalist` of the ones already in use, so „Buzau” next to
   * „Buzău” created a second centre AND a second programme in one keystroke,
   * and the second programme then carried its own seats, its own catalogue
   * entry and half of one cohort's students, with nothing anywhere saying the
   * two were the same people. Since migration 0025 the centre is a row, so the
   * programme form can only choose; this is where the choosing list grows, and
   * a director has to mean it. */
  if (action === 'adauga_centru') {
    const name = normalizeLocation(form.get('centru'))

    if (!name) {
      return back('Scrie numele centrului — „Buzău”, „Slobozia”.', true)
    }
    if (name.length > 120) {
      return back('Numele centrului este prea lung: cel mult 120 de caractere.', true)
    }

    /* Compared case-insensitively against the whole list, and in the
     * application rather than in SQL: a functional index on `lower(name)` is a
     * construct the MySQL port would have to unpick, and the list is two rows.
     * `normalizeLocation` deliberately leaves case alone — title-casing
     * „Râmnicu Vâlcea” is a guess — so this is what stops „bucurești” from
     * becoming a second București. */
    const existing = await query<{ name: string }>(`SELECT name FROM teaching_locations`)
    const key = name.toLocaleLowerCase('ro-RO')
    const already = existing.find((c) => c.name.toLocaleLowerCase('ro-RO') === key)
    if (already) {
      return back(
        already.name === name
          ? `Centrul „${name}” este deja în listă.`
          : `Centrul există deja, scris „${already.name}”. Folosește-l din listă — două scrieri ale aceluiași oraș ar face din fiecare cohortă două programe separate.`,
        true,
      )
    }

    await execute(`INSERT INTO teaching_locations (name, created_by) VALUES ($1, $2)`, [
      name,
      u!.id,
    ])
    return back(`Centrul „${name}” a fost adăugat. Îl poți alege acum la „Program nou”.`)
  }

  /* Correcting the spelling of a centre, title and all.
   *
   * WHY THIS SCREEN NEEDED ONE. „Buzau” typed instead of „Buzău” could be
   * deleted only while no programme named it (`ON DELETE RESTRICT`), so the
   * moment a cohort was on it the misspelling was permanent: the only way out
   * was a second centre, a second programme, and one cohort split in half —
   * which is the thing migration 0025 exists to prevent.
   *
   * WHY IT IS NOT JUST THE UPDATE. `study_programmes.location` cascades on
   * update (0025), so the rename really does reach every programme. But
   * `study_programmes.name` and `users.specialization` are COMPOSED from the
   * five facts by `programmeTitle` and materialised — so the cascade alone
   * would move the centre and leave „Marketing · învățământ la distanță ·
   * Buzau” written on the catalogue, the seats ledger, the topic list and six
   * filtered screens. Migration 0024 recomposed both in SQL after exactly this
   * kind of move; here the composing is done by the module instead, so there is
   * one definition of a title rather than two that can drift.
   *
   * A rename that lands on an existing centre is a MERGE — two sets of seats,
   * two catalogue entries and two halves of one cohort coming together — and
   * this refuses it, as 0024 and 0025 refuse it. It is the director's decision
   * about people, not a spelling correction. */
  if (action === 'redenumeste_centru') {
    const from = normalizeLocation(form.get('centru'))
    const to = normalizeLocation(form.get('nume_nou'))

    if (!to) return back('Scrie numele corect al centrului.', true)
    if (to.length > 120) {
      return back('Numele centrului este prea lung: cel mult 120 de caractere.', true)
    }
    if (to === from) return back(`Centrul se numește deja „${to}”.`, true)

    const centres = await query<{ name: string }>(`SELECT name FROM teaching_locations`)
    if (!centres.some((c) => c.name === from)) {
      return back(`Centrul „${from}” nu este în lista facultății.`, true)
    }
    /* Case-insensitively, as „Adaugă un centru”: „bucurești” is not a second
     * București, and a rename that only changes the case of the SAME row is a
     * correction this must still allow through. */
    const key = to.toLocaleLowerCase('ro-RO')
    const clash = centres.find(
      (c) => c.name !== from && c.name.toLocaleLowerCase('ro-RO') === key,
    )
    if (clash) {
      return back(
        `Există deja un centru „${clash.name}”. Redenumirea l-ar uni cu „${from}”, adică ar aduce la un loc două seturi de locuri și două jumătăți dintr-o cohortă — asta nu o face o corectură de scriere. Mută întâi programele dintr-un centru în celălalt, apoi șterge centrul rămas gol.`,
        true,
      )
    }

    const renamed = await transaction(async (client) => {
      // The cascade of 0025 carries the new name into every programme taught
      // there, in this year and in the archived ones alike.
      await client.query(`UPDATE teaching_locations SET name = $2 WHERE name = $1`, [from, to])

      const { rows: programmes } = await client.query<{
        id: string
        level: string
        form_of_study: string
        specialisation: string
        language: string
        location: string
      }>(
        `SELECT id, level, form_of_study, specialisation, language, location
           FROM study_programmes WHERE location = $1`,
        [to],
      )

      for (const p of programmes) {
        await client.query(`UPDATE study_programmes SET name = $2 WHERE id = $1`, [
          p.id,
          programmeTitle(p),
        ])
      }

      /* The copy on the student follows the rename, exactly as in 0024:
       * `users.specialization` is a denormalised copy of the display title and
       * six screens group and filter on it without a join, so leaving it would
       * show one cohort as two groups — under two spellings of one city. */
      const { rowCount: students } = await client.query(
        `UPDATE users u
            SET specialization = p.name
           FROM study_programmes p
          WHERE p.id = u.programme_id AND p.location = $1
            AND u.specialization IS DISTINCT FROM p.name`,
        [to],
      )

      return { programmes: programmes.length, students: students ?? 0 }
    })

    return back(
      `Centrul „${from}” se numește acum „${to}”. ` +
        (renamed.programmes === 0
          ? 'Niciun program de studiu nu se preda acolo.'
          : `${numar(renamed.programmes, 'program de studiu și-a', 'programe de studiu și-au')} recompus denumirea` +
            (renamed.students > 0
              ? `, iar ${numar(renamed.students, 'student a fost trecut', 'studenți au fost trecuți')} pe denumirea nouă.`
              : '.')),
    )
  }

  /* A centre opened by mistake has to be closable, or the list only ever grows
   * and the typo stays in it forever. Only one that no programme names: the
   * foreign key refuses the rest, and the message says which programmes hold
   * it rather than letting the database answer with a constraint name. */
  if (action === 'sterge_centru') {
    const name = normalizeLocation(form.get('centru'))

    const used = await query<{ name: string }>(
      `SELECT p.name FROM study_programmes p WHERE p.location = $1 ORDER BY p.name LIMIT 3`,
      [name],
    )
    if (used.length > 0) {
      return back(
        `Centrul „${name}” nu poate fi șters: se predau acolo programe de studiu (${used.map((p) => `„${p.name}”`).join(', ')}). Mută programele în alt centru sau dezactivează-le mai întâi.`,
        true,
      )
    }

    const n = await execute(`DELETE FROM teaching_locations WHERE name = $1`, [name])
    return back(n ? `Centrul „${name}” a fost șters.` : 'Centrul nu a fost găsit.', !n)
  }

  if (action === 'comuta_program') {
    const id = formId(form.get('program_id'))
    const n = await execute(
      `UPDATE study_programmes SET is_active = NOT is_active
        WHERE id = $1 AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
      [id],
    )
    return back(n ? 'Programul a fost actualizat.' : 'Programul nu a fost găsit.', !n)
  }

  /* --- historical import ---------------------------------------------------- */

  if (action === 'importa') {
    const yearId = formId(form.get('an_id'))
    const raw = String(form.get('randuri') ?? '').trim()

    const year = await queryOne<{ label: string }>(`SELECT label FROM academic_years WHERE id = $1`, [
      yearId,
    ])
    if (!year) return back('Alege anul universitar în care se importă.', true)
    if (!raw) return back('Lipsesc rândurile de importat.', true)

    /* The same parse as in the preview.
     *
     * Pasting is deliberately a text box, not a file: the source is almost
     * always a selection of columns out of the spreadsheet, and pasting spares
     * the export–upload trip.
     *
     * What the preview showed is not to be trusted — the submitted text is
     * parsed again here, with the same function, so the two cannot drift
     * apart. */
    const { accepted, rejected: rejectedRows } = parseArchiveRows(raw)
    const rejectedMessages = rejectedRows.map((r) => `rândul ${r.numar}: ${r.reason}`)

    if (accepted.length === 0) {
      return back(
        `Niciun rând nu a putut fi importat. ${rejectedMessages.slice(0, 3).join('; ')}${rejectedMessages.length > 3 ? `; și încă ${rejectedMessages.length - 3}` : ''}.`,
        true,
      )
    }

    // A single transaction: if something fails on the last row, nothing is
    // left half-done in the public archive.
    const imported = await transaction(async (client) => {
      let n = 0
      for (const r of accepted) {
        const { rowCount } = await client.query(
          `INSERT INTO archive_entries (academic_year_id, student_name, student_number, programme,
                                        level, language, teacher_name, title_ro, defended_on, created_by)
           SELECT $1, $2, NULLIF($3, ''), NULLIF($4, ''),
                  $5,
                  NULLIF($6, ''), $7, $8, NULLIF($9, '')::date, $10
            WHERE NOT EXISTS (
              SELECT 1 FROM archive_entries
               WHERE academic_year_id = $1 AND student_name = $2 AND title_ro = $8
            )`,
          [
            yearId, r.studentName, r.studentNumber, r.programme, parseArchiveLevel(r.level), r.language,
            r.teacherName, r.title, r.defended, u!.id,
          ],
        )
        n += rowCount ?? 0
      }
      return n
    })

    const duplicate = accepted.length - imported

    return back(
      `${imported} ${imported === 1 ? 'înregistrare importată' : 'înregistrări importate'} în ${year.label}.` +
        (duplicate > 0 ? ` ${duplicate} ${duplicate === 1 ? 'exista deja' : 'existau deja'}.` : '') +
        (rejectedMessages.length > 0
          ? ` ${rejectedMessages.length} ${rejectedMessages.length === 1 ? 'rând respins' : 'rânduri respinse'} — ${rejectedMessages.slice(0, 3).join('; ')}${rejectedMessages.length > 3 ? '; …' : ''}.`
          : ''),
      imported === 0 || rejectedMessages.length > 0,
    )
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
