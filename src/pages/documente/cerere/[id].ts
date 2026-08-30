import type { APIRoute } from 'astro'
import { queryOne } from '../../../lib/db'
import { renderDoc } from '../../../lib/doc'
import { id as routeId } from '../../../lib/ids'
import { escapeHtml } from '../../../lib/mail'
import { formatDate, requestTitleChanges } from '../../../lib/repo'
import { officialName } from '../../../lib/text'
import { languageLabel, levelLabel } from '../../../lib/years'

/**
 * The signed coordination request, filled in from what the portal already knows.
 *
 * Produced only for an approved request, because that is the document the
 * faculty files: a printed record of a decision that has been taken, not a form
 * to fill in. The reader must be one of the three people it concerns — the
 * student, their coordinator, or the head of department — and the ownership
 * check is part of the query rather than a separate lookup.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const requestId = routeId(params.id ?? null)
  if (!requestId) return new Response('Documentul nu a fost găsit', { status: 404 })

  const r = await queryOne<{
    number: string
    title_ro: string
    title_en: string | null
    objectives: string
    motivation: string | null
    decided_at: string | null
    submitted_at: string
    student_name: string
    student_number: string | null
    father_initial: string | null
    program: string | null
    specialization: string | null
    study_year: number | null
    study_language: string
    study_series: string | null
    study_group: string | null
    teacher_name: string
    academic_title: string | null
    department: string | null
    year_label: string
  }>(
    `SELECT r.number, r.title_ro, r.title_en, r.objectives, r.motivation, r.decided_at, r.submitted_at,
            s.name AS student_name, s.student_number, s.father_initial,
            s.program, s.specialization,
            s.study_year, s.study_language, s.study_series, s.study_group,
            t.name AS teacher_name, t.academic_title, t.department,
            y.label AS year_label
       FROM requests r
       JOIN users s ON s.id = r.student_id
       JOIN users t ON t.id = r.teacher_id
       JOIN academic_years y ON y.id = r.academic_year_id
      WHERE r.id = $1
        AND r.status = 'approved'
        AND ($2 IN (r.student_id, r.teacher_id) OR $3 = 'head')`,
    [requestId, u.id, u.role],
  )

  if (!r) return new Response('Documentul nu a fost găsit', { status: 404 })

  /* The document is regenerated from live data every time it is asked for, and
   * the title can now change after the coordination was agreed. So a copy
   * printed in October and one printed in March can carry two different titles
   * for the same request number, with the first already signed and filed at the
   * secretariat. The sheet says so itself rather than leaving the registry to
   * discover it. */
  const changes = await requestTitleChanges(requestId)

  const e = escapeHtml
  const row = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`

  /* The name the secretariat matches against the register — „Popescu I. Maria”.
   * The document used to print `users.name`, without the father's initial, and
   * a request that does not carry it is a request that comes back from the
   * counter. */
  const studentName = officialName({ name: r.student_name, father_initial: r.father_initial })

  return new Response(
    renderDoc(
      `Cerere de coordonare ${r.number}`,
      `<h1>CERERE DE COORDONARE A LUCRĂRII DE FINALIZARE A STUDIILOR</h1>
       <p style="text-align:center;font-size:10pt;color:#40464e">
         Nr. ${e(r.number)} · Sesiunea ${e(r.year_label)} · Aprobată la ${formatDate(r.decided_at)}
       </p>

       <p style="margin-top:24pt">Domnule/Doamnă Decan,</p>
       <p>Subsemnatul(a) <strong>${e(studentName)}</strong>, student(ă) în anul
       <strong>${r.study_year ?? '—'}</strong> la programul de studii de
       <strong>${levelLabel(r.program).toLowerCase()}</strong>, specializarea
       <strong>${e(r.specialization ?? '—')}</strong>, limba de studiu
       <strong>${languageLabel(r.study_language).toLowerCase()}</strong>, seria
       <strong>${e(r.study_series ?? '—')}</strong>, grupa
       <strong>${e(r.study_group ?? '—')}</strong>, număr matricol
       <strong>${e(r.student_number ?? '—')}</strong>, vă rog să aprobați coordonarea lucrării mele
       de finalizare a studiilor de către <strong>${e(r.teacher_name)}</strong>.</p>

       <dl class="record">
         ${row('Coordonator științific', e(r.teacher_name))}
         ${row('Departament', e(r.department ?? '—'))}
         ${row('Titlul lucrării (RO)', e(r.title_ro))}
         ${row('Titlul lucrării (EN)', e(r.title_en ?? '—'))}
         ${row('Cerere depusă la', formatDate(r.submitted_at))}
         ${row('Cerere aprobată la', formatDate(r.decided_at))}
       </dl>

       <h2>Scopul și obiectivele lucrării</h2>
       <div class="box">${e(r.objectives).replace(/\n/g, '<br>')}</div>

       ${
         r.motivation
           ? `<h2>Motivarea alegerii temei</h2>
              <div class="box">${e(r.motivation).replace(/\n/g, '<br>')}</div>`
           : ''
       }

       <div class="signatures">
         <span>Semnătura studentului: <span class="blank">&nbsp;</span></span>
         <span>Semnătura coordonatorului: <span class="blank">&nbsp;</span></span>
       </div>
       <div class="signatures"><span>Data: <span class="blank">&nbsp;</span></span></div>

       ${
         changes.length > 0
           ? `<p class="note"><strong>Titlul lucrării a fost modificat după aprobarea cererii.</strong>
              Documentul de mai sus poartă titlul în vigoare la data tipăririi. Dacă un exemplar
              semnat a fost deja depus la secretariat, el trebuie înlocuit cu acesta.</p>
              <dl class="record">${changes
                .map(
                  (c) =>
                    `<dt>${formatDate(c.decided_at ?? c.created_at)}</dt>
                     <dd>„${e(c.old_title_ro)}” → „${e(c.new_title_ro)}”${
                       c.by_teacher ? ' (modificare a coordonatorului)' : ' (la cererea studentului)'
                     }</dd>`,
                )
                .join('')}</dl>`
           : ''
       }

       <p class="note">Document generat automat din Portalul Studenți pe baza cererii înregistrate
       electronic. Se tipărește, se semnează de ambele părți și se depune la secretariatul
       facultății.</p>`,
      `Cererea ${r.number} · ${studentName}`,
    ),
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}
