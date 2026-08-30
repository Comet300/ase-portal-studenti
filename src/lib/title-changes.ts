/**
 * Changing the thesis after it has been agreed.
 *
 * The three columns that describe the work — `title_ro`, `title_en`,
 * `objectives` — are the whole of what can change; everything else about a
 * supervision is a different decision. What lives here is the part with no
 * database in it: what counts as a change, what a valid one looks like, and how
 * to say what is different. In `src/lib` rather than beside the route because
 * the transactional half has no test harness (nothing in the suite reaches a
 * database), so at least the rules a person can get wrong are pinned by one.
 */

import { numar } from './text.ts'

/** The shortest scope-and-objectives the submission form has ever accepted. */
export const MIN_OBJECTIVES = 40

/** The longest a title may be, matching the column the request form enforces. */
export const MAX_TITLE = 200

export interface ThesisFields {
  title_ro: string
  title_en: string | null
  objectives: string
}

/**
 * The form's three fields, as the database wants them.
 *
 * An English title left blank is `null`, not `''`: the column is nullable and
 * every screen renders „—” for null, so an empty string would print as a title
 * that exists and is empty.
 */
export function normalizeThesis(raw: {
  title_ro?: unknown
  title_en?: unknown
  objectives?: unknown
}): ThesisFields {
  const text = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ')
  const block = (v: unknown) => String(v ?? '').trim()
  return {
    title_ro: text(raw.title_ro),
    title_en: text(raw.title_en) || null,
    objectives: block(raw.objectives),
  }
}

/**
 * What is wrong with it, in the words the person needs — including what to do.
 *
 * `null` when there is nothing wrong.
 */
export function validateThesis(f: ThesisFields): string | null {
  if (!f.title_ro) return 'Titlul în română este obligatoriu. Scrie-l și trimite din nou.'
  if (f.title_ro.length > MAX_TITLE) {
    return `Titlul în română depășește ${MAX_TITLE} de caractere. Scurtează-l și trimite din nou.`
  }
  if (f.title_en && f.title_en.length > MAX_TITLE) {
    return `Titlul în engleză depășește ${MAX_TITLE} de caractere. Scurtează-l și trimite din nou.`
  }
  if (f.objectives.length < MIN_OBJECTIVES) {
    const missing = MIN_OBJECTIVES - f.objectives.length
    return `Scopul și obiectivele au nevoie de încă ${numar(missing, 'caracter', 'caractere')}: coordonatorul decide pe baza lor.`
  }
  return null
}

export type ThesisField = 'title_ro' | 'title_en' | 'objectives'

export interface FieldChange {
  field: ThesisField
  label: string
  from: string
  to: string
}

export const FIELD_LABELS: Record<ThesisField, string> = {
  title_ro: 'Titlul lucrării (română)',
  title_en: 'Titlul lucrării (engleză)',
  objectives: 'Scopul și obiectivele',
}

/**
 * Only what actually differs.
 *
 * A request to change nothing is not a request — the coordinator would be asked
 * to decide on two identical texts — and it is the likely outcome of opening a
 * pre-filled form and pressing send. It is refused, here, before anything is
 * written.
 */
export function thesisDiff(current: ThesisFields, proposed: ThesisFields): FieldChange[] {
  const fields: ThesisField[] = ['title_ro', 'title_en', 'objectives']
  const changes: FieldChange[] = []

  for (const field of fields) {
    const from = current[field] ?? ''
    const to = proposed[field] ?? ''
    if (from === to) continue
    changes.push({ field, label: FIELD_LABELS[field], from: from || '—', to: to || '—' })
  }

  return changes
}

export function hasThesisChanges(current: ThesisFields, proposed: ThesisFields): boolean {
  return thesisDiff(current, proposed).length > 0
}

/**
 * „Titlul și obiectivele” — what changed, named rather than counted.
 *
 * A notification saying „2 câmpuri modificate” makes the reader open the screen
 * to find out which two.
 */
export function describeChanges(changes: readonly FieldChange[]): string {
  const names: Record<ThesisField, string> = {
    title_ro: 'titlul',
    title_en: 'titlul în engleză',
    objectives: 'obiectivele',
  }
  const list = changes.map((c) => names[c.field])
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} și ${list[list.length - 1]}`
}

export const CHANGE_STATUS_LABELS: Record<string, string> = {
  pending: 'În așteptarea coordonatorului',
  approved: 'Aplicată',
  rejected: 'Respinsă',
  withdrawn: 'Retrasă',
}

export const CHANGE_STATUS_CLASS: Record<string, string> = {
  pending: 'badge--asteptare',
  approved: 'badge--aprobata',
  rejected: 'badge--respinsa',
  withdrawn: 'badge--ciorna',
}
