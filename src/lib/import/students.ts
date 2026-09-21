import { normalizeLocation } from '../programmes.mjs'
import { normalizeRomanian } from '../tabular.ts'

/**
 * THE REGISTRY EXPORT. Open this file when the registry changes its export.
 *
 * Everything the portal knows about the shape of the faculty's student list
 * lives here: which columns arrive and in what order, which of them are read
 * and which are deliberately thrown away, how a padded cell is cleaned, how
 * „3 Suplimentar” becomes a year, how „M G” becomes a father's initial, and
 * how the registry's words for a cohort become the values `study_programmes`
 * stores. `accounts.ts` next door stays the generic reader of rows — it takes
 * its rules from here so there is one definition of each, not two that drift.
 *
 * WHY A MODULE OF ITS OWN. The rules were inside the generic reader, written as
 * two regular expressions — one letter for the initial, one digit for the year.
 * Both were right for a list typed by hand and wrong for the file the registry
 * actually exports: 323 rows out of 893 were refused for an initial of two
 * letters („M G”), 27 for a fifth year written „3 Suplimentar”, and 350 more
 * were accepted and then landed on no programme at all. None of that was
 * visible from the reader, because the reader does not know what a SIMUR export
 * looks like. Now it is one file, and the file says so in its name.
 *
 * WHAT IT DOES NOT DO. It does not read the workbook — `tabular.ts` does that,
 * and it already trims the fixed-width padding and folds the cedilla `ş`/`ţ`
 * into the comma-below `ș`/`ț` that the portal writes. The functions here are
 * applied a second time on the text path (a paste, or a row typed straight into
 * the box the route re-reads), where nothing has cleaned the cells.
 */

/* --- the column contract ----------------------------------------------------- */

export interface RegistryColumn {
  /** Exactly as the registry writes it in the header row. */
  name: string
  /**
   * Whether the value reaches the database.
   *
   * A column that is read past is not a column that rejects a row: a surplus
   * column is ignored, always. This flag exists so the template below and the
   * sentence on the import screen cannot say something different from the code.
   *
   * „Reaches the database” includes reaching it as part of something else:
   * `denumire` is stored as the teaching centre of the programme the student
   * lands on, not as a column of `users`.
   */
  stored: boolean
}

/**
 * The 25 columns of the export, in the order the file writes them.
 *
 * The eight stored ones are what coordination needs: who the person is, how to
 * reach them, which cohort they are in — all five facts of it, `denumire`
 * included — and who pays for their studies.
 *
 * THE REST ARE READ PAST ON PURPOSE, AND MUST STAY THAT WAY. `CNP` is the
 * national identification number, a specially regulated identifier under
 * Romanian law and GDPR; `SerieCI`, `NumarCI`, `EmitentCI` and `DataCI` are the
 * identity card; `DataNastere`, `Sex`, `telefon1`, `telefon2`, `Adresa`,
 * `IdLocalitateDomiciliu`, `LocDom` and `JudDom` are private contact and
 * domicile data. No screen, document, notification or report in this portal
 * uses any of them, so storing them would create a register of personal data
 * with no purpose, no retention rule and no one asking for it. Do not
 * „helpfully” add them because the file happens to carry them: a column added
 * here is a column somebody must later justify.
 *
 * TRAP: `SerieCI` is the series of the IDENTITY CARD, not the study series. A
 * mapping that lands it in „Serie” is silently wrong for every row in the file,
 * and nothing downstream can tell — which is why `NEVER_MAPPED` below refuses
 * it outright rather than letting the header guesser score it.
 */
export const REGISTRY_COLUMNS: RegistryColumn[] = [
  { name: 'TipCicluStudii', stored: true },
  { name: 'FormaInvatamant', stored: true },
  // The teaching centre — „MRK - București” on all 893 rows of the current
  // file, and the only column that can ever say „Buzău”. It was read past
  // until now, and the form-of-study table guessed București for every
  // distance-learning row instead, which is a fact invented about a student.
  { name: 'denumire', stored: true },
  { name: 'AnDebutOfertaStudii', stored: false },
  { name: 'AnStudiu', stored: true },
  { name: 'Specializare', stored: true },
  { name: 'LimbaProgram', stored: true },
  { name: 'Nume', stored: true },
  { name: 'Initiale', stored: true },
  { name: 'Prenume', stored: true },
  { name: 'Sex', stored: false },
  { name: 'CNP', stored: false },
  { name: 'DataNastere', stored: false },
  { name: 'SerieCI', stored: false },
  { name: 'NumarCI', stored: false },
  { name: 'EmitentCI', stored: false },
  { name: 'DataCI', stored: false },
  { name: 'telefon1', stored: false },
  { name: 'telefon2', stored: false },
  { name: 'Email', stored: true },
  { name: 'Adresa', stored: false },
  { name: 'IdLocalitateDomiciliu', stored: false },
  { name: 'LocDom', stored: false },
  { name: 'JudDom', stored: false },
  { name: 'FormaFinantare', stored: true },
]

