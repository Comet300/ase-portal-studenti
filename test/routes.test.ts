import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_PATHS } from '../src/lib/routes.ts'
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
      '/cererile-mele',
      '/mesaje',
      '/consultatii',
      '/arhiva',
      '/contul-meu',
      '/profesor',
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
