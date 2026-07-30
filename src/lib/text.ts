/**
 * Acordul cu numeralul, în românește.
 *
 * Portalul numără constant: cereri, intervale, fișiere, ore. Regula românească nu
 * este cea englezească — după 19, substantivul cere „de”: „19 ore”, dar „20 de
 * ore”. Scrisă de mână la fiecare afișare, se scrie greșit exact acolo unde
 * numărul e mare, adică unde se citește mai des.
 *
 * Fără nicio dependență, ca `prezenta` și `date`: se folosește și pe server, și
 * în paginile care numără din JavaScript.
 */

/**
 * `numar(3, 'consultație', 'consultații')` → „3 consultații”.
 * `numar(21, 'oră', 'ore')` → „21 de ore”.
 *
 * Zecimalele merg la plural și se scriu cu virgulă, cum se scriu în românește:
 * `numar(1.5, 'oră', 'ore')` → „1,5 ore”.
 */
export function numar(n: number, singular: string, plural: string): string {
  const scris = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')

  if (n === 1) return `${scris} ${singular}`

  /* „de” intră de la 20 în sus, și se repetă la fiecare sută: 119 ore, dar 120 de
   * ore; 101 ore, dar 120 de ore. Regula se uită la ultimele două cifre. */
  const ultimeleDoua = Math.floor(Math.abs(n)) % 100
  const cereDe = Number.isInteger(n) && ultimeleDoua >= 20 || ultimeleDoua === 0 && Math.abs(n) >= 20

  return cereDe ? `${scris} de ${plural}` : `${scris} ${plural}`
}
