import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

/**
 * Capacity, against a real database, through the real routes.
 *
 * WHY THIS FILE EXISTS. Every other test in this project is arithmetic without
 * a database, and the arithmetic was never the defect. `capacityOf` has always
 * been right; what was wrong was a route reading `if (!invitation && freeFor(…)
 * === 0)`, a catalogue adding two levels together, a check on the pool and a
 * write in a transaction that could not see it. None of those is visible from a
 * pure function, and all of them decide whether a student gets a supervisor.
 *
 * WHY ITS OWN DATABASE. The suite creates `portal_test`, migrates it from 0001
 * to head and works only in there. Running against the developer's own database
 * was the alternative and it is not viable: these tests approve supervisions,
 * revoke seats and open academic years, and one of them flips `is_current` for
 * the whole schema. A test must not be able to ruin the thing somebody is
 * looking at in another window.
 *
 * WHEN THERE IS NO DATABASE the whole suite is skipped rather than failing:
 * `npm test` has to stay runnable on a laptop with nothing started. The skip is
 * loud — every test is reported skipped with the reason — so it cannot pass for
 * a green run.
 *
 * The routes are called as functions with a fabricated context. Astro hands its
 * handlers `{ request, locals, url }` and these three routes read nothing else,
 * so a Request and a user is the whole of the environment they need; going
 * through an HTTP server instead would test Astro's router, which is not the
 * thing in doubt.
 */

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const TEST_DB = 'portal_test'

const DEV_URL = 'postgres://postgres:dev@localhost:55432/portal'
const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEV_URL

/** The same server, a different database. `pg` parses the path as the name. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

async function buildTestDatabase(): Promise<string | null> {
  const admin = new pg.Client({
    connectionString: withDatabase(baseUrl, 'postgres'),
    connectionTimeoutMillis: 2000,
  })
  try {
    await admin.connect()
  } catch {
    return null
  }

  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${TEST_DB}`)
  } finally {
    await admin.end()
  }

  const url = withDatabase(baseUrl, TEST_DB)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(`SET TIME ZONE 'Europe/Bucharest'`)
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      await client.query(await readFile(join(MIGRATIONS, file), 'utf8'))
    }
  } finally {
    await client.end()
  }
  return url
}

const testUrl = await buildTestDatabase()
const skip = testUrl
  ? false
  : `fără bază de date la ${withDatabase(baseUrl, 'postgres')} — pornește containerul (docker compose up -d) și reia`

/**
 * `it`, skipped one test at a time rather than one suite at a time.
 *
 * `describe(name, { skip })` does not run its callback at all, so on a machine
 * with nothing started these twenty-nine tests would not be REGISTERED — the
 * run would report a smaller total and still say „0 failed”. A count that falls
 * quietly is the one thing a test suite must not do, so the names are declared
 * either way and only the bodies are skipped.
 */
const dbIt = (name: string, fn: () => Promise<void>) => it(name, { skip }, fn)

/* The application reads its connection string once, when `container.ts` is
 * first imported, so the environment is set before anything is imported at all.
 * Hence the dynamic import: a static one is hoisted above these two lines. */
if (testUrl) {
  process.env.DATABASE_URL = testUrl
  process.env.MAIL_TRANSPORT = 'disk'
  process.env.MAIL_OUTBOX = join(tmpdir(), 'portal-test-outbox')
  process.env.APP_BASE_URL = 'http://localhost:3000'
}

type Mod = Record<string, unknown>
const load = async (path: string): Promise<Mod> =>
  testUrl ? ((await import(path)) as Mod) : ({} as Mod)

const dbModule = await load('../src/lib/db.ts')
const repoModule = await load('../src/lib/repo.ts')
const seatsModule = await load('../src/lib/seats.ts')
const yearsModule = await load('../src/lib/years.ts')
const depuneRoute = await load('../src/pages/api/cereri/depune.ts')
const decizieRoute = await load('../src/pages/api/cereri/decizie.ts')
const retrageRoute = await load('../src/pages/api/cereri/retrage.ts')
const invitatiiRoute = await load('../src/pages/api/invitatii.ts')
const locuriRoute = await load('../src/pages/api/locuri.ts')
const studentiRoute = await load('../src/pages/api/studenti.ts')
const sustinereRoute = await load('../src/pages/api/sustinere.ts')

/* The modules are imported by name at run time, so their types are not
 * available statically and the handles below are typed by hand. Narrow on
 * purpose — only what these tests call — and every one of them is exercised by
 * the assertions a few lines down, so a signature that moves fails here. */
const query = dbModule.query as (sql: string, params?: unknown[]) => Promise<any[]>
const execute = dbModule.execute as (sql: string, params?: unknown[]) => Promise<number>
const teacherCapacity = repoModule.teacherCapacity as (id: string) => Promise<any>
const supervisors = repoModule.supervisors as (
  options: { viewer?: { programme_id: string | null; program: string | null } | null },
) => Promise<any[]>
const freeFor = seatsModule.freeFor as (cap: any, programmeId: string | null) => number
const openYear = yearsModule.openYear as (
  label: string,
  from: string,
  to: string,
  options: Record<string, boolean>,
) => Promise<unknown>

