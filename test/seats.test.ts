import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  EXTRA_SEATS_MAX_PER_LEVEL,
  atLevel,
  capacityOf,
  freeFor,
  fullBecause,
  isFullFor,
  type PotInput,
} from '../src/lib/seats.ts'

/**
 * The seat arithmetic, which three gates and six screens have to agree on.
 *
 * It had no test at all, and the defect this file was written for is the reason
 * that matters: the coordinator's „cere locuri” form posted `nivel` while the
 * route read `program_id`, so every request reached the database with
 * `programme_id = NULL`, the grant made from it carried NULL too, and `freeFor`
 * — which spends a pot only for a student whose programme equals the pot's —
 * matched no student who exists. The director approved, the ledger showed the
 * seats, `free_any` counted them, and not one student could be accepted.
 *
 * So the first thing pinned here is that a pot with no programme is not
 * capacity, and the second is that a pot WITH one is capacity for exactly one
 * programme. Both have to hold, or „reserved per programme” is a word on a
 * report.
 */

const MARKETING = '11111111-1111-1111-1111-111111111111'
const ONLINE = '22222222-2222-2222-2222-222222222222'

function pot(programme_id: string | null, granted: number, taken: number): PotInput {
  return {
    programme_id,
    programme_name: programme_id === MARKETING ? 'Marketing' : programme_id ? 'Marketing online' : null,
    granted,
    taken,
  }
}

const master = (pots: PotInput[], base = 0) =>
  capacityOf({ level: 'master', base, isNorm: false, pots })

describe('freeFor — rezerva pe program', () => {
  /* THE REGRESSION TEST. Reintroduce the missing `program_id` on either form
     and the grant lands with no programme; this fails the moment such a grant
     starts counting as capacity somebody can spend. */
  it('un loc acordat fără program nu devine capacitate pe care o poate folosi cineva', () => {
    const cap = master([pot(null, 5, 0)])

    assert.equal(cap.granted, 5, 'jurnalul arată locurile acordate')
    assert.equal(cap.free_any, 5, 'și totalul brut le numără')

    assert.equal(freeFor(cap, MARKETING), 0, 'dar niciun student nu le poate ocupa')
    assert.equal(freeFor(cap, ONLINE), 0)
    assert.equal(freeFor(cap, null), 0, 'nici studentul fără program')
    assert.ok(isFullFor(cap, MARKETING), 'coordonatorul este plin pentru oricine')
  })

  it('un loc acordat pe un program este liber pentru acel program și numai pentru el', () => {
    const cap = master([pot(MARKETING, 3, 0)])

    assert.equal(freeFor(cap, MARKETING), 3)
    assert.equal(freeFor(cap, ONLINE), 0, 'rezervat înseamnă rezervat')
    assert.equal(cap.free_any, 3, 'free_any nu este o poartă, este un total')
    assert.equal(isFullFor(cap, ONLINE), true)
    assert.equal(isFullFor(cap, MARKETING), false)
  })

  /* The base is shared across programmes at the level; the earmark is not. A
     student of a programme with no earmark of its own still has the base. */
  it('baza este comună, rezerva nu', () => {
    const cap = master([pot(MARKETING, 2, 0)], 4)

    assert.equal(freeFor(cap, MARKETING), 6, 'baza plus rezerva proprie')
    assert.equal(freeFor(cap, ONLINE), 4, 'doar baza')
    assert.equal(freeFor(cap, null), 4, 'studentul fără program plătește din bază')
  })

  /* Charging the earmark first is what makes the answer order-free: otherwise
     the approvals would have to be replayed by decision date to work out who
     overflowed, and every withdrawal would reshuffle that history. */
  it('studenții unui program își cheltuiesc întâi rezerva, apoi baza', () => {
    const cap = master([pot(MARKETING, 2, 3)], 4)

    const marketing = cap.pots.find((p) => p.programme_id === MARKETING)!
    assert.equal(marketing.used, 2, 'cele două rezervate sunt ocupate')
    assert.equal(marketing.free, 0)
    assert.equal(marketing.on_base, 1, 'al treilea a trecut pe bază')
    assert.equal(cap.base_used, 1)
    assert.equal(freeFor(cap, MARKETING), 3, 'din bază au mai rămas trei')
    assert.equal(freeFor(cap, ONLINE), 3, 'și sunt aceleași trei pentru oricine')
  })

  it('o bază coborâtă sub cât se coordonează deja dă zero, nu un număr negativ', () => {
    const cap = master([pot(MARKETING, 0, 7)], 5)
    assert.equal(cap.base_used, 7)
    assert.equal(cap.base_free, 0)
    assert.equal(freeFor(cap, MARKETING), 0)
  })

  it('atLevel alege nivelul cerut, iar lipsa unuia nu înseamnă master', () => {
    const tc = {
      teacher_id: 'x',
      bachelor: capacityOf({ level: 'bachelor' as const, base: 5, isNorm: true, pots: [] }),
      master: master([], 1),
    }
    assert.equal(atLevel(tc, 'bachelor').base, 5)
    assert.equal(atLevel(tc, 'master').base, 1)
    assert.equal(atLevel(tc, null).base, 5, 'fără nivel se răspunde despre licență')
  })
})

