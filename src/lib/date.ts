/**
 * Datele, scrise în românește.
 *
 * Într-un fișier propriu, fără nicio dependență, pentru două motive care sunt de
 * fapt același: formatarea unei date nu are nimic de-a face cu baza de date, iar
 * cât stătea în `repo.ts` nu se putea nici testa, nici importa în browser fără să
 * tragă cu ea conexiunea la Postgres. Un test care are nevoie de `DATABASE_URL`
 * ca să verifice că duminica intră în săptămâna corectă nu se scrie niciodată.
 */


/* --- Romanian formatting --------------------------------------------------- */

const MONTHS = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
]

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return withTime ? `${base}, ${formatTime(iso)}` : base
}

/**
 * Luni, ca reper de grupare.
 *
 * Un program de consultații se citește pe săptămâni — „ce am săptămâna asta” —
 * nu pe treizeci de rânduri la rând. Săptămâna începe luni, ca în calendarul
 * românesc, iar `getDay()` pune duminica la zero, deci ea se împinge la coada
 * săptămânii care se încheie.
 */
export function startOfWeek(iso: string): string {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  const zi = d.getDay()
  d.setDate(d.getDate() - (zi === 0 ? 6 : zi - 1))
  return ziLocala(d)
}

/**
 * Ziua, scrisă din componentele locale.
 *
 * `toISOString()` trece prin UTC, iar portalul rulează pe `Europe/Bucharest`: la
 * miezul nopții de luni, ora locală este 21:00 duminică în UTC, deci ziua ieșea
 * cu una mai mică. Efectul: fiecare luni cădea în săptămâna dinainte, și grupurile
 * de consultații se numeau „26 iulie – 1 august” — adică de duminică până sâmbătă.
 * Arăta destul de plauzibil ca să treacă neobservat.
 */
function ziLocala(d: Date): string {
  const l = String(d.getMonth() + 1).padStart(2, '0')
  const z = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${l}-${z}`
}

/**
 * Cum se numește o săptămână, față de cea în care ești.
 *
 * „Săptămâna 4–10 august” este exact, dar „săptămâna aceasta” este ce caută
 * ochiul, iar cele două nu se exclud: prima rămâne ca subtitlu.
 */
export function weekLabel(mondayIso: string, todayIso = new Date().toISOString().slice(0, 10)) {
  const luni = new Date(mondayIso + 'T00:00:00')
  const duminica = new Date(luni)
  duminica.setDate(duminica.getDate() + 6)

  const aceasta = startOfWeek(todayIso)
  const diferenta = Math.round(
    (luni.getTime() - new Date(aceasta + 'T00:00:00').getTime()) / (7 * 86_400_000),
  )

  const nume =
    diferenta === 0
      ? 'Săptămâna aceasta'
      : diferenta === 1
        ? 'Săptămâna viitoare'
        : diferenta === -1
          ? 'Săptămâna trecută'
          : null

  const interval =
    luni.getMonth() === duminica.getMonth()
      ? `${luni.getDate()}–${duminica.getDate()} ${MONTHS[luni.getMonth()]}`
      : `${luni.getDate()} ${MONTHS[luni.getMonth()]} – ${duminica.getDate()} ${MONTHS[duminica.getMonth()]}`

  return { nume: nume ?? interval, interval: nume ? interval : null }
}

/**
 * „august 2026”, pentru capul unui grup de fișiere.
 *
 * Fișierele unei coordonări se adună o dată pe lună — un capitol, un set de date
 * — deci luna este singura despărțire naturală într-o listă care crește. Anul se
 * scrie doar când nu e cel curent, altfel se repetă în fiecare cap de grup.
 */
export function monthLabel(iso: string, todayIso = new Date().toISOString()): string {
  const d = new Date(iso)
  const anCurent = new Date(todayIso).getFullYear()
  return d.getFullYear() === anCurent
    ? MONTHS[d.getMonth()]
    : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'acum'
  if (min < 60) return `acum ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `acum ${hours} ${hours === 1 ? 'oră' : 'ore'}`
  const days = Math.floor(hours / 24)
  if (days < 30) return `acum ${days} ${days === 1 ? 'zi' : 'zile'}`
  return formatDate(iso)
}

export function shortMonth(iso: string): string {
  return MONTHS[new Date(iso).getMonth()].slice(0, 3)
}
