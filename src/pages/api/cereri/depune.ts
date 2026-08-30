import type { APIRoute } from 'astro'
import { postEvent } from '../../../lib/chat'
import { queryOne, transaction } from '../../../lib/db'
import { template, sendEmail, html } from '../../../lib/mail'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../../lib/http'
import { DECISION_WINDOW_DAYS } from '../../../lib/lifecycle'
import { seedMilestones, teacherCapacity } from '../../../lib/repo'
import { freeFor } from '../../../lib/seats'
import { id as formId } from '../../../lib/ids'

/**
 * A student submits a supervision request.
 *
 * Two ways in, one record. Normally the student picks a coordinator and waits;
 * if they are answering an invitation they already accepted, the same form is
 * approved on submission — the decision was made when the coordinator wrote it,
 * and asking them to press a second button would only add a day.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return sessionExpired()
  if (u.role !== 'student') {
    return deadEnd(403, 'Cererile se depun de studenți', 'Zona cadrelor didactice are propriile ecrane pentru coordonare.')
  }

  const form = await request.formData()
  const teacherId = formId(form.get('profesor_id'))
  const topicId = formId(form.get('tema_id'))
  const titleRo = String(form.get('titlu_ro') ?? '').trim()
  const titleEn = String(form.get('titlu_en') ?? '').trim()
  const objectives = String(form.get('scop_obiective') ?? '').trim()
  const motivation = String(form.get('motivatie') ?? '').trim()
  const invitationId = formId(form.get('invitatie_id'))

  const back = (message: string, isError = false) =>
    redirectWithNotice('/lucrarea-mea', message, isError)

  if (!teacherId || !titleRo || objectives.length < 40) {
    return back('Completează coordonatorul, titlul și descrierea (minimum 40 de caractere).', true)
  }
  if (motivation.length < 40) {
    return back('Motivează alegerea temei în cel puțin 40 de caractere.', true)
  }

  const teacher = await queryOne<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
    [teacherId],
  )
  if (!teacher) return back('Coordonatorul selectat nu există.', true)

  /* The topic must belong to the chosen coordinator.
   *
   * The link was held only by a script that hid the unsuitable options with
   * `option.hidden` — an attribute that not every engine honours, so on some
   * browsers another teacher's topic could be chosen through the ordinary
   * interface. The level has to match as well: a master's topic has no business
   * on a bachelor's request. */
  if (topicId) {
    const topic = await queryOne<{ id: string; level: string; title: string }>(
      `SELECT id, level, title
         FROM topics
        WHERE id = $1 AND teacher_id = $2 AND is_active
          AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
      [topicId, teacherId],
    )
    if (!topic) {
      return back('Tema aleasă nu este propusă de acest coordonator în sesiunea curentă.', true)
    }
    if (u.program && topic.level !== u.program) {
      return back(
        `„${topic.title}” este o temă de ${topic.level === 'master' ? 'master' : 'licență'}, iar tu ești la ${u.program === 'master' ? 'master' : 'licență'}.`,
        true,
      )
    }
  }

  // An accepted invitation is what turns this into an approved request. The
  // lookup carries the student id, so an invitation addressed to someone else
  // simply does not match.
  // Still bounded by the invitation's own deadline: accepting does not freeze
  // the offer, and an approval that skips the seat check must not be redeemable
  // months later against seats the coordinator no longer has.
  /* Which pot the seat comes out of, named once and written onto the request.
   * `users.programme_id` is nullable — a student imported without one charges
   * the shared base, and the director's screen is where that becomes visible. */
  const programme = u.programme_id
    ? await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM study_programmes
          WHERE id = $1 AND academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
        [u.programme_id],
      )
    : null

  const invitation = invitationId
    ? await queryOne<{ id: string }>(
        `SELECT id FROM invitations
          WHERE id = $1 AND student_id = $2 AND teacher_id = $3
            AND status = 'accepted' AND expires_at > now()`,
        [invitationId, u.id, teacherId],
      )
    : null

  /* The seat is checked at the student's own level and study programme.
   *
   * Extra seats are reserved to the programme they were granted for, so „has
   * free seats” is not a fact about a coordinator any more — it is a fact about
   * a coordinator and a student. A catalogue entry that looked available to
   * everybody was the reason this refusal used to arrive as a surprise. */
  const capacity = await teacherCapacity(teacherId)
  const level = u.program === 'master' ? capacity.master : capacity.bachelor
  const cohort = programme?.name ?? (u.program === 'master' ? 'master' : 'licență')

  if (!invitation && freeFor(level, u.programme_id) === 0) {
    const reserved = level.free_any - level.base_free
    return back(
      reserved > 0
        ? `${teacher.name} nu mai are locuri pentru ${cohort}: cele ${reserved} locuri rămase sunt rezervate altor programe de studiu. Alege alt coordonator din catalog — acolo scrie câte locuri are fiecare pentru programul tău.`
        : `${teacher.name} nu mai are locuri pentru ${cohort} (${level.taken} din ${level.total} ocupate). Alege alt coordonator din catalog — acolo scrie câte locuri are fiecare pentru programul tău.`,
      true,
    )
  }

  const preApproved = Boolean(invitation)

  // The partial unique index on (student_id) for live statuses prevents a second
  // open request; the violation is caught here so the message is useful.
  try {
    /* The number and the row are allocated together.
     *
     * The counter sits on the academic year and is bumped inside this
     * transaction, so numbers run sequentially within the session they belong
     * to, stay unique without depending on a clock, and leave no gap when the
     * insert below is refused by the live-request index. */
    const { number, created } = await transaction(async (tx) => {
      const { rows: years } = await tx.query<{ label: string; request_counter: number }>(
        `UPDATE academic_years SET request_counter = request_counter + 1
          WHERE is_current
          RETURNING id, label, request_counter`,
      )
      const year = years[0]
      if (!year) throw new Error('Niciun an universitar curent')

      const allocated = `CRR-${year.label.slice(0, 4)}-${String(year.request_counter).padStart(4, '0')}`

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO requests (academic_year_id, number, student_id, teacher_id, topic_id,
                               title_ro, title_en, objectives, motivation, status,
                               invitation_id, programme_id, decided_at, expires_at)
         VALUES ((SELECT id FROM academic_years WHERE is_current),
                 $1, $2, $3, NULLIF($4, '')::uuid, $5, NULLIF($6, ''), $7, $8, $9,
                 $10, $12,
                 CASE WHEN $9 = 'approved' THEN now() END,
                 CASE WHEN $9 = 'pending' THEN now() + ($11 || ' days')::interval END)
         RETURNING id`,
        [
          allocated, u.id, teacherId, topicId, titleRo, titleEn, objectives, motivation,
          preApproved ? 'approved' : 'pending',
          invitation?.id ?? null,
          String(DECISION_WINDOW_DAYS),
          programme?.id ?? null,
        ],
      )

      return { number: allocated, created: rows[0] ?? null }
    })

    const base = process.env.APP_BASE_URL ?? url.origin

    if (preApproved && created) {
      await seedMilestones(created.id)
      await postEvent({
        studentId: u.id,
        teacherId,
        senderId: teacherId,
        eventType: 'request_approved',
        body: `Cererea ${number} a fost aprobată automat, pe baza propunerii de coordonare acceptate. Termenele lucrării sunt disponibile în portal.`,
        createConversation: true,
        subjectKind: 'request',
        subjectId: created.id,
      })

      await sendEmail({
        to: u.email,
        subject: `Cererea ${number} a fost aprobată`,
        html: template(
          'Coordonarea este confirmată',
          html`<p>Bună, ${u.name.split(' ')[0]}! Cererea <strong>${number}</strong> pentru lucrarea
           „${titleRo}” a fost aprobată automat, pentru că ai acceptat propunerea lui ${teacher.name}.</p>
           <p>În portal găsești acum termenele lucrării și poți programa consultații.</p>`,
          { text: 'Deschide portalul', url: `${base}/lucrarea-mea` },
        ),
      })
      await sendEmail({
        to: teacher.email,
        subject: `${u.name} a depus cererea — aprobată automat`,
        html: template(
          'Coordonare confirmată',
          html`<p><strong>${u.name}</strong> a depus cererea <strong>${number}</strong> pe baza propunerii
           tale, iar portalul a aprobat-o automat.</p>
           <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px"><strong>${titleRo}</strong></p>`,
          { text: 'Vezi studentul', url: `${base}/profesor/studenti?sectiune=studenti` },
        ),
      })

      return back('Cererea a fost depusă și aprobată. Coordonarea este confirmată.')
    }

    await sendEmail({
      to: teacher.email,
      subject: `Cerere nouă de coordonare — ${u.name}`,
      html: template(
        'Ai primit o cerere de coordonare',
        html`<p><strong>${u.name}</strong> (${u.student_number ?? '—'},
         ${u.program === 'master' ? 'master' : 'licență'}) îți propune lucrarea:</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px"><strong>${titleRo}</strong></p>
         <p style="color:#5b6169;font-size:13px">${objectives.slice(0, 400)}${objectives.length > 400 ? '…' : ''}</p>
         <p style="color:#5b6169;font-size:13px"><strong>Motivația studentului:</strong>
         ${motivation.slice(0, 400)}${motivation.length > 400 ? '…' : ''}</p>
         <p><strong>Ai ${DECISION_WINDOW_DAYS} zile să răspunzi.</strong> După acest termen cererea se
         respinge automat, iar studentul este anunțat.</p>`,
        { text: 'Vezi cererea', url: `${base}/profesor/studenti?sectiune=cereri` },
      ),
    })

    return back(
      `Cererea a fost depusă. ${teacher.name} are ${DECISION_WINDOW_DAYS} zile să răspundă.`,
    )
  } catch (err) {
    const message = String(err)
    if (message.includes('idx_requests_one_active')) {
      return back('Ai deja o cerere activă. Retrage-o sau așteaptă decizia coordonatorului.', true)
    }
    console.error('[cereri] eroare la depunere', err)
    return back('Cererea nu a putut fi depusă. Încearcă din nou.', true)
  }
}
