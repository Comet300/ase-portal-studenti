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
const one = async (sql, params = []) => (await q(sql, params)).rows[0]

/* --- anul universitar ------------------------------------------------------
 * Migrarea a creat deja anul curent. Seed-ul adaugă doi ani încheiați, ca
 * arhiva să aibă istoric — inclusiv un an dinaintea portalului, care nu are
 * cereri, ci doar înregistrări introduse de director.
 */

const currentYear = await one(`SELECT * FROM academic_years WHERE is_current`)
const startYear = Number(currentYear.label.split(/[–-]/)[0])

async function pastYear(offset) {
  const from = startYear - offset
  const label = `${from}–${from + 1}`
  return one(
    `INSERT INTO academic_years (label, starts_on, ends_on, is_current)
     VALUES ($1, make_date($2, 10, 1), make_date($3, 9, 30), false)
     ON CONFLICT (label) DO UPDATE SET label = EXCLUDED.label
     RETURNING *`,
    [label, from, from + 1],
  )
}

const lastYear = await pastYear(1)
const olderYear = await pastYear(2)

/* --- programe de studiu ---------------------------------------------------- */

const PROGRAMMES = [
  ['bachelor', 'Marketing', 'ro', 3],
  ['bachelor', 'Marketing', 'en', 3],
  ['master', 'Marketing strategic', 'ro', 2],
  ['master', 'Cercetări de marketing', 'ro', 2],
  ['master', 'Marketing digital', 'en', 2],
]

const programmeIds = new Map()
for (const [level, name, language, years] of PROGRAMMES) {
  const row = await one(
    `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (academic_year_id, level, name, language)
       DO UPDATE SET duration_years = EXCLUDED.duration_years
     RETURNING id`,
    [currentYear.id, level, name, language, years],
  )
  programmeIds.set(`${level}|${name}|${language}`, row.id)
}

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
  ['Prof. univ. dr. Mihaela Ionescu', 'mihaela.ionescu@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2314', 8, 5, true,
    'Coordonez lucrări la intersecția dintre comportamentul consumatorului și analiza cantitativă. Prefer teme cu date proprii, colectate de student.',
    'Comportamentul consumatorului · modelare structurală · marketing cantitativ'],
  ['Conf. univ. dr. Cristian Vasile', 'cristian.vasile@ase.ro', 'Marketing', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1108', 6, 4, false,
    'Lucrez cu studenți interesați de strategie și de piețe B2B. Aștept de la fiecare lucrare o problemă reală a unei companii, nu o temă de manual.',
    'Marketing B2B · strategie · studii de caz'],
  ['Lect. univ. dr. Simona Radu', 'simona.radu@ase.ro', 'Marketing', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2210', 6, 3, false,
    'Mă interesează comunicarea de brand și felul în care generațiile tinere își construiesc preferințele.',
    'Branding · generația Z · comunicare'],
  ['Prof. univ. dr. Andrei Popescu', 'andrei.popescu@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2401', 5, 5, false,
    'Coordonez lucrări de marketing al serviciilor și de măsurare a satisfacției. Consultațiile mele sunt săptămânale și obligatorii.',
    'Marketingul serviciilor · satisfacția clientului'],
  ['Conf. univ. dr. Elena Dumitrescu', 'elena.dumitrescu@ase.ro', 'Comunicare de marketing', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1204', 7, 4, false,
    'Comunicare de criză și reputație online. Accept teme care presupun analiză de conținut pe date recente.',
    'Comunicare de criză · reputație · analiză de conținut'],
  ['Lect. univ. dr. Bogdan Marinescu', 'bogdan.marinescu@ase.ro', 'Cercetări de marketing', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2118', 5, 3, false,
    'Cercetare de piață aplicată. Insist pe metodologie corectă: un eșantion prost ales nu se repară la interpretare.',
    'Cercetări de piață · eșantionare · SPSS'],
  ['Conf. univ. dr. Alina Georgescu', 'alina.georgescu@ase.ro', 'Marketing digital', 'Conf. univ. dr.', 'Corp Virgil Madgearu, sala 1301', 8, 6, false,
    'Marketing digital, performance și automatizare. Lucrez bine cu studenți care au acces la un cont real de campanii.',
    'Marketing digital · performance · automatizare'],
  ['Lect. univ. dr. Radu Stoica', 'radu.stoica@ase.ro', 'Marketing internațional', 'Lect. univ. dr.', 'Corp Ion Angelescu, sala 2205', 4, 4, false,
    'Internaționalizare și piețe emergente. Coordonez și lucrări redactate în limba engleză.',
    'Marketing internațional · piețe emergente'],
]

