import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Where the phone drawer hangs in the document, written down.
 *
 * It used to be a child of `<header class="topbar">`. The bar is
 * `position: sticky` with a `z-index`, so it opens a stacking context, and the
 * curtain that `scripts/menu.ts` appends to `<body>` painted above everything
 * inside that context — drawer included, whatever layer the drawer asked for.
 * Every tap on a link in the open menu hit the curtain instead, and the
 * curtain's only listener closes the menu: the menu shut, the page stayed. On a
 * phone that is the whole navigation of the portal.
 *
 * The fix is one line of structure, which is exactly the kind of thing a later
 * refactor puts back without noticing. Hence this test, and hence it reads the
 * source as text: there is no DOM in the test runner, and the fact worth
 * keeping is about the file, not about the render.
 */

const layout = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/layouts/${name}`, import.meta.url)), 'utf8')

describe('sertarul de pe telefon', () => {
  it('nu stă în interiorul barei de sus', () => {
    const source = layout('StudentLayout.astro')

    const barStart = source.indexOf('<header class="topbar">')
    const barEnd = source.indexOf('</header>', barStart)
    const drawer = source.indexOf('<nav class="meniu-mobil"')

    assert.ok(barStart !== -1, 'bara de sus nu mai există în layout')
    assert.ok(drawer !== -1, 'sertarul nu mai există în layout')
    assert.ok(
      drawer > barEnd,
      'sertarul a ajuns din nou în interiorul <header class="topbar">: perdeaua îl va acoperi și meniul de pe telefon se închide fără să navigheze',
    )
  })

  it('este deschis de butonul care îl anunță prin aria-controls', () => {
    const source = layout('StudentLayout.astro')

    assert.match(source, /aria-controls="meniu-mobil"/)
    assert.match(source, /id="meniu-mobil"/)
    assert.match(source, /start\(\{ button: '\.hamburger', panel: '#meniu-mobil' \}\)/)
  })
})
