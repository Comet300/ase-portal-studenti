import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiskMailer } from '../src/lib/adapters/disk-mailer.ts'

/**
 * Cutia poștală de pe disc.
 *
 * Ea este acum unealta cu care se verifică orice mail al portalului, deci dacă
 * scrie MIME stricat, verificarea nu spune nimic despre ce ajunge la oameni —
 * arată un fișier stricat și nimeni nu știe dacă vina e a mailului sau a cutiei.
 * Se verifică împotriva parserului din biblioteca standard, nu împotriva ochiului.
 */

function cutie() {
  return mkdtempSync(join(tmpdir(), 'portal-outbox-'))
}

const MAIL = {
  to: 'dan.marinescu@stud.ase.ro',
  subject: 'Consultația din 1 august 2026 a fost anulată',
  html: '<p>Bună, Dan. Consultația a fost <strong>anulată</strong>.</p>',
  text: 'Bună, Dan. Consultația a fost anulată.',
}

describe('createDiskMailer', () => {
  it('scrie un fișier și spune că a reușit', async () => {
    const dir = cutie()
    const m = createDiskMailer({ from: 'Portal <noreply@x.ro>', dir })
    const r = await m.send(MAIL)
    assert.equal(r.ok, true)
    const fisiere = readdirSync(dir)
    assert.equal(fisiere.length, 1)
    assert.ok(fisiere[0].endsWith('.eml'))
    assert.equal(r.id, fisiere[0])
  })

  it('numele fișierului poartă ora, destinatarul și subiectul', async () => {
    const dir = cutie()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send(MAIL)
    const nume = readdirSync(dir)[0]
    assert.match(nume, /^\d{4}-\d{2}-\d{2}T/, 'începe cu ora, ca `ls` să le dea în ordine')
    assert.ok(nume.includes('dan.marinescu@stud.ase.ro'))
    assert.ok(nume.includes('consultatia'), 'subiectul, fără diacritice')
    assert.ok(!/[^\w@.\-]/.test(nume.replace(/\.eml$/, '')), 'nimic care să nu fie un nume de fișier')
  })

  it('scrie antetele și părțile pe care le cere un client de mail', async () => {
    const dir = cutie()
    await createDiskMailer({ from: 'Portal Studenți ASE <noreply@x.ro>', dir }).send(MAIL)
    const brut = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')

    assert.ok(brut.startsWith('From: '))
    assert.ok(brut.includes(`To: ${MAIL.to}`))
    assert.ok(brut.includes('MIME-Version: 1.0'))
    assert.ok(brut.includes('multipart/mixed'))
    assert.ok(brut.includes('text/plain; charset=UTF-8'))
    assert.ok(brut.includes('text/html; charset=UTF-8'))
    // CRLF, cum cere formatul; un LF singur strică granițele la unele clienți.
    assert.ok(!/[^\r]\n/.test(brut), 'toate liniile se termină cu CRLF')
  })

  it('codează diacriticele din antete, ca să nu ajungă mojibake', async () => {
    const dir = cutie()
    await createDiskMailer({ from: 'Portal Studenți ASE <noreply@x.ro>', dir }).send(MAIL)
    const brut = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    const subiect = brut.split('\r\n').find((l) => l.startsWith('Subject:'))!
    assert.match(subiect, /=\?UTF-8\?B\?/, 'cuvânt codat RFC 2047')
    // Și se decodează la ce am trimis.
    const codat = subiect.replace('Subject: =?UTF-8?B?', '').replace('?=', '')
    assert.equal(Buffer.from(codat, 'base64').toString('utf8'), MAIL.subject)
  })

  it('rupe base64 la 76 de coloane, cum cere RFC 2045', async () => {
    const dir = cutie()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send({
      ...MAIL,
      html: '<p>' + 'text lung '.repeat(200) + '</p>',
    })
    const brut = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    for (const l of brut.split('\r\n')) {
      assert.ok(l.length <= 998, 'nicio linie peste limita SMTP')
    }
    const lungi = brut.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l))
    assert.ok(lungi.length > 1, 'base64 a fost rupt pe mai multe linii')
    for (const l of lungi) assert.ok(l.length <= 76, `linie base64 de ${l.length}`)
  })

  it('atașează fișierele cu numele și tipul lor', async () => {
    const dir = cutie()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send({
      ...MAIL,
      attachments: [
        { filename: 'anulare.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', contentType: 'text/calendar; method=CANCEL' },
        { filename: 'raport.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' },
      ],
    })
    const brut = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    assert.ok(brut.includes('filename="anulare.ics"'))
    assert.ok(brut.includes('text/calendar; method=CANCEL'))
    assert.ok(brut.includes('filename="raport.pdf"'))
    assert.ok(brut.includes('Content-Transfer-Encoding: base64'))
    // Conținutul calendarului se poate scoate înapoi.
    assert.ok(brut.includes(Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR').toString('base64')))
  })

  it('nu aruncă niciodată, nici când calea nu se poate scrie', async () => {
    // Un fișier ca director: `mkdir` eșuează, iar portalul nu are voie să cadă.
    const dir = cutie()
    const cale = join(dir, 'ocupat')
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir: cale }).send(MAIL)
    const m = createDiskMailer({ from: 'Portal <noreply@x.ro>', dir: join(cale, readdirSync(cale)[0]) })
    const r = await m.send(MAIL)
    assert.equal(r.ok, false, 'raportează eșecul')
    assert.ok(r.error, 'cu un motiv')
  })

  it('un mail fără text simplu rămâne valid', async () => {
    const dir = cutie()
    const { text, ...faraText } = MAIL
    const r = await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send(faraText)
    assert.equal(r.ok, true)
    const brut = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    assert.ok(!brut.includes('text/plain'))
    assert.ok(brut.includes('text/html'))
  })
})