/** The header row, for the template and for recognising the file. */
export const REGISTRY_HEADER: string[] = REGISTRY_COLUMNS.map((c) => c.name)

/* --- cleaning a cell ---------------------------------------------------------- */

/**
 * One cell of the export, as the portal wants it.
 *
 * Three things the file does and no other file does. Values are padded to a
 * fixed width, so everything is trimmed. A missing value is written as the
 * four letters `NULL`, not as an empty cell — left alone, a student would be
 * called „NULL” on a signed document and one address in the file would read
 * „NULL” and be refused with a message about an e-mail. And the diacritics are
 * the Turkish cedilla `ş`/`ţ` rather than the Romanian comma-below `ș`/`ț`,
 * folded by `normalizeRomanian` — reused rather than copied, because two
 * alphabets in one register is a name that never comes back from a search.
 */
export function normalizeRegistryCell(raw: string | null | undefined): string {
  const text = normalizeRomanian(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  return text === 'NULL' ? '' : text
}

/**
 * A header or a value, compared the way a person compares it.
 *
 * „Număr matricol”, „NUMAR MATRICOL” and „Nr. Matricol” are the same column to
 * everyone except a string comparison, so the marks are dropped and the
 * punctuation becomes space. U+0326, the comma below, sits outside the block
 * the other marks live in; left in, the rule underneath would read it as
 * punctuation and „Număr” would fold to „numa r”.
 *
 * The camel-case cut is the registry's doing: it writes `AnStudiu`,
 * `FormaFinantare` and `TipCicluStudii` with no separator at all, and a fold
 * that only cut on punctuation matched none of them — the year column stayed
 * unmapped for all 893 rows and every row came in without a year.
 */
export function foldForMatching(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-̦ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Headers the guesser must never offer to any field.
 *
 * `SerieCI` folds to „serie ci” and matches the study-series hint on the word
 * „seri”, which would have put an identity-card series into the study series of
 * all 893 students without one error anywhere. The rest are the regulated and
 * private columns above: a guess that maps them is a guess that starts storing
 * them the first time somebody presses through the wizard without reading it.
 */
const NEVER_MAPPED: RegExp[] = [
  /^cnp$/,
  /\bci\b/,
  /nastere/,
  /^sex$/,
  /telefon/,
  /domiciliu/,
  /^loc dom$/,
  /^jud dom$/,
]

/** Whether a header is one the portal refuses to read into any field. */
export function isNeverMappedHeader(header: string): boolean {
  const folded = foldForMatching(header)
  return NEVER_MAPPED.some((pattern) => pattern.test(folded))
}

/* --- the year of study --------------------------------------------------------- */

export interface StudyYear {
  /** „1” … „6”, or empty when the cell is empty. */
  year: string
  /** The Romanian words that qualify the year, kept rather than dropped. */
  note: string
}

/**
 * „3”, or „3 Suplimentar” — a year and what the registry wrote beside it.
 *
 * Twenty-seven students in the real file are in a supplementary year: they are
 * in year 3, and they are also in a situation the secretariat tracks. The rule
 * used to be one digit and nothing else, so all twenty-seven were refused — and
 * refusing a row means a person who cannot sign in at all. Truncating to „3”
 * instead would have been worse in a different way: the fact would have
 * disappeared from the portal silently, and the coordinator would have been the
 * last to learn that their student is repeating.
 *
 * Anything else returns null rather than being kept as a note: a cell that
 * slipped a column („Marketing”, an e-mail) has to stop the row, not become a
 * note printed next to a year.
 */
export function parseStudyYear(raw: string | null | undefined): StudyYear | null {
  const text = normalizeRegistryCell(raw)
  if (!text) return { year: '', note: '' }

  const match = text.match(/^([1-6])\s*(.*)$/)
  if (!match) return null

  const rest = match[2]!.trim()
  if (!rest) return { year: match[1]!, note: '' }
  if (/^supliment(ar|ara|ară)?$/.test(foldForMatching(rest))) {
    return { year: match[1]!, note: 'An suplimentar' }
  }
  return null
}

/* --- the father's initial ------------------------------------------------------ */

/** One initial: a letter, or the two of „Gh.” — never a whole word. */
const ONE_INITIAL = /^[A-Za-zĂÂÎȘȚăâîșț]{1,2}$/

/**
 * „M G”, „Gh.”, „S G C” — one to three initials, stored in one form.
 *
 * The father's initial is part of a Romanian student's official name, and the
 * secretariat matches a printed request against the register by exactly that
 * form. The rule used to allow a single initial of one or two letters, which
 * refused 329 rows of the real file at a stroke: a father with two given names
 * is written „M G”, and one student in the list has three.
 *
 * The canonical form is the bare letters, title-cased, separated by one space —
 * „Gh.”, „gh” and „GH.” all become „Gh”, and „M.G.” becomes „M G”. The point is
 * added where the name is printed (`formatInitial` in `text.ts`), not stored,
 * because the registrar pastes the column both ways in the same term.
 *
 * Anything else returns null: a whole cell that slipped a column would
 * otherwise be printed inside somebody's name on a document that gets signed.
 */
export function parseFatherInitials(raw: string | null | undefined): string | null {
  const text = normalizeRegistryCell(raw).replace(/\./g, ' ').trim()
  if (!text) return ''

  const tokens = text.split(/\s+/)
  if (tokens.length > 3) return null

  const canonical: string[] = []
  for (const token of tokens) {
    if (!ONE_INITIAL.test(token)) return null
    canonical.push(
      token.charAt(0).toLocaleUpperCase('ro-RO') + token.slice(1).toLocaleLowerCase('ro-RO'),
    )
  }
  return canonical.join(' ')
}

/* --- the cohort, and the programme it belongs to -------------------------------- */

export interface RegistryCohort {
  /** `TipCicluStudii`: „LICENȚĂ” or „MASTERAT”. */
  cycle: string
  /** `FormaInvatamant`: „CU FRECVENȚĂ”, „LA DISTANȚĂ”, „FRECVENȚĂ REDUSĂ”. */
  form: string
  /** `Specializare`: „Marketing” at licență, the specialisation at master. */
  specialisation: string
  /** `LimbaProgram`: „Română” or „Engleză”. */
  language: string
  /** `denumire`: „MRK - București” — the centre the cohort is taught at. */
  location: string
}

/** A cohort, in the values `study_programmes` stores. */
export interface ProgrammeIdentity {
  level: string
  form_of_study: string
  specialisation: string
  language: string
  location: string
}

/**
 * THE VOCABULARY. The registry's words, in the portal's values.
 *
 * This is the whole translation now, and it is a translation of WORDS and not
 * of MEANING. Until this release there was a table here that turned a cycle, a
 * form of study and a language into one of five hand-written programme names,
 * because the portal's licență programme WAS the form of study and had nowhere
 * to put a specialisation. It worked only while the faculty ran exactly one
 * licență specialisation; a second one could not be expressed at all, and two
 * cohorts differing only by specialisation would have become the same
 * programme — one pot of seats, one catalogue, one line in every report, for
 * two different groups of students. `study_programmes` carries the four facts
 * itself since migration 0024, so the importer looks up what the registry
 * already states instead of deciding anything.
 *
 * The keys are folded by `foldForMatching`, so the cedilla, the fixed-width
 * padding and the capitals of the export are all already gone.
 */
const CYCLES: Record<string, string> = {
  licenta: 'bachelor',
  masterat: 'master',
}

const FORMS_OF_STUDY: Record<string, string> = {
  'cu frecventa': 'if',
  'frecventa redusa': 'ifr',
  'la distanta': 'id',
}

const LANGUAGES: Record<string, string> = {
  romana: 'ro',
  engleza: 'en',
}

/**
 * The teaching centre a `denumire` cell names, among the ones the portal holds.
 *
 * `denumire` reads „MRK - București” on all 893 rows of the current export: the
 * faculty's own code, then the city. The version before 0023 read past the
 * column entirely and answered „București” for every distance-learning row,
 * which is a fact invented about a student — the faculty teaches at Buzău too.
 * 0023 replaced that with a table of four hand-written spellings, which was
 * right for the two centres that existed and wrong in shape: it was a SECOND
 * list of the faculty's centres, next to the one in the database, and the day a
 * director opened a third centre the importer would have gone on refusing every
 * row of it until somebody edited this file.
 *
 * So the candidates are passed in — they are the centres the year's programmes
 * are actually taught at, which is the same list migration 0025 made a table
 * of. „MRK - București” resolves to the stored „București” because the stored
 * one is what it is compared against, not because a line here says so.
 *
 * Four passes, and the order is the whole design: everything written exactly is
 * tried before anything written approximately. A register that carries both
 * „Buzău” and a legacy „Buzau” must send a file that wrote „Buzău” to „Buzău”,
 * not to whichever of the two the query happened to return first — the fold
 * drops diacritics and cannot tell them apart.
 *
 *   1. the whole cell, exactly — a registrar's own sheet writes the city alone;
 *   2. the tail, exactly — „MRK - Buzău”, the faculty's code and then the city;
 *   3. the whole cell, folded — the same sheet with a cedilla or other capitals;
 *   4. the tail, folded — the export's own „MRK - Bucureşti”.
 *
 * A tail counts only when what precedes it is a separator, so „Vâlcea” does not
 * swallow „Râmnicu Vâlcea”; and the longest matching centre wins, so a faculty
 * that runs both gets the one the file actually named.
 *
 * Null when nothing matches, and the row is then refused by name — loudly, in
 * the preview, in front of the director, before a single account is written.
 */
function endsOnCentre(text: string, name: string): boolean {
  if (!name || text.length <= name.length || !text.endsWith(name)) return false
  return /[\s\-–—·.,]/.test(text[text.length - name.length - 1]!)
}

function longestCentre(matches: readonly string[]): string | null {
  return matches.reduce<string | null>((best, l) => (!best || l.length > best.length ? l : best), null)
}

export function matchCentre(raw: string, locations: readonly string[]): string | null {
  const cell = normalizeLocation(normalizeRegistryCell(raw))
  if (!cell) return null

  const exact = locations.find((l) => l === cell)
  if (exact) return exact

  const tail = longestCentre(locations.filter((l) => endsOnCentre(cell, l)))
  if (tail) return tail

  const folded = foldForMatching(cell)
  const same = locations.find((l) => foldForMatching(l) === folded)
  if (same) return same

  return longestCentre(locations.filter((l) => endsOnCentre(folded, foldForMatching(l))))
}

/**
 * The cohort, in the values `study_programmes` stores — or null.
 *
 * Null means one of the five cells says something this portal has never seen.
 * It is not an error here: the caller turns it into a cell the director reads
 * (see `describeCohort`), and the row is refused further down with the values
 * in the message. Refusing inside this function would lose exactly the words
 * somebody needs in order to fix it.
 *
 * `locations` is the fifth cell's vocabulary and the only one that is not
 * written down in this file, because it is the only one of the five the faculty
 * changes on its own.
 */
export function registryDimensions(
  cohort: RegistryCohort,
  locations: readonly string[],
): ProgrammeIdentity | null {
  const level = CYCLES[foldForMatching(cohort.cycle)]
  const form_of_study = FORMS_OF_STUDY[foldForMatching(cohort.form)]
  const language = LANGUAGES[foldForMatching(cohort.language)]
  const location = matchCentre(cohort.location, locations)
  const specialisation = normalizeRegistryCell(cohort.specialisation)

  if (!level || !form_of_study || !language || !location || !specialisation) return null
  return { level, form_of_study, specialisation, language, location }
}

/**
 * The five cells as the file wrote them, for the sentence that refuses the row.
 *
 * A cohort with no programme has to be readable as a cohort: „nu există” about
 * an empty cell tells the director nothing, while „LICENȚĂ · LA DISTANȚĂ ·
 * Marketing · Engleză · MRK - Buzău” names the exact group of students who have
 * no programme defined and can be gone and defined in „An universitar”.
 *
 * Every cell empty means the file simply has no cohort in it — a list of
 * teachers, or a registrar's sheet with the four columns blank — and that is
 * legal and silent.
 */
export function describeCohort(cohort: RegistryCohort): string {
  const cells = [cohort.cycle, cohort.form, cohort.specialisation, cohort.language, cohort.location]
    .map(normalizeRegistryCell)
  return cells.some(Boolean) ? cells.map((c) => c || '—').join(' · ') : ''
}

/**
 * The programme a registry row belongs to, looked up among the year's own.
 *
 * No derivation is left: the five values come straight out of the row and the
 * answer is whichever programme carries the same five. A cohort that matches
 * none is a cohort the faculty has not defined for this year — which is a
 * decision for the director and not a guess for the importer, and it is the
 * whole reason this returns null instead of inventing a nearest match.
 *
 * The specialisation is compared case- and padding-insensitively, because it is
 * the one value of the five that is free text on both sides: the registry
 * writes „Marketing online” and a director may have typed „Marketing Online”.
 */
export function deriveProgramme<T extends ProgrammeIdentity>(
  cohort: RegistryCohort,
  programmes: T[],
): T | null {
  /* The known centres, read off the programmes themselves rather than passed
   * in separately. They are the same rows `teaching_locations` holds — a
   * programme cannot name a centre that is not in it since migration 0025 —
   * and taking them from here means no caller has to fetch and thread a second
   * list through for a value it already has in hand. */
  const wanted = registryDimensions(cohort, [...new Set(programmes.map((p) => p.location))])
  if (!wanted) return null

  const key = wanted.specialisation.toLocaleLowerCase('ro-RO')
  return (
    programmes.find(
      (p) =>
        p.level === wanted.level &&
        p.form_of_study === wanted.form_of_study &&
        p.language === wanted.language &&
        p.location === wanted.location &&
        normalizeRegistryCell(p.specialisation).toLocaleLowerCase('ro-RO') === key,
    ) ?? null
  )
}

/**
 * What goes in the „Program” cell for one registry row.
 *
 * The label of the programme it matched, or — when it matched none — the five
 * cells as the file wrote them, so that the refusal further down names the
 * cohort. Both paths produce text, because the wizard's only channel to the
 * route is text the route reads again with the same reader.
 */
export function programmeCell<T extends ProgrammeIdentity & { label: string }>(
  cohort: RegistryCohort,
  programmes: T[],
): string {
  return deriveProgramme(cohort, programmes)?.label ?? describeCohort(cohort)
}

/* --- finding the five columns in a header row ----------------------------------- */

export interface RegistryProgrammeColumns {
  cycle: number
  form: number
  specialisation: number
  language: number
  location: number
}

/**
 * Where the five columns a programme is looked up by sit in this header.
 *
 * All five or nothing: a file with four of them is not a registry export, and
 * guessing from four would produce a programme for some rows and silence for
 * the others — the worst of the three possible answers. `denumire` is the fifth
 * and it joined the set in this release: reading four and assuming București
 * for the fifth is precisely the defect this change removes.
 */
export function findRegistryColumns(header: string[]): RegistryProgrammeColumns | null {
  const folded = header.map(foldForMatching)
  const at = (name: string) => folded.indexOf(foldForMatching(name))

  const columns = {
    cycle: at('TipCicluStudii'),
    form: at('FormaInvatamant'),
    specialisation: at('Specializare'),
    language: at('LimbaProgram'),
    location: at('denumire'),
  }
  return Object.values(columns).some((i) => i < 0) ? null : columns
}

/* --- the template the faculty downloads ----------------------------------------- */

/**
 * What a column the portal reads past says in the template.
 *
 * The identity-card and domicile columns are in the template only because a
 * real export has them and the importer has to survive them. Writing a
 * plausible CNP or card number into an example file would put a specimen of a
 * regulated identifier in every download — and somebody would eventually paste
 * a real one over it and expect the portal to keep it. The sentence in the cell
 * says what happens instead.
 */
const NOT_IMPORTED = 'nu se importă'

/**
 * Two example rows, in the registry's own format.
 *
 * They live here, next to the parser, so the template and the reader cannot
 * drift apart: a test parses exactly these rows through the whole pipeline and
 * requires zero rejections. Between them they carry every shape that used to
 * break the import — the cycle spelled as the registry spells it, a two-token
 * initial, a supplementary year, the literal „NULL” for a missing value, and a
 * master programme in English.
 */
export const REGISTRY_TEMPLATE_ROWS: string[][] = [
  [
    'LICENȚĂ',
    'CU FRECVENȚĂ',
    'MRK - București',
    '2023',
    '3 Suplimentar',
    'Marketing',
    'Română',
    'DUMITRU',
    'M G',
    'IOANA',
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    'ioana.dumitru@stud.ase.ro',
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    'Buget RO',
  ],
  [
    'MASTERAT',
    'CU FRECVENȚĂ',
    'MRK - București',
    '2025',
    '2',
    'Managementul relațiilor cu clienții',
    'Engleză',
    'POPA',
    'NULL',
    'ANDREI',
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    'andrei.popa@stud.ase.ro',
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    NOT_IMPORTED,
    'Taxa',
  ],
]
