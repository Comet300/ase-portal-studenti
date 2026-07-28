import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { postEvent } from '../../lib/chat'
import { execute, queryOne } from '../../lib/db'
import { redirect, redirectWithNotice } from '../../lib/http'
import { INVITATION_WINDOW_DAYS, openInvitationFor } from '../../lib/lifecycle'
import { sendEmail, template } from '../../lib/mail'
import { teacherSeats } from '../../lib/repo'

/**
 * Invitations — the coordinator asking the student.
 *
 * The catalogue only works in one direction: a student who does not know whom to
 * approach waits to be found. A coordinator who has already read someone's work
 * can start the pairing instead, and the student still decides.
 *
 * Accepting does not create the coordination on its own. The student still fills
 * the full request — the faculty needs the title, the objectives and the
 * motivation on record either way — but it is approved on submission rather than
 * queued behind a decision that has already been made.
 */

const TEACHER_PAGE = '/profesor/studenti?sectiune=invitatii'

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const form = await request.formData()
  const action = String(form.get('actiune') ?? '')
  const base = process.env.APP_BASE_URL ?? url.origin

  /* --- the coordinator invites --------------------------------------------- */

  if (action === 'trimite') {
    if (!isTeacher(u)) return new Response('Neautorizat', { status: 403 })

    const studentId = String(form.get('student_id') ?? '')
    const topicId = String(form.get('tema_id') ?? '')
    const message = String(form.get('mesaj') ?? '').trim()

    if (message.length < 30) {
      return redirectWithNotice(
        TEACHER_PAGE,
        'Scrie cel puțin 30 de caractere — studentul decide pe baza acestui mesaj.',
        true,
      )
    }

    const student = await queryOne<{
      id: string
      name: string
      email: string
      program: string | null
      supervised: boolean
    }>(
      `SELECT u.id, u.name, u.email, u.program,
              EXISTS (SELECT 1 FROM requests r
                       WHERE r.student_id = u.id AND r.status = 'approved') AS supervised
         FROM users u WHERE u.id = $1 AND u.role = 'student'`,
      [studentId],
    )
    if (!student) return redirectWithNotice(TEACHER_PAGE, 'Studentul nu există.', true)
    if (student.supervised) {
      return redirectWithNotice(TEACHER_PAGE, `${student.name} are deja un coordonator.`, true)
    }

    const seats = await teacherSeats(u.id)
    if (seats.free === 0) {
      return redirectWithNotice(
        TEACHER_PAGE,
        'Nu mai ai locuri libere. Cere locuri suplimentare directorului înainte de a invita.',
        true,
      )
    }

    try {
      await execute(
        `INSERT INTO invitations (academic_year_id, teacher_id, student_id, topic_id, message, expires_at)
         VALUES ((SELECT id FROM academic_years WHERE is_current), $1, $2, NULLIF($3, '')::uuid, $4,
                 now() + ($5 || ' days')::interval)`,
        [u.id, studentId, topicId, message, String(INVITATION_WINDOW_DAYS)],
      )
    } catch (err) {
      if (String(err).includes('idx_invitations_one_open')) {
        return redirectWithNotice(TEACHER_PAGE, `Ai deja o invitație deschisă către ${student.name}.`, true)
      }
      throw err
    }

    await postEvent({
      studentId,
      teacherId: u.id,
      senderId: u.id,
      eventType: 'invitation_sent',
      body: `${u.name} îți propune să îți coordoneze lucrarea. Răspunde din „Cererile mele”.\n\n${message}`,
      createConversation: true,
    })

    await sendEmail({
      to: student.email,
      subject: `Propunere de coordonare de la ${u.name}`,
      html: template(
        'Ai primit o propunere de coordonare',
        `<p>Bună, ${student.name.split(' ')[0]}! <strong>${u.name}</strong> îți propune să îți coordoneze
         lucrarea de finalizare a studiilor.</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${message}</p>
         <p>Poți accepta sau refuza în portal. Propunerea expiră în ${INVITATION_WINDOW_DAYS} de zile.</p>`,
        { text: 'Vezi propunerea', url: `${base}/cererile-mele` },
      ),
    })

    return redirectWithNotice(TEACHER_PAGE, `Propunerea a fost trimisă către ${student.name}.`)
  }

  /* --- the student answers -------------------------------------------------- */

  if (action === 'raspunde') {
    if (u.role !== 'student') return new Response('Neautorizat', { status: 403 })

    const invitationId = String(form.get('invitatie_id') ?? '')
    const answer = String(form.get('raspuns') ?? '')
    const reason = String(form.get('motiv') ?? '').trim()

    if (answer !== 'accepted' && answer !== 'declined') {
      return new Response('Răspuns invalid', { status: 400 })
    }

    const invitation = await openInvitationFor(u.id, invitationId)
    if (!invitation) {
      return redirectWithNotice('/cererile-mele', 'Propunerea nu mai este disponibilă.', true)
    }

    if (answer === 'declined' && reason.length < 10) {
      return redirectWithNotice(
        '/cererile-mele',
        'Scrie pe scurt de ce refuzi — coordonatorul primește motivul.',
        true,
      )
    }

    // The status change carries the ownership condition, so a second submission
    // of the same form cannot answer twice.
    const changed = await execute(
      `UPDATE invitations
          SET status = $3, response_reason = NULLIF($4, ''), responded_at = now()
        WHERE id = $2 AND student_id = $1 AND status = 'pending'`,
      [u.id, invitationId, answer, reason],
    )
    if (!changed) {
      return redirectWithNotice('/cererile-mele', 'Propunerea nu mai este disponibilă.', true)
    }

    const accepted = answer === 'accepted'

    await postEvent({
      studentId: u.id,
      teacherId: invitation.teacher_id,
      senderId: u.id,
      eventType: accepted ? 'invitation_accepted' : 'invitation_declined',
      body: accepted
        ? `${u.name} a acceptat propunerea de coordonare. Urmează depunerea cererii.`
        : `${u.name} a refuzat propunerea de coordonare.\n\nMotiv: ${reason}`,
      createConversation: true,
    })

    const teacher = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [invitation.teacher_id],
    )
    if (teacher) {
      await sendEmail({
        to: teacher.email,
        subject: accepted
          ? `${u.name} a acceptat propunerea de coordonare`
          : `${u.name} a refuzat propunerea de coordonare`,
        html: template(
          accepted ? 'Propunere acceptată' : 'Propunere refuzată',
          accepted
            ? `<p><strong>${u.name}</strong> a acceptat propunerea. Urmează să depună cererea în portal,
               care va fi aprobată automat.</p>`
            : `<p><strong>${u.name}</strong> a refuzat propunerea.</p>
               <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${reason}</p>`,
          { text: 'Deschide portalul', url: `${base}${TEACHER_PAGE}` },
        ),
      })
    }

    return accepted
      ? redirect(`/cererile-mele?invitatie=${invitationId}`)
      : redirectWithNotice('/cererile-mele', 'Ai refuzat propunerea. Coordonatorul a fost anunțat.')
  }

  return new Response('Acțiune necunoscută', { status: 400 })
}
