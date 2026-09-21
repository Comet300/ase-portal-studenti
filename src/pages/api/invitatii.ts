import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { postEvent } from '../../lib/chat'
import { execute, queryOne } from '../../lib/db'
import { formAction } from '../../lib/forms'
import { deadEnd, redirect, redirectWithNotice, sessionExpired } from '../../lib/http'
import {
  INVITATION_WINDOW_DAYS,
  openInvitationFor,
  openInvitationPots,
  tellCoordinatorSeatIsGone,
} from '../../lib/lifecycle'
import { html, quote, sendEmail, template } from '../../lib/mail'
import { teacherCapacity } from '../../lib/repo'
import { freeFor } from '../../lib/seats'
import { numar } from '../../lib/text'
import { id as formId } from '../../lib/ids'

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
 *
 * SENDING MORE PROPOSALS THAN SEATS IS ALLOWED, and deliberately so: not
 * everybody accepts, and a coordinator who may only ever have three offers open
 * for three seats will end the session with two students. What is NOT allowed is
 * a proposal that cannot be honoured turning into an approved supervision by
 * itself — that gate is in `/api/cereri/depune`, and it applies to invited
 * students exactly as it does to everybody else. Between those two, this route
 * does the third thing: it refuses a proposal that has no seat AT THE MOMENT it
 * is written (writing one then is not optimism, it is a promise nobody can
 * keep), and it says out loud how many offers are already outstanding against
 * how few seats, so the overcommitment is a number the coordinator chose rather
 * than one they discover through somebody else's refusal.
 */

