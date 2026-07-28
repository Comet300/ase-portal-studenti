#!/usr/bin/env node
/**
 * Date demonstrative — fictive, în limba română.
 *
 * Idempotent: rulează la fiecare pornire fără să dubleze nimic. Conturile sunt
 * identificate prin email, restul entităților prin combinații naturale, deci o
 * a doua rulare nu adaugă rânduri.
 */

import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL nu este setat')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

const q = (sql, params = []) => client.query(sql, params)

/* --- etapele sesiunii ------------------------------------------------------
 * Anchored to the current date rather than to fixed 2026 dates: a demo opened
 * after a hard-coded session had ended showed every stage as încheiată and no
 * stage in curs, which is exactly the state the portal is meant to make legible.
 * Offsets are in months, relative to today; labels are derived from the dates so
 * the two can never disagree.
 */

const MONTH_NAMES = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

const monthsFromNow = (n, day) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

const label = (from, to) => {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const cap = (w) => w[0].toUpperCase() + w.slice(1)
  if (fy === ty && fm === tm) return `${cap(MONTH_NAMES[fm - 1])} ${fy}`
  if (fy === ty) return `${cap(MONTH_NAMES[fm - 1])} – ${MONTH_NAMES[tm - 1]} ${fy}`
  return `${cap(MONTH_NAMES[fm - 1])} ${fy} – ${MONTH_NAMES[tm - 1]} ${ty}`
}

// The session runs from nine months ago to three months out, which puts today
// inside "Elaborare și consultații".
const STAGE_SPANS = [
  ['Alegere coordonator', 'Depunerea cererilor către cadrele didactice și confirmarea temei.', -9, 1, -4, 28],
  ['Elaborare și consultații', 'Redactarea lucrării, consultații periodice cu coordonatorul.', -3, 1, 1, 15],
  ['Înscriere examen', 'Depunerea dosarului de înscriere la secretariat.', 1, 4, 1, 29],
  ['Încărcare antiplagiat', 'Verificarea lucrării în platforma antiplagiat.', 2, 1, 2, 19],
  ['Susținere publică', 'Prezentarea lucrării în fața comisiei.', 3, 1, 3, 10],
]

const STAGES = STAGE_SPANS.map(([title, description, fromM, fromD, toM, toD]) => {
  const from = monthsFromNow(fromM, fromD)
  const to = monthsFromNow(toM, toD)
  return [title, description, label(from, to), from, to]
})

/* --- cadre didactice ------------------------------------------------------- */