const HEAD = ['Prof. univ. dr. Daniela Constantin', 'daniela.constantin@ase.ro', 'Marketing', 'Prof. univ. dr.', 'Corp Ion Angelescu, sala 2301', 4, 3, true,
  'Director de departament. Coordonez un număr restrâns de lucrări, cu prioritate la programele de master.',
  'Politici de marketing · management academic']

/* --- studenți -------------------------------------------------------------- */

const STUDENT_NAMES = [
  'Dan Marinescu', 'Elena Popescu', 'Andrei Vasilescu', 'Ioana Dumitru', 'Mihai Stoica',
  'Andreea Barbu', 'Radu Gheorghe', 'Cristina Neagu', 'Alexandru Munteanu', 'Diana Preda',
  'Ștefan Ilie', 'Raluca Sandu', 'Vlad Petrescu', 'Bianca Toma', 'George Ionescu',
  'Maria Lungu', 'Cătălin Enache', 'Roxana Dinu', 'Paul Nistor', 'Alexandra Iordache',
  'Sorin Bălan', 'Teodora Rusu', 'Adrian Costache', 'Gabriela Matei',
]

/** Programul fiecărui student: [nivel, specializare, limbă, an]. */
const BACHELOR_GROUPS = [
  ['bachelor', 'Marketing', 'ro', 3],
  ['bachelor', 'Marketing', 'en', 3],
]
const MASTER_GROUPS = [
  ['master', 'Marketing strategic', 'ro', 2],
  ['master', 'Cercetări de marketing', 'ro', 2],
  ['master', 'Marketing digital', 'en', 2],
]

/* --- teme ------------------------------------------------------------------ */

