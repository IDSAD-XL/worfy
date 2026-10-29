// The `images` domain: the images worfy keeps in its own data folder (src/shared/images.ts) when a
// window of another Machine shows them. Handled in src/main/ipc/images.ts (ADR-0006).
//
// `images.file` carries an image of this Machine to a Linked machine whose window shows it at
// worfy-image://<store>.<machine label>/<name> (src/main/images/remote.ts). It works as `cards.file`
// does (src/shared/ipc/cards.ts): the same pieces of at most 4 MB, the same 20 MB limit, the same
// answers. Only a store name and a file name go over the link, never a path: the Machine that keeps
// the image finds the store's folder itself and serves only the names of the store's own pattern
// from it (readImageFileChunk, src/main/images/protocol.ts).
//
// `images.status` tells a window why an image did not load: the window's <img> only learns that it
// failed. It stays on the window's own Machine, whose main serves the address.
import { z } from 'zod'
import { ATTACHMENT_IMAGES_STORE, CANVAS_IMAGES_STORE, IMAGE_SCHEME } from '../images'
import { CARD_FILE_CHUNK_BYTES, CARD_FILE_LIMIT_BYTES, cardFileAnswerSchema } from './cards'
import { invokeChannel } from './channels'

/** The largest image a Linked machine sends: as large as a Card file, the largest file worfy carries anywhere. */
export const IMAGE_FILE_LIMIT_BYTES = CARD_FILE_LIMIT_BYTES

/** The most bytes of an image one `images.file` answer carries, as for a Card file. */
export const IMAGE_FILE_CHUNK_BYTES = CARD_FILE_CHUNK_BYTES

/** The store names a Linked machine may ask for: the copies of sent images, or the Canvas images of one Project. */
export const IMAGE_STORE_PATTERN = new RegExp(`^(?:${ATTACHMENT_IMAGES_STORE}|${CANVAS_IMAGES_STORE}\\.[0-9a-f]{8})$`)

/** One piece of an image, as a piece of a Card file: `file`, `missing` or `too-large`. */
export const imageFileAnswerSchema = cardFileAnswerSchema
export type ImageFileAnswer = z.output<typeof imageFileAnswerSchema>

/**
 * A stored image of this Machine, for a window of a Linked machine that shows it: `length` bytes
 * from `offset` on, at most IMAGE_FILE_CHUNK_BYTES. `name` is the file name, decoded; this Machine
 * serves it only when it matches the store's pattern of names.
 */
export const imagesFile = invokeChannel(
  'images.file',
  z.object({
    store: z.string().regex(IMAGE_STORE_PATTERN),
    name: z.string().min(1).max(255),
    offset: z.number().int().nonnegative().default(0),
    length: z.number().int().nonnegative().max(IMAGE_FILE_CHUNK_BYTES).default(IMAGE_FILE_CHUNK_BYTES),
  }),
  imageFileAnswerSchema,
  'project',
  'read',
)

/**
 * Why an image does not show: `ok` — main serves it (the bytes did not decode); `missing` — no
 * such image, or not one main serves; `too-large` — over the limit; `unreachable` — the Linked
 * machine that keeps it did not answer.
 */
export const imageStatusSchema = z.enum(['ok', 'missing', 'too-large', 'unreachable'])
export type ImageStatus = z.output<typeof imageStatusSchema>

/** What main answers now to a worfy-image:// address of the window (a HEAD request, no bytes). */
export const imagesStatus = invokeChannel(
  'images.status',
  z.object({ url: z.string().max(4096).startsWith(`${IMAGE_SCHEME}://`) }),
  imageStatusSchema,
  'local',
)

declare module './channels' {
  interface IpcContract {
    'images.file': typeof imagesFile
    'images.status': typeof imagesStatus
  }
}
