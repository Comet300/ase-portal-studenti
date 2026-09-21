import { normalizeRomanian } from '../tabular.ts'

/**
 * THE REGISTRY EXPORT. Open this file when the registry changes its export.
 *
 * Everything the portal knows about the shape of the faculty's student list
 * lives here: which columns arrive and in what order, which of them are read
 * and which are deliberately thrown away, how a padded cell is cleaned, how
 * „3 Suplimentar” becomes a year, how „M G” becomes a father's initial, and
 * which study programme a cohort belongs to. `accounts.ts` next door stays the
 * generic reader of rows — it takes its rules from here so there is one
 * definition of each, not two that drift.
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
   */
  stored: boolean
}

/**
 * The 25 columns of the export, in the order the file writes them.
 *
 * The seven stored ones are what coordination needs: who the person is, how to
 * reach them, which cohort they are in, and who pays for their studies.
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
  { name: 'denumire', stored: false },
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
  /** `Specializare`: „Marketing” at licență, the programme's name at master. */
  specialisation: string
  /** `LimbaProgram`: „Română” or „Engleză”. */
  language: string
}

export interface DerivedProgramme {
  level: 'bachelor' | 'master'
  /** The name as `study_programmes` holds it, seeded by migration 0020. */
  name: string
  language: 'ro' | 'en'
  /** „Master · Marketing online · Română” — and the value that identifies it. */
  label: string
}

const CYCLES: Record<string, 'bachelor' | 'master'> = {
  licenta: 'bachelor',
  masterat: 'master',
}

const LANGUAGES: Record<string, 'ro' | 'en'> = {
  romana: 'ro',
  engleza: 'en',
}

/**
 * The level and the language, in words, for the label.
 *
 * They are written here and not imported from `years.ts`, which owns them,
 * because `years.ts` opens the database connection on its first line and this
 * module runs in the browser: the import wizard composes the label in the page,
 * before anything is sent. The exact label is pinned by a test — and if the two
 * spellings ever part, every imported row lands with no programme at all rather
 * than on the wrong one, which is the failure that gets noticed.
 */
const LEVEL_WORDS: Record<'bachelor' | 'master', string> = {
  bachelor: 'Licență',
  master: 'Master',
}

const LANGUAGE_WORDS: Record<'ro' | 'en', string> = {
  ro: 'Română',
  en: 'Engleză',
}

/**
 * A programme's whole label, which is what identifies it.
 *
 * A bare name is not an identifier: a programme is unique on (year, level,
 * name, language), and „Managementul relațiilor cu clienții” now exists in both
 * Romanian and English. The label is what the portal's own lists send and what
 * `matchProgramme` resolves first.
 */
export function programmeLabel(p: {
  level: 'bachelor' | 'master'
  name: string
  language: 'ro' | 'en'
}): string {
  return `${LEVEL_WORDS[p.level]} · ${p.name} · ${LANGUAGE_WORDS[p.language]}`
}

/**
 * THE TABLE. A bachelor cohort's form of study, as the portal names it.
 *
 * The registry puts „Marketing” in `Specializare` and the form of study in
 * `FormaInvatamant`. The portal does the opposite: at licență the faculty runs
 * one specialisation in several forms, and migration 0020 made the FORM the
 * programme — „Învățământ cu frecvență — RO”, „Învățământ la distanță —
 * București”. So „Marketing” matches no programme at all, which is why 350
 * accepted rows still landed nowhere, and why this table exists: form plus
 * language decide the programme, and a new form of study is one line.
 *
 * The — RO / — EN suffix exists only for „cu frecvență”: it is the only form
 * the faculty runs in two languages, and the other three programmes carry no
 * suffix at all. Written out per row rather than composed, because the name
 * must match `study_programmes` character for character.
 *
 * „FRECVENȚĂ REDUSĂ” maps to „Învățământ fără frecvență”. The two are not the
 * same words: the registry says „reduced attendance”, the portal says „without
 * attendance”. They are the same thing to the faculty — it is the only
 * non-IF, non-ID bachelor programme 0020 seeds — and the mapping is written out
 * explicitly for exactly that reason: no fuzzy match would ever connect them,
 * and one that did would be connecting them by accident.
 *
 * „LA DISTANȚĂ” resolves to București and not Buzău because `denumire` is
 * „MRK - București” on every row of the export; if Buzău ever appears there,
 * this is the line that has to learn to read it.
 *
 * WHAT THIS TABLE CANNOT EXPRESS, AND WHAT TO DO THEN. The derivation works
 * only because the faculty currently runs exactly ONE bachelor specialisation,
 * Marketing. A portal bachelor programme carries a form of study and no
 * specialisation; the registry models cycle × form × specialisation × language
 * as four independent columns. The moment a second bachelor specialisation
 * appears, „form + language” stops identifying a programme and no number of
 * lines here can fix it — `study_programmes` itself has to grow a form-of-study
 * column, and this function has to key on (form, specialisation, language).
 * That is a change to the programme model, not to this table.
 */
const BACHELOR_FORMS: { form: string; language: 'ro' | 'en'; name: string }[] = [
  { form: 'cu frecventa', language: 'ro', name: 'Învățământ cu frecvență — RO' },
  { form: 'cu frecventa', language: 'en', name: 'Învățământ cu frecvență — EN' },
  { form: 'frecventa redusa', language: 'ro', name: 'Învățământ fără frecvență' },
  { form: 'la distanta', language: 'ro', name: 'Învățământ la distanță — București' },
]

/**
 * The programme a registry row belongs to, or null when the cohort is unknown.
 *
 * Null is not an error here: the caller writes an empty „Program” cell, and the
 * import screen then says which value it did not recognise, in front of the
 * director, before anything is written. Refusing inside this function would
 * lose the cohort that caused it.
 *
 * At master there is no table: the registry's `Specializare` already IS the
 * programme's name, character for character, so a master programme added by the
 * faculty needs a row in `study_programmes` and no code at all. A name that
 * exists in neither language is reported by `matchProgramme` with the name in
 * the message, which is the sentence somebody can act on.
 */
export function deriveProgramme(cohort: RegistryCohort): DerivedProgramme | null {
  const level = CYCLES[foldForMatching(cohort.cycle)]
  const language = LANGUAGES[foldForMatching(cohort.language)]
  if (!level || !language) return null

  if (level === 'master') {
    const name = normalizeRegistryCell(cohort.specialisation)
    if (!name) return null
    return { level, name, language, label: programmeLabel({ level, name, language }) }
  }

  const form = foldForMatching(cohort.form)
  const found = BACHELOR_FORMS.find((f) => f.form === form && f.language === language)
  if (!found) return null
  return {
    level,
    name: found.name,
    language,
    label: programmeLabel({ level, name: found.name, language }),
  }
}

/* --- finding the four columns in a header row ----------------------------------- */

export interface RegistryProgrammeColumns {
  cycle: number
  form: number
  specialisation: number
  language: number
}

/**
 * Where the four columns a programme is derived from sit in this header.
 *
 * All four or nothing: a file with three of them is not a registry export, and
 * guessing from three would produce a programme for some rows and silence for
 * the others — the worst of the three possible answers.
 */
export function findRegistryColumns(header: string[]): RegistryProgrammeColumns | null {
  const folded = header.map(foldForMatching)
  const at = (name: string) => folded.indexOf(foldForMatching(name))

  const columns = {
    cycle: at('TipCicluStudii'),
    form: at('FormaInvatamant'),
    specialisation: at('Specializare'),
    language: at('LimbaProgram'),
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
