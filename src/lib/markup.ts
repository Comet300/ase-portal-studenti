/**
 * Building HTML out of values that came from people.
 *
 * Emails and printable documents are assembled as strings, so every value
 * interpolated into them is an injection site. Escaping at each site does not
 * survive contact with a codebase: it takes one forgotten `${}` — and this one
 * had roughly twenty, including thesis titles and free-text messages going into
 * mail sent from the faculty's own verified domain.
 *
 * So the default is inverted. `html` escapes every interpolated value unless it
 * is itself the result of `html` (or explicitly marked `trusted`), which makes
 * nesting work and makes a raw value the thing you have to ask for.
 */

const SAFE = Symbol('safe-html')

export interface SafeHtml {
  readonly [SAFE]: true
  toString(): string
}

function mark(value: string): SafeHtml {
  return { [SAFE]: true, toString: () => value }
}

function isSafe(value: unknown): value is SafeHtml {
  return typeof value === 'object' && value !== null && SAFE in value
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Apostroful, deși nimic din portal nu îl are nevoie astăzi.
     *
     * El contează doar într-un atribut delimitat cu ghilimele simple, iar toate
     * atributele scrise aici folosesc ghilimele duble — deci lipsa lui nu era
     * exploatabilă. Dar asta face siguranța marcajului să depindă de o convenție
     * de stil pe care o poate încălca următorul șablon scris în grabă, într-un
     * fișier care nu are nimic de-a face cu acesta. Costă o înlocuire. */
    .replace(/'/g, '&#39;')
}

/**
 * Tagged template that escapes what it interpolates.
 *
 * ```ts
 * html`<p>${studentName} a scris:</p>${html`<em>${message}</em>`}`
 * ```
 *
 * `null` and `undefined` render as nothing rather than as the words "null" and
 * "undefined", because most of these values are optional columns.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]
  for (const [i, value] of values.entries()) {
    const rendered = isSafe(value)
      ? value.toString()
      : value == null
        ? ''
        : escapeHtml(String(value))
    out += rendered + strings[i + 1]
  }
  return mark(out)
}

/**
 * Marks a string as already-safe markup.
 *
 * For literals written in this repository — a layout, a stylesheet — never for
 * anything that passed through a form, a database column or a URL.
 */
export function trusted(markup: string): SafeHtml {
  return mark(markup)
}

/** Joins parts that are already safe. */
export function joinHtml(parts: SafeHtml[], separator = ''): SafeHtml {
  return mark(parts.map((p) => p.toString()).join(separator))
}
