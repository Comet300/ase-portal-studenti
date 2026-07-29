import type { APIRoute } from 'astro'
import { isDepartmentHead } from '../../lib/auth'
import { execute, queryOne, transaction } from '../../lib/db'
import { redirectWithNotice } from '../../lib/http'
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
  if (!isDepartmentHead(u)) return new Response('Pagina nu a fost găsită', { status: 404 })

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

    await openYear(label, startsOn, endsOn, {
      copyStages: form.get('preia_etape') === 'da',
      copyTopics: form.get('preia_teme') === 'da',
      copyProgrammes: form.get('preia_programe') === 'da',
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

    // Deliberately a paste box, not a file upload: the source is almost always a
    // spreadsheet column selection, and a paste skips the export-and-upload
    // round trip. Separator is the semicolon, because Romanian names and titles
    // contain commas far more often than semicolons.
    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(';').map((cell) => cell.trim()))

    /* Totul se verifică înainte ca ceva să se scrie.
     *
     * Rândurile intrau unul câte unul, fără tranzacție, iar data trecea direct
     * prin `::date` fără nicio validare: un „iulie 2024” într-un rând de la
     * mijloc arunca o eroare 500 cu corp gol, după ce rândurile de dinaintea lui
     * erau deja definitive — și rămâneau vizibile în arhiva publică. Directorul
     * nu primea nici mesaj, nici număr, nici vreun fel de a ști ce a intrat. */
    const bune: {
      studentName: string
      studentNumber: string
      programme: string
      level: string
      language: string
      teacherName: string
      title: string
      defended: string
    }[] = []
    const respinse: string[] = []

    for (const [index, cells] of rows.entries()) {
      const [studentName, studentNumber, programme, level, language, teacherName, title, defended] = cells
      const nr = index + 1

      if (!studentName || !teacherName || !title) {
        respinse.push(`rândul ${nr}: lipsește studentul, coordonatorul sau titlul`)
        continue
      }

      const data = (defended ?? '').trim()
      // Doar ISO: „iulie 2024” nu este o dată pentru Postgres, iar `::date`
      // ridica excepția abia în mijlocul importului.
      if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        respinse.push(`rândul ${nr}: data „${data}” nu este în formatul AAAA-LL-ZZ`)
        continue
      }
      if (data && Number.isNaN(new Date(data).getTime())) {
        respinse.push(`rândul ${nr}: data „${data}” nu există în calendar`)
        continue
      }

      bune.push({
        studentName,
        studentNumber: studentNumber ?? '',
        programme: programme ?? '',
        level: level ?? '',
        language: language ?? '',
        teacherName,
        title,
        defended: data,
      })
    }

    if (bune.length === 0) {
      return back(
        `Niciun rând nu a putut fi importat. ${respinse.slice(0, 3).join('; ')}${respinse.length > 3 ? `; și încă ${respinse.length - 3}` : ''}.`,
        true,
      )
    }

    // O singură tranzacție: dacă pică ceva la ultimul rând, nu rămâne nimic pe
    // jumătate în arhiva publică.
    const imported = await transaction(async (client) => {
      let n = 0
      for (const r of bune) {
        const { rowCount } = await client.query(
          `INSERT INTO archive_entries (academic_year_id, student_name, student_number, programme,
                                        level, language, teacher_name, title_ro, defended_on, created_by)
           SELECT $1, $2, NULLIF($3, ''), NULLIF($4, ''),
                  CASE WHEN lower($5) IN ('master', 'm') THEN 'master' ELSE 'bachelor' END,
                  NULLIF($6, ''), $7, $8, NULLIF($9, '')::date, $10
            WHERE NOT EXISTS (
              SELECT 1 FROM archive_entries
               WHERE academic_year_id = $1 AND student_name = $2 AND title_ro = $8
            )`,
          [
            yearId, r.studentName, r.studentNumber, r.programme, r.level, r.language,
            r.teacherName, r.title, r.defended, u!.id,
          ],
        )
        n += rowCount ?? 0
      }
      return n
    })

    const duplicate = bune.length - imported

    return back(
      `${imported} ${imported === 1 ? 'înregistrare importată' : 'înregistrări importate'} în ${year.label}.` +
        (duplicate > 0 ? ` ${duplicate} ${duplicate === 1 ? 'exista deja' : 'existau deja'}.` : '') +
        (respinse.length > 0
          ? ` ${respinse.length} ${respinse.length === 1 ? 'rând respins' : 'rânduri respinse'} — ${respinse.slice(0, 3).join('; ')}${respinse.length > 3 ? '; …' : ''}.`
          : ''),
      imported === 0 || respinse.length > 0,
    )
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
