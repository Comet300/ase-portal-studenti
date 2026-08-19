import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, queryOne, transaction } from '../../lib/db'
import { deadEnd, redirectWithNotice } from '../../lib/http'
import { parseArchiveRows, parseArchiveLevel } from '../../lib/archive'
import { formAction } from '../../lib/forms'
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

    return back(`Anul ${label} este deschis. Sesiunea anterioară a trecut în arhivă.`)
  }

  if (action === 'adauga_program') {
    const level = String(form.get('nivel') ?? '')
    const name = String(form.get('denumire') ?? '').trim()
    const language = String(form.get('limba') ?? 'ro')
    const years = Number(form.get('durata') ?? 3)

    if (!['bachelor', 'master'].includes(level)) return back('Nivel invalid.', true)
    if (!['ro', 'en', 'fr', 'de'].includes(language)) return back('Limbă invalidă.', true)
    if (!name) return back('Denumirea programului este obligatorie.', true)

    await execute(
      `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years)
       VALUES ((SELECT id FROM academic_years WHERE is_current), $1, $2, $3, $4)
       ON CONFLICT (academic_year_id, level, name, language)
       DO UPDATE SET duration_years = EXCLUDED.duration_years, is_active = true`,
      [level, name, language, Math.min(6, Math.max(1, Math.trunc(years) || 3))],
    )

    return back(`Programul „${name}” a fost adăugat.`)
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
