/**
 * The profile photo, shrunk before it leaves.
 *
 * The portal shows the avatar at 28, 34, 44 or 72 pixels — nothing larger. The
 * whole photograph was being sent and served: 2 MB out of a phone, 4000 pixels
 * wide, for a circle of 28. The catalogue has twenty-two avatars on one screen,
 * so that page was asking for tens of megabytes in order to draw a few circles.
 *
 * The shrinking happens here, in the browser, with `canvas`. Not because it is
 * the best place, but because it is the only one that does not require a native
 * image-processing library in a portal with three dependencies — and the
 * original is never used by anything.
 *
 * What is guaranteed does not change: the 2 MB ceiling and the list of types
 * stay checked on the server, for someone who posts straight to the route. This
 * is a courtesy of the client, not a defence.
 */

/** Longest side of the derived image: 72px displayed × 3, enough on dense screens too. */
const MAX_SIDE_PX = 256

/** Below this it is not worth re-encoding: an already small photo could come out larger. */
const MIN_BYTES_TO_RESIZE = 60 * 1024

const RESIZABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function downscale(f: File): Promise<File | null> {
  // A GIF can be animated; re-encoded through a canvas it would be left with a
  // single frame, so it is left alone and goes through the server's ceiling as
  // before.
  if (!RESIZABLE_TYPES.includes(f.type)) return null
  if (f.size <= MIN_BYTES_TO_RESIZE) return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(f)
  } catch {
    // A file that says it is an image but does not decode: the server refuses it.
    return null
  }

  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height))
  // Already small: it is not touched, so that quality is not lost for nothing.
  if (scale === 1) {
    bitmap.close()
    return null
  }

  const l = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = l
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, l, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.86),
  )
  if (!blob || blob.size >= f.size) return null

  const newName = f.name.replace(/\.[^.]+$/, '') + '.webp'
  return new File([blob], newName, { type: 'image/webp', lastModified: f.lastModified })
}

export function startPhoto() {
  const field = document.querySelector<HTMLInputElement>('input[name="poza"]')
  if (!field) return

  const hint = field.parentElement?.querySelector('.hint')
  const initialHint = hint?.textContent ?? ''

  field.addEventListener('change', async () => {
    const f = field.files?.[0]
    if (!f) {
      if (hint) hint.textContent = initialHint
      return
    }

    const resized = await downscale(f)
    if (!resized) return

    const dt = new DataTransfer()
    dt.items.add(resized)
    field.files = dt.files

    /* It is said, not done on the sly: someone who uploads a 3 MB photograph
     * and gets „trimis 34 KB” has to understand why, especially if they wonder
     * where their resolution went. */
    if (hint) {
      const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`
      hint.textContent = `Poza a fost micșorată la ${MAX_SIDE_PX} px (${kb(f.size)} → ${kb(resized.size)}); portalul o afișează oricum la cel mult 72 px.`
    }
  })
}
