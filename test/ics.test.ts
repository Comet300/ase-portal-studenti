import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs, buildIcsBundle, consultationUid } from '../src/lib/ics.ts'

/**
 * The calendar file.
 *
 * Tested against format rules, not against looks: a wrong `.ics` does not look
 * bad, it simply does not import — or, worse, it imports as a second event
 * instead of cancelling the first one. A cancellation works only if the UID is
 * identical to the invitation's and `SEQUENCE` is higher; the portal has had
 * three different UID schemes, so a cancellation could never find its own
 * booking.
 */

const EVENT = {
  uid: 'consultatie-1-2',
  title: 'Consultație cu Prof. univ. dr. Mihaela Ionescu',
  location: 'Cabinet 2314',
  start: new Date('2026-09-15T11:30:00Z'),
  end: new Date('2026-09-15T13:00:00Z'),
  organizerName: 'Prof. univ. dr. Mihaela Ionescu',
  organizerEmail: 'mihaela.ionescu@ase.ro',
  attendeeName: 'Andrei Vasilescu',
  attendeeEmail: 'andrei.vasilescu@stud.ase.ro',
}

const lineOf = (ics: string, key: string) =>
  ics.split('\r\n').find((l) => l.startsWith(key + ':') || l.startsWith(key + ';'))

describe('buildIcs', () => {
  it('scrie un calendar întreg, cu CRLF cum cere RFC 5545', () => {
    const ics = buildIcs(EVENT)
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'))
    assert.ok(ics.includes('\r\n'), 'terminatorul este CRLF, nu LF')
    assert.ok(!/[^\r]\n/.test(ics), 'niciun LF fără CR înaintea lui')
  })

  it('scrie orele în UTC, ca fusul cititorului să nu le mute', () => {
    const ics = buildIcs(EVENT)
    assert.equal(lineOf(ics, 'DTSTART'), 'DTSTART:20260915T113000Z')
    assert.equal(lineOf(ics, 'DTEND'), 'DTEND:20260915T130000Z')
  })

  it('o invitație este REQUEST, confirmată, secvența zero', () => {
    const ics = buildIcs(EVENT)
    assert.equal(lineOf(ics, 'METHOD'), 'METHOD:REQUEST')
    assert.equal(lineOf(ics, 'STATUS'), 'STATUS:CONFIRMED')
    assert.equal(lineOf(ics, 'SEQUENCE'), 'SEQUENCE:0')
  })

  /* The pair that matters: the cancellation has to replace the invitation, not
   * add a second event to the calendar. */
  it('o anulare păstrează UID-ul și urcă secvența', () => {
    const invitation = buildIcs(EVENT)
    const anulare = buildIcs({ ...EVENT, cancelled: true })

    assert.equal(lineOf(anulare, 'UID'), lineOf(invitation, 'UID'), 'același UID')
    assert.equal(lineOf(anulare, 'METHOD'), 'METHOD:CANCEL')
    assert.equal(lineOf(anulare, 'STATUS'), 'STATUS:CANCELLED')

    const seq = (ics: string) => Number(lineOf(ics, 'SEQUENCE')!.split(':')[1])
    assert.ok(seq(anulare) > seq(invitation), 'secvența crește, altfel clientul o ignoră')
  })

  it('rupe liniile lungi la 75 de octeți, cu continuare prin spațiu', () => {
    const ics = buildIcs({
      ...EVENT,
      title: 'Consultație despre metodologia cercetării cantitative și validarea instrumentului de măsurare a satisfacției',
    })
    for (const l of ics.split('\r\n')) {
      assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `linie de ${Buffer.byteLength(l, 'utf8')} octeți: ${l.slice(0, 40)}…`)
    }
    // Continuations start with a space, otherwise the text is lost on reading.
    const continuations = ics.split('\r\n').filter((l) => l.startsWith(' '))
    assert.ok(continuations.length > 0, 'titlul lung a fost rupt')
  })

  it('protejează caracterele cu înțeles în format', () => {
    const ics = buildIcs({ ...EVENT, location: 'Cabinet 2314, etaj 3; intrarea B' })
    const l = ics.split('\r\n').filter((x) => x.startsWith('LOCATION') || x.startsWith(' ')).join('')
    assert.ok(l.includes('\\,'), 'virgula este escapată')
    assert.ok(l.includes('\\;'), 'punctul și virgula sunt escapate')
  })

  it('numește organizatorul și invitatul, ca invitația să fie o invitație', () => {
    const ics = buildIcs(EVENT)
    assert.match(lineOf(ics, 'ORGANIZER')!, /mailto:mihaela\.ionescu@ase\.ro/)
    assert.match(ics.replace(/\r\n /g, ''), /ATTENDEE.*mailto:andrei\.vasilescu@stud\.ase\.ro/)
  })
})

