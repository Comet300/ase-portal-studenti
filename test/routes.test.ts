import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HEAD_ONLY_PREFIXES, PUBLIC_PATHS, isHeadOnlyPath } from '../src/lib/routes.ts'
import { SCREENS, screenName } from '../src/lib/navigation.ts'
import { homeFor } from '../src/lib/http.ts'

/**
 * The gate, written down.
 *
 * The portal was open by omission: the middleware listed the paths that needed
 * a session, so every route added afterwards was public until somebody noticed
 * — that is how the catalogue came to publish student names and student numbers
 * to anonymous visitors. The list is now the other way round, and it is pinned
 * here: making a route public costs a line in this file, which a reviewer sees.
 */

describe('rutele publice', () => {
  it('sunt exact acestea — orice adăugire trece prin acest test', () => {
    assert.deepEqual(
      [...PUBLIC_PATHS],
      [
        '/autentificare',
        '/intra',
        '/confidentialitate',
        '/404',
        '/500',
        '/api/autentificare',
        '/api/demo-login',
        '/api/deconectare',
        '/api/sanatate',
        '/api/sweep',
      ],
    )
  })

  it('nu lasă nimic din portal în afara autentificării', () => {
    const gated = [
      '/',
      '/coordonatori',
      '/ghid',
      '/lucrarea-mea',
      '/cererile-mele',
      '/mesaje',
      '/consultatii',
      '/arhiva',
      '/contul-meu',
      '/profesor',
      '/profesor/activitatea-mea',
      '/profesor/arhiva',
      '/profesor/departament',
      '/documente/regulament',
      '/fisiere/1',
      '/avatare/1.jpg',
      '/profil/1',
      '/api/datele-mele',
    ]
    for (const path of gated) {
      assert.equal(PUBLIC_PATHS.includes(path as never), false, `${path} nu are ce căuta public`)
    }
  })

  /* The old check was `startsWith('/profesor')`, which also matched
   * `/profesorat`. The same slip in a list of public paths would open the
   * portal instead of closing a corner of it, so the match is exact. */
  it('se potrivește pe calea exactă, nu pe prefix', () => {
    assert.equal(PUBLIC_PATHS.includes('/autentificare-noua' as never), false)
    assert.equal(PUBLIC_PATHS.includes('/api/autentificare/reset' as never), false)
  })
})

/* „Arhiva mea” was the coordinator's own record plus their profile form plus a
 * written request to the head of department, and it shared a name with the
 * faculty's archive of defended theses. The record kept the screen under a name
 * of its own; the other two moved out. What is pinned here is the outcome: one
 * „Arhivă” in the portal, and the old address still answering to a name so that
 * a „?de_la=” coming back from an email already sent does not read „Înapoi”. */
describe('numele ecranelor', () => {
  it('numește și adresele ecranelor scoase, ca „Înapoi” să aibă ce scrie', () => {
    assert.equal(screenName('/profesor/activitatea-mea'), 'Panoul meu')
    assert.equal(screenName('/profesor/arhiva?an=2024'), 'Panoul meu')
  })

  it('lasă un singur „Arhivă” în portal', () => {
    const archives = Object.entries(SCREENS).filter(([, name]) =>
      name.toLowerCase().startsWith('arhiv'),
    )
    assert.deepEqual(archives, [['/arhiva', 'Arhivă']])
  })

  it('dă contului un nume, ca să fie găsit în paletă', () => {
    assert.equal(screenName('/contul-meu'), 'Contul meu')
  })
})

describe('homeFor', () => {
  it('trimite studentul acasă la el', () => {
    assert.equal(homeFor({ role: 'student' }), '/')
  })

  /* The demo sign-in fell back to `/`, so a teacher who used it landed on the
   * student home — a screen that is empty for them. */
  it('trimite cadrul didactic și directorul în zona lor', () => {
    assert.equal(homeFor({ role: 'teacher' }), '/profesor')
    assert.equal(homeFor({ role: 'head' }), '/profesor')
  })
})

/**
 * The director's own screens, written down.
 *
 * These carry the register of the faculty: every student with their number and
 * address, the load of every coordinator, the accounts. A coordinator has their
 * own students one screen away and the public catalogue outside the shell —
 * this list is what only the person answering for the session opens. Adding to
 * it, or taking something out of it, costs a line here.
 */
describe('ecranele directorului', () => {
  it('sunt exact acestea', () => {
    assert.deepEqual(
      [...HEAD_ONLY_PREFIXES],
      [
        '/profesor/facultate',
        '/profesor/departament',
        '/profesor/conturi',
        '/profesor/calendar',
        '/profesor/an-universitar',
      ],
    )
  })

  it('se potrivesc pe prefix, ca exportul să fie la fel de închis ca ecranul', () => {
    assert.equal(isHeadOnlyPath('/profesor/facultate'), true)
    assert.equal(isHeadOnlyPath('/profesor/facultate/export'), true)
    assert.equal(isHeadOnlyPath('/profesor/departament/export-cereri'), true)
  })

  it('lasă deschis restul zonei cadrelor didactice', () => {
    for (const path of [
      '/profesor',
      '/profesor/studenti',
      '/profesor/teme',
      '/profesor/consultatii',
      '/profesor/mesaje',
    ]) {
      assert.equal(isHeadOnlyPath(path), false, `${path} nu este doar al directorului`)
    }
  })
})
