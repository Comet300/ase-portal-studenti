/**
 * Agreement with the numeral, in Romanian.
 *
 * The portal counts all the time: requests, slots, files, hours. The Romanian
 * rule is not the English one — past 19, the noun requires „de”: „19 ore”, but
 * „20 de ore”. Written out by hand at every place that displays a number, it
 * comes out wrong exactly where the number is large, which is where it is read
 * most often.
 *
 * Without any dependency, like `presence` and `date`: it is used both on the
 * server and in the pages that count from JavaScript.
 */

/**
 * `numar(3, 'consultație', 'consultații')` → „3 consultații”.
 * `numar(21, 'oră', 'ore')` → „21 de ore”.
 *
 * Decimals take the plural and are written with a comma, the way they are
 * written in Romanian:
 * `numar(1.5, 'oră', 'ore')` → „1,5 ore”.
 */
export function numar(n: number, singular: string, plural: string): string {
  const written = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')

  if (n === 1) return `${written} ${singular}`

  /* „de” comes in from 20 upwards, and comes back at every hundred: 119 ore, but
   * 120 de ore; 101 ore, but 120 de ore. The rule looks at the last two digits. */
  const lastTwoDigits = Math.floor(Math.abs(n)) % 100
  const needsDe = Number.isInteger(n) && lastTwoDigits >= 20 || lastTwoDigits === 0 && Math.abs(n) >= 20

  return needsDe ? `${written} de ${plural}` : `${written} ${plural}`
}
