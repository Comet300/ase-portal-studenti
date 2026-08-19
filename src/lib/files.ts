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
 * What can be attached in a conversation.
 *
 * A closed list, not a list of exclusions: a thread about a bachelor's thesis
 * carries chapters, questionnaires and data sets, not executables. The type is
 * derived from the checked extension, not from what the browser declares —
 * `file.type` comes from the client and is not proof.
 */
export const ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'xls', 'xlsx', 'csv', 'ods',
  'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'zip',
] as const

const MIME_TYPES: Record<string, string> = {
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

/** The `accept` attribute of the file field, derived from the same list. */
export const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

export function extensionOf(name: string): string {
  const part = name.split('.').pop()
  return part && part !== name ? part.toLowerCase() : ''
}

export function isAllowedExtension(name: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

/** The type we record, derived from the extension — not from what the client says. */
export function mimeForExtension(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? 'application/octet-stream'
}

export const saveFile = fileStore.save.bind(fileStore)
export const openFile = fileStore.open.bind(fileStore)
