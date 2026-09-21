/**
 * What a study programme IS, and what it is therefore called.
 *
 * A programme used to be a level, a `name` and a language, and the `name` meant
 * two different things depending on the level: at licență it was the FORM OF
 * STUDY („Învățământ la distanță — Buzău”) and at master the SPECIALISATION
 * („Marketing online”). The registry — which is the source of truth — has
 * always described the same cohort with four independent facts: cycle, form of
 * study, specialisation and language, plus the teaching centre. Projecting four
 * facts onto one string worked only while the faculty ran exactly one licență
 * specialisation; a second one could not be written down at all, and two
 * cohorts differing only by specialisation would have become the same row —
 * one set of seats, one catalogue entry, one line in every report, for two
 * different groups of people.
 *
 * So the four are columns now, and this module is the only place that turns
 * them back into words. The dimensions are the identity; the label is
 * presentation, and it is computed, never typed.
 *
 * WHY PLAIN JAVASCRIPT. Same reason as `defaults.mjs` next door: `scripts/
 * seed.mjs` runs on bare Node with no TypeScript step and has to write the very
 * same names the portal computes. If the seed spelled them itself they would
 * drift, and a drifted name is a second row in `study_programmes` for a
 * programme that already exists — the exact duplication this change exists to
 * make impossible. One definition, four readers: the app, the seed, the import
 * wizard in the browser, and the tests.
 */

/** @typedef {'bachelor' | 'master'} ProgrammeLevel */

/**
 * @typedef {'if' | 'ifr' | 'id'} FormOfStudy
 *
 * The ministry's own codes: `if` = cu frecvență, `ifr` = cu frecvență redusă,
 * `id` = la distanță. Codes and not Romanian words, because the words are what
 * every register writes differently — the portal said „fără frecvență” where
 * the registry says „FRECVENȚĂ REDUSĂ” for the same students, and no comparison
 * of the two strings would ever have connected them.
 */

/** @typedef {'ro' | 'en' | 'fr' | 'de'} ProgrammeLanguage */

/**
 * @typedef {object} ProgrammeDimensions
 * @property {string} level
 * @property {string} form_of_study
 * @property {string} specialisation
 * @property {string} language
 * @property {string} location  The teaching centre: „București”, „Buzău”.
 */

/** The three forms of study, for a CHECK-alike on the way in. */
export const FORMS_OF_STUDY = ['if', 'ifr', 'id']

/** @type {Record<string, string>} */
export const LEVEL_WORDS = { bachelor: 'Licență', master: 'Master' }

/** @type {Record<string, string>} */
export const LANGUAGE_WORDS = {
  ro: 'Română',
  en: 'Engleză',
  fr: 'Franceză',
  de: 'Germană',
}

/**
 * The forms of study, spelled the way the ministry and the registry spell them.
 *
 * „Învățământ fără frecvență” is what migration 0020 seeded and what the
 * faculty's own screens said. It is not the name of anything: the form is
 * „învățământ cu frecvență redusă”, it is what the diploma says and what the
 * registry exports, and the two words were the reason the importer needed a
 * hand-written line to connect „FRECVENȚĂ REDUSĂ” to a portal programme at all.
 * @type {Record<string, string>}
 */
export const FORM_WORDS = {
  if: 'învățământ cu frecvență',
  ifr: 'învățământ cu frecvență redusă',
  id: 'învățământ la distanță',
}

/**
 * The centre every programme is taught at unless it says otherwise.
 *
 * A DISPLAY rule and nothing else: eleven options each ending in „· București”
 * would bury the two that are not in București, which is the only thing the
 * centre is there to tell anybody. Reading goes the other way — nothing is ever
 * assumed on the way in, `location` is NOT NULL, and a registry value the
 * importer cannot place refuses the row instead of landing on this constant.
 */
export const MAIN_LOCATION = 'București'

/**
 * What a programme is called, inside its level.
 *
 * Specialisation first, because it is what a person is enrolled in and what a
 * coordinator searches for. Then the form of study, ALWAYS — including „cu
 * frecvență”, which is the ordinary one. Leaving the ordinary form unwritten
 * was the other option and it costs exactly what this change is undoing: at
 * licență, where the faculty runs one specialisation in four forms, the two „cu
 * frecvență” programmes would both have read simply „Marketing”, and the reason
 * they are two rows would have been invisible on the screen where a director
 * moves a student between them.
 *
 * The centre comes next and only when it is not the main one — see
 * `MAIN_LOCATION`. The language closes it, by the same rule: written only when
 * it is not Romanian.
 *
 * The language has to be here, and leaving it out was a real bug for as long as
 * this function existed. `name` is materialised from this, and a dozen queries
 * show `name` on its own — a coordinator's topics, the catalogue, a seat
 * withdrawal refusal, the audit log's subject. Without the language, the two
 * licență „Marketing · învățământ cu frecvență” programmes and the two master
 * „Managementul relațiilor cu clienții” ones printed the same string, so a
 * director picking between them, and a log recording which one was touched, had
 * nothing to go on. Every part of the identity that can differ inside a level is
 * now written out, which is what makes the result unique.
 *
 * @param {ProgrammeDimensions} p
 * @returns {string} „Marketing · învățământ la distanță · Buzău”, „Marketing · învățământ cu frecvență · Engleză”
 */
export const MAIN_LANGUAGE = 'ro'

/**
 * The part of the title that is the same in every language.
 *
 * Split out because `programmeLabel` writes the language itself, in a fixed
 * position at the end, and would otherwise write it twice for an English
 * programme.
 *
 * @param {ProgrammeDimensions} p
 * @returns {string}
 */
function programmeStem(p) {
  const parts = [p.specialisation, FORM_WORDS[p.form_of_study] ?? p.form_of_study]
  if (p.location && p.location !== MAIN_LOCATION) parts.push(p.location)
  return parts.join(' · ')
}

export function programmeTitle(p) {
  const stem = programmeStem(p)
  const language = p.language ?? MAIN_LANGUAGE
  return language === MAIN_LANGUAGE ? stem : `${stem} · ${LANGUAGE_WORDS[language] ?? language}`
}

/**
 * The whole of a programme, in one line: the value that identifies it.
 *
 * A title is not an identifier — the same specialisation in the same form is a
 * different programme in Romanian and in English, and „Managementul relațiilor
 * cu clienții” really is taught in both. This is what the portal's own lists
 * send when a row names a programme, and what `matchProgramme` resolves first.
 *
 * @param {ProgrammeDimensions} p
 * @returns {string} „Master · Marketing online · învățământ cu frecvență · Română”
 */
export function programmeLabel(p) {
  const level = LEVEL_WORDS[p.level] ?? p.level
  const language = LANGUAGE_WORDS[p.language] ?? p.language
  return `${level} · ${programmeStem(p)} · ${language}`
}

