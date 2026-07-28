import type { APIRoute } from 'astro'
import { esteProfesor } from '../../../lib/auth'
import { queryOne, transaction } from '../../../lib/db'
import { sablon, trimiteEmail } from '../../../lib/mail'

/** Jaloanele implicite, create odată cu acceptarea, ca studentul să nu pornească din gol. */
const JALOANE_IMPLICITE = [
  ['Stabilirea temei și a bibliografiei', 'Temă confirmată și minimum 20 de titluri bibliografice.', 0],
  ['Capitolul teoretic', 'Sinteza literaturii de specialitate și cadrul conceptual.', 45],
  ['Metodologia cercetării', 'Instrument de cercetare validat, eșantion stabilit.', 90],
  ['Colectarea și analiza datelor', 'Date colectate și prelucrate.', 135],
  ['Predarea formei finale', 'Lucrare completă și verificare antiplagiat.', 180],
] as const

export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.utilizator
  if (!esteProfesor(u)) return new Response('Neautorizat', { status: 401 })

  const date = await request.formData()
  const cerereId = String(date.get('cerere_id') ?? '')
  const decizie = String(date.get('decizie') ?? '')
  const motiv = String(date.get('motiv') ?? '').trim()
  const redirect = String(date.get('redirect') ?? '/profesor/studenti')

  if (decizie !== 'aprobata' && decizie !== 'respinsa') {
    return new Response('Decizie invalidă', { status: 400 })
  }

  if (decizie === 'respinsa' && motiv.length < 10) {
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
      `UPDATE cereri
          SET status = $3,
              motiv_respingere = $4,
              decisa_la = now(),
              actualizat_la = now()
        WHERE id = $2 AND profesor_id = $1 AND status = 'in_asteptare'
        RETURNING id, student_id, titlu_ro, numar`,
      [u!.id, cerereId, decizie, decizie === 'respinsa' ? motiv : null],
    )

    const c = rows[0]
    if (!c) return null

    if (decizie === 'aprobata') {
      for (const [titlu, descriere, zile] of JALOANE_IMPLICITE) {
        await client.query(
          `INSERT INTO jaloane (cerere_id, titlu, descriere, termen, ordine)
           VALUES ($1, $2, $3, (current_date + ($4 || ' days')::interval)::date, $5)`,
          [c.id, titlu, descriere, String(zile), JALOANE_IMPLICITE.findIndex((j) => j[0] === titlu)],
        )
      }
      // Firul de discuție se deschide odată cu acceptarea.
      await client.query(
        `INSERT INTO conversatii (student_id, profesor_id) VALUES ($1, $2)
         ON CONFLICT (student_id, profesor_id) DO NOTHING`,
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

  const student = await queryOne<{ email: string; nume: string }>(
    'SELECT email, nume FROM utilizatori WHERE id = $1',
    [cerere.student_id],
  )

  if (student) {
    const baza = process.env.APP_BASE_URL ?? url.origin
    const aprobata = decizie === 'aprobata'
    await trimiteEmail({
      to: student.email,
      subject: aprobata
        ? `Cererea ${cerere.numar} a fost aprobată`
        : `Cererea ${cerere.numar} a fost respinsă`,
      html: sablon(
        aprobata ? 'Cererea ta a fost aprobată' : 'Cererea ta a fost respinsă',
        aprobata
          ? `<p>Bună, ${student.nume.split(' ')[0]}! Cererea <strong>${cerere.numar}</strong> pentru lucrarea
             „${cerere.titlu_ro}” a fost aprobată de ${u!.nume}.</p>
             <p>În portal găsești acum jaloanele lucrării și poți programa consultații.</p>`
          : `<p>Bună, ${student.nume.split(' ')[0]}. Cererea <strong>${cerere.numar}</strong> pentru lucrarea
             „${cerere.titlu_ro}” a fost respinsă de ${u!.nume}.</p>
             <p><strong>Motiv:</strong> ${motiv}</p>
             <p>Poți depune o cerere nouă, către același coordonator sau către altul.</p>`,
        { text: 'Deschide portalul', url: `${baza}/cererile-mele` },
      ),
    })
  }

  return Response.redirect(
    new URL(
      `${redirect}?notificare=${encodeURIComponent(
        decizie === 'aprobata' ? 'Cerere aprobată. Studentul a fost notificat.' : 'Cerere respinsă. Studentul a fost notificat.',
      )}`,
      url,
    ),
    303,
  )
}
