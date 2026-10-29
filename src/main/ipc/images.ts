// Handlers of the `images` domain (src/shared/ipc/images.ts): the images worfy keeps, for a window
// of another Machine, and the reason a window's image did not load.
import { imagesFile, imagesStatus } from '../../shared/ipc/images'
import { createImageHandler, imageStatus, readImageFileChunk } from '../images/protocol'
import { appLinkedImageSource } from '../images/remote'
import { appImageStore } from '../images/stores'
import { defineHandler, type HandlerModule } from './index'

/** The protocol's own handler, as installImageProtocol serves it: the status is what the window got. */
const handler = createImageHandler(appImageStore, {}, appLinkedImageSource)

export default [
  // An image of this Machine for a Linked machine that shows it (worfy-canvas ticket 24): found as
  // this Machine's own protocol finds it, by store name and file name; a path never comes over the link.
  defineHandler(imagesFile, ({ store, name, offset, length }) => readImageFileChunk(appImageStore(store), name, offset, length)),
  defineHandler(imagesStatus, ({ url }) => imageStatus(handler, url)),
] satisfies HandlerModule
