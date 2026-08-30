import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiskMailer } from '../src/lib/adapters/disk-mailer.ts'

/**
 * The mailbox on disk.
 *
 * It is now the tool every mail the portal sends is checked with, so if it
 * writes broken MIME, the check says nothing about what reaches people — it
 * shows a broken file and nobody knows whether the fault is the mail's or the
 * mailbox's. It is checked against the parser in the standard library, not
 * against the eye.
 */

function tempOutbox() {
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
    const dir = tempOutbox()
    const m = createDiskMailer({ from: 'Portal <noreply@x.ro>', dir })
    const r = await m.send(MAIL)
    assert.equal(r.ok, true)
    const files = readdirSync(dir)
    assert.equal(files.length, 1)
    assert.ok(files[0].endsWith('.eml'))
    assert.equal(r.id, files[0])
  })

  it('numele fișierului poartă ora, destinatarul și subiectul', async () => {
    const dir = tempOutbox()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send(MAIL)
    const nume = readdirSync(dir)[0]
    assert.match(nume, /^\d{4}-\d{2}-\d{2}T/, 'începe cu ora, ca `ls` să le dea în ordine')
    assert.ok(nume.includes('dan.marinescu@stud.ase.ro'))
    assert.ok(nume.includes('consultatia'), 'subiectul, fără diacritice')
    assert.ok(!/[^\w@.\-]/.test(nume.replace(/\.eml$/, '')), 'nimic care să nu fie un nume de fișier')
  })

  it('scrie antetele și părțile pe care le cere un client de mail', async () => {
    const dir = tempOutbox()
    await createDiskMailer({ from: 'Portal Studenți ASE <noreply@x.ro>', dir }).send(MAIL)
    const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')

    assert.ok(raw.startsWith('From: '))
    assert.ok(raw.includes(`To: ${MAIL.to}`))
    assert.ok(raw.includes('MIME-Version: 1.0'))
    assert.ok(raw.includes('multipart/mixed'))
    assert.ok(raw.includes('text/plain; charset=UTF-8'))
    assert.ok(raw.includes('text/html; charset=UTF-8'))
    // CRLF, as the format requires; a lone LF breaks the boundaries in some clients.
    assert.ok(!/[^\r]\n/.test(raw), 'toate liniile se termină cu CRLF')
  })

  it('codează diacriticele din antete, ca să nu ajungă mojibake', async () => {
    const dir = tempOutbox()
    await createDiskMailer({ from: 'Portal Studenți ASE <noreply@x.ro>', dir }).send(MAIL)
    const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    const subjectHeader = raw.split('\r\n').find((l) => l.startsWith('Subject:'))!
    assert.match(subjectHeader, /=\?UTF-8\?B\?/, 'cuvânt codat RFC 2047')
    // And it decodes back to what we sent.
    const codat = subjectHeader.replace('Subject: =?UTF-8?B?', '').replace('?=', '')
    assert.equal(Buffer.from(codat, 'base64').toString('utf8'), MAIL.subject)
  })

  it('rupe base64 la 76 de coloane, cum cere RFC 2045', async () => {
    const dir = tempOutbox()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send({
      ...MAIL,
      html: '<p>' + 'text lung '.repeat(200) + '</p>',
    })
    const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    for (const l of raw.split('\r\n')) {
      assert.ok(l.length <= 998, 'nicio linie peste limita SMTP')
    }
    const longLines = raw.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l))
    assert.ok(longLines.length > 1, 'base64 a fost rupt pe mai multe linii')
    for (const l of longLines) assert.ok(l.length <= 76, `linie base64 de ${l.length}`)
  })

  it('atașează fișierele cu numele și tipul lor', async () => {
    const dir = tempOutbox()
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send({
      ...MAIL,
      attachments: [
        { filename: 'anulare.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', contentType: 'text/calendar; method=CANCEL' },
        { filename: 'raport.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' },
      ],
    })
    const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    assert.ok(raw.includes('filename="anulare.ics"'))
    assert.ok(raw.includes('text/calendar; method=CANCEL'))
    assert.ok(raw.includes('filename="raport.pdf"'))
    assert.ok(raw.includes('Content-Transfer-Encoding: base64'))
    // The calendar content can be pulled back out.
    assert.ok(raw.includes(Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR').toString('base64')))
  })

  it('nu aruncă niciodată, nici când calea nu se poate scrie', async () => {
    // A file standing where a directory should be: `mkdir` fails, and the portal
    // is not allowed to fall over.
    const dir = tempOutbox()
    const path = join(dir, 'ocupat')
    await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir: path }).send(MAIL)
    const m = createDiskMailer({ from: 'Portal <noreply@x.ro>', dir: join(path, readdirSync(path)[0]) })
    const r = await m.send(MAIL)
    assert.equal(r.ok, false, 'raportează eșecul')
    assert.ok(r.error, 'cu un motiv')
  })

  it('un mail fără text simplu rămâne valid', async () => {
    const dir = tempOutbox()
    const { text, ...withoutText } = MAIL
    const r = await createDiskMailer({ from: 'Portal <noreply@x.ro>', dir }).send(withoutText)
    assert.equal(r.ok, true)
    const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')
    assert.ok(!raw.includes('text/plain'))
    assert.ok(raw.includes('text/html'))
  })
})
