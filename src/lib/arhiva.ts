/**
 * Cititorul rândurilor de arhivă.
 *
 * Stă separat pentru un motiv precis: aceeași funcție citește rândurile și în
 * pagină, pentru previzualizare, și în rută, la scriere. Dacă previzualizarea
 * ar avea propriul cititor, ar arăta un tabel corect și s-ar importa altul —
 * exact felul de diferență pe care nimeni nu o observă până nu e în arhiva
 * publică.
 *
 * Ce vine de la client nu este niciodată de încredere: previzualizarea este o
 * curtoazie, iar ruta reia citirea de la zero pe textul trimis.
 */

/** Coloanele, în ordinea în care se lipesc din foaia de calcul. */
export const COLOANE_ARHIVA = [
  'Nume student',
  'Număr matricol',
  'Program',
  'Nivel',
  'Limbă',
  'Coordonator',
  'Titlul lucrării',
  'Data susținerii',
] as const

export interface RandArhiva {
  studentName: string
  studentNumber: string
  programme: string
  level: string
  language: string
  teacherName: string
  title: string
  /** ISO, sau gol. */
  defended: string
}

export interface RandRespins {
  /** Numărul rândului din text, de la 1 — cum îl numără și omul. */
  numar: number
  text: string
  motiv: string
}

export interface CititArhiva {
  bune: RandArhiva[]
  respinse: RandRespins[]
}

/**
 * Punct și virgulă, nu virgulă: numele și titlurile românești conțin virgule
 * mult mai des decât punct și virgulă. Un tab merge la fel, pentru că asta
 * produce o lipire directă din Excel.
 */
/**
 * O dată care există chiar și în calendar.
 *
 * `new Date('2022-02-31')` nu întoarce NaN: JavaScript rostogolește data peste
 * lună și dă 3 martie. Deci verificarea „nu este NaN” lăsa să treacă orice zi
 * inventată, iar `::date` din Postgres o refuza abia în mijlocul importului — exact
 * eșecul pe care validarea exista ca să îl prevină. Se compară componentele cu
 * data reconstruită: dacă s-au mutat, ziua nu exista.
 */
function dataExista(iso: string): boolean {
  const [an, luna, zi] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(an, luna - 1, zi))
  return (
    d.getUTCFullYear() === an && d.getUTCMonth() === luna - 1 && d.getUTCDate() === zi
  )
}

export function citesteRanduriArhiva(brut: string): CititArhiva {
  const bune: RandArhiva[] = []
  const respinse: RandRespins[] = []

  const linii = brut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const [index, linie] of linii.entries()) {
    const numar = index + 1
    const celule = linie.split(linie.includes('\t') && !linie.includes(';') ? '\t' : ';').map((c) => c.trim())
    const [studentName, studentNumber, programme, level, language, teacherName, title, defended] = celule

    if (!studentName || !teacherName || !title) {
      respinse.push({
        numar,
        text: linie,
        motiv: 'lipsește studentul, coordonatorul sau titlul',
      })
      continue
    }

    const data = (defended ?? '').trim()
    // Doar ISO: „iulie 2024” nu este o dată pentru Postgres, iar `::date` ridica
    // excepția abia în mijlocul importului.
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      respinse.push({ numar, text: linie, motiv: `data „${data}” nu este în formatul AAAA-LL-ZZ` })
      continue
    }
    if (data && !dataExista(data)) {
      respinse.push({ numar, text: linie, motiv: `data „${data}” nu există în calendar` })
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

  return { bune, respinse }
}

/** Nivelul, cum îl scrie o secretariat: „master”, „M”, orice altceva e licență. */
export function nivelArhiva(text: string): 'bachelor' | 'master' {
  return ['master', 'm'].includes(text.trim().toLowerCase()) ? 'master' : 'bachelor'
}
