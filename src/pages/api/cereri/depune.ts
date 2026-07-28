import type { APIRoute } from 'astro'
import { queryOne } from '../../../lib/db'
import { template, sendEmail } from '../../../lib/mail'
import { redirectWithNotice } from '../../../lib/http'

/** A student submits a supervision request. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })
  if (u.role !== 'student') {
    return new Response('Doar studenții pot depune cereri', { status: 403 })
  }

  const form = await request.formData()
  const teacherId = String(form.get('profesor_id') ?? '')
  const topicId = String(form.get('tema_id') ?? '')
  const titleRo = String(form.get('titlu_ro') ?? '').trim()
  const titleEn = String(form.get('titlu_en') ?? '').trim()
  const objectives = String(form.get('scop_obiective') ?? '').trim()

  const back = (message: string, isError = false) =>
    redirectWithNotice('/cererile-mele', message, isError)

  if (!teacherId || !titleRo || objectives.length < 40) {
    return back('Completează coordonatorul, titlul și descrierea (minimum 40 de caractere).', true)
  }

  const teacher = await queryOne<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
    [teacherId],
  )
  if (!teacher) return back('Coordonatorul selectat nu există.', true)

  // The partial unique index on (student_id) for live statuses prevents a second
  // open request; the violation is caught here so the message is useful.
  try {
    const number = `CRR-2026-${Date.now().toString().slice(-6)}`
    await queryOne<{ id: string }>(
      `INSERT INTO requests (number, student_id, teacher_id, topic_id, title_ro, title_en, objectives, status)
       VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, NULLIF($6, ''), $7, 'pending')
       RETURNING id`,
      [number, u.id, teacherId, topicId, titleRo, titleEn, objectives],
    )

    const base = process.env.APP_BASE_URL ?? url.origin
    await sendEmail({
      to: teacher.email,
      subject: `Cerere nouă de coordonare — ${u.name}`,
      html: template(
        'Ai primit o cerere de coordonare',
        `<p><strong>${u.name}</strong> (${u.student_number ?? '—'},
         ${u.program === 'master' ? 'master' : 'licență'}) îți propune lucrarea:</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px"><strong>${titleRo}</strong></p>
         <p style="color:#5b6169;font-size:13px">${objectives.slice(0, 400)}${objectives.length > 400 ? '…' : ''}</p>`,
        { text: 'Vezi cererea', url: `${base}/profesor/studenti?sectiune=cereri` },
      ),
    })

    return back('Cererea a fost depusă. Coordonatorul a fost notificat.')
  } catch (err) {
    const message = String(err)
    if (message.includes('idx_requests_one_active')) {
      return back('Ai deja o cerere activă. Retrage-o sau așteaptă decizia coordonatorului.', true)
    }
    console.error('[cereri] eroare la depunere', err)
    return back('Cererea nu a putut fi depusă. Încearcă din nou.', true)
  }
}
