import type { APIRoute } from 'astro'
import { isTeacher } from '../../lib/auth'
import { execute } from '../../lib/db'
import { redirect } from '../../lib/http'

/** Account settings. Email and role are not editable here — they identify the user. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const u = locals.user
  if (!isTeacher(u)) return new Response('Neautorizat', { status: 401 })

  const form = await request.formData()
  const name = String(form.get('name') ?? '').trim()
  const office = String(form.get('office') ?? '').trim()
  const bachelor = Number(form.get('bachelor_capacity') ?? 0)
  const master = Number(form.get('master_capacity') ?? 0)

  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(30, Math.max(0, Math.trunc(n))) : 0)

  if (!name) {
    return redirect(
      new URL(`/profesor/arhiva?notificare=${encodeURIComponent('Numele nu poate fi gol.')}&tip=error`, url),
      303,
    )
  }

  await execute(
    `UPDATE users
        SET name = $2, office = NULLIF($3, ''), bachelor_capacity = $4, master_capacity = $5
      WHERE id = $1`,
    [u!.id, name, office, clamp(bachelor), clamp(master)],
  )

  return redirect(new URL('/profesor/arhiva?salvat=1', url), 303)
}