describe('consultationUid', () => {
  it('un UID per pereche interval–student', () => {
    assert.notEqual(consultationUid('slot-1', 'student-a'), consultationUid('slot-1', 'student-b'))
    assert.notEqual(consultationUid('slot-1', 'student-a'), consultationUid('slot-2', 'student-a'))
  })

  it('același UID pentru aceeași pereche, oricând este cerut', () => {
    assert.equal(consultationUid('slot-1', 'student-a'), consultationUid('slot-1', 'student-a'))
  })
})

/**
 * Several events in one file.
 *
 * A coordinator who calls off a whole day, and a group meeting with three
 * invitees, both produce more than one event for the same person. Sent as
 * separate attachments only the first is read — Gmail keeps one calendar part
 * per message — so the second and third hours stayed in the calendar of
 * everybody who had just been told, in writing, that they were cancelled.
 */
describe('buildIcsBundle', () => {
  const SLOT = 'slot-9'
  const STUDENTS = [
    { id: 'student-a', name: 'Andrei Vasilescu', email: 'andrei.vasilescu@stud.ase.ro' },
    { id: 'student-b', name: 'Bianca Marin', email: 'bianca.marin@stud.ase.ro' },
    { id: 'student-c', name: 'Cătălin Pop', email: 'catalin.pop@stud.ase.ro' },
  ]

  const cancelBundle = () =>
    buildIcsBundle(
      STUDENTS.map((s) => ({
        ...EVENT,
        uid: consultationUid(SLOT, s.id),
        attendeeName: s.name,
        attendeeEmail: s.email,
        cancelled: true,
      })),
    )

  it('ține un singur calendar, oricâte evenimente are', () => {
    const ics = cancelBundle()
    assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VCALENDAR').length, 1)
    assert.equal(ics.split('\r\n').filter((l) => l === 'END:VCALENDAR').length, 1)
    assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 3)
  })

  /* The pair that matters, once more: three students on the same hour are three
   * events in three calendars, so a cancellation has to name all three UIDs. */
  it('anulează exact rezervările cerute, cu UID-ul fiecăreia', () => {
    const uids = cancelBundle()
      .split('\r\n')
      .filter((l) => l.startsWith('UID:'))
      .map((l) => l.slice(4))

    assert.deepEqual(uids, STUDENTS.map((s) => consultationUid(SLOT, s.id)))
    assert.equal(new Set(uids).size, 3, 'niciun UID repetat')
  })

  it('marchează toate evenimentele ca anulate, cu secvența urcată', () => {
    const lines = cancelBundle().split('\r\n')
    assert.deepEqual(lines.filter((l) => l.startsWith('METHOD:')), ['METHOD:CANCEL'])
    assert.equal(lines.filter((l) => l === 'STATUS:CANCELLED').length, 3)
    assert.equal(lines.filter((l) => l === 'SEQUENCE:1').length, 3)
  })

  it('fiecare eveniment își păstrează invitatul', () => {
    const ics = cancelBundle().replace(/\r\n /g, '')
    for (const s of STUDENTS) {
      assert.ok(ics.includes(`mailto:${s.email}`), `${s.name} lipsește din pachet`)
    }
  })

  /* `buildIcs` is this function with one event: the single invitation, which is
   * the overwhelming majority of what the portal sends, must not change shape
   * because the bundle exists. */
  it('un singur eveniment dă exact fișierul de dinainte', () => {
    const alone = buildIcsBundle([EVENT]).replace(/^DTSTAMP:.*$/gm, '')
    const direct = buildIcs(EVENT).replace(/^DTSTAMP:.*$/gm, '')
    assert.equal(alone, direct)
  })
})
