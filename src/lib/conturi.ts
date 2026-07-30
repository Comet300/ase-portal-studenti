/**
 * Cititorul listelor de conturi.
 *
 * Un an universitar începe cu o listă de la secretariat: două sute de rânduri
 * lipite dintr-o foaie de calcul. Aceeași funcție citește rândurile și în pagină,
 * pentru previzualizare, și în rută, la scriere — ca la importul de arhivă, și
 * din același motiv: două cititoare ar arăta un tabel și ar scrie altul.
 *
 * Nu are nicio dependență, ca să poată fi importat și în browser.
 */

export const COLOANE_CONTURI = [
  'Nume',
  'Email',
  'Rol',
  'Număr matricol',
  'Program',
  'An',
  'Grupa',
] as const

export type RolCont = 'student' | 'teacher' | 'head'

export interface RandCont {
  name: string
  email: string
  role: RolCont
  studentNumber: string
  programme: string
  year: string
  group: string
}

export interface RandRespinsCont {
  numar: number
  text: string
  motiv: string
}

export interface CititConturi {
  bune: RandCont[]
  respinse: RandRespinsCont[]
}

/**
 * Adresa, verificată cât să prindă greșeli de tastare, nu să respingă adrese
 * ciudate dar valide. Un `@` cu ceva de o parte și de alta, un punct în domeniu,
 * fără spații. Restul îl spune realitatea: linkul ajunge sau nu.
 */
function emailPlauzibil(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

/** „student”, „cadru didactic”, „director” — cum le scrie secretariatul. */
export function rolCont(text: string): RolCont | null {
  const t = text.trim().toLowerCase()
  if (!t || t === 'student' || t === 's') return 'student'
  if (['cadru', 'cadru didactic', 'profesor', 'teacher', 'p', 'c'].includes(t)) return 'teacher'
  if (['director', 'head', 'director de departament', 'd'].includes(t)) return 'head'
  return null
}

export function citesteRanduriConturi(brut: string): CititConturi {
  const bune: RandCont[] = []
  const respinse: RandRespinsCont[] = []
  const vazute = new Set<string>()

  const linii = brut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const [index, linie] of linii.entries()) {
    const numar = index + 1
    const sep = linie.includes('\t') && !linie.includes(';') ? '\t' : ';'
    const [name, email, role, studentNumber, programme, year, group] = linie
      .split(sep)
      .map((c) => c.trim())

    if (!name || !email) {
      respinse.push({ numar, text: linie, motiv: 'lipsește numele sau adresa de email' })
      continue
    }
    if (!emailPlauzibil(email)) {
      respinse.push({ numar, text: linie, motiv: `„${email}” nu arată a adresă de email` })
      continue
    }

    /* Duplicatele din aceeași listă se opresc aici, nu în baza de date: altfel
     * primul rând ar intra și al doilea ar da o eroare de unicitate în mijlocul
     * importului, exact tiparul pe care importul de arhivă îl evită. */
    const cheie = email.toLowerCase()
    if (vazute.has(cheie)) {
      respinse.push({ numar, text: linie, motiv: `adresa „${email}” apare de două ori în listă` })
      continue
    }
    vazute.add(cheie)

    const rol = rolCont(role ?? '')
    if (!rol) {
      respinse.push({
        numar,
        text: linie,
        motiv: `rolul „${role}” nu e recunoscut (student, cadru didactic, director)`,
      })
      continue
    }

    const an = (year ?? '').trim()
    if (an && !/^[1-6]$/.test(an)) {
      respinse.push({ numar, text: linie, motiv: `anul „${an}” trebuie să fie între 1 și 6` })
      continue
    }

    bune.push({
      name,
      email: cheie,
      role: rol,
      studentNumber: studentNumber ?? '',
      programme: programme ?? '',
      year: an,
      group: group ?? '',
    })
  }

  return { bune, respinse }
}
