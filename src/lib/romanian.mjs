/**
 * The Romanian letters, written the one way the portal writes them.
 *
 * WHY IT MOVED OUT OF `tabular.ts`. The fold was defined there, next to the
 * reader that needs it on every cell. `programmes.mjs` needs the very same fold
 * now — a teaching centre typed „Buzǎu” with a cedilla is a second centre — and
 * `programmes.mjs` is imported by `scripts/seed.mjs`, which runs on bare Node
 * with no TypeScript step. Importing a `.ts` module from it would work today
 * only because nothing in `tabular.ts` survives type stripping, and would stop
 * working the first time somebody writes an enum in it. So the fold lives in
 * plain JavaScript and `tabular.ts` re-exports it: one definition, and every
 * caller that had it from `tabular.ts` still does.
 */

/**
 * `ş` U+015F and `ţ` U+0163 carry a cedilla and belong to Turkish; Romanian
 * uses the comma-below `ș` U+0219 and `ț` U+021B. Windows-1250 has only the
 * cedilla pair, so every file saved out of Excel on a Romanian machine arrives
 * in the wrong alphabet. Two alphabets inside one register is the kind of wrong
 * nobody notices until a name is searched for and does not come back.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeRomanian(text) {
  return text
    .replace(/ş/g, 'ș')
    .replace(/Ş/g, 'Ș')
    .replace(/ţ/g, 'ț')
    .replace(/Ţ/g, 'Ț')
    .replace(/ /g, ' ')
}
