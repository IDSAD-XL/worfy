// The stores of the worfy-image:// protocol in the app (src/shared/images.ts): the copies of sent
// images (worfy-ui ticket 28) and the images on each Project's Canvas (worfy-canvas ticket 23,
// src/main/layout/images.ts). One locator serves both this Machine's window (installImageProtocol)
// and a Linked machine that asks for an image over the link (`images.file`, src/main/ipc/images.ts).
import { ATTACHMENT_IMAGES_STORE } from '../../shared/images'
import { attachmentImagesDir } from '../agent/attachments'
import { canvasImageStore } from '../layout/images'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import { attachmentImageStore, type ImageStoreLocator } from './protocol'

/** The store a store name names on this Machine, or null. */
export const appImageStore: ImageStoreLocator = (store) =>
  store === ATTACHMENT_IMAGES_STORE
    ? attachmentImageStore(attachmentImagesDir(dataRoot()))
    : canvasImageStore(store, { ids: () => projectStore().list().map(({ id }) => id), dataDirOf: (id) => projectStore().dataDir(id) })
