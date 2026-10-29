// The second source of the worfy-image:// protocol (worfy-canvas ticket 24): the stored images of
// Linked machines that a window of this Machine shows — the images on the Canvas of a Project of
// that Machine, and the copies of the images sent in its Sessions. Their address carries the machine
// label of the Linked machine (worfy-image://<store>.<machine label>/<name>, src/shared/images.ts);
// this module finds the Linked machine with that label and asks it for the image with `images.file`
// (src/shared/ipc/images.ts), piece by piece, as a Card file comes (src/main/link/file-chunks.ts).
// The Linked machine finds and checks the file itself (readImageFileChunk, src/main/images/protocol.ts).
import { IMAGE_FILE_LIMIT_BYTES } from '../../shared/ipc/images'
import { appLinkFiles, fetchLinkedFile, type LinkedFileDeps } from '../link/file-chunks'
import type { LinkedImageSource } from './protocol'

/** The second source over `deps`; protocol.ts's createImageHandler takes it. */
export function createLinkedImageSource(deps: LinkedFileDeps): LinkedImageSource {
  return (request) =>
    fetchLinkedFile(deps, {
      machineLabel: request.machineLabel,
      channel: 'images.file',
      input: (offset, length) => ({ store: request.store, name: request.name, offset, length }),
      head: request.head,
      limit: IMAGE_FILE_LIMIT_BYTES,
    })
}

/** The app's second source: the Linked machines of the app's link service. */
export const appLinkedImageSource: LinkedImageSource = createLinkedImageSource(appLinkFiles)
