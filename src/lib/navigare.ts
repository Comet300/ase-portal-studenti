/**
 * Cum se numesc ecranele portalului.
 *
 * Etichetele existau în două locuri — bara studentului și bara cadrului didactic
 * — și nicăieri altundeva se putea afla numele unui ecran. De aceea butonul
 * „Înapoi” de pe profil scria „Înapoi”, deși știa exact unde duce: nu avea de
 * unde lua cuvântul „Studenți & Cereri”.
 *
 * Tabelul de aici este singura sursă. Barele își păstrează structura (grupuri,
 * pictograme, ce vede fiecare rol) și iau numele de aici, ca o redenumire să nu
 * mai trebuiască făcută în trei locuri.
 */
export const ECRANE: Record<string, string> = {
  '/': 'Acasă',
  '/coordonatori': 'Coordonatori & Teme',
  '/cererile-mele': 'Cererile mele',
  '/mesaje': 'Mesaje',
  '/consultatii': 'Consultații',
  '/arhiva': 'Arhivă',
  '/ghid': 'Ghid',
  '/contul-meu': 'Contul meu',
  '/confidentialitate': 'Confidențialitate',
  '/profesor': 'Panoul meu',
  '/profesor/studenti': 'Studenți & Cereri',
  '/profesor/teme': 'Teme propuse',
  '/profesor/consultatii': 'Consultații',
  '/profesor/mesaje': 'Mesaje',
  '/profesor/facultate': 'Studenții facultății',
  '/profesor/arhiva': 'Arhiva mea',
  '/profesor/departament': 'Departament',
  '/profesor/calendar': 'Calendarul sesiunii',
  '/profesor/an-universitar': 'An universitar',
}

/**
 * Numele ecranului de la o adresă, dacă îl știm.
 *
 * Se compară doar calea: `?sectiune=cereri` sau `#cerere-…` nu schimbă ecranul,
 * iar o adresă necunoscută nu primește un nume inventat — cine întreabă decide ce
 * scrie atunci.
 */
export function numeleEcranului(cale: string): string | null {
  const doarCalea = cale.split(/[?#]/)[0]
  return ECRANE[doarCalea] ?? ECRANE[doarCalea.replace(/\/$/, '')] ?? null
}
