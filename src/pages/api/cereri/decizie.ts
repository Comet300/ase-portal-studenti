import type { APIRoute } from 'astro'
import { isTeacher } from '../../../lib/auth'
import { postEvent } from '../../../lib/chat'
import { queryOne, transaction } from '../../../lib/db'
import { html, quote, sendEmail, template } from '../../../lib/mail'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../../lib/http'
import { DEFAULT_MILESTONES, teacherSeats } from '../../../lib/repo'
import { id as formId } from '../../../lib/ids'

/**
 * The coordinator's decision.
 *
 * Either way it carries a message. A rejection without a reason leaves the
 * student guessing what to change; an approval without a word is a status flip
 * where a sentence was expected. The message travels twice — by email, and into
 * the pair's thread as an event, where it stays findable months later.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const requestId = formId(form.get('cerere_id'))
  const decision = String(form.get('decizie') ?? '')
  const note = String(form.get('motiv') ?? '').trim()
  const redirectTo = String(form.get('redirect') ?? '/profesor/studenti')

  if (decision !== 'approved' && decision !== 'rejected') {
    return deadEnd(400, 'Decizie neînțeleasă', 'Decizia trimisă nu este una dintre cele posibile. Reia din coada de cereri.')
  }

  if (decision === 'rejected' && note.length < 10) {
    return redirectWithNotice(redirectTo, 'Motivul respingerii este obligatoriu (minimum 10 caractere).', true)
  }

  if (decision === 'approved') {
    const seats = await teacherSeats(u!.id)
    if (seats.free === 0) {
      return redirectWithNotice(
        redirectTo,
        `Nu mai ai locuri libere (${seats.total_taken}/${seats.total_seats}). Cere locuri suplimentare directorului înainte de a accepta.`,
        true,
      )
    }
  }

  // The ownership condition sits in the same statement as the write: another
  // coordinator's request does not match, so nothing changes.
  const cerere = await transaction(async (client) => {
    const { rows } = await client.query<{
      id: string
      student_id: string
      title_ro: string
      number: string
    }>(
      `UPDATE requests
          SET status = $3,
              rejection_reason = CASE WHEN $3 = 'rejected' THEN NULLIF($4, '') ELSE rejection_reason END,
              decision_note = NULLIF($4, ''),
              decided_at = now(),
              expires_at = NULL,
              updated_at = now()
        WHERE id = $2 AND teacher_id = $1 AND status = 'pending'
        RETURNING id, student_id, title_ro, number`,
      [u!.id, requestId, decision, note],
    )

    const c = rows[0]
    if (!c) return null

    if (decision === 'approved') {
      for (const [index, [title, description, days]] of DEFAULT_MILESTONES.entries()) {
        await client.query(
          `INSERT INTO milestones (request_id, title, description, due_on, position)
           VALUES ($1, $2, $3, (current_date + ($4 || ' days')::interval)::date, $5)`,
          [c.id, title, description, String(days), index],
        )
      }
      // Firul de discuție se deschide odată cu acceptarea.
      await client.query(
        `INSERT INTO conversations (student_id, teacher_id) VALUES ($1, $2)
         ON CONFLICT (student_id, teacher_id) DO NOTHING`,
        [c.student_id, u!.id],
      )
    }

    return c
  })

  if (!cerere) {
    return redirectWithNotice(redirectTo, 'Cererea nu mai poate fi modificată.', true)
  }

  const approved = decision === 'approved'

  await postEvent({
    studentId: cerere.student_id,
    teacherId: u!.id,
    senderId: u!.id,
    eventType: approved ? 'request_approved' : 'request_rejected',
    body:
      (approved
        ? `Cererea ${cerere.number} a fost aprobată. Termenele lucrării sunt disponibile în portal.`
        : `Cererea ${cerere.number} a fost respinsă.`) + (note ? `\n\n${note}` : ''),
    // A rejection may be the pair's only exchange; the thread is created so the
    // reason has somewhere to live.
    createConversation: true,
    subjectKind: 'request',
    subjectId: cerere.id,
  })

  const student = await queryOne<{ email: string; name: string }>(
    'SELECT email, name FROM users WHERE id = $1',
    [cerere.student_id],
  )

  if (student) {
    const baza = process.env.APP_BASE_URL ?? url.origin
    const noteBlock = note ? quote(note) : ''

    await sendEmail({
      to: student.email,
      subject: approved
        ? `Cererea ${cerere.number} a fost aprobată`
        : `Cererea ${cerere.number} a fost respinsă`,
      html: template(
        approved ? 'Cererea ta a fost aprobată' : 'Cererea ta a fost respinsă',
        approved
          ? html`<p>Bună, ${student.name.split(' ')[0]}! Cererea <strong>${cerere.number}</strong> pentru lucrarea
             „${cerere.title_ro}” a fost aprobată de ${u!.name}.</p>
             ${note ? html`<p><strong>Mesaj de la coordonator:</strong></p>${noteBlock}` : ''}
             <p>În portal găsești acum termenele lucrării și poți programa consultații.</p>
             <p>Cererea de coordonare, completată cu datele tale, se descarcă și se tipărește de aici:
             <a href="${baza}/documente/cerere/${cerere.id}">cerere-coordonare-${cerere.number}</a>.</p>`
          : html`<p>Bună, ${student.name.split(' ')[0]}. Cererea <strong>${cerere.number}</strong> pentru lucrarea
             „${cerere.title_ro}” a fost respinsă de ${u!.name}.</p>
             <p><strong>Motiv:</strong></p>${noteBlock}
             <p>Poți depune o cerere nouă, către același coordonator sau către altul.</p>`,
        { text: 'Deschide portalul', url: `${baza}/cererile-mele` },
      ),
    })
  }

  return redirectWithNotice(
    redirectTo,
    approved
      ? 'Cerere aprobată. Studentul a fost notificat, iar cererea tipăribilă este disponibilă.'
      : 'Cerere respinsă. Studentul a primit motivul pe email și în conversație.',
  )
}
