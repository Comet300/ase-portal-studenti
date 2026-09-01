# Portal Studenți — Sesiunea de Finalizare a Studiilor

Facultatea de Marketing, Academia de Studii Economice din București.

Aplicație server-rendered (Astro + adaptorul Node) cu PostgreSQL. Interfața este
în limba română; codul, schema și identificatorii sunt în engleză.

## Pornire

Ai nevoie de două lucruri instalate, o singură dată:

| | Ce este | De unde |
|---|---|---|
| **Node.js 22+** | rulează portalul | <https://nodejs.org> — ia versiunea „LTS” |
| **Docker Desktop** | ține baza de date | <https://www.docker.com/products/docker-desktop/> |

Docker trebuie să fie **pornit** (pe macOS și Windows: deschizi aplicația și
aștepți să scrie „Running”). Apoi, în terminal:

```bash
git clone https://github.com/Comet300/ase-portal-studenti.git
cd ase-portal-studenti
npm install
npm start
```

Atât. `npm start` pornește baza de date, creează tabelele, pune înăuntru o
sesiune demonstrativă completă — studenți, cadre didactice, cereri, teme,
consultații — și deschide portalul la **<http://localhost:3000>**.

Nu ai nevoie de niciun fișier de configurare: fără `.env`, portalul folosește
valorile din [`src/lib/defaults.mjs`](src/lib/defaults.mjs).

### Cum intri

Portalul nu are parole: te autentifici cu un link primit pe email. Local nu
pleacă niciun email, așa că pagina de intrare are **patru conturi
demonstrative**, câte unul pentru fiecare rol — un clic și ești înăuntru:

| Cont | Ce vezi |
|---|---|
| Ana-Maria Lupu | student fără coordonator: catalogul, cererea de depus |
| Dan Marinescu | student cu lucrarea în lucru: termene, consultații, fișierul predat |
| Prof. univ. dr. Mihaela Ionescu | cadru didactic: cereri, studenți coordonați, teme, consultații |
| Prof. univ. dr. Daniela Constantin | director de departament: tot, plus registrul facultății |

Emailurile pe care le-ar trimite portalul (linkuri de acces, notificări) se
scriu ca fișiere `.eml` în `outbox/` și se deschid cu dublu clic.

### Dacă ceva nu merge

| Mesaj | Ce înseamnă |
|---|---|
| „Docker nu este instalat” | instalează-l de la linkul de mai sus |
| „Docker este instalat, dar nu rulează” | deschide Docker Desktop și așteaptă să pornească |
| „Baza de date nu a putut porni” | portul 55432 e ocupat: `docker ps` arată de cine |

Ca să o iei de la zero, cu tot cu date: `npm run db:reset`.

Ai deja un PostgreSQL al tău și nu vrei Docker? Spune-i portalului unde e, iar
containerul nu se mai pornește:

```bash
DATABASE_URL=postgres://user:parola@localhost:5432/numebaza npm start
```

### Celelalte comenzi

| Comandă | Ce face |
|---|---|
| `npm start` | tot ce e mai sus: bază de date, migrări, date demonstrative, server |
| `npm run dev` | doar serverul, dacă baza de date rulează deja |
| `npm run verify` | verificarea de tipuri și cele 213 teste |
| `npm run build` | construiește versiunea de producție |
| `npm run db:reset` | șterge baza de date și o reface de la zero |

## Roluri

| Rol | Ce vede |
|---|---|
| `student` | calendarul sesiunii, catalogul de coordonatori și teme, coordonarea proprie, lucrarea (titlu, termene, fișierul predat), propunerile primite, mesaje, consultații — ale coordonatorului și cele publice —, coordonările întregii sesiuni, arhiva, profiluri, ghid |
| `teacher` | dashboard, triaj cereri, studenți coordonați cu cronologie editabilă și lucrarea predată de fiecare, propuneri trimise, teme, program de consultații (publicate, programate, ținute), mesaje, catalogul de coordonatori, ghid, profil |
| `head` | tot ce vede un cadru didactic, plus registrul facultății: studenții facultății (cu adăugarea unui student și importul unei promoții), arhiva sesiunilor, departamentul (acoperire, încărcare, alocarea locurilor pe rândul fiecărui coordonator, conturile cadrelor didactice), calendarul sesiunii și anul universitar |

