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

/**
 * The name as the register writes it: „Popescu I. Maria”.
 *
 * The father's initial is part of a Romanian student's official name, not a
 * decoration — the secretariat matches the printed request against the register
 * by exactly this form, and a request that reads „Popescu Maria” comes back.
 * It is composed here, once, because it is printed on three documents and shown
 * on six screens, and a second copy of the rule would drift from this one.
 *
 * The initial goes after the first word: the list comes from the registrar's
 * spreadsheet, which is written in the register's order — family name first.
 * A family name of two words („Popa Bălan Maria”) therefore comes out wrong;
 * nothing in a single free-text `name` column can tell where it ends, so the
 * registrar corrects it in the name itself rather than the portal guessing.
 *
 * With no initial on record the name is returned untouched — most teachers have
 * none, and a student whose row the registrar has not completed yet must keep
 * reading as they always did.
 */
export function officialName(person: {
  name: string
  father_initial?: string | null
}): string {
  const initial = formatInitial(person.father_initial)
  if (!initial) return person.name

  const name = person.name.trim()
  const cut = name.indexOf(' ')
  if (cut === -1) return `${name} ${initial}`

  return `${name.slice(0, cut)} ${initial}${name.slice(cut)}`
}

/**
 * „i” and „I” and „Gh” all come back as „I.” / „Gh.”.
 *
 * The registrar pastes the letter both with and without the point, and Romanian
 * abbreviates some given names with two letters — Gheorghe is „Gh.”, not „G.”.
 * Anything else returns empty, so a stray cell cannot end up printed inside
 * somebody's name on a document that gets signed.
 */
export function formatInitial(raw: string | null | undefined): string {
  const text = (raw ?? '').trim().replace(/\.+$/, '')
  if (!/^[A-Za-zĂÂÎȘȚăâîșț]{1,2}$/.test(text)) return ''
  return text.charAt(0).toLocaleUpperCase('ro-RO') + text.slice(1).toLocaleLowerCase('ro-RO') + '.'
}
