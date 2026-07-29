import { fileStore } from './container'

/**
 * Uploaded files.
 *
 * Bound to whichever `FileStore` implementation `container.ts` chose. Reads
 * return a stream, not a path, so a store backed by object storage would need
 * no change at the call sites.
 */

export { MAX_BYTES } from './adapters/disk-files'

/**
 * Ce se poate atașa într-o conversație.
 *
 * O listă închisă, nu una de excluderi: un fir de lucrare de licență poartă
 * capitole, chestionare și seturi de date, nu executabile. Tipul se deduce din
 * extensia verificată, nu din ce declară browserul — `file.type` vine de la
 * client și nu este o dovadă.
 */
export const EXTENSII_PERMISE = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'xls', 'xlsx', 'csv', 'ods',
  'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'zip',
] as const

const TIPURI: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
}

/** Atributul `accept` al câmpului de fișier, derivat din aceeași listă. */
export const ACCEPT = EXTENSII_PERMISE.map((e) => `.${e}`).join(',')

export function extensia(nume: string): string {
  const parte = nume.split('.').pop()
  return parte && parte !== nume ? parte.toLowerCase() : ''
}

export function extensiePermisa(nume: string): boolean {
  return (EXTENSII_PERMISE as readonly string[]).includes(extensia(nume))
}

/** Tipul pe care îl înregistrăm, dedus din extensie — nu din ce spune clientul. */
export function tipDupaExtensie(nume: string): string {
  return TIPURI[extensia(nume)] ?? 'application/octet-stream'
}

export const saveFile = fileStore.save.bind(fileStore)
export const openFile = fileStore.open.bind(fileStore)
