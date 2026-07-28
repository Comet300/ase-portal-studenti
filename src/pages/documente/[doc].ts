import type { APIRoute } from 'astro'
import { query } from '../../lib/db'
import { renderDoc } from '../../lib/doc'
import { stagesIcs } from '../../lib/ics'
import { currentYearLabel } from '../../lib/years'
import { escapeHtml } from '../../lib/mail'

/**
 * Downloadable documents are generated here rather than served as static files.
 *
 * These are the blank models — the ones a student prints before there is
 * anything to fill them with. The completed coordination request lives at
 * `/documente/cerere/[id]`, because it can only exist once a decision has.
 *
 * The calendar is built from the stages in the database: change a date in the
 * portal and tomorrow's download already carries it.
 */

export const GET: APIRoute = async ({ params, locals }) => {
  const u = locals.user
  const doc = params.doc

  if (doc === 'calendar-sesiune.ics') {
    const stages = await query<{
      title: string
      description: string | null
      starts_on: string | null
      ends_on: string | null
    }>(
      `SELECT title, description, starts_on, ends_on
         FROM session_stages
        WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        ORDER BY position`,
    )

    return new Response(stagesIcs(stages, await currentYearLabel()), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="calendar-sesiune.ics"',
      },
    })
  }

  // Templates pre-fill for a signed-in user; a visitor gets blanks to complete.
  const name = u ? escapeHtml(u.name) : ''
  const studentNumber = u?.student_number ? escapeHtml(u.student_number) : ''
  const program = u?.program === 'master' ? 'master' : 'licență'
  const specialization = u?.specialization ? escapeHtml(u.specialization) : ''
  const fill = (v: string) => (v ? `<strong>${v}</strong>` : '<span class="blank">&nbsp;</span>')

  if (doc === 'model-cerere-coordonare.html') {
    return new Response(
      renderDoc(
        'Model — Cerere de coordonare',
        `<h1>CERERE DE COORDONARE A LUCRĂRII DE FINALIZARE A STUDIILOR</h1>
         <p style="text-align:center;font-size:10pt;color:#40464e">Se depune electronic, prin Portalul Studenți</p>
         <p style="margin-top:24pt">Domnule/Doamnă Decan,</p>
         <p>Subsemnatul(a) ${fill(name)}, student(ă) în anul ${fill('')} la programul de studii
         ${fill(program)}, specializarea ${fill(specialization)}, număr matricol ${fill(studentNumber)},
         vă rog să aprobați coordonarea lucrării mele de finalizare a studiilor de către ${fill('')}.</p>
         <h2>Titlul propus al lucrării</h2>
         <p>În limba română: ${fill('')}</p>
         <p>În limba engleză: ${fill('')}</p>
         <h2>Scopul și obiectivele lucrării</h2>
         <p>Se descriu direcția generală a cercetării, problema abordată și minimum trei obiective:</p>
         <p style="min-height:4cm;border:1px dotted #5b6169;padding:8pt">&nbsp;</p>
         <div class="signatures"><span>Data: ${fill('')}</span><span>Semnătura: ${fill('')}</span></div>
         <p class="note">Model informativ. Cererea oficială se depune în portal, la „Cererile mele”,
         unde primește automat un număr de înregistrare.</p>`,
      ),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  if (doc === 'declaratie-originalitate.html') {
    return new Response(
      renderDoc(
        'Declarație de originalitate',
        `<h1>DECLARAȚIE DE ORIGINALITATE</h1>
         <p style="margin-top:24pt">Subsemnatul(a) ${fill(name)}, număr matricol ${fill(studentNumber)},
         absolvent(ă) al/a programului de studii ${fill(program)}, specializarea ${fill(specialization)},
         declar pe propria răspundere că lucrarea cu titlul:</p>
         <p style="text-align:center;margin:16pt 0">${fill('')}</p>
         <p>elaborată sub coordonarea ${fill('')}, este rezultatul muncii mele personale.</p>
         <p>Declar că:</p>
         <ol>
           <li>lucrarea nu a mai fost prezentată în cadrul altui program de studii;</li>
           <li>toate sursele utilizate, inclusiv cele preluate din internet, sunt indicate în lucrare,
               cu respectarea regulilor de citare;</li>
           <li>rezultatele cercetării proprii sunt prezentate fără modificări care le-ar denatura
               înțelesul;</li>
           <li>am respectat regulamentul privind utilizarea instrumentelor de inteligență artificială
               și am declarat orice utilizare a acestora.</li>
         </ol>
         <p>Am luat cunoștință că lucrarea va fi verificată cu un instrument antiplagiat și că
         nerespectarea celor declarate atrage anularea examenului de finalizare a studiilor.</p>
         <div class="signatures"><span>Data: ${fill('')}</span><span>Semnătura: ${fill('')}</span></div>`,
      ),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  if (doc === 'ghid-redactare.html') {
    return new Response(
      renderDoc(
        'Ghid de redactare',
        `<h1>GHID DE REDACTARE A LUCRĂRII DE FINALIZARE A STUDIILOR</h1>
         <h2>1. Structura lucrării</h2>
         <ol>
           <li>Copertă și pagină de titlu</li>
           <li>Declarație de originalitate</li>
           <li>Cuprins</li>
           <li>Introducere — problema de cercetare, obiective, structura lucrării (2–3 pagini)</li>
           <li>Capitolul teoretic — sinteza literaturii, cadrul conceptual</li>
           <li>Capitolul metodologic — design, instrument, eșantion, procedură</li>
           <li>Capitolul empiric — rezultate și interpretare</li>
           <li>Concluzii, limite și direcții viitoare</li>
           <li>Bibliografie</li>
           <li>Anexe</li>
         </ol>
         <h2>2. Formatare</h2>
         <ul>
           <li>Format A4, margini: 2,5 cm sus/jos, 3 cm stânga, 2 cm dreapta</li>
           <li>Times New Roman 12 pt, spațiere 1,5 rânduri, aliniere justify</li>
           <li>Titluri de capitol: 14 pt bold; subcapitole: 12 pt bold</li>
           <li>Numerotarea paginilor: jos, centrat, începând cu introducerea</li>
           <li>Întindere recomandată: 40–60 pagini (licență), 60–80 pagini (master), fără anexe</li>
         </ul>
         <h2>3. Citare</h2>
         <p>Se folosește stilul APA (ediția a 7-a), consecvent în tot textul. Fiecare sursă citată în
         text apare în bibliografie și invers. Citările directe de peste 40 de cuvinte se formatează
         ca bloc indentat.</p>
         <h2>4. Tabele și figuri</h2>
         <p>Se numerotează separat și continuu, au titlu deasupra (tabele) sau sub (figuri) și indică
         sursa. Figurile preluate se citează ca orice altă sursă.</p>
         <h2>5. Predare</h2>
         <p>Lucrarea se încarcă în portal în format PDF, împreună cu declarația de originalitate
         semnată, până la termenul din calendarul sesiunii.</p>`,
      ),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  return new Response('Documentul nu a fost găsit', { status: 404 })
}
