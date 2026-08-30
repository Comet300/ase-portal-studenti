import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, html, joinHtml, trusted } from '../src/lib/markup.ts'

/**
 * The markup in the emails.
 *
 * This is where text written by people is escaped before it goes into an HTML
 * mail: the justification of a request, the reason for a rejection, the name of
 * a file. It is the only barrier between what a student types and what gets
 * rendered in the coordinator's inbox, so the tests are about what must *not*
 * get through.
 */

describe('escapeHtml', () => {
  it('neutralizează cele cinci caractere care schimbă sensul marcajului', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;')
    assert.equal(escapeHtml('a & b'), 'a &amp; b')
    assert.equal(escapeHtml(`"citat" 'simplu'`), '&quot;citat&quot; &#39;simplu&#39;')
  })

  it('scapă ampersandul o singură dată, nu în cascadă', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;')
  })

  it('lasă diacriticele în pace: nu sunt periculoase, sunt limba', () => {
    assert.equal(escapeHtml('Motivația lucrării — analiză'), 'Motivația lucrării — analiză')
  })
})

describe('html', () => {
  it('scapă orice valoare interpolată', () => {
    const rau = '<img src=x onerror=alert(1)>'
    const out = html`<p>${rau}</p>`.toString()
    assert.ok(!out.includes('<img'), 'eticheta nu supraviețuiește')
    assert.ok(out.includes('&lt;img'))
  })

  it('nu scapă marcajul propriu al șablonului', () => {
    assert.equal(html`<p>text</p>`.toString(), '<p>text</p>')
  })

  it('acceptă marcaj deja sigur fără să îl scape a doua oară', () => {
    const inner = html`<strong>Ana</strong>`
    const out = html`<p>${inner}</p>`.toString()
    assert.equal(out, '<p><strong>Ana</strong></p>')
  })

  it('scrie numerele și golurile fără să se plângă', () => {
    assert.equal(html`<p>${3} ${null} ${undefined}</p>`.toString(), '<p>3  </p>')
  })

  it('un student care își numește lucrarea cu marcaj nu poate injecta nimic', () => {
    const title = '</p><script>fetch("//evil")</script><p>'
    const out = html`<p>${title}</p>`.toString()
    assert.ok(!out.includes('<script'), 'nicio etichetă de script')
    assert.ok(!out.includes('</p><'), 'nu se poate ieși din paragraf')
  })
})

describe('joinHtml', () => {
  it('unește bucăți sigure păstrându-le sigure', () => {
    const out = joinHtml([html`<li>a</li>`, html`<li>b</li>`]).toString()
    assert.equal(out, '<li>a</li><li>b</li>')
  })

  it('o listă goală dă un șir gol, nu „undefined”', () => {
    assert.equal(joinHtml([]).toString(), '')
  })
})

describe('trusted', () => {
  it('marchează explicit marcajul scris de noi, nu de un utilizator', () => {
    const out = html`<p>${trusted('<br>')}</p>`.toString()
    assert.equal(out, '<p><br></p>')
  })
})