const TEACHERS = [
  ['Prof. univ. dr. Mihaela Ionescu', 'mihaela.ionescu@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2314', 8, 5, true],
  ['Conf. univ. dr. Cristian Vasile', 'cristian.vasile@ase.ro', 'Marketing', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1108', 6, 4, false],
  ['Lect. univ. dr. Simona Radu', 'simona.radu@ase.ro', 'Marketing', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2210', 6, 3, false],
  ['Prof. univ. dr. Andrei Popescu', 'andrei.popescu@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2401', 5, 5, false],
  ['Conf. univ. dr. Elena Dumitrescu', 'elena.dumitrescu@ase.ro', 'Comunicare de marketing', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1204', 7, 4, false],
  ['Lect. univ. dr. Bogdan Marinescu', 'bogdan.marinescu@ase.ro', 'Cercetări de marketing', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2118', 5, 3, false],
  ['Conf. univ. dr. Alina Georgescu', 'alina.georgescu@ase.ro', 'Marketing digital', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1301', 8, 6, false],
  ['Lect. univ. dr. Radu Stoica', 'radu.stoica@ase.ro', 'Marketing internațional', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2205', 4, 4, false],
]

const HEAD = ['Prof. univ. dr. Daniela Constantin', 'daniela.constantin@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2301', 4, 3, true]

/* --- studenți -------------------------------------------------------------- */

const STUDENT_NAMES = [
  'Dan Marinescu', 'Elena Popescu', 'Andrei Vasilescu', 'Ioana Dumitru', 'Mihai Stoica',
  'Andreea Barbu', 'Radu Gheorghe', 'Cristina Neagu', 'Alexandru Munteanu', 'Diana Preda',
  'Ștefan Ilie', 'Raluca Sandu', 'Vlad Petrescu', 'Bianca Toma', 'George Ionescu',
  'Maria Lungu', 'Cătălin Enache', 'Roxana Dinu', 'Paul Nistor', 'Alexandra Iordache',
  'Sorin Bălan', 'Teodora Rusu', 'Adrian Costache', 'Gabriela Matei',
]

const BACHELOR_TRACKS = ['Marketing', 'Marketing (engleză)']
const MASTER_TRACKS = ['Marketing strategic', 'Cercetări de marketing', 'Marketing digital']

/* --- teme ------------------------------------------------------------------ */

const TOPICS = [
  ['Comportamentul consumatorului în comerțul electronic românesc', 'bachelor', 'Cantitativă, SPSS, modelare structurală', 'Marketing cantitativ, nota minimă 8', 3],
  ['Transformarea digitală a strategiilor B2B', 'master', 'Studii de caz multiple, interviuri semi-structurate', 'Management strategic', 2],
  ['Credibilitatea influencerilor și decizia de cumpărare la generația Z', 'bachelor', 'Chestionar online, analiză factorială', 'Statistică descriptivă', 4],
  ['Marketingul sustenabil în industria FMCG', 'bachelor', 'Analiză de conținut, interviuri', '—', 3],
  ['Personalizarea prin inteligență artificială în retail', 'master', 'Experiment, A/B testing', 'Marketing digital', 2],
  ['Loialitatea față de brand în serviciile bancare', 'bachelor', 'Sondaj, regresie logistică', 'Statistică aplicată', 3],
  ['Comunicarea de criză pe rețelele sociale', 'master', 'Netnografie, analiză tematică', 'Comunicare de marketing', 2],
  ['Prețul de referință intern și percepția valorii', 'bachelor', 'Experiment de laborator', 'Comportamentul consumatorului', 2],
  ['Marketingul experiențial în turismul cultural', 'master', 'Observație participativă, interviuri', '—', 2],
  ['Adopția plăților contactless în mediul rural', 'bachelor', 'Sondaj față în față, analiză descriptivă', '—', 3],
  ['Strategii de internaționalizare pentru IMM-uri românești', 'master', 'Studii de caz comparative', 'Marketing internațional', 2],
  ['Impactul recenziilor online asupra vânzărilor', 'bachelor', 'Analiză de date secundare, regresie', 'Econometrie', 3],
]

const REQUEST_TITLES = [
  ['Impactul inteligenței artificiale în strategiile de personalizare', 'The impact of artificial intelligence on personalisation strategies'],
  ['Strategii de comunicare digitală pentru branduri locale', 'Digital communication strategies for local brands'],
  ['Analiza comportamentului de cumpărare în magazinele online', 'Analysis of purchasing behaviour in online stores'],
  ['Rolul ambalajului sustenabil în decizia de achiziție', 'The role of sustainable packaging in purchase decisions'],
  ['Marketingul de conținut în industria serviciilor financiare', 'Content marketing in the financial services industry'],
  ['Fidelizarea clienților prin programe de recompense digitale', 'Customer loyalty through digital reward programmes'],
  ['Percepția consumatorilor asupra brandurilor românești', 'Consumer perception of Romanian brands'],
  ['Optimizarea experienței utilizatorului în aplicațiile de retail', 'User experience optimisation in retail applications'],
  ['Influența recenziilor video asupra intenției de cumpărare', 'The influence of video reviews on purchase intention'],
  ['Segmentarea pieței pe baza datelor comportamentale', 'Market segmentation based on behavioural data'],
  ['Comunicarea valorilor de brand către generația Z', 'Communicating brand values to generation Z'],
  ['Eficiența campaniilor de retargeting în e-commerce', 'The effectiveness of retargeting campaigns in e-commerce'],
]

const OBJECTIVES = `Lucrarea își propune să analizeze modul în care factorii identificați influențează decizia consumatorului pe piața din România. Obiectivele urmărite sunt: (1) delimitarea conceptuală a fenomenului studiat pe baza literaturii recente; (2) identificarea factorilor determinanți printr-o cercetare cantitativă pe un eșantion de minimum 200 de respondenți; (3) formularea unor recomandări aplicabile pentru companiile care activează în sectorul analizat.`

const MILESTONES = [
  ['Stabilirea temei și a bibliografiei', 'Temă aprobată, minimum 20 de titluri bibliografice.', 0],
  ['Capitolul teoretic', 'Sinteza literaturii de specialitate, cadrul conceptual.', 1],
  ['Metodologia cercetării', 'Instrument de cercetare validat, eșantion stabilit.', 2],
  ['Colectarea și analiza datelor', 'Date colectate, prelucrare statistică finalizată.', 3],
  ['Predarea formei finale', 'Lucrare completă, verificare antiplagiat.', 4],
]

const DEMO_MESSAGES = [
  ['student', 'Bună ziua, doamna profesoară! Am actualizat capitolul de analiză cantitativă conform discuției de săptămâna trecută. Aș dori să vă întreb dacă metodologia corespunde cerințelor pentru sesiunea 2026.'],
  ['teacher', 'Bună ziua! Am primit notificarea, voi parcurge materialul până joi. Vă rog să încărcați și fișierul cu rezultatele SPSS pentru verificare.'],
  ['student', 'Am încărcat fișierul. Am folosit un eșantion de 214 respondenți, iar alfa Cronbach este 0,87 pentru scala principală.'],
  ['teacher', 'Foarte bine. Alfa este în limite acceptabile. Ne vedem la consultația de marți ca să discutăm interpretarea rezultatelor.'],
]

/* --- inserare -------------------------------------------------------------- */

console.log('[seed] pornit')

// Etape
for (const [i, [titlu, descriere, interval, di, ds]] of STAGES.entries()) {
  await q(
    `INSERT INTO session_stages (position, title, description, interval_label, starts_on, ends_on)
     SELECT $1, $2, $3, $4, $5::date, $6::date
      WHERE NOT EXISTS (SELECT 1 FROM session_stages WHERE position = $1)`,
    [i + 1, titlu, descriere, interval, di, ds],
  )
}

async function upsertUser(campuri) {
  const { rows } = await q(
    `INSERT INTO users (email, name, role, student_number, program, specialization, study_year,
                              academic_title, department, office, bachelor_capacity, master_capacity, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    campuri,
  )
  return rows[0].id
}

// Cadre didactice
const teacherIds = []
for (const [nume, email, dep, titlu, birou, capL, capM, demo] of TEACHERS) {
  teacherIds.push(
    await upsertUser([email, nume, 'teacher', null, null, null, null, titlu, dep, birou, capL, capM, demo]),
  )
}

const [numeD, emailD, depD, titluD, birouD, capLD, capMD] = HEAD
const headId = await upsertUser([emailD, numeD, 'head', null, null, null, null, titluD, depD, birouD, capLD, capMD, true])

// Studenți
const studentIds = []
for (const [i, nume] of STUDENT_NAMES.entries()) {
  const eMaster = i % 3 === 2
  const program = eMaster ? 'master' : 'bachelor'
  const specializare = eMaster
    ? MASTER_TRACKS[i % MASTER_TRACKS.length]
    : BACHELOR_TRACKS[i % BACHELOR_TRACKS.length]
  const email = `${nume.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}@stud.ase.ro`
  studentIds.push(
    await upsertUser([
      email, nume, 'student',
      `MK-2026-${String(i + 1).padStart(4, '0')}`,
      program, specializare, eMaster ? 2 : 3,
      null, 'Marketing', null, 0, 0,
      i === 0, // primul student este cont demo
    ]),
  )
}

// Teme
for (const [i, [titlu, nivel, metode, prereq, locuri]] of TOPICS.entries()) {
  const profesorId = teacherIds[i % teacherIds.length]
  await q(
    `INSERT INTO topics (teacher_id, title, description, level, methods, prerequisites, seats)
     SELECT $1,$2,$3,$4,$5,$6,$7
      WHERE NOT EXISTS (SELECT 1 FROM topics WHERE teacher_id = $1 AND title = $2)`,
    [profesorId, titlu, `Direcție de cercetare propusă pentru sesiunea 2026. ${metode}.`, nivel, metode, prereq, locuri],
  )
}

// Cereri — distribuite pe stări, majoritatea către primul profesor (contul demo)
const STATES = ['pending', 'approved', 'approved', 'rejected', 'pending', 'approved']
for (const [i, studentId] of studentIds.entries()) {
  const [titluRo, titluEn] = REQUEST_TITLES[i % REQUEST_TITLES.length]
  const status = STATES[i % STATES.length]
  // Primii 10 studenți merg la profesorul demo, ca dashboardul lui să aibă conținut.
  const profesorId = i < 10 ? teacherIds[0] : teacherIds[i % teacherIds.length]
  const numar = `CRR-2026-${String(i + 1).padStart(4, '0')}`

  const { rows } = await q(
    `INSERT INTO requests (number, student_id, teacher_id, title_ro, title_en, objectives, status,
                         rejection_reason, submitted_at, decided_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' days')::interval,
            CASE WHEN $7 = 'pending' THEN NULL ELSE now() - ($10 || ' days')::interval END
      WHERE NOT EXISTS (SELECT 1 FROM requests WHERE number = $1)
     RETURNING id`,
    [
      numar, studentId, profesorId, titluRo, titluEn, OBJECTIVES, status,
      status === 'rejected'
        ? 'Tema propusă se suprapune cu o lucrare deja alocată. Vă rog să reformulați direcția de cercetare sau să alegeți una dintre temele propuse.'
        : null,
      String(30 - i), String(Math.max(1, 25 - i)),
    ],
  )

  // Jaloane pentru cererile aprobate
  if (rows[0] && status === 'approved') {
    const cerereId = rows[0].id
    for (const [j, [titlu, descriere, ordine]] of MILESTONES.entries()) {
      const stare = j === 0 ? 'done' : j === 1 ? (i % 2 === 0 ? 'done' : 'in_progress') : j === 2 ? 'in_progress' : 'planned'
      await q(
        `INSERT INTO milestones (request_id, title, description, due_on, status, position)
         VALUES ($1,$2,$3, (date '2026-01-15' + ($4 || ' days')::interval)::date, $5, $6)`,
        [cerereId, titlu, descriere, String(j * 45), stare, ordine],
      )
    }
  }
}

// Sloturi de consultații pentru profesorul demo și încă doi
for (const profesorId of [teacherIds[0], teacherIds[1], headId]) {
  for (let zi = 1; zi <= 14; zi += 2) {
    for (const ora of [14, 15]) {
      await q(
        `INSERT INTO consultation_slots (teacher_id, starts_at, ends_at, mode, location, capacity)
         SELECT $1,
                date_trunc('day', now() + ($2 || ' days')::interval) + ($3 || ' hours')::interval,
                date_trunc('day', now() + ($2 || ' days')::interval) + (($3::int + 1) || ' hours')::interval,
                'in_person', $4, 1
          WHERE NOT EXISTS (
            SELECT 1 FROM consultation_slots
             WHERE teacher_id = $1
               AND starts_at = date_trunc('day', now() + ($2 || ' days')::interval) + ($3 || ' hours')::interval
          )`,
        [profesorId, String(zi), String(ora), 'Corp Ion Angelescu, sala 2314'],
      )
    }
  }
}

// Conversații + mesaje pentru studenții aprobați ai profesorului demo
const { rows: approved } = await q(
  `SELECT student_id, teacher_id FROM requests WHERE status = 'approved' AND teacher_id = $1 LIMIT 6`,
  [teacherIds[0]],
)

for (const { student_id, teacher_id } of approved) {
  const { rows } = await q(
    `INSERT INTO conversations (student_id, teacher_id, last_message_at)
     VALUES ($1, $2, now())
     ON CONFLICT (student_id, teacher_id) DO NOTHING
     RETURNING id`,
    [student_id, teacher_id],
  )
  if (!rows[0]) continue
  const conversatieId = rows[0].id

  for (const [i, [role, body]] of DEMO_MESSAGES.entries()) {
    await q(
      `INSERT INTO messages (conversation_id, sender_id, body, read_at, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval)`,
      [
        conversatieId,
        role === 'student' ? student_id : teacher_id,
        body,
        i < DEMO_MESSAGES.length - 1 ? new Date().toISOString() : null,
        String((DEMO_MESSAGES.length - i) * 6),
      ],
    )
  }
  await q(`UPDATE conversations SET last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id = $1) WHERE id = $1`, [conversatieId])
}

/* --- connect the two demo accounts ---------------------------------------
 * The demo student and the demo teacher have to tell one complete story:
 * an approved request, a milestone timeline, a thread and bookable slots.
 * Without this the demo student signs in to an empty portal and the teacher's
 * consultation slots are invisible to them. Idempotent like the rest.
 */
const { rows: demoPair } = await q(
  `UPDATE requests r
      SET status = 'approved', decided_at = COALESCE(r.decided_at, now())
    FROM users s, users t
   WHERE r.student_id = s.id
     AND r.teacher_id = t.id
     AND s.is_demo = true AND s.role = 'student'
     AND t.is_demo = true AND t.role = 'teacher'
     AND r.status <> 'approved'
   RETURNING r.id, r.student_id, r.teacher_id`,
)

for (const r of demoPair) {
  const { rows: existing } = await q('SELECT 1 FROM milestones WHERE request_id = $1 LIMIT 1', [r.id])
  if (existing.length === 0) {
    for (const [j, [title, description]] of MILESTONES.entries()) {
      await q(
        `INSERT INTO milestones (request_id, title, description, due_on, status, position)
         VALUES ($1, $2, $3, (date '2026-01-15' + ($4 || ' days')::interval)::date, $5, $4::int)`,
        [r.id, title, description, String(j * 45), j === 0 ? 'done' : j === 1 ? 'in_progress' : 'planned'],
      )
    }
  }
  await q(
    `INSERT INTO conversations (student_id, teacher_id) VALUES ($1, $2)
     ON CONFLICT (student_id, teacher_id) DO NOTHING`,
    [r.student_id, r.teacher_id],
  )
  console.log(`[seed] demo pair linked (request ${r.id})`)
}

const { rows: [{ count: userCount }] } = await q('SELECT count(*)::int AS count FROM users')
const { rows: [{ count: requestCount }] } = await q('SELECT count(*)::int AS count FROM requests')
console.log(`[seed] done — ${userCount} users, ${requestCount} requests`)

await client.end()
