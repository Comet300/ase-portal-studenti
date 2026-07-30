import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formAction } from '../src/lib/forms.ts'
import { id } from '../src/lib/ids.ts'
import { internalPath } from '../src/lib/http.ts'
import { prezenta } from '../src/lib/prezenta.ts'
import { numeleEcranului } from '../src/lib/navigare.ts'

/**
 * Cele patru funcții mici de care atârnă lucruri mari.
 *
 * `formAction` a fost bug-ul care a făcut două butoane de ștergere să nu facă
 * nimic. `id` este singurul filtru dintre un parametru din adresă și o
 * interogare. `internalPath` este singurul lucru care oprește un redirect către
 * altă gazdă. Niciuna nu are mai de zece linii, și exact de aceea nimeni nu se
 * uită la ele din nou.
 */

/** Un `FormData` construit ca de un browser: ordinea din document se păstrează. */
function formular(perechi: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of perechi) f.append(k, v)
  return f
}

describe('formAction', () => {
  it('ia valoarea butonului apăsat', () => {
    assert.equal(formAction(formular([['actiune', 'sterge']])), 'sterge')
  })

  /* Bug-ul care a ascuns două ștergeri.
   *
   * Un formular cu două verbe avea două câmpuri numite `actiune` — unul ascuns cu
   * valoarea implicită și unul pe buton. `FormData.get` întoarce *prima* intrare,
   * adică mereu pe cea implicită, deci ștergerea nu se întâmpla niciodată și nu
   * apărea nicio eroare. Fallbackul are alt nume acum. */
  it('nu confundă valoarea implicită cu cea a butonului', () => {
    const f = formular([
      ['actiune_implicita', 'actualizeaza'],
      ['actiune', 'sterge'],
    ])
    assert.equal(formAction(f), 'sterge', 'butonul apăsat câștigă, oriunde stă în document')
  })

  it('cade pe valoarea implicită când niciun buton nu a trimis una', () => {
    assert.equal(formAction(formular([['actiune_implicita', 'actualizeaza']])), 'actualizeaza')
  })

  it('un buton cu valoare goală nu ascunde valoarea implicită', () => {
    const f = formular([
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

  /* Nu trebuie să se poată deduce minutajul: asta este diferența dintre a ajuta
   * și a supraveghea. */
  it('nu scurge un minutaj exact', () => {
    for (const m of [4, 17, 43]) {
      assert.equal(prezenta(acum(m)), 'a fost în portal acum câteva minute', `${m} min dau același text`)
    }
  })
})

describe('numeleEcranului', () => {
  it('numește ecranele portalului', () => {
    assert.equal(numeleEcranului('/profesor/studenti'), 'Studenți & Cereri')
    assert.equal(numeleEcranului('/coordonatori'), 'Coordonatori & Teme')
  })

  it('ignoră întrebarea și fragmentul: nu schimbă ecranul', () => {
    assert.equal(numeleEcranului('/profesor/studenti?sectiune=cereri#cerere-1'), 'Studenți & Cereri')
  })

  it('nu inventează un nume pentru o cale necunoscută', () => {
    assert.equal(numeleEcranului('/ceva/inexistent'), null)
  })
})
