/**
 * How many students a coordinator may still take, and from which programme.
 *
 * Capacity has two parts. The BASE is the department's norm for the year, or
 * the number the director set for this coordinator instead of it; it is shared
 * across every programme at that level. An EXTRA is granted for one named study
 * programme and is strictly reserved to it — a seat given for Marketing can
 * only be filled by a Marketing student. That is the department's decision, and
 * everything below follows from it.
 *
 * THE ONE RULE. A student of programme P, at level L, applying to coordinator T
 * may be taken when
 *
 *     free(T, L, P) = base_free(T, L) + earmark_free(T, L, P) > 0
 *
 * where the earmark is spent FIRST: the students of P fill P's own extras
 * before they touch the shared base. Charging the base first would need the
 * approvals ordered by decision date to work out who overflowed, and every
 * withdrawal would reshuffle that history; charging the earmark first is one
 * aggregate, order-free, and stable under withdrawal.
 *
 * The consequence to say out loud: „full” is no longer a property of a
 * coordinator. The same coordinator can be full for Marketing and open for
 * Finance in the same instant, so a catalogue with no student signed in cannot
 * state one truth and must fall back to per-level totals.
 *
 * No database here on purpose — this is the arithmetic three gates and six
 * screens have to agree on, and it is the part that can be tested.
 */

export type Level = 'bachelor' | 'master'

/** The highest base the director's form offers. Extras are not part of it. */
export const SEAT_BASE_MAX = 40

/** One written ask, and one act of granting, stay inside this range. */
export const GRANT_MIN = 1
export const GRANT_MAX = 20

/**
 * The ceiling on live extras per coordinator and level.
 *
 * Not decoration: `grantSeats` used to add into the same column the director's
 * form clamps to 40, so a coordinator sitting at 43 lost three seats — silently,
 * with a success notice — on the next save of that row. Extras live in their own
 * ledger now, so nothing can be truncated by a save; this bound only keeps the
 * total a number a person meant to hand out.
 */
export const EXTRA_SEATS_MAX_PER_LEVEL = 20

/** One study programme's earmark and consumption at a coordinator, one level. */
export interface PotInput {
  /** NULL is the students whose programme was never recorded; they pay base. */
  programme_id: string | null
  programme_name: string | null
  /** Live extras granted for this programme — revoked grants are not here. */
  granted: number
  /** Approved and defended theses of this programme, this year. */
  taken: number
}

export interface Pot extends PotInput {
  /** Earmarked seats this programme has already filled. */
  used: number
  /** Earmarked seats still waiting for a student of this programme. */
  free: number
  /** Students of this programme that spilled onto the shared base. */
  on_base: number
}

export interface Capacity {
  level: Level
  /** The norm, or the coordinator's own number if the director set one. */
  base: number
  /** True when `base` is the year's norm rather than a decision about them. */
  is_norm: boolean
  base_used: number
  base_free: number
  /** Live extras at this level, all programmes together. */
  granted: number
  /** Students supervised at this level, all programmes together. */
  taken: number
  /** base + granted — what „x din y” is written against on a summary screen. */
  total: number
  /**
   * Everything still open at this level, earmarks included.
   *
   * The honest number for a viewer whose programme is unknown. It is NOT the
   * number of students that can still be taken, because most of it may be
   * reserved for programmes this particular student is not in.
   */
  free_any: number
  pots: Pot[]
}

/**
 * Turns the raw counts into the answer, spending earmarks before the base.
 *
 * `taken` above `granted` in a pot is normal — that is what spilling onto the
 * base means. `base_used` above `base` is also possible (a coordinator who
 * supervises seven with a base of five, because the base was lowered after the
 * fact), and clamps to zero free rather than going negative.
 */
export function capacityOf(input: {
  level: Level
  base: number
  isNorm: boolean
  pots: PotInput[]
}): Capacity {
  const base = Math.max(0, Math.trunc(input.base))

  const pots: Pot[] = input.pots.map((p) => {
    const granted = Math.max(0, Math.trunc(p.granted))
    const taken = Math.max(0, Math.trunc(p.taken))
    const used = Math.min(granted, taken)
    return {
      ...p,
      granted,
      taken,
      used,
      free: granted - used,
      on_base: taken - used,
    }
  })

  const base_used = pots.reduce((n, p) => n + p.on_base, 0)
  const granted = pots.reduce((n, p) => n + p.granted, 0)
  const taken = pots.reduce((n, p) => n + p.taken, 0)
  const base_free = Math.max(0, base - base_used)

  return {
    level: input.level,
    base,
    is_norm: input.isNorm,
    base_used,
    base_free,
    granted,
    taken,
    total: base + granted,
    free_any: base_free + pots.reduce((n, p) => n + p.free, 0),
    pots,
  }
}

/**
 * The seats this exact student can take: the shared base still unspent at their
 * level, plus their own programme's unspent earmark. Seats earmarked for
 * another programme are invisible to them, which is the whole point of an
 * earmark — without this, „tracked separately” would be a label on a report.
 */
export function freeFor(cap: Capacity, programmeId: string | null): number {
  const pot = programmeId ? cap.pots.find((p) => p.programme_id === programmeId) : undefined
  return cap.base_free + (pot?.free ?? 0)
}

/** Full for this student. Never asked without a programme in context. */
export function isFullFor(cap: Capacity, programmeId: string | null): boolean {
  return freeFor(cap, programmeId) === 0
}

/** Everything a coordinator has, per level, for the year in view. */
export interface TeacherCapacity {
  teacher_id: string
  bachelor: Capacity
  master: Capacity
}

export function atLevel(tc: TeacherCapacity, level: Level | null): Capacity {
  return level === 'master' ? tc.master : tc.bachelor
}

/**
 * The refusal, worded once.
 *
 * Colour never carries this: the sentence names the programme, the numbers and
 * the way out. It is shared by the three gates so a student turned away by the
 * catalogue and a coordinator turned away by the accept button are told the
 * same thing about the same seat.
 */
export function fullBecause(cap: Capacity, programmeName: string | null): string {
  const reserved = cap.free_any - cap.base_free
  if (reserved > 0 && programmeName) {
    return `Locurile rămase sunt rezervate altor programe de studiu, iar pentru ${programmeName} nu mai este niciunul liber.`
  }
  if (reserved > 0) {
    return 'Locurile rămase sunt rezervate unor programe de studiu anume.'
  }
  return `Toate cele ${cap.total} locuri de la acest nivel sunt ocupate (${cap.taken} din ${cap.total}).`
}
