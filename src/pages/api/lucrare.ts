import type { APIRoute } from 'astro'
import { postEvent } from '../../lib/chat'
import { recordAccess } from '../../lib/audit'
import { queryOne, transaction } from '../../lib/db'
import {
  DECLARATION_EXTENSIONS,
  THESIS_EXTENSIONS,
  THESIS_MAX_BYTES,
  extensionOf,
  mimeForExtension,
  saveFile,
} from '../../lib/files'
import { formAction } from '../../lib/forms'
import { redirectWithNotice, sessionExpired } from '../../lib/http'
import { html, sendEmail, template } from '../../lib/mail'
import { formatDate } from '../../lib/repo'

/**
 * Handing in the thesis.
 *
 * The regulation the portal itself prints says the paper is uploaded here, in
 * PDF, together with the signed declaration of originality. Until now it was
 * not: the guide told the student to email the final form to their coordinator,
 * who then uploaded it to the university's platform — so the one artefact a
 * year of work produces was the only thing the portal did not hold.
 *
 * A hand-in is not a message with a paper clip. It belongs to the supervision,
 * it has exactly one current version, it keeps the ones before it, and it is
 * what the department's archive shows next to the title.
 *
 * The version is a new row, never an overwrite: a student who uploads a
 * corrected form the evening before the deadline has not deleted the one their
 * coordinator read last week, and „which version did I read” is a question with
 * consequences.
 */

const ACCEPTED: Record<string, readonly string[]> = {
  thesis: THESIS_EXTENSIONS,
  declaration: DECLARATION_EXTENSIONS,
}

const NAMES: Record<string, string> = {
  thesis: 'Lucrarea',
  declaration: 'Declarația de originalitate',
}

export const POST: APIRoute = async ({ request, locals }) => {
  const u = locals.user
  if (!u) return sessionExpired('/lucrarea-mea')

  const form = await request.formData()
  const kind = formAction(form) === 'declaratie' ? 'declaration' : 'thesis'
  const back = (message: string, isError = false) =>
    redirectWithNotice('/lucrarea-mea#lucrare', message, isError)

  if (u.role !== 'student') {
    return back('Lucrarea o încarcă studentul, din contul lui.', true)
  }

  const file = form.get('fisier')
  if (!(file instanceof File) || file.size === 0) {
    return back('Alege un fișier și încearcă din nou.', true)
  }

  /* Ownership and eligibility in one statement, as everywhere else here: there
   * is no row-level security, so „whose thesis is this” is part of the lookup
   * rather than a check somebody can forget to repeat. A defended thesis is
   * closed — the file behind the grade does not change afterwards. */
  const request_ = await queryOne<{ id: string; teacher_id: string; teacher_name: string; teacher_email: string; title_ro: string }>(
    `SELECT r.id, r.teacher_id, t.name AS teacher_name, t.email AS teacher_email, r.title_ro
       FROM requests r
       JOIN users t ON t.id = r.teacher_id
      WHERE r.student_id = $1 AND r.status = 'approved'
        AND r.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
      ORDER BY r.decided_at DESC NULLS LAST
      LIMIT 1`,
    [u.id],
  )

  if (!request_) {
    return back(
      'Lucrarea se încarcă după ce un coordonator îți aprobă cererea. Depune cererea din catalogul de coordonatori.',
      true,
    )
  }

  const extension = extensionOf(file.name)
  if (!ACCEPTED[kind].includes(extension)) {
    return back(
      kind === 'thesis'
        ? 'Lucrarea se încarcă în format PDF — este forma care se citește la fel pe orice calculator și cea care intră în verificarea antiplagiat.'
        : 'Declarația poate fi PDF sau o fotografie a paginii semnate (JPG sau PNG).',
      true,
    )
  }

  if (file.size > THESIS_MAX_BYTES) {
    return back(
      `Fișierul are ${Math.round(file.size / (1024 * 1024))} MB, peste limita de ${Math.round(THESIS_MAX_BYTES / (1024 * 1024))} MB. Exportă PDF-ul cu imaginile comprimate și reia.`,
      true,
    )
  }

  let fileId: string
  try {
    const bytes = Buffer.from(await file.arrayBuffer())

    fileId = await transaction(async (client) => {
      /* The folder is the request's id: the file store only ever accepts a uuid
       * as a folder and generates the name itself, so nothing from the upload
       * reaches a path. A supervision keeps its versions together. */
      const stored = await saveFile(request_.id, file.name, bytes, THESIS_MAX_BYTES)
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO files (uploaded_by, request_id, kind, original_name, stored_name, mime, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [u.id, request_.id, kind, file.name, stored, mimeForExtension(file.name), file.size],
      )
      return rows[0].id
    })
  } catch (err) {
    console.error('[lucrare] fișierul nu a putut fi salvat', err)
    return back('Fișierul nu a putut fi salvat. Încearcă din nou peste câteva momente.', true)
  }

  const version = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM files WHERE request_id = $1 AND kind = $2`,
    [request_.id, kind],
  )
  const nth = version?.n ?? 1

  /* The thread carries it, like every other act of the portal: a record, not
   * somebody typing. The coordinator's bell leads to the file itself. */
  await postEvent({
    studentId: u.id,
    teacherId: request_.teacher_id,
    senderId: u.id,
    eventType: 'thesis_uploaded',
    body:
      nth > 1
        ? `${NAMES[kind]} a fost încărcată din nou (versiunea ${nth}): ${file.name}`
        : `${NAMES[kind]} a fost încărcată: ${file.name}`,
    subjectKind: 'file',
    subjectId: fileId,
    createConversation: true,
  })

  await sendEmail({
    to: request_.teacher_email,
    subject:
      nth > 1
        ? `${u.name} a încărcat o versiune nouă a lucrării`
        : `${u.name} a încărcat lucrarea`,
    html: template(
      nth > 1 ? 'Versiune nouă a lucrării' : 'Lucrarea a fost încărcată',
      html`<p>${u.name} a încărcat ${nth > 1 ? `versiunea ${nth} a` : ''}
        ${kind === 'thesis' ? 'lucrării' : 'declarației de originalitate'}, pe
        ${formatDate(new Date().toISOString())}.</p>
       <p><strong>${request_.title_ro}</strong></p>
       <p>Fișier: ${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB</p>`,
      { text: 'Deschide lucrarea', url: `${process.env.APP_BASE_URL ?? ''}/profesor/studenti?sectiune=studenti` },
    ),
  })

  await recordAccess({
    userId: u.id,
    action: 'incarca_lucrare',
    subject: `${kind}:${fileId}`,
    request,
  })

  return back(
    nth > 1
      ? `${NAMES[kind]} a fost înlocuită. Coordonatorul a fost anunțat, iar versiunile anterioare rămân în istoric.`
      : `${NAMES[kind]} a fost încărcată. Coordonatorul a fost anunțat.`,
  )
}