/* --- driving a route -------------------------------------------------------- */

interface Sent {
  status: number
  /** The path a redirect points at, without the notice. */
  path: string
  /** The Romanian sentence the portal answered with. */
  notice: string
  /** True when the portal refused: `redirectWithNotice(…, true)`. */
  refused: boolean
}

async function post(
  route: Mod,
  user: unknown,
  fields: Record<string, string | string[]>,
): Promise<Sent> {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) body.append(name, one)
  }
  const url = new URL('http://localhost:3000/api/test')
  const request = new Request(url, { method: 'POST', body })
  const handler = route.POST as (context: unknown) => Promise<Response>
  const response = await handler({ request, locals: { user }, url })

  const location = response.headers.get('location') ?? ''
  const target = location ? new URL(location, 'http://localhost:3000') : null
  return {
    status: response.status,
    path: target ? target.pathname : '',
    notice: target?.searchParams.get('notificare') ?? '',
    refused: target?.searchParams.get('tip') === 'error',
  }
}

/* --- the people and programmes the tests act on ----------------------------- */

interface Fixtures {
  yearId: string
  teacher: any
  head: any
  /** Two programmes at the same level: an earmark for one is not the other's. */
  alpha: { id: string; name: string }
  beta: { id: string; name: string }
  masterProgramme: { id: string; name: string }
}

let f: Fixtures
let sequence = 0

const nextEmail = (prefix: string) => `${prefix}-${++sequence}@capacitate.test`

async function makeStudent(programme: { id: string; name: string }, level: 'bachelor' | 'master') {
  const [row] = await query(
    `INSERT INTO users (email, name, role, student_number, program, specialization,
                        programme_id, study_language, study_year)
     VALUES ($1, $2, 'student', $3, $4, $5, $6, 'ro', 3)
     RETURNING id, email, name, role, program, specialization, programme_id,
               study_language, student_number, father_initial`,
    [nextEmail('student'), `Student ${sequence}`, `TST-${sequence}`, level, programme.name, programme.id],
  )
  return row
}

async function setBase(teacherId: string, bachelor: number | null, master: number | null) {
  await execute(
    `INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_base, master_base)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (teacher_id, academic_year_id)
     DO UPDATE SET bachelor_base = EXCLUDED.bachelor_base, master_base = EXCLUDED.master_base`,
    [teacherId, f.yearId, bachelor, master],
  )
}

async function grant(
  teacherId: string,
  programme: { id: string },
  level: 'bachelor' | 'master',
  seats: number,
) {
  const [row] = await query(
    `INSERT INTO seat_grants (academic_year_id, teacher_id, programme_id, level, seats, reason)
     VALUES ($1, $2, $3, $4, $5, 'Motiv de test, suficient de lung pentru validare.')
     RETURNING id`,
    [f.yearId, teacherId, programme.id, level, seats],
  )
  return row.id as string
}

/** Approved and defended supervisions at a level — the number a seat is spent on. */
async function taken(teacherId: string, level: 'bachelor' | 'master' = 'bachelor') {
  const cap = await teacherCapacity(teacherId)
  return level === 'master' ? cap.master.taken : cap.bachelor.taken
}

async function freeAt(
  teacherId: string,
  level: 'bachelor' | 'master',
  programmeId: string | null,
) {
  const cap = await teacherCapacity(teacherId)
  return freeFor(level === 'master' ? cap.master : cap.bachelor, programmeId)
}

async function approvedRowsFor(teacherId: string) {
  return query(`SELECT id, status FROM requests WHERE teacher_id = $1 AND status = 'approved'`, [
    teacherId,
  ])
}

/** A request already in the queue, as `/api/cereri/depune` would have left it. */
async function pendingRequest(student: any, teacherId: string) {
  const [row] = await query(
    `INSERT INTO requests (academic_year_id, number, student_id, teacher_id, title_ro,
                           objectives, motivation, status, programme_id, expires_at)
     VALUES ($1, $2, $3, $4, 'Titlu de test',
             $5, $5, 'pending', $6, now() + interval '7 days')
     RETURNING id, number`,
    [
      f.yearId, `CRR-TST-${++sequence}`, student.id, teacherId,
      'Obiective de test, peste patruzeci de caractere ca să treacă validarea.',
      student.programme_id,
    ],
  )
  return row
}

async function invite(teacherId: string, student: any, status: 'pending' | 'accepted') {
  const [row] = await query(
    `INSERT INTO invitations (academic_year_id, teacher_id, student_id, message, status,
                              expires_at, responded_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '14 days',
             CASE WHEN $5 = 'accepted' THEN now() END)
     RETURNING id`,
    [
      f.yearId, teacherId, student.id,
      'Mesaj de propunere suficient de lung pentru validarea de treizeci de caractere.',
      status,
    ],
  )
  return row.id as string
}

const SUBMIT = {
  titlu_ro: 'Lucrare de test',
  scop_obiective: 'Obiective de test, peste patruzeci de caractere ca să treacă validarea.',
  motivatie: 'Motivație de test, peste patruzeci de caractere ca să treacă validarea.',
}