const TOPICS = [
  ['Comportamentul consumatorului în comerțul electronic românesc', 'bachelor', 'ro', 'Cantitativă, SPSS, modelare structurală', 'Marketing cantitativ, nota minimă 8', 3],
  ['Transformarea digitală a strategiilor B2B', 'master', 'ro', 'Studii de caz multiple, interviuri semi-structurate', 'Management strategic', 2],
  ['Credibilitatea influencerilor și decizia de cumpărare la generația Z', 'bachelor', 'ro', 'Chestionar online, analiză factorială', 'Statistică descriptivă', 4],
  ['Marketingul sustenabil în industria FMCG', 'bachelor', 'ro', 'Analiză de conținut, interviuri', '—', 3],
  ['Personalizarea prin inteligență artificială în retail', 'master', 'en', 'Experiment, A/B testing', 'Marketing digital', 2],
  ['Loialitatea față de brand în serviciile bancare', 'bachelor', 'ro', 'Sondaj, regresie logistică', 'Statistică aplicată', 3],
  ['Comunicarea de criză pe rețelele sociale', 'master', 'ro', 'Netnografie, analiză tematică', 'Comunicare de marketing', 2],
  ['Prețul de referință intern și percepția valorii', 'bachelor', 'ro', 'Experiment de laborator', 'Comportamentul consumatorului', 2],
  ['Marketingul experiențial în turismul cultural', 'master', 'ro', 'Observație participativă, interviuri', '—', 2],
  ['Adopția plăților contactless în mediul rural', 'bachelor', 'ro', 'Sondaj față în față, analiză descriptivă', '—', 3],
  ['Strategii de internaționalizare pentru IMM-uri românești', 'master', 'ro', 'Studii de caz comparative', 'Marketing internațional', 2],
  ['Impactul recenziilor online asupra vânzărilor', 'bachelor', 'en', 'Analiză de date secundare, regresie', 'Econometrie', 3],
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

const MOTIVATIONS = [
  'Am ales această direcție pentru că lucrez de doi ani part-time într-o agenție de marketing digital și văd zilnic diferența dintre ce recomandă manualele și ce funcționează în campanii reale. Vreau să testez această diferență cu date.',
  'Tema mă interesează de la cursul de comportamentul consumatorului, unde am făcut un proiect pe același subiect și am rămas cu întrebări la care nu am apucat să răspund. Aș vrea să le duc până la capăt.',
  'Am acces la datele unei firme de familie din domeniu și la o bază de clienți dispusă să răspundă unui chestionar, ceea ce îmi permite o cercetare pe date primare, nu doar pe surse secundare.',
  'Vreau să continui pe această direcție și la master, iar lucrarea de licență este ocazia să îmi construiesc metodologia și bibliografia de care voi avea nevoie.',
]

const MILESTONES = [
  ['Stabilirea temei și a bibliografiei', 'Temă aprobată, minimum 20 de titluri bibliografice.', 0],
  ['Capitolul teoretic', 'Sinteza literaturii de specialitate, cadrul conceptual.', 1],
  ['Metodologia cercetării', 'Instrument de cercetare validat, eșantion stabilit.', 2],
  ['Colectarea și analiza datelor', 'Date colectate, prelucrare statistică finalizată.', 3],
  ['Predarea formei finale', 'Lucrare completă, verificare antiplagiat.', 4],
]

const DEMO_MESSAGES = [
  ['student', 'Bună ziua, doamna profesoară! Am actualizat capitolul de analiză cantitativă conform discuției de săptămâna trecută. Aș dori să vă întreb dacă metodologia corespunde cerințelor pentru sesiunea aceasta.'],
  ['teacher', 'Bună ziua! Am primit notificarea, voi parcurge materialul până joi. Vă rog să încărcați și fișierul cu rezultatele SPSS pentru verificare.'],
  ['student', 'Am încărcat fișierul. Am folosit un eșantion de 214 respondenți, iar alfa Cronbach este 0,87 pentru scala principală.'],
  ['teacher', 'Foarte bine. Alfa este în limite acceptabile. Ne vedem la consultația de marți ca să discutăm interpretarea rezultatelor.'],
]

/* --- inserare -------------------------------------------------------------- */

console.log('[seed] pornit')

// Etape
for (const [i, [titlu, descriere, interval, di, ds]] of STAGES.entries()) {
  await q(
    `INSERT INTO session_stages (academic_year_id, position, title, description, interval_label, starts_on, ends_on)
     SELECT $1, $2, $3, $4, $5, $6::date, $7::date
      WHERE NOT EXISTS (
        SELECT 1 FROM session_stages WHERE academic_year_id = $1 AND position = $2
      )`,
    [currentYear.id, i + 1, titlu, descriere, interval, di, ds],
  )
}

async function upsertUser(campuri) {
  const { rows } = await q(
    `INSERT INTO users (email, name, role, student_number, program, specialization, study_year,
                        programme_id, study_language, study_group,
                        academic_title, department, office, bio, interests, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       programme_id = EXCLUDED.programme_id,
       study_language = EXCLUDED.study_language,
       study_group = EXCLUDED.study_group,
       bio = COALESCE(users.bio, EXCLUDED.bio),
       interests = COALESCE(users.interests, EXCLUDED.interests)
     RETURNING id`,
    campuri,
  )
  return rows[0].id
}

// Cadre didactice
const teacherIds = []
for (const [nume, email, dep, titlu, birou, capL, capM, demo, bio, interese] of TEACHERS) {
  const id = await upsertUser([
    email, nume, 'teacher', null, null, null, null,
    null, 'ro', null,
    titlu, dep, birou, bio, interese, demo,
  ])
  teacherIds.push(id)
  await q(
    `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_seats, master_seats)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (teacher_id, academic_year_id) DO NOTHING`,
    [id, currentYear.id, capL, capM],
  )
}

const [numeD, emailD, depD, titluD, birouD, capLD, capMD, , bioD, intereseD] = HEAD
const headId = await upsertUser([
  emailD, numeD, 'head', null, null, null, null,
  null, 'ro', null,
  titluD, depD, birouD, bioD, intereseD, true,
])
await q(
  `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_seats, master_seats)
   VALUES ($1, $2, $3, $4) ON CONFLICT (teacher_id, academic_year_id) DO NOTHING`,
  [headId, currentYear.id, capLD, capMD],
)

// Studenți
const studentIds = []
for (const [i, nume] of STUDENT_NAMES.entries()) {
  const isMaster = i % 3 === 2
  const [level, specializare, limba, an] = isMaster
    ? MASTER_GROUPS[i % MASTER_GROUPS.length]
    : BACHELOR_GROUPS[i % BACHELOR_GROUPS.length]
  const email = `${nume.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}@stud.ase.ro`
  studentIds.push(
    await upsertUser([
      email, nume, 'student',
      `MK-${startYear}-${String(i + 1).padStart(4, '0')}`,
      level, specializare, an,
      programmeIds.get(`${level}|${specializare}|${limba}`), limba, `${limba.toUpperCase()}-${1500 + (i % 4)}`,
      null, 'Marketing', null, null, null,
      i === 0, // primul student este cont demo
    ]),
  )
}

/* A demo student with no supervisor at all.
 *
 * Deliberately kept out of `studentIds`, so the request loop below never gives
 * them one: every empty state on the student side — no request, no coordinator,
 * no thread, no bookable consultation — is reachable from the sign-in page
 * instead of only existing in theory.
 */
const unassignedStudentId = await upsertUser([
  'ana.lupu@stud.ase.ro', 'Ana-Maria Lupu', 'student',
  `MK-${startYear}-0099`,
  'bachelor', 'Marketing', 3,
  programmeIds.get('bachelor|Marketing|ro'), 'ro', 'RO-1503',
  null, 'Marketing', null, null, null,
  true,
])

// Idempotency guard: if an earlier run (or a manual test) left this account with
// a request, clear it so the account keeps meaning "not yet started".
await q(`DELETE FROM requests WHERE student_id = $1`, [unassignedStudentId])

// Teme
for (const [i, [titlu, nivel, limba, metode, prereq, locuri]] of TOPICS.entries()) {
  const profesorId = teacherIds[i % teacherIds.length]
  await q(
    `INSERT INTO topics (academic_year_id, teacher_id, title, description, level, language,
                         methods, prerequisites, seats)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
      WHERE NOT EXISTS (
        SELECT 1 FROM topics WHERE academic_year_id = $1 AND teacher_id = $2 AND title = $3
      )`,
    [currentYear.id, profesorId, titlu, `Direcție de cercetare propusă pentru sesiunea în curs. ${metode}.`,
     nivel, limba, metode, prereq, locuri],
  )
}

// Cereri — distribuite pe stări, majoritatea către primul profesor (contul demo)
const STATES = ['pending', 'approved', 'approved', 'rejected', 'pending', 'approved']
for (const [i, studentId] of studentIds.entries()) {
  const [titluRo, titluEn] = REQUEST_TITLES[i % REQUEST_TITLES.length]
  const status = STATES[i % STATES.length]
  // Primii 10 studenți merg la profesorul demo, ca dashboardul lui să aibă conținut.
  const profesorId = i < 10 ? teacherIds[0] : teacherIds[i % teacherIds.length]
  const numar = `CRR-${startYear}-${String(i + 1).padStart(4, '0')}`

  const { rows } = await q(
    `INSERT INTO requests (academic_year_id, number, student_id, teacher_id, title_ro, title_en,
                           objectives, motivation, status, rejection_reason, submitted_at, decided_at, expires_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            now() - ($11 || ' days')::interval,
            CASE WHEN $9 = 'pending' THEN NULL ELSE now() - ($12 || ' days')::interval END,
            CASE WHEN $9 = 'pending' THEN now() + ($13 || ' days')::interval END
      WHERE NOT EXISTS (SELECT 1 FROM requests WHERE number = $2)
     RETURNING id`,
    [
      currentYear.id, numar, studentId, profesorId, titluRo, titluEn, OBJECTIVES,
      MOTIVATIONS[i % MOTIVATIONS.length], status,
      status === 'rejected'
        ? 'Tema propusă se suprapune cu o lucrare deja alocată. Vă rog să reformulați direcția de cercetare sau să alegeți una dintre temele propuse.'
        : null,
      // Cererile în așteptare sunt recente, ca să nu fie măturate imediat de
      // termenul de o săptămână; restul sunt vechi, ca istoricul să aibă adâncime.
      status === 'pending' ? String(1 + (i % 3)) : String(30 - i),
      String(Math.max(1, 25 - i)),
      String(5 - (i % 3)),
    ],
  )

  // Jaloane pentru cererile aprobate
  if (rows[0] && status === 'approved') {
    const cerereId = rows[0].id
    for (const [j, [titlu, descriere, ordine]] of MILESTONES.entries()) {
      const stare = j === 0 ? 'done' : j === 1 ? (i % 2 === 0 ? 'done' : 'in_progress') : j === 2 ? 'in_progress' : 'planned'
      await q(
        `INSERT INTO milestones (request_id, title, description, due_on, status, position)
         VALUES ($1,$2,$3, (current_date + ($4 || ' days')::interval)::date, $5, $6)`,
        [cerereId, titlu, descriere, String(j * 30 - 30), stare, ordine],
      )
    }
  }
}

// Sloturi de consultații pentru profesorul demo și încă doi. Unul din trei este
// online, ca linkul întâlnirii să fie vizibil undeva în interfață.
for (const profesorId of [teacherIds[0], teacherIds[1], headId]) {
  for (let zi = 1; zi <= 14; zi += 2) {
    for (const ora of [14, 15]) {
      const online = (zi + ora) % 3 === 0
      await q(
        `INSERT INTO consultation_slots (teacher_id, starts_at, ends_at, mode, location, meeting_url, capacity)
         SELECT $1,
                date_trunc('day', now() + ($2 || ' days')::interval) + ($3 || ' hours')::interval,
                date_trunc('day', now() + ($2 || ' days')::interval) + (($3::int + 1) || ' hours')::interval,
                $4, $5, $6, 1
          WHERE NOT EXISTS (
            SELECT 1 FROM consultation_slots
             WHERE teacher_id = $1
               AND starts_at = date_trunc('day', now() + ($2 || ' days')::interval) + ($3 || ' hours')::interval
          )`,
        [
          profesorId, String(zi), String(ora),
          online ? 'online' : 'in_person',
          online ? null : 'Corp Ion Angelescu, etaj 3, sala 2314',
          online ? 'https://meet.ase.ro/consultatii-marketing' : null,
        ],
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

  // Firul începe cu evenimentul care l-a deschis, nu cu o replică.
  await q(
    `INSERT INTO messages (conversation_id, sender_id, body, kind, event_type, read_at, created_at)
     VALUES ($1, $2, $3, 'event', 'request_approved', now(), now() - interval '40 hours')`,
    [conversatieId, teacher_id, 'Cererea de coordonare a fost aprobată. Jaloanele lucrării sunt disponibile în portal.'],
  )

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
      SET status = 'approved', decided_at = COALESCE(r.decided_at, now()), expires_at = NULL
    FROM users s, users t
   WHERE r.student_id = s.id
     AND r.teacher_id = t.id
     AND s.is_demo = true AND s.role = 'student' AND s.id <> $1
     AND t.is_demo = true AND t.role = 'teacher'
     AND r.status <> 'approved'
   RETURNING r.id, r.student_id, r.teacher_id`,
  [unassignedStudentId],
)

for (const r of demoPair) {
  const { rows: existing } = await q('SELECT 1 FROM milestones WHERE request_id = $1 LIMIT 1', [r.id])
  if (existing.length === 0) {
    for (const [j, [title, description]] of MILESTONES.entries()) {
      await q(
        `INSERT INTO milestones (request_id, title, description, due_on, status, position)
         VALUES ($1, $2, $3, (current_date + ($4 || ' days')::interval)::date, $5, $6)`,
        [r.id, title, description, String(j * 30 - 30), j === 0 ? 'done' : j === 1 ? 'in_progress' : 'planned', j],
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

/* --- o invitație în așteptare ---------------------------------------------
 * Studenta fără coordonator primește o propunere de la cadrul didactic demo.
 * Rămâne fără coordonator până răspunde, deci scenariul „niciun coordonator”
 * se păstrează, iar ecranul de acceptare/refuz devine accesibil din demo.
 */
await q(
  `INSERT INTO invitations (academic_year_id, teacher_id, student_id, topic_id, message, expires_at)
   SELECT $1, $2, $3,
          (SELECT id FROM topics WHERE teacher_id = $2 AND academic_year_id = $1 ORDER BY created_at LIMIT 1),
          $4, now() + interval '14 days'
    WHERE NOT EXISTS (
      SELECT 1 FROM invitations WHERE teacher_id = $2 AND student_id = $3
    )`,
  [
    currentYear.id, teacherIds[0], unassignedStudentId,
    'Bună ziua! Am observat rezultatele dumneavoastră la cursul de cercetări de marketing și v-aș propune să vă coordonez lucrarea de licență. Am o temă disponibilă care cred că vi se potrivește. Dacă acceptați, completați cererea din portal și o voi aproba direct.',
  ],
)

/* --- o cerere de locuri suplimentare, în așteptarea directorului ----------- */
await q(
  `INSERT INTO seat_requests (teacher_id, academic_year_id, level, extra_seats, reason)
   SELECT $1, $2, 'bachelor', 2,
          'Am primit trei cereri peste capacitatea alocată, toate pe teme din aria mea de cercetare. Aș prelua încă doi studenți de licență fără să reduc numărul de consultații.'
    WHERE NOT EXISTS (
      SELECT 1 FROM seat_requests WHERE teacher_id = $1 AND academic_year_id = $2 AND level = 'bachelor'
    )`,
  [teacherIds[1], currentYear.id],
)

/* --- arhivă istorică -------------------------------------------------------
 * Anul trecut are date native în portal doar dacă a rulat cineva portalul
 * atunci — nu a rulat. Ambii ani încheiați primesc înregistrări introduse
 * manual, exact ca importul pe care îl face directorul.
 */
const ARCHIVE = [
  ['Cristian Dobre', 'Prof. univ. dr. Mihaela Ionescu', 'Fidelizarea clienților în retailul alimentar', 'bachelor', 'Marketing', 'ro'],
  ['Ana Petre', 'Conf. univ. dr. Cristian Vasile', 'Strategii de preț în piața asigurărilor', 'master', 'Marketing strategic', 'ro'],
  ['Mircea Anton', 'Lect. univ. dr. Simona Radu', 'Rolul ambalajului în percepția calității', 'bachelor', 'Marketing', 'ro'],
  ['Ilinca Vlad', 'Conf. univ. dr. Alina Georgescu', 'Automatizarea campaniilor de email marketing', 'master', 'Marketing digital', 'en'],
  ['Tudor Nicolae', 'Prof. univ. dr. Andrei Popescu', 'Măsurarea satisfacției în serviciile medicale private', 'bachelor', 'Marketing', 'ro'],
  ['Sabina Grigore', 'Lect. univ. dr. Bogdan Marinescu', 'Segmentarea pieței de produse bio', 'bachelor', 'Marketing', 'ro'],
]

for (const [an, offset] of [[lastYear, 1], [olderYear, 2]]) {
  for (const [i, [student, profesor, titlu, nivel, program, limba]] of ARCHIVE.entries()) {
    await q(
      `INSERT INTO archive_entries (academic_year_id, student_name, student_number, programme,
                                    level, language, teacher_name, title_ro, defended_on)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8, make_date($9, 7, 5)
        WHERE NOT EXISTS (
          SELECT 1 FROM archive_entries WHERE academic_year_id = $1 AND student_name = $2
        )`,
      [
        an.id, student, `MK-${startYear - offset}-${String(100 + i).padStart(4, '0')}`,
        program, nivel, limba, profesor, titlu, startYear - offset + 1,
      ],
    )
  }
}

const { rows: [{ count: userCount }] } = await q('SELECT count(*)::int AS count FROM users')
const { rows: [{ count: requestCount }] } = await q('SELECT count(*)::int AS count FROM requests')
console.log(`[seed] done — ${userCount} users, ${requestCount} requests`)

await client.end()
