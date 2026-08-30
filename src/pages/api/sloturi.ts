import type { APIRoute } from 'astro'
import { recordAccess } from '../../lib/audit'
import { isTeacher } from '../../lib/auth'
import { postEvent } from '../../lib/chat'
import { execute, query, queryOne } from '../../lib/db'
import { buildIcs, buildIcsBundle, consultationUid, type CalendarEvent } from '../../lib/ics'
import { deadEnd, redirectWithNotice, sessionExpired } from '../../lib/http'
import { formAction } from '../../lib/forms'
import { html, joinHtml, sendEmail, template } from '../../lib/mail'
import {
  studentCancellationMail,
  teacherCancellationMail,
  type CancelledHour,
} from '../../lib/mail-consultatii'
import { formatDate, formatTime } from '../../lib/repo'
import { numar } from '../../lib/text'
import { id as formId } from '../../lib/ids'

/**
 * Consultation hours.
 *
 * Two shapes, because coordinators work in two ways. `publica` opens a block of
 * hours that any coordinated student may book — the office-hours model, and the
 * habitual one. `programeaza` summons one or more named students and books the
 * meeting on their behalf, which is what happens when the coordinator is the one
 * who needs it. `kind` records which of the two made the row, because nothing
 * else in the table can tell them apart: a group meeting leaves `student_id`
 * NULL exactly like an open hour does.
 *
 * Either way the hour carries where it is: a room with a floor and a number, a
 * meeting link, or both when a student may attend remotely.
 *
 * `anuleaza` is the way back out, for one hour or for a whole day.
 */

const PAGE = '/profesor/consultatii'

/**
 * „14:30” as hours since midnight.
 *
 * The hour was a numeric field holding whole hours, and the interval was built
 * by concatenating `' hours'` — so a consultation on the half hour could not be
 * expressed at all. A plain number is accepted as well, for the older forms and
 * for the requests that do not come from a browser.
 */
function parseClock(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (clock) {
    const h = Number(clock[1])
    const m = Number(clock[2])
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h + m / 60
  }

  const plain = Number(raw)
  return Number.isFinite(plain) && plain >= 0 && plain <= 23 ? plain : null
}

