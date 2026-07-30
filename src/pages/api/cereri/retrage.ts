import type { APIRoute } from 'astro'
import { postEvent } from '../../../lib/chat'
import { queryOne } from '../../../lib/db'
import { redirectWithNotice, sessionExpired } from '../../../lib/http'
import { id as formId } from '../../../lib/ids'
import { html, sendEmail, template } from '../../../lib/mail'

/**
 * A student withdraws their own pending request.
 *
 * Only `pending`: an approved coordination is an agreement between two people
 * and is not unmade from one side, and the rest are already closed. The row is
 * kept — the coordinator saw it, and the archive should show it happened — but
 * `withdrawn` falls outside the live-request index, so the student can apply
 * elsewhere or accept an invitation straight away.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()
  if (u.role !== 'student') return sessionExpired()

  const form = await request.formData()
  const requestId = formId(form.get('cerere_id'))
  const reason = String(form.get('motiv') ?? '').trim()

  // Ownership and state travel with the write, so a request belonging to
  // somebody else — or already decided — simply does not match.
  const withdrawn = await queryOne<{
    id: string
    number: string
    title_ro: string
    teacher_id: string
    teacher_email: string
    teacher_name: string
  }>(
    `UPDATE requests r
        SET status = 'withdrawn', decided_at = now(), updated_at = now(), expires_at = NULL
       FROM users t
      WHERE r.id = $2 AND r.student_id = $1 AND r.status = 'pending' AND t.id = r.teacher_id
      RETURNING r.id, r.number, r.title_ro, t.id AS teacher_id, t.email AS teacher_email, t.name AS teacher_name`,
    [u.id, requestId],
  )

  if (!withdrawn) {
    return redirectWithNotice(
      '/cererile-mele',
      'Cererea nu mai poate fi retrasă — a primit deja un răspuns.',
      true,
    )
  }

  await postEvent({
    studentId: u.id,
    teacherId: withdrawn.teacher_id,
    senderId: u.id,
    eventType: 'request_withdrawn',
    body:
      `${u.name} a retras cererea ${withdrawn.number}.` + (reason ? `\n\nMotiv: ${reason}` : ''),
    createConversation: false,
    subjectKind: 'request',
    subjectId: withdrawn.id,
  })

  const base = process.env.APP_BASE_URL ?? url.origin
  await sendEmail({
    to: withdrawn.teacher_email,
    subject: `Cererea ${withdrawn.number} a fost retrasă`,
    html: template(
      'O cerere a fost retrasă',
      html`<p><strong>${u.name}</strong> a retras cererea <strong>${withdrawn.number}</strong> pentru
       lucrarea „${withdrawn.title_ro}”. Nu mai trebuie să iei o decizie.</p>
       ${reason ? html`<p><strong>Motivul studentului:</strong> ${reason}</p>` : ''}`,
      { text: 'Vezi cererile', url: `${base}/profesor/studenti?sectiune=cereri` },
    ),
  })

  return redirectWithNotice(
    '/cererile-mele',
    'Cererea a fost retrasă. Poți depune una nouă către alt coordonator.',
  )
}
