import { fileStore } from './container'

/**
 * Uploaded files.
 *
 * Bound to whichever `FileStore` implementation `container.ts` chose. Reads
 * return a stream, not a path, so a store backed by object storage would need
 * no change at the call sites.
 */

export { MAX_BYTES } from './adapters/disk-files'

export const saveFile = fileStore.save.bind(fileStore)
export const openFile = fileStore.open.bind(fileStore)