function whereItIs(mode: string, location: string | null, meetingUrl: string | null): string {
  if (mode === 'online') return meetingUrl || 'Online'
  return [location, meetingUrl].filter(Boolean).join(' · ') || 'Cabinet'
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return sessionExpired()

  const form = await request.formData()
  const action = formAction(form) || 'publica'
  const base = process.env.APP_BASE_URL ?? url.origin

  const back = (message: string, isError = false) => redirectWithNotice(PAGE, message, isError)

  /* --- open hours anyone coordinated may book ------------------------------- */

  if (action === 'publica') {
    const day = String(form.get('zi') ?? '')
    const startHour = parseClock(form.get('ora_start')) ?? 14
    const endHour = parseClock(form.get('ora_final')) ?? 16
    const mode = String(form.get('mod') ?? 'in_person')
    const location = String(form.get('locatie') ?? '').trim()
    const meetingUrl = String(form.get('link_online') ?? '').trim()
    // How many students may take the same hour. A consultation is often a group
    // of three going over the same chapter; one-to-one is the default, not the
    // only shape.
    const requested = Number(form.get('locuri') ?? 1)
    const places = Number.isFinite(requested) ? Math.min(30, Math.max(1, Math.trunc(requested))) : 1
    /* Whom the hour is for. Anything the form did not say is read as the
     * narrower of the two: an hour meant for one's own students that is
     * published to the whole faculty by a typo cannot be taken back — the
     * students have already seen it. */
    const audience = form.get('audienta') === 'public' ? 'public' : 'thesis'

    if (!day || !Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
      return back('Alege ziua și un interval orar valid.', true)
    }
    if (!['in_person', 'online'].includes(mode)) return back('Mod invalid.', true)
    if (mode === 'online' && !meetingUrl) {
      return back('O consultație online are nevoie de un link de întâlnire.', true)
    }
    if (meetingUrl && !/^https?:\/\/\S+$/i.test(meetingUrl)) {
      return back('Linkul întâlnirii trebuie să înceapă cu http:// sau https://.', true)
    }
    if (mode === 'in_person' && !location) {
      return back('Scrie unde are loc consultația — clădirea, etajul și sala.', true)
    }

    // The open block is split into whole hours, so an endpoint on the half hour
    // must not be allowed to produce an interval that runs past the end time.
    const hours = Math.min(Math.floor(endHour - startHour), 8)
    if (hours < 1) return back('Între „De la” și „Până la” trebuie să încapă cel puțin o oră întreagă.', true)

    const created: { starts_at: string; ends_at: string }[] = []

    for (let i = 0; i < hours; i++) {
      const slot = await queryOne<{ starts_at: string; ends_at: string }>(
        `INSERT INTO consultation_slots
           (teacher_id, starts_at, ends_at, mode, location, meeting_url, capacity, kind, audience)
         SELECT $1,
                ($2::date + ($3 || ' hours')::interval),
                ($2::date + ($4 || ' hours')::interval),
                $5, NULLIF($6, ''), NULLIF($7, ''), $8, 'open', $9
          WHERE NOT EXISTS (
            SELECT 1 FROM consultation_slots s
             WHERE s.teacher_id = $1
               AND s.starts_at = ($2::date + ($3 || ' hours')::interval)
          )
         RETURNING starts_at, ends_at`,
        [u!.id, day, String(startHour + i), String(startHour + i + 1), mode, location, meetingUrl, places, audience],
      )
      if (slot) created.push(slot)
    }

    if (created.length === 0) {
      return back('Orele erau deja deschise în ziua asta. Alege alt interval orar.', true)
    }

    /* Published hours nobody hears about are hours nobody books.
     *
     * Sent whenever anything new appears — including a single interval, which is
     * the case most likely to be missed: a coordinator freeing up one hour is
     * exactly when the students who need it are not looking at the portal.
     *
     * Only for one's own students. A public hour goes to everyone in the
     * faculty, and mailing eleven hundred people every time somebody opens an
     * afternoon is not a notification — it is the reason people switch
     * notifications off. Those hours are found on „Consultații”, which is where
     * a student looking for one already goes. */
    const students = audience === 'public' ? [] : await query<{ name: string; email: string }>(
      `SELECT s.name, s.email
         FROM requests r JOIN users s ON s.id = r.student_id
        WHERE r.teacher_id = $1 AND r.status = 'approved'
          AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        ORDER BY s.name`,
      [u!.id],
    )

    const place = whereItIs(mode, location, meetingUrl)
    const list = joinHtml(
      created.map(
        (s) =>
          html`<li><strong>${formatDate(s.starts_at)}</strong>, ${formatTime(s.starts_at)}–${formatTime(s.ends_at)}</li>`,
      ),
    )

    await Promise.all(
      students.map((student) =>
        sendEmail({
          to: student.email,
          subject:
            created.length === 1
              ? `O oră de consultație nouă — ${formatDate(created[0].starts_at)}`
              : `${numar(created.length, 'oră de consultație nouă', 'ore de consultație noi')}`,
          html: template(
            'Ore de consultație deschise',
            html`<p>Bună, ${student.name.split(' ')[0]}! ${u!.name} a deschis
             ${numar(created.length, 'oră de consultație', 'ore de consultație')}:</p>
             <ul>${list}</ul>
             <p>${place}</p>
             <p>Locurile se ocupă în ordinea rezervărilor${places > 1 ? `, câte ${places} pe oră` : ''}.
              Invitația în calendar îți vine imediat ce rezervi.</p>`,
            { text: 'Rezervă o oră', url: `${base}/consultatii` },
          ),
        }),
      ),
    )

    return back(
      `${numar(created.length, 'oră deschisă', 'ore deschise')}. ` +
        (audience === 'public'
          ? 'Apar la orice student din facultate, fără email.'
          : students.length > 0
            ? `${numar(students.length, 'student anunțat', 'studenți anunțați')} pe email.`
            : 'Nu ai încă studenți coordonați de anunțat.'),
    )
  }

  /* --- summon one or more named students ------------------------------------ */

  if (action === 'programeaza') {
    // One interval, any number of students: three people working on the same
    // chapter do not need three separate hours.
    const studentIds = form.getAll('student_id').map(formId).filter((v): v is string => Boolean(v))
    const day = String(form.get('zi') ?? '')
    const startHour = parseClock(form.get('ora_start'))
    const durationHours = Number(form.get('durata') ?? 1)
    const mode = String(form.get('mod') ?? 'in_person')
    const location = String(form.get('locatie') ?? '').trim()
    const meetingUrl = String(form.get('link_online') ?? '').trim()
    const note = String(form.get('subiect') ?? '').trim()

    if (!day) return back('Alege ziua consultației.', true)
    if (startHour === null) return back('Ora consultației nu este validă.', true)
    if (!['in_person', 'online'].includes(mode)) return back('Mod invalid.', true)
    if (mode === 'online' && !meetingUrl) {
      return back('O consultație online are nevoie de un link de întâlnire.', true)
    }
    if (meetingUrl && !/^https?:\/\/\S+$/i.test(meetingUrl)) {
      return back('Linkul întâlnirii trebuie să înceapă cu http:// sau https://.', true)
    }
    if (mode === 'in_person' && !location) {
      return back('Scrie unde are loc consultația — clădirea, etajul și sala.', true)
    }

    if (studentIds.length === 0) return back('Alege cel puțin un student.', true)

    // Only students this coordinator actually supervises, and the condition is
    // part of the lookup rather than a check before it.
    const students = await query<{ id: string; name: string; email: string }>(
      `SELECT s.id, s.name, s.email
         FROM users s
         JOIN requests r ON r.student_id = s.id
        WHERE s.id = ANY($2::uuid[]) AND r.teacher_id = $1 AND r.status = 'approved'
        ORDER BY s.name`,
      [u!.id, studentIds],
    )
    if (students.length === 0) return back('Alege studenți pe care îi coordonezi.', true)

    // A quarter of an hour is the smallest unit the form offers.
    const hours = Math.min(Math.max(0.25, Math.round(durationHours * 4) / 4 || 1), 4)

    /* `student_id` on the slot names a single invitee, so it is only set when
     * there is exactly one — with several, the slot is theirs collectively and
     * the bookings below are what record who is coming. */
    const slot = await queryOne<{ id: string; starts_at: string; ends_at: string }>(
      /* `audience` is 'thesis' and not a choice: the students who can be
         summoned are the ones this person supervises — checked in the lookup
         above — so a summoned meeting is by construction not a public hour. */
      `INSERT INTO consultation_slots
         (teacher_id, student_id, starts_at, ends_at, mode, location, meeting_url, note, capacity, kind, audience)
       VALUES ($1, $2,
               ($3::date + ($4 || ' hours')::interval),
               ($3::date + ($5 || ' hours')::interval),
               $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10, 'scheduled', 'thesis')
       RETURNING id, starts_at, ends_at`,
      [
        u!.id, students.length === 1 ? students[0].id : null,
        day, String(startHour), String(startHour + hours),
        mode, location, meetingUrl, note, students.length,
      ],
    )
    if (!slot) return back('Consultația nu a putut fi creată.', true)

    // The coordinator scheduled it, so it is booked for each of them, not offered.
    for (const student of students) {
      await execute(
        `INSERT INTO bookings (slot_id, student_id, subject) VALUES ($1, $2, NULLIF($3, ''))
         ON CONFLICT (slot_id, student_id) DO UPDATE SET status = 'booked'`,
        [slot.id, student.id, note],
      )
    }

    const place = whereItIs(mode, location, meetingUrl)
    const grup = students.length > 1

    const details = html`<p style="padding:12px 16px;background:#f8f9fa;border-radius:4px">
        <strong>${formatDate(slot.starts_at)}</strong>, ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}<br>
        ${place}
      </p>
      ${note ? html`<p><strong>Subiect:</strong> ${note}</p>` : ''}
      ${grup ? html`<p style="color:#5b6169;font-size:13px">Participanți: ${students.map((s) => s.name).join(', ')}</p>` : ''}`

    /* One event per invitee, not one event with three guests.
     *
     * A calendar entry addressed to somebody else is one most clients quietly
     * refuse to add, so each student gets their own — and the identity of each
     * is `(slot, student)`, which is what a cancellation later has to match. */
    const invitations: CalendarEvent[] = students.map((student) => ({
      uid: consultationUid(slot.id, student.id),
      title: `Consultație — ${u!.name}`,
      description: note || 'Consultație pentru lucrarea de finalizare a studiilor.',
      location: place,
      meetingUrl: meetingUrl || undefined,
      start: new Date(slot.starts_at),
      end: new Date(slot.ends_at),
      organizerName: u!.name,
      organizerEmail: u!.email,
      attendeeName: student.name,
      attendeeEmail: student.email,
    }))

    await Promise.all(
      students.map((student, i) =>
        sendEmail({
          to: student.email,
          subject: `Consultație programată — ${formatDate(slot.starts_at)}`,
          html: template(
            'Coordonatorul ți-a programat o consultație',
            html`<p><strong>${u!.name}</strong> a programat o consultație${grup ? ' de grup' : ''} cu tine:</p>${details}
             <p style="color:#5b6169;font-size:13px">Invitația atașată se adaugă automat în calendar.</p>`,
            { text: 'Vezi consultațiile', url: `${base}/consultatii` },
          ),
          attachments: [
            {
              filename: 'consultatie.ics',
              content: buildIcs(invitations[i]),
              contentType: 'text/calendar; method=REQUEST',
            },
          ],
        }),
      ),
    )

    /* The coordinator's copy carries the same invitations.
     *
     * It went out without any, so a meeting the coordinator had scheduled
     * themselves was the one meeting missing from their own calendar — and,
     * worse, a later cancellation had nothing to withdraw there. When a student
     * books an open hour the coordinator does receive the file (`rezervari.ts`),
     * so the two paths behaved differently for no reason anybody chose.
     *
     * All the invitations travel in a single file: one attachment is one
     * calendar part, and a second attachment is dropped by most clients. */
    await sendEmail({
      to: u!.email,
      subject: grup
        ? `Consultație de grup cu ${students.length} studenți — ${formatDate(slot.starts_at)}`
        : `Consultație cu ${students[0].name} — ${formatDate(slot.starts_at)}`,
      html: template('Consultație programată', details),
      attachments: [
        {
          filename: 'consultatie.ics',
          content: buildIcsBundle(invitations),
          contentType: 'text/calendar; method=REQUEST',
        },
      ],
    })

    for (const student of students) {
      await postEvent({
        studentId: student.id,
        teacherId: u!.id,
        senderId: u!.id,
        eventType: 'consultation_scheduled',
        body:
          `Consultație${grup ? ' de grup' : ''} programată pentru ${formatDate(slot.starts_at)}, ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}.\n${place}` +
          (note ? `\n\nSubiect: ${note}` : ''),
        createConversation: true,
        subjectKind: 'slot',
        subjectId: slot.id,
      })
    }

    return back(
      grup
        ? `Consultație de grup programată cu ${numar(students.length, 'student', 'studenți')}. Fiecare a primit invitația pe email.`
        : `Consultație programată cu ${students[0].name}. Invitația a plecat pe email.`,
    )
  }

  /* --- cancel --------------------------------------------------------------- */

  if (action === 'anuleaza') {
    const slotId = formId(form.get('slot_id'))
    const reason = String(form.get('motiv') ?? '').trim().slice(0, 400)
    /* The scope arrives as a checkbox, the day is read on the server.
     *
     * A coordinator who is away is away for the whole day, and cancelling four
     * published hours meant four confirmations and four emails to each of the
     * same students. The day is derived from the hour that was clicked rather
     * than posted, so nothing in the form can widen the blast radius. */
    const wholeDay = String(form.get('toata_ziua') ?? '') === '1'

    if (!slotId) return back('Ora de consultație nu a fost identificată. Reîncarcă pagina.', true)

    /* An hour that has ended, or is already cancelled, is not cancelled again.
     *
     * There was no condition on the time at all — the interface merely left the
     * button off the rows that had ended, and an interface is not an
     * authorisation. Posting yesterday's form sent everybody who had actually
     * attended a `CANCEL` for a meeting that had already taken place. A second
     * submit of the same form found no bookings left to withdraw, told nobody
     * anything, and still reported success. */
    const anchor = await queryOne<{ day: string }>(
      `SELECT starts_at::date::text AS day
         FROM consultation_slots
        WHERE id = $2 AND teacher_id = $1 AND is_cancelled = false AND starts_at > now()`,
      [u!.id, slotId],
    )

    if (!anchor) {
      return back(
        'Ora nu mai poate fi anulată: fie s-a încheiat, fie era deja anulată. ' +
          'Reîncarcă pagina ca să vezi programul actual.',
        true,
      )
    }

    const hours = await query<{
      id: string
      starts_at: string
      ends_at: string
      mode: string
      location: string | null
      meeting_url: string | null
    }>(
      `SELECT id, starts_at, ends_at, mode, location, meeting_url
         FROM consultation_slots
        WHERE teacher_id = $1 AND is_cancelled = false AND starts_at > now()
          AND (($3::boolean = false AND id = $2) OR ($3::boolean = true AND starts_at::date = $4::date))
        ORDER BY starts_at`,
      [u!.id, slotId, wholeDay, anchor.day],
    )

    /* Gathered by person, not by hour.
     *
     * One gesture from the coordinator has to be one letter for each student:
     * four hours cancelled together used to mean four emails to the same person,
     * arriving in the same minute, each saying the same thing. The calendar
     * entries are gathered the same way — one file per person, holding one
     * `VEVENT` per hour they had booked. */
    const told = new Map<
      string,
      { name: string; email: string; hours: CancelledHour[]; events: CalendarEvent[] }
    >()
    const cancelled: CancelledHour[] = []
    const allEvents: CalendarEvent[] = []

    for (const hour of hours) {
      const when = `${formatDate(hour.starts_at)}, ${formatTime(hour.starts_at)}–${formatTime(hour.ends_at)}`
      const place = whereItIs(hour.mode, hour.location, hour.meeting_url)

      /* Who cancelled it, when, and why — the three things a boolean could not
       * hold. `is_cancelled = false` stays in the WHERE, and the hour is marked
       * *before* the bookings are withdrawn: two requests arriving together
       * cancel it once and tell everybody once, instead of the loser of the
       * race silently emptying the bookings and notifying nobody. */
      const marked = await execute(
        `UPDATE consultation_slots
            SET is_cancelled = true,
                cancelled_reason = NULLIF($3, ''),
                cancelled_at = now(),
                cancelled_by = $1
          WHERE id = $2 AND teacher_id = $1 AND is_cancelled = false`,
        [u!.id, hour.id, reason],
      )
      if (!marked) continue

      const bookings = await query<{
        student_id: string
        student_name: string
        student_email: string
      }>(
        `UPDATE bookings r SET status = 'cancelled'
           FROM consultation_slots s, users st
          WHERE r.slot_id = s.id AND st.id = r.student_id
            AND r.slot_id = $2 AND r.status = 'booked' AND s.teacher_id = $1
          RETURNING r.student_id, st.name AS student_name, st.email AS student_email`,
        [u!.id, hour.id],
      )

      cancelled.push({ when, place })

      for (const b of bookings) {
        /* The same UID as the invitation, a higher SEQUENCE, `METHOD:CANCEL`.
         * Any other identity adds a second event to the calendar instead of
         * withdrawing the first, so `consultationUid` is not touched. */
        const event: CalendarEvent = {
          uid: consultationUid(hour.id, b.student_id),
          title: `Consultație — ${u!.name}`,
          description: reason ? `Consultație anulată. Motiv: ${reason}` : 'Consultație anulată.',
          location: place,
          meetingUrl: hour.meeting_url ?? undefined,
          start: new Date(hour.starts_at),
          end: new Date(hour.ends_at),
          organizerName: u!.name,
          organizerEmail: u!.email,
          attendeeName: b.student_name,
          attendeeEmail: b.student_email,
          cancelled: true,
        }
        allEvents.push(event)

        const entry = told.get(b.student_id) ?? {
          name: b.student_name,
          email: b.student_email,
          hours: [],
          events: [],
        }
        entry.hours.push({ when, place })
        entry.events.push(event)
        told.set(b.student_id, entry)
      }
    }

    if (cancelled.length === 0) {
      return back('Orele erau deja anulate. Reîncarcă pagina ca să vezi programul actual.', true)
    }

    const delivered = await Promise.all(
      [...told.entries()].map(async ([studentId, s]) => {
        /* The portal's own act, written into the thread as a record — not as a
         * message from anybody. `postEvent` never throws, so a thread that
         * cannot be written to does not cancel the cancellation. */
        await postEvent({
          studentId,
          teacherId: u!.id,
          senderId: u!.id,
          eventType: 'consultation_cancelled',
          body:
            (s.hours.length === 1
              ? `${u!.name} a anulat consultația din ${s.hours[0].when}.`
              : `${u!.name} a anulat ${numar(s.hours.length, 'oră de consultație', 'ore de consultație')}: ` +
                `${s.hours.map((h) => h.when).join('; ')}.`) + (reason ? `\n\nMotiv: ${reason}` : ''),
          createConversation: false,
          subjectKind: 'slot',
          subjectId: slotId,
        })

        const letter = studentCancellationMail({
          studentName: s.name,
          teacherName: u!.name,
          hours: s.hours,
          reason,
          portalUrl: base,
        })

        try {
          const sent = await sendEmail({
            to: s.email,
            subject: letter.subject,
            html: letter.html,
            attachments: [
              {
                filename: 'anulare.ics',
                content: buildIcsBundle(s.events),
                contentType: 'text/calendar; method=CANCEL',
              },
            ],
          })
          if (!sent.ok) console.error('[sloturi] anularea nu a ajuns la', s.email, sent.error)
          return sent.ok
        } catch (err) {
          console.error('[sloturi] anularea nu a putut fi trimisă', err)
          return false
        }
      }),
    )

    /* And to the coordinator, when there was anybody to withdraw.
     *
     * They hold a calendar copy of every booking — one event per student, put
     * there when it was made — so cancelling without telling them left the hour
     * in the calendar of the one person who knew for certain it would not
     * happen. With nobody booked there is nothing in their calendar either, and
     * the notice on the screen is the whole of the news. */
    if (allEvents.length > 0) {
      const receipt = teacherCancellationMail({
        hours: cancelled,
        studentNames: [...told.values()].map((s) => s.name),
        reason,
        portalUrl: base,
      })

      await sendEmail({
        to: u!.email,
        subject: receipt.subject,
        html: receipt.html,
        attachments: [
          {
            filename: 'anulare.ics',
            content: buildIcsBundle(allEvents),
            contentType: 'text/calendar; method=CANCEL',
          },
        ],
      }).catch((err) => console.error('[sloturi] copia anulării nu a plecat', err))
    }

    await recordAccess({
      userId: u!.id,
      action: 'anuleaza_consultatie',
      subject: wholeDay ? `ziua ${anchor.day}` : slotId,
      rowCount: told.size,
      request,
    })

    const failed = delivered.filter((ok) => !ok).length

    /* The notice reports what was attempted and what failed, not what was
     * delivered: the old one claimed „N studenți anunțați” while the sends were
     * fire-and-forget, so a mailer that was down produced a green message and
     * nobody at the door. */
    return back(
      `${numar(cancelled.length, 'oră anulată', 'ore anulate')}. ` +
        (told.size === 0
          ? 'Nimeni nu avea loc rezervat, deci nu a fost nimeni de anunțat.'
          : `${numar(told.size, 'student anunțat', 'studenți anunțați')} pe email.`) +
        (failed > 0
          ? ` ${numar(failed, 'email nu a plecat', 'emailuri nu au plecat')} — scrie-le din Mesaje.`
          : ''),
      failed > 0,
    )
  }

  return deadEnd(400, 'Cerere neînțeleasă', 'Portalul nu a recunoscut acțiunea cerută. Reia pasul din interfață.')
}
