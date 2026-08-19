import { html, joinHtml, quote, sendEmail, template, type SafeHtml } from './mail'
import { describeChanges, type FieldChange } from './title-changes.ts'

/**
 * The four messages a thesis change produces.
 *
 * Beside the route rather than inside `lib/mail.ts`, which is shared: what
 * belongs there is the house style — one template, one button, one footer — and
 * what belongs here is the wording of one feature. Every body is built with the
 * `html` tag, so titles and objectives written by a student are escaped on the
 * way in; they are free text that reaches an inbox.
 */

/**
 * The before-and-after, as a block. Only the fields that differ appear.
 *
 * `joinHtml`, not an array interpolated into `html`: the tag escapes anything
 * that is not itself safe markup, and an array reaches it as `String(array)` —
 * every part joined with commas and then escaped, i.e. the markup printed as
 * text.
 */
function diffBlock(changes: readonly FieldChange[]): SafeHtml {
  return joinHtml(changes.map(
    (c) => html`<p style="margin:16px 0 4px;font-size:12px;color:#5b6169">${c.label}</p>
      <p style="margin:0 0 2px;padding:8px 12px;background:#f8f9fa;border-radius:4px;
        color:#5b6169;text-decoration:line-through;white-space:pre-wrap">${c.from}</p>
      <p style="margin:0;padding:8px 12px;background:#f8f9fa;border-left:2px solid #990000;
        border-radius:0 4px 4px 0;white-space:pre-wrap"><strong>${c.to}</strong></p>`,
  ))
}

const firstName = (name: string) => name.split(' ')[0]

/** To the coordinator: the student is asking for a change. */
export function sendChangeRequested(m: {
  to: string
  teacherName: string
  studentName: string
  requestNumber: string
  changes: readonly FieldChange[]
  reason: string | null
  baseUrl: string
}) {
  return sendEmail({
    to: m.to,
    subject: `${m.studentName} cere o modificare la lucrarea ${m.requestNumber}`,
    html: template(
      'O cerere de modificare a lucrării',
      html`<p>Bună, ${firstName(m.teacherName)}. ${m.studentName} cere să schimbe
       ${describeChanges(m.changes)} la lucrarea <strong>${m.requestNumber}</strong>.</p>
       ${diffBlock(m.changes)}
       ${m.reason ? html`<p style="margin-top:20px"><strong>Motivul studentului:</strong></p>${quote(m.reason)}` : ''}
       <p>Coordonarea rămâne în vigoare cât timp cererea așteaptă: locul, conversația și
       documentul tipăribil nu se schimbă. Se schimbă doar textul lucrării, dacă accepți.</p>`,
      { text: 'Vezi cererea de modificare', url: `${m.baseUrl}/profesor/studenti?sectiune=modificari` },
      `${describeChanges(m.changes)} · ${m.requestNumber}`,
    ),
  })
}

/** To the student: the coordinator has decided. */
export function sendChangeDecided(m: {
  to: string
  studentName: string
  teacherName: string
  requestNumber: string
  approved: boolean
  changes: readonly FieldChange[]
  note: string | null
  baseUrl: string
}) {
  return sendEmail({
    to: m.to,
    subject: m.approved
      ? `Modificarea lucrării ${m.requestNumber} a fost acceptată`
      : `Modificarea lucrării ${m.requestNumber} a fost respinsă`,
    html: template(
      m.approved ? 'Modificarea a fost acceptată' : 'Modificarea a fost respinsă',
      m.approved
        ? html`<p>Bună, ${firstName(m.studentName)}. ${m.teacherName} a acceptat modificarea la
           lucrarea <strong>${m.requestNumber}</strong>. Titlul din portal, din arhivă și din
           cererea tipăribilă este de acum cel nou.</p>
           ${diffBlock(m.changes)}
           ${m.note ? html`<p style="margin-top:20px"><strong>Mesaj de la coordonator:</strong></p>${quote(m.note)}` : ''}
           <p>Dacă ai deja cererea tipărită și semnată la secretariat, tipărește-o din nou:
           exemplarul depus poartă titlul vechi.</p>`
        : html`<p>Bună, ${firstName(m.studentName)}. ${m.teacherName} nu a acceptat modificarea la
           lucrarea <strong>${m.requestNumber}</strong>. Lucrarea rămâne cu titlul și obiectivele
           de dinainte.</p>
           <p><strong>Motiv:</strong></p>${quote(m.note ?? '')}
           <p>Poți cere altă modificare oricând, sau poți discuta întâi în conversație.</p>`,
      { text: 'Deschide lucrarea', url: `${m.baseUrl}/cererile-mele` },
    ),
  })
}

/** To the student: the coordinator changed it themselves. */
export function sendChangeApplied(m: {
  to: string
  studentName: string
  teacherName: string
  requestNumber: string
  changes: readonly FieldChange[]
  reason: string | null
  baseUrl: string
}) {
  return sendEmail({
    to: m.to,
    subject: `${m.teacherName} a modificat lucrarea ${m.requestNumber}`,
    html: template(
      'Lucrarea ta a fost modificată',
      html`<p>Bună, ${firstName(m.studentName)}. ${m.teacherName} a schimbat
       ${describeChanges(m.changes)} la lucrarea <strong>${m.requestNumber}</strong>. Modificarea
       este deja în vigoare — coordonatorul o aplică direct.</p>
       ${diffBlock(m.changes)}
       ${m.reason ? html`<p style="margin-top:20px"><strong>Explicația coordonatorului:</strong></p>${quote(m.reason)}` : ''}
       <p>Dacă nu ești de acord, scrie-i în conversație înainte de a cere altă modificare.</p>`,
      { text: 'Vezi lucrarea', url: `${m.baseUrl}/cererile-mele` },
    ),
  })
}

/** To the coordinator: the student took the request back. */
export function sendChangeWithdrawn(m: {
  to: string
  teacherName: string
  studentName: string
  requestNumber: string
  baseUrl: string
}) {
  return sendEmail({
    to: m.to,
    subject: `${m.studentName} a retras cererea de modificare`,
    html: template(
      'Cererea de modificare a fost retrasă',
      html`<p>Bună, ${firstName(m.teacherName)}. ${m.studentName} a retras cererea de modificare
       la lucrarea <strong>${m.requestNumber}</strong>. Nu mai ai nimic de decis, iar lucrarea
       rămâne cu titlul și obiectivele de dinainte.</p>`,
      { text: 'Vezi studenții', url: `${m.baseUrl}/profesor/studenti?sectiune=modificari` },
    ),
  })
}
