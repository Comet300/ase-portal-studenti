import { crc32 } from 'node:zlib'

/**
 * Un ZIP fără compresie, scris de mână.
 *
 * Motivul pentru care nu este o dependență: portalul are trei — `pg`, `resend`,
 * `astro` — și singurul lucru cerut aici este să pui zece fișiere într-un plic.
 * Metoda „store” (0) nu comprimă nimic, deci nu are nevoie de niciun algoritm:
 * este doar antet, octeți, antet, octeți, apoi un cuprins la final. Capitolele
 * unei lucrări sunt oricum .docx și .pdf, adică deja comprimate — un deflate
 * peste ele ar câștiga procente și ar aduce un algoritm întreg.
 *
 * Formatul este PKZIP APPNOTE 6.3.3, partea din el fără care nimic nu deschide
 * arhiva: semnăturile 0x04034b50 (fișier), 0x02014b50 (cuprins), 0x06054b50
 * (sfârșit). Se scrie cu Zip64 mereu absent, deci limita este 4 GB pe arhivă și
 * 65.535 de fișiere; o conversație nu ajunge la niciuna, iar plafonul de 15 MB
 * pe fișier o ține departe de amândouă.
 *
 * Datele se scriu în antetul local, nu în descriptorul de la sfârșit: mărimea și
 * CRC-ul sunt cunoscute înainte, pentru că fișierele vin din memorie.
 */

export interface IntrareZip {
  /** Numele din arhivă. Se curăță aici: separatorii ar crea foldere. */
  nume: string
  octeti: Buffer
  /** Data fișierului, pentru ce arată arhiva la deschidere. */
  data?: Date
}

/**
 * Ora în format MS-DOS: doi octeți pentru oră, doi pentru dată, cu secunda
 * împărțită la doi (formatul are cinci biți pentru ea) și anii numărați din
 * 1980. Este ce înțeleg toate programele de arhivare, inclusiv Windows.
 */
function ceasDos(d: Date): { ora: number; data: number } {
  return {
    ora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    data: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * Nume de intrare curățat.
 *
 * Un `/` ar crea un folder, un `..` ar urca din el, iar un nume gol ar produce o
 * intrare pe care unele programe refuză să o extragă. Numele originale vin de la
 * cine a încărcat fișierul, deci nu se pot crede pe cuvânt.
 */
function numeSigur(nume: string, rezerva: string): string {
  const curat = nume
    .replace(/[/\\]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 180)
  return curat || rezerva
}

/**
 * Numele unice în arhivă.
 *
 * Doi studenți trimit „capitolul 2.docx” în aceeași conversație, sau același
 * student îl trimite de două ori: într-o arhivă ar fi două intrări cu un nume,
 * iar dezarhivarea ar păstra una. Al doilea primește un indice.
 */
export function numeUnice(nume: string[]): string[] {
  const vazute = new Map<string, number>()
  return nume.map((n) => {
    const cheie = n.toLowerCase()
    const deCateOri = vazute.get(cheie) ?? 0
    vazute.set(cheie, deCateOri + 1)
    if (deCateOri === 0) return n
    const punct = n.lastIndexOf('.')
    return punct > 0
      ? `${n.slice(0, punct)} (${deCateOri + 1})${n.slice(punct)}`
      : `${n} (${deCateOri + 1})`
  })
}

export function construiesteZip(intrari: IntrareZip[]): Buffer {
  const bucati: Buffer[] = []
  const cuprins: Buffer[] = []
  let deplasare = 0

  const numeCurate = numeUnice(
    intrari.map((i, idx) => numeSigur(i.nume, `fisier-${idx + 1}.bin`)),
  )

  intrari.forEach((intrare, idx) => {
    const nume = Buffer.from(numeCurate[idx], 'utf8')
    const suma = crc32(intrare.octeti)
    const marime = intrare.octeti.byteLength
    const { ora, data } = ceasDos(intrare.data ?? new Date())

    const antet = Buffer.alloc(30)
    antet.writeUInt32LE(0x04034b50, 0)
    antet.writeUInt16LE(20, 4) // versiunea minimă: 2.0
    // Bitul 11 spune că numele este UTF-8; fără el diacriticele ajung mojibake.
    antet.writeUInt16LE(0x0800, 6)
    antet.writeUInt16LE(0, 8) // metoda: store
    antet.writeUInt16LE(ora, 10)
    antet.writeUInt16LE(data, 12)
    antet.writeUInt32LE(suma, 14)
    antet.writeUInt32LE(marime, 18)
    antet.writeUInt32LE(marime, 22)
    antet.writeUInt16LE(nume.byteLength, 26)
    antet.writeUInt16LE(0, 28) // fără câmpuri extra

    const inregistrare = Buffer.alloc(46)
    inregistrare.writeUInt32LE(0x02014b50, 0)
    inregistrare.writeUInt16LE(20, 4) // scris de versiunea 2.0
    inregistrare.writeUInt16LE(20, 6)
    inregistrare.writeUInt16LE(0x0800, 8)
    inregistrare.writeUInt16LE(0, 10)
    inregistrare.writeUInt16LE(ora, 12)
    inregistrare.writeUInt16LE(data, 14)
    inregistrare.writeUInt32LE(suma, 16)
    inregistrare.writeUInt32LE(marime, 20)
    inregistrare.writeUInt32LE(marime, 24)
    inregistrare.writeUInt16LE(nume.byteLength, 28)
    inregistrare.writeUInt16LE(0, 30)
    inregistrare.writeUInt16LE(0, 32)
    inregistrare.writeUInt16LE(0, 34)
    inregistrare.writeUInt16LE(0, 36)
    inregistrare.writeUInt32LE(0, 38)
    inregistrare.writeUInt32LE(deplasare, 42)

    bucati.push(antet, nume, intrare.octeti)
    cuprins.push(inregistrare, nume)
    deplasare += antet.byteLength + nume.byteLength + marime
  })

  const cuprinsIntreg = Buffer.concat(cuprins)

  const sfarsit = Buffer.alloc(22)
  sfarsit.writeUInt32LE(0x06054b50, 0)
  sfarsit.writeUInt16LE(0, 4) // un singur volum
  sfarsit.writeUInt16LE(0, 6)
  sfarsit.writeUInt16LE(intrari.length, 8)
  sfarsit.writeUInt16LE(intrari.length, 10)
  sfarsit.writeUInt32LE(cuprinsIntreg.byteLength, 12)
  sfarsit.writeUInt32LE(deplasare, 16)
  sfarsit.writeUInt16LE(0, 20) // fără comentariu

  return Buffer.concat([...bucati, cuprinsIntreg, sfarsit])
}