Rutele `/profesor/*` cer rolul `teacher` sau `head`; `/profesor/facultate`,
`/profesor/departament`, `/profesor/conturi` (redirecționată), `/profesor/calendar` și
`/profesor/an-universitar` cer `head`, iar `/arhiva` — registrul întregii
facultăți — se deschide studenților și directorului, nu și unui coordonator, a
cărui activitate proprie stă pe `/profesor/activitatea-mea`. Un utilizator fără
drept primește 404, nu 403 — nu confirmăm existența unei zone pe care nu o poate
folosi.

## Acces

Portalul nu are față publică. Fără sesiune se deschid doar `/autentificare`,
`/intra`, `/confidentialitate`, `/404`, `/500` și rutele de serviciu
`/api/autentificare`, `/api/demo-login`, `/api/deconectare`, `/api/sanatate`,
`/api/sweep`. Lista este în `src/lib/routes.ts`, se potrivește pe calea exactă
(nu pe prefix) și este fixată în `test/routes.test.ts`: o rută publică nouă
costă o linie acolo, pe care o vede recenzentul. Orice altă adresă cerută fără
sesiune duce la `/autentificare?redirect=<calea cerută, cu tot cu query>`, deci
linkul urmat se deschide după autentificare, nu se pierde.

După autentificare fiecare rol ajunge acasă la el — studentul pe `/`, cadrul
didactic și directorul pe `/profesor`. Regula este `homeFor()` din
`src/lib/http.ts`, folosită de linkul din email, de intrarea demonstrativă și de
pagina de autentificare.

## Anul universitar

Anul este un obiect, nu o convenție: `academic_years` (octombrie–septembrie, un
singur an curent, garantat de un index unic parțial). Tot ce se reia de la zero
poartă `academic_year_id` — etapele calendarului, temele, cererile, alocarea
locurilor, arhiva. Interogările din `src/lib/repo.ts` rezolvă singure anul curent,
deci o pagină amestecă doi ani doar dacă cere explicit asta.

Directorul deschide anul nou și alege ce se preia: programele de studiu, etapele
calendarului, temele active. Nu se șterge nimic; anul precedent devine arhivă.

## Reguli de coordonare

- **Locurile** sunt alocate de director (`seat_allocations`, pe an), nu declarate
  de cadrul didactic. Cine rămâne fără locuri cere altele în scris
  (`seat_requests`). Un coordonator plin rămâne în catalog, estompat, cu studenții
  lui vizibili — iar acceptarea, invitarea și depunerea sunt refuzate.
- **O cerere expiră** după șapte zile fără răspuns: stare `expired`, email către
  student, eveniment în conversație. Măturarea rulează din middleware, limitată
  la o dată la cinci minute, și nu blochează niciun răspuns.
- **Invitațiile** merg în sens invers: cadrul didactic propune, studentul acceptă
  sau refuză motivat. Acceptarea nu creează coordonarea — studentul completează
  aceeași cerere, dar aprobată la depunere.
- **Deciziile, invitațiile, predarea lucrării** ajung în firul de discuție ca
  `messages.kind = 'event'`, afișate ca înregistrare, nu ca replică.
- **Temele** spun pentru cine sunt: nivel plus un program de studii din
  `study_programmes` al anului curent, din care se ia și limba lucrării. Nu au
  locuri proprii — locurile sunt ale coordonatorului, pe nivel și pe program.
- **Consultațiile** au două publicuri: `audience = 'thesis'`, pentru studenții
  coordonați, anunțate lor pe email; și `audience = 'public'`, pe care le vede și
  le rezervă orice student din facultate, fără email — un anunț către toată
  facultatea la fiecare după-amiază deschisă este motivul pentru care oamenii
  închid notificările.
