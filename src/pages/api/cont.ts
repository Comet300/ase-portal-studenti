import type { APIRoute } from 'astro'
import { execute } from '../../lib/db'
import { saveFile } from '../../lib/files'
import { redirect, redirectWithNotice, sessionExpired } from '../../lib/http'

/**
 * Profile settings, for every role.
 *
 * Email, role and the faculty's own record of a student (number, programme,
 * group) are not editable here — they identify the person and come from the
 * registrar. What is editable is what the person chooses to show: display name,
 * office, a picture, a short description.
 *
 * The academic title is written here too. It was printed on the student's
 * request form and in the coordination export, and no route in the portal ever
 * updated it: outside the seed it stayed NULL for good. Only a teacher may set
 * one — the guard is in the statement, so a student's POST cannot claim a rank.
 *
 * Seats are deliberately absent: they are allocated by the head of department,
 * not declared by the coordinator who spends them.
 */

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!u) return sessionExpired()

  /* One account screen for every role now: a teacher used to be redirected to
   * „Arhivă & Profil”, so a validation error landed them on a screen whose form
   * was the sixth section down. */
  const home = '/contul-meu'
  const isStudent = u.role === 'student'
  const form = await request.formData()
  const name = String(form.get('nume') ?? '').trim()
  const office = String(form.get('birou') ?? '').trim()
  const bio = String(form.get('descriere') ?? '').trim()
  const interests = String(form.get('interese') ?? '').trim()
  const website = String(form.get('pagina_web') ?? '').trim()
  const academicTitle = isStudent ? '' : String(form.get('titlu') ?? '').trim()
  const avatar = form.get('poza')

  if (!name) return redirectWithNotice(home, 'Numele nu poate fi gol.', true)
  if (bio.length > 1200) {
    return redirectWithNotice(home, 'Descrierea depășește 1200 de caractere.', true)
  }
  if (website && !/^https?:\/\/\S+$/i.test(website)) {
    return redirectWithNotice(home, 'Adresa paginii web trebuie să înceapă cu http:// sau https://.', true)
  }
  if (academicTitle.length > 60) {
    return redirectWithNotice(
      home,
      'Titlul didactic depășește 60 de caractere. Scrie-l prescurtat, ca pe cerere: „Conf. univ. dr.”.',
      true,
    )
  }

  let avatarPath: string | null = null
  if (avatar instanceof File && avatar.size > 0) {
    if (!IMAGE_TYPES.includes(avatar.type)) {
      return redirectWithNotice(home, 'Poza trebuie să fie JPG, PNG, WEBP sau GIF.', true)
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      return redirectWithNotice(home, 'Poza depășește 2 MB.', true)
    }
    try {
      const stored = await saveFile(u.id, avatar.name, Buffer.from(await avatar.arrayBuffer()))
      avatarPath = `${u.id}/${stored}`
    } catch (err) {
      console.error('[cont] poza nu a putut fi salvată', err)
      return redirectWithNotice(home, 'Poza nu a putut fi salvată. Încearcă din nou.', true)
    }
  }

  await execute(
    `UPDATE users
        SET name = $2,
            office = NULLIF($3, ''),
            bio = NULLIF($4, ''),
            interests = NULLIF($5, ''),
            website = NULLIF($6, ''),
            avatar_path = COALESCE($7, avatar_path),
            academic_title = CASE WHEN $9::boolean THEN academic_title
                                  ELSE NULLIF($8::text, '') END
      WHERE id = $1`,
    [u.id, name, office, bio, interests, website, avatarPath, academicTitle, isStudent],
  )

  return redirect(`${home}?salvat=1`)
}
