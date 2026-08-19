import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * What a closed thread says.
 *
 * The composer used to stay open on a conversation nobody could write in, and
 * the server refused the message with one sentence for all eight ways a pairing
 * can end — a sentence which, because it travelled as a query parameter on a
 * redirect the XHR swallowed, nobody ever read.
 *
 * The wording is the whole feature: this is what a student meets after a
 * refusal, and it has to name the refusal rather than „conversația este
 * închisă”. So the copy is asserted, not just the branching.
 *
 * The copy lives in `chat-lock.ts` rather than in `chat.ts` for the same reason
 * every other test here imports a module with no imports of its own: `chat.ts`
 * reaches the database container on its first line, and the lib modules import
 * each other without file extensions — which Vite resolves and `node --test`
 * does not.
 */
import { lockNotice } from '../src/lib/chat-lock.ts'

const STUDENT = { name: 'Prof. univ. dr. Elena Marin', forStudent: true }
const TEACHER = { name: 'Ana Popescu', forStudent: false }

describe('lockNotice', () => {
  it('nu spune nimic despre o conversație care merge', () => {
    assert.equal(lockNotice(null, STUDENT), null)
  })

  it('numește refuzul, nu „coordonarea inactivă”', () => {
    const notice = lockNotice('request_rejected', STUDENT)!
    assert.equal(notice.label, 'Cerere respinsă')
    assert.match(notice.body, /a fost respinsă/)
    assert.match(notice.body, /Prof\. univ\. dr\. Elena Marin/)
  })

  it('deosebește cele opt motive între ele', () => {
    const reasons = [
      'request_rejected',
      'request_withdrawn',
      'request_expired',
      'invitation_declined',
      'invitation_expired',
      'defended',
      'peer_inactive',
      'never_linked',
    ] as const

    const bodies = reasons.map((r) => lockNotice(r, STUDENT)!.body)
    assert.equal(new Set(bodies).size, reasons.length)

    const labels = reasons.map((r) => lockNotice(r, STUDENT)!.label)
    assert.equal(new Set(labels).size, reasons.length)
  })

  it('o lucrare susținută nu este o eroare: ton neutru și niciun îndemn', () => {
    const notice = lockNotice('defended', STUDENT)!
    assert.equal(notice.tone, 'neutral')
    assert.equal(notice.action, undefined)
    assert.match(notice.body, /susținută/)
  })

  it('doar refuzurile poartă tonul de eroare', () => {
    assert.equal(lockNotice('request_rejected', STUDENT)?.tone, 'bad')
    assert.equal(lockNotice('invitation_declined', STUDENT)?.tone, 'bad')
    assert.equal(lockNotice('request_expired', STUDENT)?.tone, 'neutral')
    assert.equal(lockNotice('request_withdrawn', STUDENT)?.tone, 'neutral')
    assert.equal(lockNotice('peer_inactive', STUDENT)?.tone, 'neutral')
  })

  it('pasul următor există pentru student și nu există pentru coordonator', () => {
    assert.deepEqual(lockNotice('request_rejected', STUDENT)?.action, {
      text: 'Caută alt coordonator',
      href: '/coordonatori',
    })
    assert.equal(lockNotice('request_rejected', TEACHER)?.action, undefined)
  })

  it('un cont închis nu trimite pe nimeni să caute pe altcineva', () => {
    const notice = lockNotice('peer_inactive', STUDENT)!
    assert.equal(notice.action, undefined)
    assert.match(notice.body, /nu mai are acces în portal/)
  })

  it('spune cine a făcut gestul, de fiecare parte a firului', () => {
    assert.match(lockNotice('request_withdrawn', STUDENT)!.body, /Ți-ai retras cererea/)
    assert.match(lockNotice('request_withdrawn', TEACHER)!.body, /a retras cererea/)
    assert.match(lockNotice('invitation_declined', STUDENT)!.body, /Ai refuzat propunerea/)
    assert.match(lockNotice('invitation_declined', TEACHER)!.body, /a refuzat propunerea ta/)
  })

  it('nu presupune genul nimănui', () => {
    const gendered = /\b(dumnealui|dumneaei|studentul|studenta|profesorul|profesoara|domnul|doamna)\b/i
    for (const reason of [
      'request_rejected',
      'request_withdrawn',
      'request_expired',
      'invitation_declined',
      'invitation_expired',
      'defended',
      'peer_inactive',
      'never_linked',
    ] as const) {
      for (const peer of [STUDENT, TEACHER]) {
        assert.doesNotMatch(lockNotice(reason, peer)!.body, gendered)
      }
    }
  })

  it('fiecare motiv spune și că firul rămâne de citit', () => {
    for (const reason of [
      'request_rejected',
      'request_withdrawn',
      'request_expired',
      'invitation_declined',
      'invitation_expired',
      'defended',
      'peer_inactive',
      'never_linked',
    ] as const) {
      assert.match(lockNotice(reason, STUDENT)!.body, /citi|disponibile/)
    }
  })
})
