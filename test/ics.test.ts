import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs, consultationUid } from '../src/lib/ics.ts'

/**
 * Fișierul de calendar.
 *
 * Testat pe reguli de format, nu pe aspect: un `.ics` greșit nu arată prost, pur
 * și simplu nu se importă — sau, mai rău, se importă ca un al doilea eveniment în
 * loc să anuleze primul. Anularea funcționează numai dacă UID-ul este identic cu
 * al invitației și `SEQUENCE` este mai mare; portalul a avut trei scheme de UID
 * diferite, deci o anulare nu putea găsi niciodată rezervarea ei.
 */

const EVENIMENT = {
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

const linia = (ics: string, cheie: string) =>
  ics.split('\r\n').find((l) => l.startsWith(cheie + ':') || l.startsWith(cheie + ';'))

describe('buildIcs', () => {
  it('scrie un calendar întreg, cu CRLF cum cere RFC 5545', () => {
    const ics = buildIcs(EVENIMENT)
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'))
    assert.ok(ics.includes('\r\n'), 'terminatorul este CRLF, nu LF')
    assert.ok(!/[^\r]\n/.test(ics), 'niciun LF fără CR înaintea lui')
  })

  it('scrie orele în UTC, ca fusul cititorului să nu le mute', () => {
    const ics = buildIcs(EVENIMENT)
    assert.equal(linia(ics, 'DTSTART'), 'DTSTART:20260915T113000Z')
    assert.equal(linia(ics, 'DTEND'), 'DTEND:20260915T130000Z')
  })

  it('o invitație este REQUEST, confirmată, secvența zero', () => {
    const ics = buildIcs(EVENIMENT)
    assert.equal(linia(ics, 'METHOD'), 'METHOD:REQUEST')
    assert.equal(linia(ics, 'STATUS'), 'STATUS:CONFIRMED')
    assert.equal(linia(ics, 'SEQUENCE'), 'SEQUENCE:0')
  })

  /* Perechea care contează: anularea trebuie să înlocuiască invitația, nu să
   * adauge un al doilea eveniment în calendar. */
  it('o anulare păstrează UID-ul și urcă secvența', () => {
    const invitatie = buildIcs(EVENIMENT)
    const anulare = buildIcs({ ...EVENIMENT, cancelled: true })

    assert.equal(linia(anulare, 'UID'), linia(invitatie, 'UID'), 'același UID')
    assert.equal(linia(anulare, 'METHOD'), 'METHOD:CANCEL')
    assert.equal(linia(anulare, 'STATUS'), 'STATUS:CANCELLED')

    const seq = (ics: string) => Number(linia(ics, 'SEQUENCE')!.split(':')[1])
    assert.ok(seq(anulare) > seq(invitatie), 'secvența crește, altfel clientul o ignoră')
  })

  it('rupe liniile lungi la 75 de octeți, cu continuare prin spațiu', () => {
    const ics = buildIcs({
      ...EVENIMENT,
      title: 'Consultație despre metodologia cercetării cantitative și validarea instrumentului de măsurare a satisfacției',
    })
    for (const l of ics.split('\r\n')) {
      assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `linie de ${Buffer.byteLength(l, 'utf8')} octeți: ${l.slice(0, 40)}…`)
    }
    // Continuările încep cu un spațiu, altfel textul se pierde la citire.
    const continuari = ics.split('\r\n').filter((l) => l.startsWith(' '))
    assert.ok(continuari.length > 0, 'titlul lung a fost rupt')
  })

  it('protejează caracterele cu înțeles în format', () => {
    const ics = buildIcs({ ...EVENIMENT, location: 'Cabinet 2314, etaj 3; intrarea B' })
    const l = ics.split('\r\n').filter((x) => x.startsWith('LOCATION') || x.startsWith(' ')).join('')
    assert.ok(l.includes('\\,'), 'virgula este escapată')
    assert.ok(l.includes('\\;'), 'punctul și virgula sunt escapate')
  })

  it('numește organizatorul și invitatul, ca invitația să fie o invitație', () => {
    const ics = buildIcs(EVENIMENT)
    assert.match(linia(ics, 'ORGANIZER')!, /mailto:mihaela\.ionescu@ase\.ro/)
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
