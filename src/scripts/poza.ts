/**
 * Poza de profil, micșorată înainte să plece.
 *
 * Portalul afișează avatarul la 28, 34, 44 sau 72 de pixeli — nimic mai mare. Se
 * trimitea și se servea fotografia întreagă: 2 MB dintr-un telefon, la 4000 de
 * pixeli lățime, pentru un cerc de 28. Catalogul are douăzeci și două de avatare
 * pe un ecran, deci pagina aceea cerea zeci de megabytes ca să deseneze niște
 * cercuri.
 *
 * Micșorarea se face aici, în browser, cu `canvas`. Nu pentru că e cel mai bun
 * loc, ci pentru că este singurul care nu cere o bibliotecă nativă de procesare
 * de imagini într-un portal cu trei dependențe — iar originalul nu este folosit
 * niciodată de nimic.
 *
 * Ce se garantează nu se schimbă: plafonul de 2 MB și lista de tipuri rămân
 * verificate pe server, pentru cineva care trimite direct în rută. Asta este o
 * curtoazie a clientului, nu o apărare.
 */

/** Latura maximă a derivatei: 72px afișat × 3, adică suficient și pe ecrane dense. */
const LATURA = 256

/** Sub atât nu merită recodat: o poză deja mică ar putea ieși mai mare. */
const PRAG_OCTETI = 60 * 1024

const TIPURI = ['image/jpeg', 'image/png', 'image/webp']

async function micsoreaza(f: File): Promise<File | null> {
  // GIF-ul poate fi animat; recodat prin canvas ar rămâne un singur cadru, deci
  // se lasă în pace și trece prin plafonul serverului ca înainte.
  if (!TIPURI.includes(f.type)) return null
  if (f.size <= PRAG_OCTETI) return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(f)
  } catch {
    // Un fișier care spune că e imagine dar nu se decodează: îl refuză serverul.
    return null
  }

  const scara = Math.min(1, LATURA / Math.max(bitmap.width, bitmap.height))
  // Deja mică: nu se atinge, ca să nu se piardă calitate degeaba.
  if (scara === 1) {
    bitmap.close()
    return null
  }

  const l = Math.round(bitmap.width * scara)
  const h = Math.round(bitmap.height * scara)
  const panza = document.createElement('canvas')
  panza.width = l
  panza.height = h
  const ctx = panza.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, l, h)
  bitmap.close()

  const bucata = await new Promise<Blob | null>((gata) =>
    panza.toBlob(gata, 'image/webp', 0.86),
  )
  if (!bucata || bucata.size >= f.size) return null

  const numeNou = f.name.replace(/\.[^.]+$/, '') + '.webp'
  return new File([bucata], numeNou, { type: 'image/webp', lastModified: f.lastModified })
}

export function pornestePoza() {
  const camp = document.querySelector<HTMLInputElement>('input[name="poza"]')
  if (!camp) return

  const hint = camp.parentElement?.querySelector('.hint')
  const textInitial = hint?.textContent ?? ''

  camp.addEventListener('change', async () => {
    const f = camp.files?.[0]
    if (!f) {
      if (hint) hint.textContent = textInitial
      return
    }

    const mica = await micsoreaza(f)
    if (!mica) return

    const dt = new DataTransfer()
    dt.items.add(mica)
    camp.files = dt.files

    /* Se spune, nu se face pe furiș: cineva care încarcă o fotografie de 3 MB și
     * primește „trimis 34 KB” trebuie să înțeleagă de ce, mai ales dacă se
     * întreabă unde i-a plecat rezoluția. */
    if (hint) {
      const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`
      hint.textContent = `Poza a fost micșorată la ${LATURA} px (${kb(f.size)} → ${kb(mica.size)}); portalul o afișează oricum la cel mult 72 px.`
    }
  })
}
