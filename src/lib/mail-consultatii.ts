import { html, joinHtml, template, type SafeHtml } from './mail'
import { numar } from './text'

/**
 * The letters a cancelled consultation sends.
 *
 * They live next to the consultation routes rather than in `mail.ts`, which
 * owns the house style and nothing else. What is here is the wording of one
 * event — an hour that will not happen — written once for the two people it
 * concerns instead of twice inside the endpoint.
 *
 * A coordinator can call off a whole day in one gesture, so every message is
 * written for a list of hours and reads correctly when the list has one.
 */

export interface CancelledHour {
  /** „12 septembrie 2026, 14:00–15:00”. */
  when: string
  /** Where it was going to be — the room, or the meeting address. */
  place: string
}

function hourList(hours: CancelledHour[]): SafeHtml {
  return joinHtml(hours.map((h) => html`<li><strong>${h.when}</strong> · ${h.place}</li>`))
}

/**
 * Why, in the coordinator's own words.
 *
 * Left out entirely when there is none: „Motiv: —” reads as a refusal to say,
 * which is worse than a cancellation with no explanation attached to it.
 */
function reasonBlock(reason: string): SafeHtml {
  if (!reason) return html``
  return html`<p style="padding:12px 16px;background:#f8f9fa;border-radius:4px">
      <strong>Motiv:</strong> ${reason}
    </p>`
}

/** The message to a student who had booked one of the cancelled hours. */
export function studentCancellationMail(p: {
  studentName: string
  teacherName: string
  hours: CancelledHour[]
  reason: string
  portalUrl: string
}): { subject: string; html: string } {
  const one = p.hours.length === 1

  const subject = one
    ? `Consultația din ${p.hours[0].when} a fost anulată`
    : `${numar(p.hours.length, 'oră de consultație anulată', 'ore de consultație anulate')}`

  const body = html`<p>Bună, ${p.studentName.split(' ')[0]}.
     <strong>${p.teacherName}</strong>
     ${one ? 'a anulat consultația de mai jos.' : 'a anulat consultațiile de mai jos.'}</p>
    <ul>${hourList(p.hours)}</ul>
    ${reasonBlock(p.reason)}
    <p>Locul ${one ? 'ei' : 'lor'} nu se reprogramează automat: alege altă oră liberă din portal,
     sau scrie-i coordonatorului ca să stabiliți alta.</p>
    <p style="color:#5b6169;font-size:13px">Am retras și ${one ? 'invitația' : 'invitațiile'} din
     calendar — fișierul atașat le anulează acolo unde le-ai adăugat.</p>`

  return {
    subject,
    html: template(
      one ? 'Consultația a fost anulată' : 'Consultațiile au fost anulate',
      body,
      { text: 'Vezi orele libere', url: `${p.portalUrl}/consultatii` },
    ),
  }
}

/**
 * The coordinator's own copy.
 *
 * Not a courtesy: the coordinator holds a calendar entry for every student who
 * had booked — one event per person, put there when the booking was made — and
 * cancelling used to withdraw those entries from the students only. The hour
 * stayed in the calendar of the one person who knew for certain it would not
 * happen, and reminded them of it an hour before.
 */
export function teacherCancellationMail(p: {
  hours: CancelledHour[]
  studentNames: string[]
  reason: string
  portalUrl: string
}): { subject: string; html: string } {
  const one = p.hours.length === 1

  const announced =
    p.studentNames.length > 0
      ? html`<p>${numar(p.studentNames.length, 'student anunțat', 'studenți anunțați')} pe email:
         ${p.studentNames.join(', ')}.</p>`
      : html`<p>Nimeni nu avea loc rezervat, deci nu a fost nimeni de anunțat.</p>`

  return {
    subject: one
      ? `Ai anulat consultația din ${p.hours[0].when}`
      : `Ai anulat ${numar(p.hours.length, 'oră de consultație', 'ore de consultație')}`,
    html: template(
      one ? 'Consultație anulată' : 'Consultații anulate',
      html`<p>${one ? 'Ora anulată' : 'Orele anulate'}:</p>
        <ul>${hourList(p.hours)}</ul>
        ${reasonBlock(p.reason)}
        ${announced}
        <p style="color:#5b6169;font-size:13px">Fișierul atașat scoate ${one ? 'ora' : 'orele'} și
         din calendarul tău.</p>`,
      { text: 'Vezi programul', url: `${p.portalUrl}/profesor/consultatii` },
    ),
  }
}