describe('fullBecause — refuzul spune pentru ce program', () => {
  it('numește programul și pasul următor când locurile rămase sunt rezervate', () => {
    const cap = master([pot(ONLINE, 4, 0)], 0)
    const text = fullBecause(cap, 'Marketing · învățământ cu frecvență')

    assert.match(text, /4 locuri/)
    assert.match(text, /Marketing · învățământ cu frecvență/)
    assert.match(text, /Alege alt coordonator/, 'un refuz spune și ce se poate face')
  })

  it('fără un program în context nu inventează unul', () => {
    const text = fullBecause(master([pot(ONLINE, 4, 0)]), null)
    assert.match(text, /rezervate unor programe de studiu anume/)
    assert.doesNotMatch(text, /Marketing/)
  })

  /* „Toate cele 0 locuri sunt ocupate (3 din 0)” is what one sentence for all
     three states produced, and both of these really occur: a coordinator the
     director has not allocated anything to yet, and one whose base was lowered
     under the number they already supervise. */
  it('un coordonator fără locuri alocate nu este „plin”, ci nealocat', () => {
    const text = fullBecause(master([], 0), 'Marketing')
    assert.match(text, /nu i-a alocat încă locuri/)
    assert.doesNotMatch(text, /cele 0 locuri/)
  })

  it('un coordonator peste capacitate spune câți coordonează, nu câte locuri sunt ocupate', () => {
    const text = fullBecause(master([pot(MARKETING, 0, 5)], 2), 'Marketing')
    assert.match(text, /Coordonează deja 5 studenți/)
    assert.match(text, /peste cele 2 locuri alocate/)
    assert.doesNotMatch(text, /5 din 2/)
  })

  it('când chiar nu mai există niciun loc, spune câte sunt și câte s-au ocupat', () => {
    const cap = master([pot(MARKETING, 2, 2)], 3)
    const full = capacityOf({ level: 'master', base: 3, isNorm: false, pots: [pot(MARKETING, 2, 5)] })
    assert.equal(freeFor(full, MARKETING), 0)
    assert.match(fullBecause(full, 'Marketing'), /Toate cele 5 locuri/)
    assert.equal(cap.free_any, 3, 'controlul: cel de sus chiar mai are locuri')
  })
})

describe('limitele care au un motiv', () => {
  /* Not decoration: `grantSeats` used to add into the same column the
     director's form clamps to 40, so a coordinator sitting at 43 lost three
     seats — with a success notice — on the next save of that row. */
  it('rezervele au un plafon pe nivel, separat de bază', () => {
    assert.equal(EXTRA_SEATS_MAX_PER_LEVEL, 20)
    const cap = master([pot(MARKETING, 20, 0)], 40)
    assert.equal(cap.total, 60, 'baza și rezervele se adună, dar nu se amestecă')
    assert.equal(cap.granted, 20)
  })
})

/**
 * The other half of the same defect, which no arithmetic can catch.
 *
 * `capacityOf` was always right: a pot with no programme is not capacity. What
 * was wrong is that the two forms which ask for seats never sent a programme at
 * all — the coordinator's form posted `nivel`, the director had no form — so
 * every request and every grant reached the database with `programme_id` NULL
 * and the seats were dead on arrival. That is a fact about three files agreeing
 * on a field name, so it is checked as one: there is no DOM in the test runner,
 * and the thing worth keeping is in the source.
 */
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')

/** The markup of the one form inside `file` that posts `actiune=<action>`. */
function seatForm(file: string, action: string): string {
  const text = source(file)
  const marker = `name="actiune" value="${action}"`
  const at = text.indexOf(marker)
  assert.notEqual(at, -1, `${file} nu mai trimite actiune=${action}`)
  const start = text.lastIndexOf('<form', at)
  const end = text.indexOf('</form>', at)
  assert.ok(start !== -1 && end !== -1, `${file}: actiune=${action} nu este într-un formular`)
  return text.slice(start, end)
}

describe('formularele de locuri numesc programul pe care îl cer', () => {
  /* THE REGRESSION TEST for the form half. Take `program_id` off either form
     and the grant it produces is unusable by every student in the faculty,
     while every screen goes on reporting the seats as free. */
  it('cererea coordonatorului trimite program_id', () => {
    const form = seatForm('pages/profesor/index.astro', 'cere')
    assert.match(form, /name="program_id"/, 'fără el, cererea ajunge cu programme_id NULL')
    assert.match(form, /required/, 'un program nenumit nu poate fi ocupat de nimeni')
  })

  it('acordarea directă a directorului trimite program_id', () => {
    const form = seatForm('pages/profesor/departament.astro', 'acorda')
    assert.match(form, /name="program_id"/)
    assert.match(form, /name="profesor_id"/)
  })

  /* The level is not asked for any more, on either form: a programme carries
     its own, and two fields that can disagree meant a request for master seats
     naming a bachelor's programme — a seat nobody could ever spend. */
  it('niciunul dintre ele nu mai cere și nivelul pe lângă program', () => {
    for (const [file, action] of [
      ['pages/profesor/index.astro', 'cere'],
      ['pages/profesor/departament.astro', 'acorda'],
    ] as const) {
      assert.doesNotMatch(
        seatForm(file, action),
        /name="nivel"/,
        `${file}: nivelul și programul s-ar putea contrazice`,
      )
    }
  })

  /* The route reads what the forms send — the names are matched here because
     nothing else in the build does: a rename on either side is silent. */
  it('ruta citește exact numele trimise de formulare', () => {
    const route = source('pages/api/locuri.ts')
    for (const field of ['program_id', 'profesor_id', 'locuri', 'motiv', 'acordare_id']) {
      assert.ok(route.includes(`form.get('${field}')`), `/api/locuri nu mai citește ${field}`)
    }
  })

  /* Every grant made outside a written request comes from that one form, and
     every revocation from the ledger beside it. Without a revoke control the
     refusal „retrage o acordare neocupată” names a step nobody can take. */
  it('jurnalul oferă și retragerea, nu doar acordarea', () => {
    assert.match(
      source('pages/profesor/departament.astro'),
      /name="actiune" value="retrage"/,
      'o acordare fără cale de întoarcere este o ușă cu un singur sens',
    )
  })
})