const TEACHER_PAGE = '/profesor/studenti?sectiune=invitatii'

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form)
  const base = process.env.APP_BASE_URL ?? url.origin

  /* --- the coordinator invites --------------------------------------------- */

  if (action === 'trimite') {
    if (!isTeacher(u)) return sessionExpired()

    const studentId = formId(form.get('student_id'))
    const topicId = formId(form.get('tema_id'))
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
      programme_id: string | null
      programme_name: string | null
      supervised: boolean
    }>(
      `SELECT u.id, u.name, u.email, u.program, u.programme_id, p.name AS programme_name,
              EXISTS (SELECT 1 FROM requests r
                       WHERE r.student_id = u.id AND r.status = 'approved') AS supervised
         FROM users u
         LEFT JOIN study_programmes p ON p.id = u.programme_id
        WHERE u.id = $1 AND u.role = 'student'`,
      [studentId],
    )
    if (!student) return redirectWithNotice(TEACHER_PAGE, 'Studentul nu există.', true)
    if (student.supervised) {
      return redirectWithNotice(TEACHER_PAGE, `${student.name} are deja un coordonator.`, true)
    }

    /* The seat has to exist for THIS student: at their level, and out of the
     * pot their study programme can spend. Checked on the sum of both levels
     * until now, which let somebody with no bachelor's seats invite bachelor's
     * students on the strength of their master's ones. */
    const capacity = await teacherCapacity(u.id)
    const level = student.program === 'master' ? capacity.master : capacity.bachelor
    const cohort = student.programme_name ?? (student.program === 'master' ? 'master' : 'licență')

    if (freeFor(level, student.programme_id) === 0) {
      return redirectWithNotice(
        TEACHER_PAGE,
        `Nu mai ai locuri pentru ${cohort} (${level.taken} din ${level.total} ocupate la acest nivel). Locurile se numără separat pe nivel și pe program de studiu. Cere directorului locuri pentru ${cohort} înainte de a invita.`,
        true,
      )
    }

    // The notification needs the row it creates, so it can lead exactly to it.
    let created: { id: string } | null = null
    try {
      created = await queryOne<{ id: string }>(
        `INSERT INTO invitations (academic_year_id, teacher_id, student_id, topic_id, message, expires_at)
         VALUES ((SELECT id FROM academic_years WHERE is_current), $1, $2, $3, $4,
                 now() + ($5 || ' days')::interval)
         RETURNING id`,
        [u.id, studentId, topicId, message, String(INVITATION_WINDOW_DAYS)],
      )
    } catch (err) {
      if (String(err).includes('idx_invitations_one_open')) {
        return redirectWithNotice(TEACHER_PAGE, `Ai deja o invitație deschisă către ${student.name}.`, true)
      }
      throw err
    }

    await postEvent({
      studentId: student.id,
      teacherId: u.id,
      senderId: u.id,
      eventType: 'invitation_sent',
      body: `${u.name} îți propune să îți coordoneze lucrarea. Răspunde din „Cererile mele”.\n\n${message}`,
      createConversation: true,
      subjectKind: 'invitation',
      subjectId: created?.id ?? null,
    })

    await sendEmail({
      to: student.email,
      subject: `Propunere de coordonare de la ${u.name}`,
      html: template(
        'Ai primit o propunere de coordonare',
        html`<p>Bună, ${student.name.split(' ')[0]}! <strong>${u.name}</strong> îți propune să îți coordoneze
         lucrarea de finalizare a studiilor.</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px;white-space:pre-wrap">${message}</p>
         <p>Poți accepta sau refuza în portal. Propunerea expiră în ${INVITATION_WINDOW_DAYS} de zile.</p>`,
        { text: 'Vezi propunerea', url: `${base}/lucrarea-mea` },
      ),
    })

    /* „Trimisă” on its own hid the only thing worth knowing afterwards.
     *
     * The seats left for this cohort were counted a moment ago; the proposals
     * already outstanding against them are counted now, with this one in. When
     * the offers outnumber the seats the notice says so and names the way out,
     * because the alternative is that the coordinator finds out when a student
     * they invited is refused — and that student is the one who pays for it. */
    const pots = await openInvitationPots(u.id)
    const outstanding =
      pots.find(
        (p) =>
          p.level === (student.program === 'master' ? 'master' : 'bachelor') &&
          p.programme_id === student.programme_id,
      )?.open ?? 1
    const seatsLeft = freeFor(level, student.programme_id)

    return redirectWithNotice(
      TEACHER_PAGE,
      outstanding > seatsLeft
        ? `Propunerea a fost trimisă către ${student.name}. Ai acum ${numar(outstanding, 'propunere deschisă', 'propuneri deschise')} pentru ${cohort} și doar ${numar(seatsLeft, 'loc liber', 'locuri libere')}: dacă acceptă mai mulți decât încap, portalul refuză cererea ultimilor. Cere directorului locuri pentru ${cohort} sau ține cont de asta la următoarea propunere.`
        /* „Mai ai”, nu „Îți rămâne/rămân”: `numar` acordă substantivul, nu și
         * verbul dinaintea lui, iar propoziția trebuie să fie corectă și la 1,
         * și la 3. */
        : `Propunerea a fost trimisă către ${student.name}. Mai ai ${numar(seatsLeft, 'loc liber', 'locuri libere')} pentru ${cohort}.`,
    )
  }

  /* --- the student answers -------------------------------------------------- */

  if (action === 'raspunde') {
    if (u.role !== 'student') return sessionExpired()

    const invitationId = formId(form.get('invitatie_id'))
    const answer = String(form.get('raspuns') ?? '')
    const reason = String(form.get('motiv') ?? '').trim()

    if (answer !== 'accepted' && answer !== 'declined') {
      return deadEnd(400, 'Răspuns neînțeles', 'Răspunsul trimis nu este unul dintre cele posibile.')
    }

    const invitation = await openInvitationFor(u.id, invitationId)
    if (!invitation) {
      return redirectWithNotice('/lucrarea-mea', 'Propunerea nu mai este disponibilă.', true)
    }

    if (answer === 'declined' && reason.length < 10) {
      return redirectWithNotice(
        '/lucrarea-mea',
        'Scrie pe scurt de ce refuzi — coordonatorul primește motivul.',
        true,
      )
    }

    /* Accepting an offer that can no longer be honoured is stopped HERE, not
     * three screens later.
     *
     * The binding gate is on the request itself, where the seat is actually
     * spent, and it stays there — seats can go in the minutes between the two.
     * But sending the student on to write a title, objectives and forty
     * characters of motivation, only to refuse the result, is making somebody
     * do work for nothing. The proposal is left PENDING rather than accepted:
     * an accepted one they cannot redeem is a dead end they cannot back out of,
     * while a pending one is still there to accept the day a seat appears.
     *
     * No lock and no transaction: accepting spends nothing, so two students
     * accepting at once is not a race — it is two people reaching a gate that
     * will let exactly one of them through when they get to it. */
    if (answer === 'accepted') {
      const capacity = await teacherCapacity(invitation.teacher_id)
      const level = u.program === 'master' ? capacity.master : capacity.bachelor
      const cohort = u.specialization ?? (u.program === 'master' ? 'master' : 'licență')

      if (freeFor(level, u.programme_id) === 0) {
        const teacherNow = await queryOne<{ email: string; name: string }>(
          `SELECT email, name FROM users WHERE id = $1`,
          [invitation.teacher_id],
        )
        const told = teacherNow
          ? await tellCoordinatorSeatIsGone({
              invitationId: invitation.id,
              teacherId: invitation.teacher_id,
              teacherName: teacherNow.name,
              teacherEmail: teacherNow.email,
              studentId: u.id,
              studentName: u.name,
              cohort,
              baseUrl: base,
            })
          : false

        return redirectWithNotice(
          '/lucrarea-mea',
          `${invitation.teacher_name} nu mai are niciun loc liber pentru ${cohort}, așa că ` +
            `propunerea nu poate fi dusă până la capăt acum. Nu ai greșit nimic — locurile ` +
            `s-au ocupat după ce ți-a scris. ` +
            `${told ? 'L-am anunțat și poate' : 'Poate'} cere directorului de departament un ` +
            `loc pentru ${cohort}. Propunerea rămâne deschisă până expiră, deci o poți accepta ` +
            `din nou dacă apare un loc. Poți și să alegi alt coordonator din catalog.`,
          true,
        )
      }
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
      return redirectWithNotice('/lucrarea-mea', 'Propunerea nu mai este disponibilă.', true)
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
      subjectKind: 'invitation',
      subjectId: invitation.id,
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
            ? html`<p><strong>${u.name}</strong> a acceptat propunerea. Urmează să depună cererea în portal,
               care va fi aprobată automat.</p>`
            : html`<p><strong>${u.name}</strong> a refuzat propunerea.</p>${quote(reason)}`,
          { text: 'Deschide portalul', url: `${base}${TEACHER_PAGE}` },
        ),
      })
    }

    return accepted
      ? redirect(`/lucrarea-mea?invitatie=${invitationId}`)
      : redirectWithNotice('/lucrarea-mea', 'Ai refuzat propunerea. Coordonatorul a fost anunțat.')
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
