/**
 * What the portal's screens are called.
 *
 * The labels existed in two places — the student sidebar and the teaching-staff
 * sidebar — and nowhere else could the name of a screen be found. That is why
 * the „Înapoi” button on a profile said „Înapoi”, even though it knew exactly
 * where it led: it had nowhere to take the words „Studenți & Cereri” from.
 *
 * The table here is the only source. The sidebars keep their own structure
 * (groups, icons, what each role sees) and take the names from here, so that a
 * rename no longer has to be made in three places.
 */
export const SCREENS: Record<string, string> = {
  '/': 'Acasă',
  '/coordonatori': 'Coordonatori & Teme',
  '/lucrarea-mea': 'Lucrarea mea',
  /* The address the screen had while it was only about the request. It stays in
   * the table because it is written in emails already delivered: without a name
   * here, a „?de_la=” coming back from one of them renders a bare „Înapoi”. */
  '/cererile-mele': 'Lucrarea mea',
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
  '/profesor/activitatea-mea': 'Activitatea mea',
  /* The address the screen had while it was also carrying the profile form and
   * the seats request. It stays in the table because it is written in emails
   * already delivered and in bookmarks: without a name here, a „?de_la=” coming
   * back from one of them renders a bare „Înapoi”. */
  '/profesor/arhiva': 'Activitatea mea',
  '/profesor/departament': 'Departament',
  '/profesor/conturi': 'Conturi',
  '/profesor/calendar': 'Calendarul sesiunii',
  '/profesor/an-universitar': 'An universitar',
}

/**
 * The name of the screen at a URL, if it is known.
 *
 * Only the path is compared: `?sectiune=cereri` or `#cerere-…` does not change
 * the screen, and an unknown URL does not get an invented name — whoever asks
 * decides what is written then.
 */
export function screenName(path: string): string | null {
  const pathOnly = path.split(/[?#]/)[0]
  return SCREENS[pathOnly] ?? SCREENS[pathOnly.replace(/\/$/, '')] ?? null
}
