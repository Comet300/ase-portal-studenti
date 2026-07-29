/**
 * Which action a submitted form asked for.
 *
 * A form that offers more than one verb — Save and Delete on the same fields —
 * carries a default in a hidden input and the exceptional verb on the button.
 * The two must not share a field name: `FormData` keeps document order and
 * `get()` returns the first entry, so the hidden default would win every time
 * and the button would be decorative. Two screens shipped exactly that bug —
 * "Șterge etapa" and "Șterge termenul" both reported success while quietly
 * saving instead — so the default lives under its own name and is only read
 * when no button supplied one.
 */
export function formAction(form: FormData): string {
  const fromSubmitter = form.get('actiune')
  if (typeof fromSubmitter === 'string' && fromSubmitter !== '') return fromSubmitter

  const fallback = form.get('actiune_implicita')
  return typeof fallback === 'string' ? fallback : ''
}
