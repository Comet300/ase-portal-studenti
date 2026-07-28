# Portal Studenți — Sesiunea de Finalizare a Studiilor 2026

Facultatea de Marketing, Academia de Studii Economice din București.

Aplicație server-rendered (Astro + adaptorul Node) cu PostgreSQL. Interfața este
în limba română; codul, schema și identificatorii sunt în engleză.

## Roluri

| Rol | Ce vede |
|---|---|
| `student` | calendarul sesiunii, catalogul de coordonatori, cererile proprii, mesaje, consultații, ghid |
| `teacher` | dashboard, triaj cereri, studenți coordonați cu cronologie editabilă, teme, program de consultații, mesaje, arhivă |
| `head` | tot ce vede un cadru didactic, plus vederea pe departament (acoperire, încărcare, export CSV) |

Rutele `/profesor/*` cer rolul `teacher` sau `head`; `/profesor/departament` cere
`head`. Un utilizator fără drept primește 404, nu 403 — nu confirmăm existența
unei zone pe care nu o poate folosi.

## Autentificare

Fără parole: se cere un link de acces pe email, valabil 20 de minute și de unică
folosință. În bază se păstrează doar amprenta SHA-256 a tokenului.

`DEMO_MODE=true` adaugă intrarea directă în conturile marcate `is_demo`, fără
email. **Este o ocolire reală a autentificării**: implicit dezactivată, anunțată
vizibil în interfață, iar ruta răspunde 404 când e oprită.

## Configurare

| Variabilă | Rol |
|---|---|
| `DATABASE_URL` | conexiunea PostgreSQL (obligatorie) |
| `APP_BASE_URL` | originea publică; validează și antetul `Origin` la POST |
| `RESEND_API_KEY` | expediere email |
| `MAIL_FROM` | expeditorul afișat |
| `MAIL_REDIRECT_TO` | redirecționează **tot** mailul către o singură adresă (date demo) |
| `UPLOADS_DIR` | directorul atașamentelor; în container, un volum montat |
| `DEMO_MODE` | `true` activează intrarea fără email |

Nimic nu este necesar la build: imaginea nu primește build args și nu conține
secrete.

## Rulare locală

```bash
npm install
export DATABASE_URL=postgres://user:parola@localhost:5432/portal
npm run db:migrate     # aplică migrations/*.sql
npm run db:seed        # date demonstrative, idempotent
npm run dev
```

## Structură

```
migrations/        SQL aplicat în ordinea numelor de fișier
scripts/           migrate.mjs, seed.mjs
src/lib/           db, auth, repo (interogări), chat, mail, ics, files, http
src/layouts/       BaseLayout + chrome pentru student și cadru didactic
src/components/    Chat.astro, folosit identic de ambele roluri
src/pages/         rute (URL-urile rămân în română)
src/styles/app.css sistemul de design
```

## Autorizare

Nu există row-level security. Fiecare funcție care atinge datele unui cadru
didactic primește `teacherId` ca prim parametru și îl folosește în aceeași
instrucțiune care citește sau scrie — o verificare separată, înainte, ar lăsa o
fereastră între control și acțiune.

## Livrare

Container multi-stage (`Dockerfile`), pornit cu migrare, seed și apoi serverul.
Migrările blochează pornirea; seed-ul, fiind date demonstrative, doar
înregistrează eroarea și lasă aplicația să servească. Verificarea de sănătate
este `/api/sanatate` și nu atinge nicio dependență.
