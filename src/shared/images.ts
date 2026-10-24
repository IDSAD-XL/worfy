// The worfy-image:// protocol (worfy-ui ticket 28): how the window shows an image worfy keeps in its
// own data folder (ADR-0005), without base64 over IPC and without data: URLs, which the window's
// CSP keeps closed. main serves it (src/main/images/protocol.ts); this file is the address both
// sides build.
//
// The address is worfy-image://<store>/<file name>. The host names one store, a folder of worfy's
// data with a fixed pattern of file names; main serves only those names, only from that folder:
// - `attachments` — the copies of the images sent in messages, `<data root>/attachments/images/`,
//   named `<sha256>.<ext>` (src/main/agent/attachments.ts).
// A new store (the images on the Canvas, worfy-canvas ticket 23: `<Project data folder>/images/`)
// is a new host, for example `canvas.<project label>` with the project label of worfy-card://
// (src/main/cards/protocol.ts), and a new entry of the store locator in src/main/index.ts.
import { imageFileName, type ImageMediaType } from './agent/attachments'

export const IMAGE_SCHEME = 'worfy-image'

/** The store of the images sent in messages. */
export const ATTACHMENT_IMAGES_HOST = 'attachments'

/** The address of the copy of a sent image. */
export const attachmentImageUrl = (ref: string, mediaType: ImageMediaType): string => `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_HOST}/${imageFileName(ref, mediaType)}`
