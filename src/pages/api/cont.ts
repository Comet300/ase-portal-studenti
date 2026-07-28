import type { APIRoute } from 'astro'
import { execute } from '../../lib/db'
import { saveFile } from '../../lib/files'
import { redirect, redirectWithNotice } from '../../lib/http'

/**
 * Profile settings, for every role.
 *
 * Email, role and the faculty's own record of a student (number, programme,
 * group) are not editable here — they identify the person and come from the
 * registrar. What is editable is what the person chooses to show: display name,
 * office, a picture, a short description.
 *
 * Seats are deliberately absent: they are allocated by the head of department,
 * not declared by the coordinator who spends them.
 */

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!u) return new Response('Neautentificat', { status: 401 })

  const home = u.role === 'student' ? '/contul-meu' : '/profesor/arhiva'
  const form = await request.formData()
  const name = String(form.get('nume') ?? '').trim()
  const office = String(form.get('birou') ?? '').trim()
  const bio = String(form.get('descriere') ?? '').trim()
  const interests = String(form.get('interese') ?? '').trim()
  const website = String(form.get('pagina_web') ?? '').trim()
  const avatar = form.get('poza')

  if (!name) return redirectWithNotice(home, 'Numele nu poate fi gol.', true)
  if (bio.length > 1200) {
    return redirectWithNotice(home, 'Descrierea depășește 1200 de caractere.', true)
  }
  if (website && !/^https?:\/\/\S+$/i.test(website)) {
    return redirectWithNotice(home, 'Adresa paginii web trebuie să înceapă cu http:// sau https://.', true)
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
            avatar_path = COALESCE($7, avatar_path)
      WHERE id = $1`,
    [u.id, name, office, bio, interests, website, avatarPath],
  )

  return redirect(`${home}?salvat=1`)
}
