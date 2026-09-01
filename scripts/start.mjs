#!/usr/bin/env node
/**
 * O singură comandă, de la clonă la portal deschis în browser.
 *
 * Pașii erau patru — pornește o bază de date, scrie un `.env`, rulează
 * migrările, rulează popularea, apoi serverul — și fiecare avea felul lui de a
 * eșua cu un mesaj care nu spunea ce să faci. Aici sunt unul singur, iar când
 * ceva lipsește se scrie în românește ce anume și cum se rezolvă.
 *
 * Ce face, în ordine:
 *   1. dacă `DATABASE_URL` este deja setat, îl folosește și nu atinge Docker —
 *      cine are PostgreSQL-ul lui nu are nevoie de containerul nostru;
 *   2. altfel pornește baza din `compose.yml` și așteaptă să răspundă;
 *   3. aplică migrările (fără ele portalul nu are tabele);
 *   4. populează datele demonstrative, dacă baza este goală;
 *   5. pornește serverul de dezvoltare și scrie pe ecran adresa și conturile
 *      cu care se poate intra.
 *
 * Nu face nimic în producție: acolo containerul rulează `migrate` și apoi
 * `dist/server/entry.mjs`, fără scriptul ăsta (vezi `Dockerfile`).
 */

import { spawn, spawnSync } from 'node:child_process'
import { DEV_BASE_URL, DEV_DATABASE_URL, DEV_DB_CONTAINER, DEV_PORT } from '../src/lib/defaults.mjs'

const rosu = (t) => `\x1b[31m${t}\x1b[0m`
const verde = (t) => `\x1b[32m${t}\x1b[0m`
const gri = (t) => `\x1b[90m${t}\x1b[0m`
const gros = (t) => `\x1b[1m${t}\x1b[0m`

const pas = (t) => console.log(`${gri('▸')} ${t}`)
const gata = (t) => console.log(`${verde('✓')} ${t}`)

function opreste(titlu, ...randuri) {
  console.error(`\n${rosu('✗')} ${gros(titlu)}\n`)
  for (const r of randuri) console.error(`  ${r}`)
  console.error('')
  process.exit(1)
}

/** Rulează o comandă și întoarce ce a scris, fără să arunce dacă lipsește. */
function ruleaza(cmd, args, optiuni = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...optiuni })
}

const areDocker = () => ruleaza('docker', ['info']).status === 0

/* --- 1. baza de date -------------------------------------------------------- */

const dinAfara = Boolean(process.env.DATABASE_URL)
if (dinAfara) {
  gata('Folosesc DATABASE_URL din mediu; nu pornesc niciun container.')
} else {
  pas('Pornesc PostgreSQL...')

  if (ruleaza('docker', ['--version']).status !== 0) {
    opreste(
      'Docker nu este instalat',
      'Portalul are nevoie de o bază de date PostgreSQL. Cea mai simplă cale este Docker:',
      '',
      `  ${gros('macOS / Windows')}  https://www.docker.com/products/docker-desktop/`,
      `  ${gros('Linux')}            https://docs.docker.com/engine/install/`,
      '',
      'Instalează-l, pornește-l, apoi rulează din nou:  npm start',
      '',
      'Dacă ai deja un PostgreSQL al tău, nu îți trebuie Docker — spune-i portalului unde e:',
      '',
      gri('  DATABASE_URL=postgres://user:parola@localhost:5432/numebaza npm start'),
    )
  }

  if (!areDocker()) {
    opreste(
      'Docker este instalat, dar nu rulează',
      'Deschide aplicația Docker Desktop și așteaptă să scrie „Running”, apoi:  npm start',
      '',
      'Pe Linux:  sudo systemctl start docker',
    )
  }

  const compose = ruleaza('docker', ['compose', 'up', '-d'], { stdio: 'inherit' })
  if (compose.status !== 0) {
    opreste(
      'Baza de date nu a putut porni',
      'Cel mai des, portul 55432 este deja ocupat de altceva.',
      '',
      'Vezi ce rulează:  docker ps',
      `Oprește ce am pornit noi:  docker rm -f ${DEV_DB_CONTAINER}`,
    )
  }

  /* Containerul răspunde la câteva secunde după ce Docker spune „pornit”, iar
   * migrarea care ajunge prea devreme eșuează cu o eroare de rețea, nu cu una
   * care s-ar înțelege. */
  pas('Aștept baza de date...')
  let gataBaza = false
  for (let i = 0; i < 60; i++) {
    const r = ruleaza('docker', ['exec', DEV_DB_CONTAINER, 'pg_isready', '-U', 'postgres', '-d', 'portal'])
    if (r.status === 0) {
      gataBaza = true
      break
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'])
  }
  if (!gataBaza) {
    opreste(
      'Baza de date nu a răspuns în 60 de secunde',
      `Vezi ce spune:  docker logs ${DEV_DB_CONTAINER}`,
    )
  }
  gata(`PostgreSQL rulează pe ${DEV_DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
}

/* --- 2. schema și datele ---------------------------------------------------- */

const mediu = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? DEV_DATABASE_URL }

pas('Aplic migrările...')
const migrare = spawnSync(process.execPath, ['scripts/migrate.mjs'], { stdio: 'inherit', env: mediu })
if (migrare.status !== 0) {
  opreste('Migrările nu au trecut', 'Mesajul de mai sus spune la ce fișier s-a oprit.')
}

/* Popularea este idempotentă și nu este obligatorie: dacă eșuează, portalul
 * pornește gol, ceea ce este tot un lucru de văzut. */
pas('Populez datele demonstrative...')
const populare = spawnSync(process.execPath, ['scripts/seed.mjs'], { stdio: 'inherit', env: mediu })
if (populare.status !== 0) {
  console.warn(`${rosu('!')} Popularea nu a mers; portalul pornește oricum, dar gol.`)
}

/* --- 3. serverul ------------------------------------------------------------ */

console.log(`
${gros('Portalul pornește.')}

  Adresă        ${gros(DEV_BASE_URL)}
  Autentificare fără parolă — pe pagina de intrare sunt patru conturi
                demonstrative, câte unul pentru fiecare rol:

                ${gros('Ana-Maria Lupu')}                student fără coordonator
                ${gros('Dan Marinescu')}                 student cu lucrare în lucru
                ${gros('Prof. univ. dr. Mihaela Ionescu')} cadru didactic
                ${gros('Prof. univ. dr. Daniela Constantin')} director de departament

  Emailurile nu pleacă nicăieri: se scriu ca fișiere .eml în ${gros('outbox/')}.
  Oprește cu Ctrl+C. Baza de date rămâne pornită; ${gri('docker compose down')} o oprește.
`)

const server = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
  stdio: 'inherit',
  env: mediu,
})
server.on('exit', (cod) => process.exit(cod ?? 0))