- **Lucrarea** se predă în portal: `files.kind = 'thesis'`, legată de cerere, în
  PDF, cel mult 40 MB. Versiunile nu se suprascriu; cea nouă este un rând nou.
  O văd studentul, coordonatorul lui și directorul — ultimul, din arhiva
  sesiunii.

## Autentificare

Fără parole: se cere un link de acces pe email, valabil 20 de minute și de unică
folosință. În bază se păstrează doar amprenta SHA-256 a tokenului.

`DEMO_MODE=true` adaugă intrarea directă în conturile marcate `is_demo`, fără
email. **Este o ocolire reală a autentificării**: implicit dezactivată, anunțată
vizibil în interfață, iar ruta răspunde 404 când e oprită. Acum că nimic nu se
deschide fără sesiune, pagina de autentificare este toată suprafața publică, iar
butoanele demonstrative de pe ea sunt un clic până în orice ecran — de aceea, cu
`NODE_ENV=production`, pornirea scrie un avertisment în log.

## Configurare

Local nu trebuie setat nimic — valorile implicite din
[`src/lib/defaults.mjs`](src/lib/defaults.mjs) acoperă tot. În producție,
`DATABASE_URL` este obligatorie: fără ea pornirea se oprește, în loc să cadă pe
o valoare implicită care ar căuta o bază de date pe laptopul cuiva.

| Variabilă | Rol | Implicit local |
|---|---|---|
| `DATABASE_URL` | conexiunea PostgreSQL | baza din `compose.yml`, pe portul 55432 |
| `APP_BASE_URL` | originea publică; validează și antetul `Origin` la POST | originea cererii |
| `DEMO_MODE` | `true` activează intrarea fără email | `true` (în producție: `false`) |
| `MAIL_TRANSPORT` | `disk` scrie `.eml` în `outbox/`, `resend` trimite | `disk` |
| `RESEND_API_KEY` | expediere email | — |
| `MAIL_FROM` | expeditorul afișat | — |
| `MAIL_REDIRECT_TO` | redirecționează **tot** mailul către o singură adresă (date demo) | — |
| `UPLOADS_DIR` | directorul atașamentelor; în container, un volum montat | `uploads/` |

Nimic nu este necesar la build: imaginea nu primește build args și nu conține
secrete.

## Structură

```
compose.yml        PostgreSQL pentru o copie locală
migrations/        SQL aplicat în ordinea numelor de fișier
scripts/           start.mjs (o comandă, de la clonă la portal), migrate, seed
src/lib/           db, auth, ids, repo (interogări), years, lifecycle, chat,
                   mail, doc, ics, files, sheet (csv + xlsx), zip, http
src/layouts/       BaseLayout + chrome pentru student și cadru didactic
src/components/    Erou.astro, Chat.astro, Avatar.astro — aceleași pentru ambele
                   roluri
src/pages/         rute (URL-urile rămân în română)
src/styles/app.css sistemul de design
```

## Autorizare

Nu există row-level security. Fiecare funcție care atinge datele unui cadru
didactic primește `teacherId` ca prim parametru și îl folosește în aceeași
instrucțiune care citește sau scrie — o verificare separată, înainte, ar lăsa o
fereastră între control și acțiune.

Identificatorii veniți din formulare sau din URL trec prin `src/lib/ids.ts`.
Orice nu este uuid devine `null`, care nu se potrivește cu niciun rând: PostgreSQL
respinge la fel de tare și șirul gol, iar un câmp modificat manual trebuie să
răspundă „nu a fost găsit”, nu 500.

## Livrare

Container multi-stage (`Dockerfile`), pornit cu migrare, seed și apoi serverul.
Migrările blochează pornirea; seed-ul, fiind date demonstrative, doar
înregistrează eroarea și lasă aplicația să servească. Verificarea de sănătate
este `/api/sanatate` și nu atinge nicio dependență.
