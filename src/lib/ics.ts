/**
 * Generare de invitații de calendar.
 *
 * Un fișier .ics atașat la email ajunge în Google Calendar, Outlook și Apple
 * Calendar fără integrare externă, fără OAuth și fără dependențe.
 */

export interface CalendarEvent {
  uid: string
  title: string
  description?: string
  location?: string
  start: Date
  end: Date
  organizerName: string
  organizerEmail: string
  attendeeName: string
  attendeeEmail: string
  cancelled?: boolean
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 cere lines de maximum 75 de octeți, continuate cu un spațiu. */
function fold(linie: string): string {
  const bytes = Buffer.from(linie, 'utf8')
  if (bytes.byteLength <= 75) return linie

  const chunks: string[] = []
  let current = Buffer.alloc(0)

  for (const ch of [...linie]) {
    const b = Buffer.from(ch, 'utf8')
    const limit = chunks.length === 0 ? 75 : 74
    if (current.byteLength + b.byteLength > limit) {
      chunks.push(current.toString('utf8'))
      current = Buffer.alloc(0)
    }
    current = Buffer.concat([current, b])
  }
  chunks.push(current.toString('utf8'))

  return chunks.join('\r\n ')
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildIcs(ev: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Portal Studenti ASE//Sesiunea 2026//RO',
    'CALSCALE:GREGORIAN',
    `METHOD:${ev.is_cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(ev.inceput)}`,
    `DTEND:${utc(ev.sfarsit)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : '',
    ev.location ? `LOCATION:${escapeText(ev.location)}` : '',
    `ORGANIZER;CN=${escapeText(ev.organizatorNume)}:mailto:${ev.organizatorEmail}`,
    `ATTENDEE;CN=${escapeText(ev.participantNume)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ev.participantEmail}`,
    `STATUS:${ev.is_cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${ev.is_cancelled ? 1 : 0}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Consultație în mai puțin de o oră',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)

  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Calendarul sesiunii, ca fișier descărcabil — etapele ca evenimente de zi întreagă. */
export function stagesIcs(stages: { title: string; description: string | null; starts_on: string | null; ends_on: string | null }[]): string {
  const dayStamp = (d: string) => d.slice(0, 10).replace(/-/g, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Portal Studenti ASE//Calendar sesiune 2026//RO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Sesiunea de Finalizare a Studiilor 2026',
  ]

  for (const [i, e] of stages.entries()) {
    if (!e.starts_on || !e.ends_on) continue
    // DTEND este exclusiv pentru evenimentele de zi întreagă.
    const end = new Date(e.ends_on)
    end.setDate(end.getDate() + 1)

    lines.push(
      'BEGIN:VEVENT',
      `UID:etapa-${i + 1}@portal.stargrid.dev`,
      `DTSTAMP:${utc(new Date())}`,
      `DTSTART;VALUE=DATE:${dayStamp(e.starts_on)}`,
      `DTEND;VALUE=DATE:${dayStamp(end.toISOString())}`,
      `SUMMARY:${escape(e.title)}`,
      e.description ? `DESCRIPTION:${escape(e.description)}` : '',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n'
}
