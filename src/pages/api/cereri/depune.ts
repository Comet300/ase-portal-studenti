import type { APIRoute } from 'astro'
import { queryOne } from '../../../lib/db'
import { template, sendEmail } from '../../../lib/mail'

/** Depunerea unei cereri de coordonare de către student. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })
  if (u.role !== 'student') {
    return new Response('Doar studenții pot depune cereri', { status: 403 })
  }

  const date = await request.formData()
  const profesorId = String(date.get('profesor_id') ?? '')
  const temaId = String(date.get('tema_id') ?? '')
  const titluRo = String(date.get('titlu_ro') ?? '').trim()
  const titluEn = String(date.get('titlu_en') ?? '').trim()
  const scop = String(date.get('scop_obiective') ?? '').trim()

  const inapoi = (mesaj: string, eroare = false) =>
    Response.redirect(
      new URL(`/cererile-mele?notificare=${encodeURIComponent(mesaj)}${error ? '&kind=error' : ''}`, url),
      303,
    )

  if (!teacherId || !titleRo || objectivesField.length < 40) {
    return back('Completează coordonatorul, titlul și descrierea (minimum 40 de caractere).', true)
  }

  const teacherSelect = await queryOne<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE id = $1 AND role IN ('teacher', 'head')`,
    [teacherId],
  )
  if (!teacherSelect) return back('Coordonatorul selectat nu există.', true)

  // Indexul parțial pe (student_id) unde status este active împiedică o a doua
  // request deschisă; prindem încălcarea aici ca să dăm un mesaj util.
  try {
    const number = `CRR-2026-${Date.now().toString().slice(-6)}`
    await queryOne<{ id: string }>(
      `INSERT INTO requests (number, student_id, teacher_id, topic_id, title_ro, title_en, objectives, status)
       VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, NULLIF($6, ''), $7, 'pending')
       RETURNING id`,
      [number, u.id, teacherId, topicId, titleRo, titleEn, objectivesField],
    )

    const base = process.env.APP_BASE_URL ?? url.origin
    await sendEmail({
      to: teacherSelect.email,
      subject: `Cerere nouă de coordonare — ${u.name}`,
      html: template(
        'Ai primit o request de coordonare',
        `<p><strong>${u.name}</strong> (${u.student_number ?? '—'},
         ${u.program === 'master' ? 'master' : 'licență'}) îți propune lucrarea:</p>
         <p style="padding:12px 16px;background:#f8f9fa;border-radius:4px"><strong>${titleRo}</strong></p>
         <p style="color:#5b6169;font-size:13px">${scop.slice(0, 400)}${scop.length > 400 ? '…' : ''}</p>`,
        { text: 'Vezi cererea', url: `${base}/teacherSelect/students?section=requests` },
      ),
    })

    return back('Cererea a fost depusă. Coordonatorul a fost notificat.')
  } catch (err) {
    const mesaj = String(err)
    if (mesaj.includes('idx_cereri_una_activa')) {
      return back('Ai deja o request activă. Retrage-o sau așteaptă decizia coordonatorului.', true)
    }
    console.error('[requests] error la depunere', err)
    return back('Cererea nu a putut fi depusă. Încearcă din nou.', true)
  }
}
