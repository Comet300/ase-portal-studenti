import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formAction } from '../src/lib/forms.ts'
import { id } from '../src/lib/ids.ts'
import { internalPath } from '../src/lib/http.ts'
import { prezenta } from '../src/lib/presence.ts'
import { screenName } from '../src/lib/navigation.ts'

/**
 * The four small functions that big things hang off.
 *
 * `formAction` was the bug that made two delete buttons do nothing. `id` is the
 * only filter between a parameter out of the address and a query.
 * `internalPath` is the only thing that stops a redirect to another host. None
 * of them is more than ten lines long, and that is exactly why nobody looks at
 * them again.
 */

/** A `FormData` built the way a browser builds one: document order is kept. */
function formData(pairs: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of pairs) f.append(k, v)
  return f
}

describe('formAction', () => {
  it('ia valoarea butonului apăsat', () => {
    assert.equal(formAction(formData([['actiune', 'sterge']])), 'sterge')
  })

  /* The bug that hid two deletions.
   *
   * A form with two verbs had two fields named `actiune` — one hidden, carrying
   * the default value, and one on the button. `FormData.get` returns the *first*
   * entry, that is always the default one, so the deletion never happened and no
   * error showed up. The fallback has a different name now. */
  it('nu confundă valoarea implicită cu cea a butonului', () => {
    const f = formData([
      ['actiune_implicita', 'actualizeaza'],
      ['actiune', 'sterge'],
    ])
    assert.equal(formAction(f), 'sterge', 'butonul apăsat câștigă, oriunde stă în document')
  })

  it('cade pe valoarea implicită când niciun buton nu a trimis una', () => {
    assert.equal(formAction(formData([['actiune_implicita', 'actualizeaza']])), 'actualizeaza')
  })

  it('un buton cu valoare goală nu ascunde valoarea implicită', () => {
    const f = formData([
      ['actiune_implicita', 'actualizeaza'],
      ['actiune', ''],
    ])
    assert.equal(formAction(f), 'actualizeaza')
  })

  it('fără niciunul, întoarce gol — nu „undefined” într-un switch', () => {
    assert.equal(formAction(new FormData()), '')
  })
})

describe('id', () => {
  it('acceptă un uuid, în orice registru de litere', () => {
    const u = '669245fa-d559-4b68-a351-84d2fc5886d6'
    assert.equal(id(u), u)
    assert.equal(id(u.toUpperCase()), u.toUpperCase())
  })

  it('refuză orice altceva, inclusiv ce pare aproape corect', () => {
    for (const rau of [
      null,
      '',
      '1',
      'undefined',
      '669245fa-d559-4b68-a351-84d2fc5886d',
      "669245fa-d559-4b68-a351-84d2fc5886d6' OR 1=1--",
      '669245fa_d559_4b68_a351_84d2fc5886d6',
      '../669245fa-d559-4b68-a351-84d2fc5886d6',
    ]) {
      assert.equal(id(rau), null, `„${rau}”`)
    }
  })
})

describe('internalPath', () => {
  it('lasă o cale a portalului să treacă, cu tot cu întrebare și fragment', () => {
    assert.equal(internalPath('/profesor/facultate?nivel=master'), '/profesor/facultate?nivel=master')
    assert.equal(internalPath('/a#b'), '/a#b')
  })

  it('refuză orice ar scoate pe cineva din portal', () => {
    for (const rau of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '']) {
      assert.equal(internalPath(rau), '/', `„${rau}”`)
    }
  })

  it('folosește rezerva dată, când există una', () => {
    assert.equal(internalPath('//evil.example', '/profesor'), '/profesor')
    assert.equal(internalPath(null, '/profesor'), '/profesor')
  })
})

describe('prezenta', () => {
  const acum = (minute: number) => new Date(Date.now() - minute * 60_000).toISOString()

  it('trei trepte, apoi tăcere', () => {
    assert.equal(prezenta(acum(0)), 'în portal acum')
    assert.equal(prezenta(acum(2)), 'în portal acum')
    assert.equal(prezenta(acum(10)), 'a fost în portal acum câteva minute')
    assert.equal(prezenta(acum(59)), 'a fost în portal acum câteva minute')
    assert.equal(prezenta(acum(120)), 'a fost în portal astăzi')
    assert.equal(prezenta(acum(60 * 13)), null, 'peste o jumătate de zi nu mai înseamnă nimic')
  })

  it('nu spune nimic fără dată, și nu se încurcă în viitor', () => {
    assert.equal(prezenta(null), null)
    assert.equal(prezenta(new Date(Date.now() + 60_000).toISOString()), null)
  })

  /* The exact minute count must not be deducible: that is the difference
   * between helping and keeping watch. */
  it('nu scurge un minutaj exact', () => {
    for (const m of [4, 17, 43]) {
      assert.equal(prezenta(acum(m)), 'a fost în portal acum câteva minute', `${m} min dau același text`)
    }
  })
})

describe('numeleEcranului', () => {
  it('numește ecranele portalului', () => {
    assert.equal(screenName('/profesor/studenti'), 'Studenți & Cereri')
    assert.equal(screenName('/coordonatori'), 'Coordonatori & Teme')
  })

  it('ignoră întrebarea și fragmentul: nu schimbă ecranul', () => {
    assert.equal(screenName('/profesor/studenti?sectiune=cereri#cerere-1'), 'Studenți & Cereri')
  })

  it('nu inventează un nume pentru o cale necunoscută', () => {
    assert.equal(screenName('/ceva/inexistent'), null)
  })
})
