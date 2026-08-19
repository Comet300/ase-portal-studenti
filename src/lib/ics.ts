/**
 * Generating calendar invitations.
 *
 * An .ics file attached to an email arrives in Google Calendar, Outlook and
 * Apple Calendar with no external integration, no OAuth and no dependencies.
 */

export interface CalendarEvent {
  uid: string
  title: string
  description?: string
  location?: string
  /** The online meeting address, if there is one. Becomes the „Participă” button. */
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
 * The identity of an event, for the calendar client.
 *
 * It has to be the same on creation, on modification and on cancellation —
 * otherwise `METHOD:CANCEL` finds nothing to cancel and leaves a ghost hour in
 * the calendar. There were three different schemes in three files; now there is
 * a single one, here.
 *
 * A group slot has one event per invitee, so the identity includes the invitee
 * too.
 */
export function consultationUid(slotId: string, studentId: string): string {
  return `consultatie-${slotId}-${studentId}@portal-studenti.ase.ro`
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 requires lines of at most 75 bytes, continued with a space. */
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

/** One `VEVENT`, without the calendar around it. */
function vevent(ev: CalendarEvent): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(ev.start)}`,
    `DTEND:${utc(ev.end)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : '',
    ev.location ? `LOCATION:${escapeText(ev.location)}` : '',
    /* The meeting address as a property, not merely buried in the description:
     * Google Calendar and Outlook build the „Participă” button out of it, and
     * `X-GOOGLE-CONFERENCE` is what Google in particular reads. */
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
  ].filter(Boolean)
}

export function buildIcs(ev: CalendarEvent): string {
  return buildIcsBundle([ev])
}

/**
 * Several events in one file.
 *
 * A coordinator who cancels a whole day withdraws three or four hours at once,
 * and a group meeting has one event per invitee — that is, one UID per invitee,
 * because the calendar of the person who organised it holds a separate copy for
 * each of them. Attached as separate `.ics` files, only the first is read:
 * Gmail surfaces one calendar part per message and silently ignores the rest,
 * so the second and third hours stayed in the calendar of everybody who had
 * been told, in writing, that they were cancelled.
 *
 * RFC 5545 puts several `VEVENT`s inside one `VCALENDAR`, which is a single
 * attachment and therefore a single calendar part. The bundle is homogeneous —
 * either all cancellations or all invitations — so `METHOD` is taken from the
 * first event; a mixed bundle has no meaning for a calendar client.
 */
export function buildIcsBundle(events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Portal Studenti ASE//Portal Studenti//RO',
    'CALSCALE:GREGORIAN',
    `METHOD:${events[0]?.cancelled ? 'CANCEL' : 'REQUEST'}`,
    ...events.flatMap(vevent),
    'END:VCALENDAR',
  ]

  return lines.map(fold).join('\r\n') + '\r\n'
}

/** The session calendar, as a downloadable file — the stages as all-day events. */
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
    // DTEND is exclusive for all-day events.
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
