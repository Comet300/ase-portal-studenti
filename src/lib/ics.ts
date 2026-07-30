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
  /** Adresa întâlnirii online, dacă există. Devine butonul „Participă”. */
  meetingUrl?: string
  start: Date
  end: Date
  organizerName: string
  organizerEmail: string
  attendeeName: string
  attendeeEmail: string
  cancelled?: boolean
}

/**
 * Identitatea unui eveniment, pentru clientul de calendar.
 *
 * Trebuie să fie aceeași la creare, la modificare și la anulare — altfel
 * `METHOD:CANCEL` nu găsește ce să anuleze și lasă în calendar o oră fantomă.
 * Existau trei scheme diferite în trei fișiere; acum e una singură, aici.
 *
 * Un interval de grup are câte un eveniment pentru fiecare invitat, deci
 * identitatea îl include și pe el.
 */
export function consultationUid(slotId: string, studentId: string): string {
  return `consultatie-${slotId}-${studentId}@portal-studenti.ase.ro`
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
    'PRODID:-//Portal Studenti ASE//Portal Studenti//RO',
    'CALSCALE:GREGORIAN',
    `METHOD:${ev.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(ev.start)}`,
    `DTEND:${utc(ev.end)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : '',
    ev.location ? `LOCATION:${escapeText(ev.location)}` : '',
    /* Adresa întâlnirii, ca proprietate, nu doar îngropată în descriere:
     * Google Calendar și Outlook scot din ea butonul „Participă”, iar
     * `X-GOOGLE-CONFERENCE` este ce citește Google anume. */
    ev.meetingUrl ? `URL:${escapeText(ev.meetingUrl)}` : '',
    ev.meetingUrl ? `X-GOOGLE-CONFERENCE:${escapeText(ev.meetingUrl)}` : '',
    `ORGANIZER;CN=${escapeText(ev.organizerName)}:mailto:${ev.organizerEmail}`,
    `ATTENDEE;CN=${escapeText(ev.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ev.attendeeEmail}`,
    `STATUS:${ev.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${ev.cancelled ? 1 : 0}`,
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
export function stagesIcs(
  stages: { title: string; description: string | null; starts_on: string | null; ends_on: string | null }[],
  sessionLabel = '',
): string {
  const dayStamp = (d: string) => d.slice(0, 10).replace(/-/g, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Portal Studenti ASE//Calendar sesiune//RO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Sesiunea de Finalizare a Studiilor ${sessionLabel}`.trim(),
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
      `SUMMARY:${escapeText(e.title)}`,
      e.description ? `DESCRIPTION:${escapeText(e.description)}` : '',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n'
}
