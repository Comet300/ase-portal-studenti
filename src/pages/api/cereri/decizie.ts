import type { APIRoute } from 'astro'
import { isTeacher } from '../../../lib/auth'
import { queryOne, transaction } from '../../../lib/db'
import { template, sendEmail } from '../../../lib/mail'

/** Jaloanele implicite, create odată cu acceptarea, ca studentul să nu pornească din gol. */
const JALOANE_IMPLICITE = [
  ['Stabilirea temei și a bibliografiei', 'Temă confirmată și minimum 20 de titluri bibliografice.', 0],
  ['Capitolul teoretic', 'Sinteza literaturii de specialitate și cadrul conceptual.', 45],
  ['Metodologia cercetării', 'Instrument de cercetare validat, eșantion stabilit.', 90],
  ['Colectarea și analiza datelor', 'Date colectate și prelucrate.', 135],
  ['Predarea formei finale', 'Lucrare completă și verificare antiplagiat.', 180],
] as const

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const cerereId = String(date.get('cerere_id') ?? '')
  const decizie = String(date.get('decizie') ?? '')
  const motiv = String(date.get('motiv') ?? '').trim()
  const redirect = String(date.get('redirect') ?? '/profesor/studenti')

  if (decizie !== 'approved' && decizie !== 'rejected') {
    return new Response('Decizie invalidă', { status: 400 })
  }

  if (decizie === 'rejected' && motiv.length < 10) {
    return Response.redirect(
      new URL(
        `${redirect}?notificare=${encodeURIComponent('Motivul respingerii este obligatoriu (minimum 10 caractere).')}&tip=error`,
        url,
      ),
      303,
    )
  }

  // Condiția de proprietate stă în aceeași instrucțiune cu scrierea: o cerere a
  // altui coordonator nu se potrivește, deci nu se modifică nimic.
  const cerere = await transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE requests
          SET status = $3,
              rejection_reason = $4,
              decided_at = now(),
              updated_at = now()
        WHERE id = $2 AND teacher_id = $1 AND status = 'pending'
        RETURNING id, student_id, title_ro, number`,
      [u!.id, cerereId, decizie, decizie === 'rejected' ? motiv : null],
    )

    const c = rows[0]
    if (!c) return null

    if (decizie === 'approved') {
      for (const [titlu, description, zile] of JALOANE_IMPLICITE) {
        await client.query(
          `INSERT INTO milestones (request_id, title, description, due_on, position)
           VALUES ($1, $2, $3, (current_date + ($4 || ' days')::interval)::date, $5)`,
          [c.id, title, description, String(zile), JALOANE_IMPLICITE.findIndex((j) => j[0] === titlu)],
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
    return Response.redirect(
      new URL(`${redirect}?notificare=${encodeURIComponent('Cererea nu mai poate fi modificată.')}&tip=error`, url),
      303,
    )
  }

  const student = await queryOne<{ email: string; name: string }>(
    'SELECT email, name FROM users WHERE id = $1',
    [cerere.student_id],
  )

  if (student) {
    const baza = process.env.APP_BASE_URL ?? url.origin
    const aprobata = decizie === 'approved'
    await sendEmail({
      to: student.email,
      subject: aprobata
        ? `Cererea ${cerere.number} a fost aprobată`
        : `Cererea ${cerere.number} a fost respinsă`,
      html: template(
        aprobata ? 'Cererea ta a fost aprobată' : 'Cererea ta a fost respinsă',
        aprobata
          ? `<p>Bună, ${student.name.split(' ')[0]}! Cererea <strong>${cerere.number}</strong> pentru lucrarea
             „${cerere.title_ro}” a fost aprobată de ${u!.name}.</p>
             <p>În portal găsești acum jaloanele lucrării și poți programa consultații.</p>`
          : `<p>Bună, ${student.name.split(' ')[0]}. Cererea <strong>${cerere.number}</strong> pentru lucrarea
             „${cerere.title_ro}” a fost respinsă de ${u!.name}.</p>
             <p><strong>Motiv:</strong> ${motiv}</p>
             <p>Poți depune o cerere nouă, către același coordonator sau către altul.</p>`,
        { text: 'Deschide portalul', url: `${baza}/cererile-mele` },
      ),
    })
  }

  return Response.redirect(
    new URL(
      `${redirect}?notificare=${encodeURIComponent(
        decizie === 'approved' ? 'Cerere aprobată. Studentul a fost notificat.' : 'Cerere respinsă. Studentul a fost notificat.',
      )}`,
      url,
    ),
    303,
  )
}