describe('capacitatea, împotriva bazei de date', () => {
  before(async () => {
    if (skip) return
    const [year] = await query(`SELECT id FROM academic_years WHERE is_current`)

    await execute(`INSERT INTO teaching_locations (name) VALUES ('Testopolis')`)

    const programme = async (
      level: 'bachelor' | 'master',
      specialisation: string,
    ): Promise<{ id: string; name: string }> => {
      const name = `${specialisation} · învățământ cu frecvență · Testopolis`
      const [row] = await query(
        `INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years,
                                       form_of_study, specialisation, location)
         VALUES ($1, $2, $3, 'ro', 3, 'if', $4, 'Testopolis')
         RETURNING id, name`,
        [year.id, level, name, specialisation],
      )
      return row
    }

    const [teacher] = await query(
      `INSERT INTO users (email, name, role, department)
       VALUES ($1, 'Coordonator de test', 'teacher', 'Test')
       RETURNING id, email, name, role`,
      [nextEmail('teacher')],
    )
    const [head] = await query(
      `INSERT INTO users (email, name, role, department)
       VALUES ($1, 'Director de test', 'head', 'Test')
       RETURNING id, email, name, role`,
      [nextEmail('head')],
    )

    f = {
      yearId: year.id,
      teacher,
      head,
      alpha: await programme('bachelor', 'Alfa'),
      beta: await programme('bachelor', 'Beta'),
      masterProgramme: await programme('master', 'Gama'),
    }
  })

  /* Every test starts from a coordinator with nothing on them. Cheaper and far
   * clearer than undoing whatever the previous one did, and it means a test can
   * be read on its own. */
  beforeEach(async () => {
    if (skip) return
    await execute(`DELETE FROM requests WHERE teacher_id = $1`, [f.teacher.id])
    await execute(`DELETE FROM invitations WHERE teacher_id = $1`, [f.teacher.id])
    await execute(`DELETE FROM seat_grants WHERE teacher_id = $1`, [f.teacher.id])
    await execute(`DELETE FROM seat_requests WHERE teacher_id = $1`, [f.teacher.id])
    await execute(`DELETE FROM seat_allocations WHERE teacher_id = $1`, [f.teacher.id])
  })

  after(async () => {
    if (skip) return
    const pool = dbModule.close as (() => Promise<void>) | undefined
    if (pool) await pool()
  })

  /* --- the owner's complaint ------------------------------------------------ */

  describe('o propunere acceptată nu trece peste locuri', () => {
    dbIt('coordonatorul la limită: cererea invitatului este refuzată și nu se aprobă nimic', async () => {
      await setBase(f.teacher.id, 1, 0)
      const occupant = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(occupant, f.teacher.id)
      await execute(`UPDATE requests SET status = 'approved', decided_at = now() WHERE id = $1`, [
        request.id,
      ])
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0, 'premisa: chiar este plin')

      const invited = await makeStudent(f.alpha, 'bachelor')
      const invitationId = await invite(f.teacher.id, invited, 'accepted')

      const before = (await approvedRowsFor(f.teacher.id)).length
      const sent = await post(depuneRoute, invited, {
        ...SUBMIT,
        profesor_id: f.teacher.id,
        invitatie_id: invitationId,
      })

      assert.equal(sent.refused, true, 'portalul trebuie să refuze')
      assert.match(sent.notice, /nu mai are niciun loc/)
      assert.match(sent.notice, /Nu ai greșit nimic/, 'refuzul nu dă vina pe student')
      assert.match(sent.notice, /director/, 'și spune cine poate face ceva')

      assert.equal(
        (await approvedRowsFor(f.teacher.id)).length,
        before,
        'niciun rând aprobat în plus — asta este plângerea proprietarului',
      )
      const mine = await query(`SELECT status FROM requests WHERE student_id = $1`, [invited.id])
      assert.deepEqual(mine, [], 'și nicio cerere deloc pentru studentul invitat')
    })

    dbIt('cu un loc liber, aceeași acceptare trece și cererea este aprobată', async () => {
      await setBase(f.teacher.id, 1, 0)
      const invited = await makeStudent(f.alpha, 'bachelor')
      const invitationId = await invite(f.teacher.id, invited, 'accepted')

      const sent = await post(depuneRoute, invited, {
        ...SUBMIT,
        profesor_id: f.teacher.id,
        invitatie_id: invitationId,
      })

      assert.equal(sent.refused, false, sent.notice)
      const mine = await query(`SELECT status, invitation_id FROM requests WHERE student_id = $1`, [
        invited.id,
      ])
      assert.equal(mine.length, 1)
      assert.equal(mine[0].status, 'approved', 'propunerea acceptată se aprobă la depunere')
      assert.equal(mine[0].invitation_id, invitationId)
      assert.equal(await taken(f.teacher.id), 1, 'și consumă locul')
    })

    dbIt('coordonatorul este anunțat o singură dată, oricâte încercări ar face studentul', async () => {
      await setBase(f.teacher.id, 0, 0)
      const invited = await makeStudent(f.alpha, 'bachelor')
      const invitationId = await invite(f.teacher.id, invited, 'accepted')

      for (let i = 0; i < 3; i++) {
        const sent = await post(depuneRoute, invited, {
          ...SUBMIT,
          profesor_id: f.teacher.id,
          invitatie_id: invitationId,
        })
        assert.equal(sent.refused, true)
      }

      const events = await query(
        `SELECT id FROM messages WHERE event_type = 'invitation_no_seat' AND subject_id = $1`,
        [invitationId],
      )
      assert.equal(events.length, 1, 'trei încercări, un singur anunț')
    })

    dbIt('acceptarea propunerii este oprită înainte de formular, iar propunerea rămâne deschisă', async () => {
      await setBase(f.teacher.id, 0, 0)
      const invited = await makeStudent(f.alpha, 'bachelor')
      const invitationId = await invite(f.teacher.id, invited, 'pending')

      const sent = await post(invitatiiRoute, invited, {
        actiune: 'raspunde',
        invitatie_id: invitationId,
        raspuns: 'accepted',
      })

      assert.equal(sent.refused, true)
      assert.match(sent.notice, /Nu ai greșit nimic/)
      const [row] = await query(`SELECT status FROM invitations WHERE id = $1`, [invitationId])
      assert.equal(row.status, 'pending', 'rămâne de acceptat în ziua în care apare un loc')
    })

    dbIt('refuzul unei propuneri nu are nevoie de niciun loc', async () => {
      await setBase(f.teacher.id, 0, 0)
      const invited = await makeStudent(f.alpha, 'bachelor')
      const invitationId = await invite(f.teacher.id, invited, 'pending')

      const sent = await post(invitatiiRoute, invited, {
        actiune: 'raspunde',
        invitatie_id: invitationId,
        raspuns: 'declined',
        motiv: 'Am ales altă direcție de cercetare.',
      })

      assert.equal(sent.refused, false, sent.notice)
      const [row] = await query(`SELECT status FROM invitations WHERE id = $1`, [invitationId])
      assert.equal(row.status, 'declined')
    })
  })

  /* --- the other ways a supervision can be born ----------------------------- */

  describe('depunerea obișnuită', () => {
    dbIt('fără loc la programul studentului, cererea este refuzată', async () => {
      await setBase(f.teacher.id, 0, 0)
      const student = await makeStudent(f.alpha, 'bachelor')

      const sent = await post(depuneRoute, student, { ...SUBMIT, profesor_id: f.teacher.id })

      assert.equal(sent.refused, true)
      assert.match(sent.notice, /nu mai are locuri/)
      assert.deepEqual(await query(`SELECT id FROM requests WHERE student_id = $1`, [student.id]), [])
    })

    dbIt('o cerere în așteptare nu consumă loc; aprobarea îl consumă', async () => {
      await setBase(f.teacher.id, 1, 0)
      const student = await makeStudent(f.alpha, 'bachelor')

      const sent = await post(depuneRoute, student, { ...SUBMIT, profesor_id: f.teacher.id })
      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await taken(f.teacher.id), 0, 'o cerere nedecisă nu ocupă nimic')
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 1)

      const [row] = await query(`SELECT id FROM requests WHERE student_id = $1`, [student.id])
      const decided = await post(decizieRoute, f.teacher, {
        cerere_id: row.id,
        decizie: 'approved',
      })
      assert.equal(decided.refused, false, decided.notice)
      assert.equal(await taken(f.teacher.id), 1)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0)
    })

    dbIt('rezerva unui program nu poate fi cheltuită de studentul altuia', async () => {
      await setBase(f.teacher.id, 0, 0)
      await grant(f.teacher.id, f.beta, 'bachelor', 3)

      const cap = await teacherCapacity(f.teacher.id)
      assert.equal(cap.bachelor.free_any, 3, 'free_any le numără — este un total, nu o poartă')

      const fromAlpha = await makeStudent(f.alpha, 'bachelor')
      const refused = await post(depuneRoute, fromAlpha, { ...SUBMIT, profesor_id: f.teacher.id })
      assert.equal(refused.refused, true)
      assert.match(refused.notice, /rezervate altor programe/)

      const fromBeta = await makeStudent(f.beta, 'bachelor')
      const accepted = await post(depuneRoute, fromBeta, { ...SUBMIT, profesor_id: f.teacher.id })
      assert.equal(accepted.refused, false, accepted.notice)
    })

    dbIt('locurile de la celălalt nivel nu se pot folosi', async () => {
      await setBase(f.teacher.id, 0, 5)
      const student = await makeStudent(f.alpha, 'bachelor')

      const sent = await post(depuneRoute, student, { ...SUBMIT, profesor_id: f.teacher.id })
      assert.equal(sent.refused, true, 'cinci locuri de master nu fac un loc de licență')
    })
  })

  describe('decizia coordonatorului', () => {
    dbIt('respingerea nu consumă loc', async () => {
      await setBase(f.teacher.id, 1, 0)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)

      const sent = await post(decizieRoute, f.teacher, {
        cerere_id: request.id,
        decizie: 'rejected',
        motiv: 'Tema propusă nu se potrivește cu direcțiile mele de cercetare.',
      })

      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await taken(f.teacher.id), 0)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 1, 'locul rămâne liber')
    })

    dbIt('aprobarea peste limită este refuzată, iar cererea rămâne în așteptare', async () => {
      await setBase(f.teacher.id, 1, 0)
      const first = await makeStudent(f.alpha, 'bachelor')
      const firstRequest = await pendingRequest(first, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: firstRequest.id, decizie: 'approved' })

      const second = await makeStudent(f.alpha, 'bachelor')
      const secondRequest = await pendingRequest(second, f.teacher.id)
      const sent = await post(decizieRoute, f.teacher, {
        cerere_id: secondRequest.id,
        decizie: 'approved',
      })

      assert.equal(sent.refused, true)
      assert.match(sent.notice, /Nu mai ai locuri/)
      const [row] = await query(`SELECT status FROM requests WHERE id = $1`, [secondRequest.id])
      assert.equal(row.status, 'pending', 'refuzul nu decide cererea în locul nimănui')
      assert.equal(await taken(f.teacher.id), 1)
    })

    dbIt('programul se fixează pe cerere la aprobare', async () => {
      await setBase(f.teacher.id, 2, 0)
      const student = await makeStudent(f.alpha, 'bachelor')
      const [row] = await query(
        `INSERT INTO requests (academic_year_id, number, student_id, teacher_id, title_ro,
                               objectives, motivation, status, expires_at)
         VALUES ($1, $2, $3, $4, 'Fără program fixat', $5, $5, 'pending', now() + interval '7 days')
         RETURNING id`,
        [f.yearId, `CRR-TST-${++sequence}`, student.id, f.teacher.id, SUBMIT.scop_obiective],
      )

      await post(decizieRoute, f.teacher, { cerere_id: row.id, decizie: 'approved' })

      const [after] = await query(`SELECT programme_id FROM requests WHERE id = $1`, [row.id])
      assert.equal(after.programme_id, f.alpha.id, 'locul se cheltuie din programul numit')
    })
  })

  describe('retragerea', () => {
    dbIt('retragerea unei cereri în așteptare nu schimbă locurile ocupate', async () => {
      await setBase(f.teacher.id, 2, 0)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)

      const before = await taken(f.teacher.id)
      const sent = await post(retrageRoute, student, {
        cerere_id: request.id,
        motiv: 'Am găsit alt coordonator.',
      })

      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await taken(f.teacher.id), before, 'o cerere nedecisă nu ținea niciun loc')
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 2)
    })

    /* An approved supervision is an agreement between two people and is not
     * unmade from one side. Written down here because the consequence is the
     * one a director asks about: within the year, an approved seat never comes
     * back — not on withdrawal, not on defence. */
    dbIt('o coordonare aprobată nu poate fi retrasă de student, iar locul rămâne ocupat', async () => {
      await setBase(f.teacher.id, 2, 0)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: request.id, decizie: 'approved' })

      const sent = await post(retrageRoute, student, {
        cerere_id: request.id,
        motiv: 'M-am răzgândit.',
      })

      assert.equal(sent.refused, true)
      assert.equal(await taken(f.teacher.id), 1, 'locul rămâne al ei')
    })
  })

  describe('susținerea', () => {
    dbIt('o lucrare susținută rămâne un loc ocupat până la anul următor', async () => {
      await setBase(f.teacher.id, 1, 0)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: request.id, decizie: 'approved' })
      assert.equal(await taken(f.teacher.id), 1)

      const sent = await post(sustinereRoute, f.teacher, {
        actiune: 'sustinuta',
        cerere_id: request.id,
        data: new Date().toISOString().slice(0, 10),
        nota: '9',
      })

      assert.equal(sent.refused, false, sent.notice)
      const [row] = await query(`SELECT status FROM requests WHERE id = $1`, [request.id])
      assert.equal(row.status, 'defended')
      assert.equal(
        await taken(f.teacher.id),
        1,
        'o licență susținută în februarie nu redă locul pentru restul anului',
      )
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0)
    })
  })

  describe('mutarea unui student între programe', () => {
    /* The seat is pinned on the request at the instant it is spent. Read off
     * the student at query time it followed them: moving somebody in March
     * moved a seat spent in October with them, out of one coordinator's earmark
     * and into another's — and the coordinator who had actually been given the
     * seat lost it without being told. */
    dbIt('locul deja ocupat rămâne pe programul din care a fost cheltuit', async () => {
      await setBase(f.teacher.id, 0, 0)
      await grant(f.teacher.id, f.alpha, 'bachelor', 1)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: request.id, decizie: 'approved' })

      const before = await teacherCapacity(f.teacher.id)
      assert.equal(
        before.bachelor.pots.find((p: any) => p.programme_id === f.alpha.id).taken,
        1,
      )

      const moved = await post(studentiRoute, f.head, {
        student_id: student.id,
        program_id: f.beta.id,
      })
      assert.equal(moved.refused, false, moved.notice)

      const after = await teacherCapacity(f.teacher.id)
      const alpha = after.bachelor.pots.find((p: any) => p.programme_id === f.alpha.id)
      const beta = after.bachelor.pots.find((p: any) => p.programme_id === f.beta.id)

      assert.equal(alpha.taken, 1, 'locul rămâne cheltuit acolo unde a fost acordat')
      assert.equal(alpha.free, 0)
      assert.equal(beta, undefined, 'și nu apare al doilea rând pentru același student')
      assert.equal(after.bachelor.taken, 1, 'niciodată numărat de două ori')

      /* What the student loses by moving: the earmark was Alfa's, so from Beta
       * they would now need the shared base, which is zero. That is the correct
       * answer and it is the one the gate gives. */
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.beta.id), 0)
    })
  })

  /* --- the director's four writes ------------------------------------------- */

  describe('alocarea locurilor', () => {
    dbIt('„pe norma anului” pe amândouă nivelurile pune amândouă bazele pe NULL', async () => {
      await setBase(f.teacher.id, 7, 4)

      const sent = await post(locuriRoute, f.head, {
        actiune: 'aloca',
        profesor_id: f.teacher.id,
        locuri_licenta: '7',
        locuri_master: '4',
        pe_norma: ['licenta', 'master'],
      })

      assert.equal(sent.refused, false, sent.notice)
      const [row] = await query(
        `SELECT bachelor_base, master_base FROM seat_allocations
          WHERE teacher_id = $1 AND academic_year_id = $2`,
        [f.teacher.id, f.yearId],
      )
      assert.equal(row.bachelor_base, null, 'licența s-a întors pe normă')
      assert.equal(row.master_base, null, 'și masterul la fel — `form.get` ar fi luat doar prima bifă')

      const cap = await teacherCapacity(f.teacher.id)
      const [year] = await query(
        `SELECT default_bachelor_seats, default_master_seats FROM academic_years WHERE id = $1`,
        [f.yearId],
      )
      assert.equal(cap.bachelor.base, year.default_bachelor_seats)
      assert.equal(cap.bachelor.is_norm, true)
      assert.equal(cap.master.base, year.default_master_seats)
    })

    dbIt('o singură bifă lasă celălalt nivel pe numărul scris', async () => {
      const sent = await post(locuriRoute, f.head, {
        actiune: 'aloca',
        profesor_id: f.teacher.id,
        locuri_licenta: '9',
        locuri_master: '2',
        pe_norma: 'master',
      })

      assert.equal(sent.refused, false, sent.notice)
      const [row] = await query(
        `SELECT bachelor_base, master_base FROM seat_allocations WHERE teacher_id = $1`,
        [f.teacher.id],
      )
      assert.equal(row.bachelor_base, 9)
      assert.equal(row.master_base, null)
    })

    dbIt('un coordonator nu își alocă singur locuri', async () => {
      const sent = await post(locuriRoute, f.teacher, {
        actiune: 'aloca',
        profesor_id: f.teacher.id,
        locuri_licenta: '40',
      })
      assert.equal(sent.status, 404, 'baza este decizia departamentului')
    })
  })

  describe('rezervele pe program', () => {
    dbIt('acordarea adaugă exact la programul numit și la niciun altul', async () => {
      await setBase(f.teacher.id, 0, 0)

      const sent = await post(locuriRoute, f.head, {
        actiune: 'acorda',
        profesor_id: f.teacher.id,
        program_id: f.alpha.id,
        locuri: '3',
        motiv: 'Preia trei studenți de la colegul plecat în concediu medical.',
      })

      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 3)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.beta.id), 0)
      assert.equal(await freeAt(f.teacher.id, 'master', f.masterProgramme.id), 0)
    })

    dbIt('retragerea unei acordări neocupate o scoate din capacitate', async () => {
      await setBase(f.teacher.id, 0, 0)
      const grantId = await grant(f.teacher.id, f.alpha, 'bachelor', 2)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 2)

      const sent = await post(locuriRoute, f.head, {
        actiune: 'retrage',
        acordare_id: grantId,
        motiv: 'Nu mai este nevoie de ele în acest semestru.',
      })

      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0)
      const [row] = await query(`SELECT revoked_at, revoke_reason FROM seat_grants WHERE id = $1`, [
        grantId,
      ])
      assert.ok(row.revoked_at, 'rândul rămâne în jurnal, marcat retras')
      assert.match(row.revoke_reason, /Nu mai este nevoie/)
    })

    dbIt('o acordare ocupată nu poate fi retrasă dacă baza nu are loc pentru cei de pe ea', async () => {
      await setBase(f.teacher.id, 0, 0)
      const grantId = await grant(f.teacher.id, f.alpha, 'bachelor', 1)
      const student = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(student, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: request.id, decizie: 'approved' })

      const sent = await post(locuriRoute, f.head, {
        actiune: 'retrage',
        acordare_id: grantId,
        motiv: 'Le iau înapoi la departament.',
      })

      assert.equal(sent.refused, true)
      assert.match(sent.notice, /ar rămâne fără loc/)
      const [row] = await query(`SELECT revoked_at FROM seat_grants WHERE id = $1`, [grantId])
      assert.equal(row.revoked_at, null)
      assert.equal(await taken(f.teacher.id), 1)
    })

    dbIt('cererea scrisă a coordonatorului devine o acordare la programul cerut', async () => {
      await setBase(f.teacher.id, 0, 0)

      const asked = await post(locuriRoute, f.teacher, {
        actiune: 'cere',
        program_id: f.beta.id,
        locuri: '2',
        motiv: 'Am doi absolvenți de la Beta care mi-au cerut coordonarea.',
      })
      assert.equal(asked.refused, false, asked.notice)

      const [seatRequest] = await query(
        `SELECT id, programme_id, level FROM seat_requests WHERE teacher_id = $1`,
        [f.teacher.id],
      )
      assert.equal(seatRequest.programme_id, f.beta.id)
      assert.equal(seatRequest.level, 'bachelor', 'nivelul vine de la program, nu de la un câmp')

      const decided = await post(locuriRoute, f.head, {
        actiune: 'decide',
        cerere_id: seatRequest.id,
        decizie: 'approved',
        nota: 'De acord.',
      })
      assert.equal(decided.refused, false, decided.notice)

      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.beta.id), 2)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0)
    })
  })

  /* --- proposals ------------------------------------------------------------ */

  describe('propunerile coordonatorului', () => {
    dbIt('nu se trimite o propunere pentru care nu există niciun loc', async () => {
      await setBase(f.teacher.id, 0, 0)
      const student = await makeStudent(f.alpha, 'bachelor')

      const sent = await post(invitatiiRoute, f.teacher, {
        actiune: 'trimite',
        student_id: student.id,
        mesaj: 'Mesaj de propunere suficient de lung ca să treacă validarea de treizeci.',
      })

      assert.equal(sent.refused, true)
      assert.match(sent.notice, /Nu mai ai locuri/)
      assert.deepEqual(await query(`SELECT id FROM invitations WHERE student_id = $1`, [student.id]), [])
    })

    dbIt('o propunere trimisă nu consumă niciun loc', async () => {
      await setBase(f.teacher.id, 1, 0)
      const student = await makeStudent(f.alpha, 'bachelor')

      const sent = await post(invitatiiRoute, f.teacher, {
        actiune: 'trimite',
        student_id: student.id,
        mesaj: 'Mesaj de propunere suficient de lung ca să treacă validarea de treizeci.',
      })

      assert.equal(sent.refused, false, sent.notice)
      assert.equal(await taken(f.teacher.id), 0)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 1)
    })

    /* More proposals than seats is allowed on purpose — not everybody accepts —
     * but the coordinator is told, in the notice and on their own screen, so
     * the overcommitment is a choice rather than something a student discovers
     * by being refused. */
    dbIt('a doua propunere pe ultimul loc trece, cu numărul spus pe față', async () => {
      await setBase(f.teacher.id, 1, 0)
      const first = await makeStudent(f.alpha, 'bachelor')
      const second = await makeStudent(f.alpha, 'bachelor')
      const message = 'Mesaj de propunere suficient de lung ca să treacă validarea de treizeci.'

      const one = await post(invitatiiRoute, f.teacher, {
        actiune: 'trimite',
        student_id: first.id,
        mesaj: message,
      })
      assert.equal(one.refused, false, one.notice)
      // Verb included: „Îți rămân 1 loc liber” is what a `numar()` that agrees
      // the noun and not the verb before it produces, and it shipped once.
      assert.match(one.notice, /Mai ai 1 loc liber/)

      const two = await post(invitatiiRoute, f.teacher, {
        actiune: 'trimite',
        student_id: second.id,
        mesaj: message,
      })
      assert.equal(two.refused, false, two.notice)
      assert.match(two.notice, /2 propuneri deschise/)
      assert.match(two.notice, /1 loc liber/)
    })
  })

  /* --- what the catalogue says ---------------------------------------------- */

  /* The defect fixed on `/profesor/studenti` in 3f93866 and left live on the one
   * screen students actually browse: `bachelor_seats + master_seats -
   * (bachelor_taken + master_taken)`. Both levels summed, every earmark counted
   * as available to everybody. `supervisors({ viewer })` is what that screen
   * reads, so this is the number on the card. */
  describe('catalogul, pentru cine îl citește', () => {
    dbIt('un licențiat și un masterand văd numere diferite despre același coordonator', async () => {
      await setBase(f.teacher.id, 0, 2)
      await grant(f.teacher.id, f.alpha, 'bachelor', 3)

      const mine = async (viewer: unknown) =>
        (await supervisors({ viewer: viewer as never })).find((s: any) => s.id === f.teacher.id)

      const fromAlpha = await mine({ programme_id: f.alpha.id, program: 'bachelor' })
      const fromBeta = await mine({ programme_id: f.beta.id, program: 'bachelor' })
      const fromMaster = await mine({ programme_id: f.masterProgramme.id, program: 'master' })
      const anonymous = await mine(null)

      assert.equal(fromAlpha.free_for_viewer, 3, 'rezerva este a programului Alfa')
      assert.equal(fromAlpha.is_full, false)

      assert.equal(fromBeta.free_for_viewer, 0, 'și nu este a nimănui altcuiva')
      assert.equal(fromBeta.is_full, true)

      assert.equal(fromMaster.free_for_viewer, 2, 'masterandul vede baza lui de master')
      assert.equal(fromMaster.is_full, false)

      assert.equal(anonymous.free_for_viewer, null, 'fără cititor nu există un singur număr')
      assert.equal(anonymous.bachelor_free, 3, 'doar două numere, pe nivel')
      assert.equal(anonymous.master_free, 2)

      /* The number the screen printed until this release, kept here as the
         thing that must never come back: five, which is true of nobody. */
      const summedBothLevels =
        fromAlpha.bachelor_seats + fromAlpha.master_seats -
        (fromAlpha.bachelor_taken + fromAlpha.master_taken)
      assert.equal(summedBothLevels, 5)
      for (const viewer of [fromAlpha, fromBeta, fromMaster]) {
        assert.notEqual(
          viewer.free_for_viewer,
          summedBothLevels,
          'suma celor două niveluri nu este adevărată despre niciun student',
        )
      }
    })

    dbIt('un coordonator plin pentru un program rămâne deschis pentru altul', async () => {
      await setBase(f.teacher.id, 1, 0)
      await grant(f.teacher.id, f.beta, 'bachelor', 1)
      const occupant = await makeStudent(f.alpha, 'bachelor')
      const request = await pendingRequest(occupant, f.teacher.id)
      await post(decizieRoute, f.teacher, { cerere_id: request.id, decizie: 'approved' })

      const mine = async (programme: { id: string }) =>
        (await supervisors({ viewer: { programme_id: programme.id, program: 'bachelor' } }))
          .find((s: any) => s.id === f.teacher.id)

      assert.equal((await mine(f.alpha)).is_full, true, 'baza s-a dus pe Alfa')
      assert.equal((await mine(f.beta)).is_full, false, 'rezerva Beta este intactă')
      assert.equal((await mine(f.beta)).free_for_viewer, 1)
    })
  })

  /* --- the race -------------------------------------------------------------- */

  describe('doi studenți pe ultimul loc, în aceeași clipă', () => {
    dbIt('exact unul este acceptat, celălalt primește refuzul', async () => {
      await setBase(f.teacher.id, 1, 0)
      const one = await makeStudent(f.alpha, 'bachelor')
      const two = await makeStudent(f.alpha, 'bachelor')
      const invitationOne = await invite(f.teacher.id, one, 'accepted')
      const invitationTwo = await invite(f.teacher.id, two, 'accepted')

      /* Not awaited one after the other: both handlers are started, and only
       * then is either waited on, so the two transactions really are open at
       * the same time. Awaiting the first would test nothing — the seat would
       * already be spent before the second one began. */
      const [first, second] = await Promise.all([
        post(depuneRoute, one, {
          ...SUBMIT,
          profesor_id: f.teacher.id,
          invitatie_id: invitationOne,
        }),
        post(depuneRoute, two, {
          ...SUBMIT,
          profesor_id: f.teacher.id,
          invitatie_id: invitationTwo,
        }),
      ])

      const outcomes = [first, second]
      assert.equal(outcomes.filter((o) => !o.refused).length, 1, 'exact o cerere trece')
      assert.equal(outcomes.filter((o) => o.refused).length, 1, 'și exact una este refuzată')

      const approved = await approvedRowsFor(f.teacher.id)
      assert.equal(approved.length, 1, 'un singur rând aprobat în baza de date')
      assert.equal(await taken(f.teacher.id), 1)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 0)
    })

    dbIt('și la fel pentru două decizii ale coordonatorului deodată', async () => {
      await setBase(f.teacher.id, 1, 0)
      const one = await makeStudent(f.alpha, 'bachelor')
      const two = await makeStudent(f.alpha, 'bachelor')
      const requestOne = await pendingRequest(one, f.teacher.id)
      const requestTwo = await pendingRequest(two, f.teacher.id)

      const [first, second] = await Promise.all([
        post(decizieRoute, f.teacher, { cerere_id: requestOne.id, decizie: 'approved' }),
        post(decizieRoute, f.teacher, { cerere_id: requestTwo.id, decizie: 'approved' }),
      ])

      assert.equal([first, second].filter((o) => !o.refused).length, 1)
      assert.equal((await approvedRowsFor(f.teacher.id)).length, 1)
    })
  })

  /* --- the year turns over --------------------------------------------------- */

  /* LAST, and on purpose: `openYear` flips `is_current` for the whole schema,
   * so every fixture above belongs to a session that has just been archived.
   * Nothing after this could read a current-year capacity again. */
  describe('deschiderea unui an nou', () => {
    dbIt('baza se mută în anul nou dacă directorul cere, rezervele niciodată', async () => {
      await setBase(f.teacher.id, 6, 2)
      await grant(f.teacher.id, f.alpha, 'bachelor', 4)
      assert.equal(await freeAt(f.teacher.id, 'bachelor', f.alpha.id), 10)

      await openYear('2098–2099', '2098-10-01', '2099-09-30', {
        copyStages: false,
        copyTopics: false,
        copyProgrammes: true,
        copySeats: true,
      })

      const cap = await teacherCapacity(f.teacher.id)
      assert.equal(cap.bachelor.base, 6, 'baza este decizia departamentului și se duce mai departe')
      assert.equal(cap.master.base, 2)
      assert.equal(cap.bachelor.is_norm, false)
      assert.equal(
        cap.bachelor.granted,
        0,
        'rezervele se cer din nou: erau pentru studenții sesiunii încheiate',
      )
      assert.equal(cap.bachelor.taken, 0, 'și nicio coordonare nu trece în anul nou')
    })
  })
})
