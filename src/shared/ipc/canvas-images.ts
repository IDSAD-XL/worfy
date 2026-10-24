// The `canvasImage` domain (worfy-canvas ticket 23): an image the user pastes or drops on the Canvas
// becomes a Node of kind `image`. Its bytes live in one file per image in the Project's data folder,
// `<Project data folder>/images/<id>.<ext>` — worfy's own data, on this machine only, never the
// Project's repository (ADR-0005; confirmed by the owner 2026-10-25). The Layout keeps only what
// the Node needs to show it: `data: { file, width, height, mime }`.
//
// The renderer reads the bytes and hands them to main; main checks the size and the type by the
// first bytes (never by the name), reads the natural size from the image's own header, picks the
// file name itself and writes the file (src/main/layout/images.ts). The renderer then creates the
// Node with the answer, through the Layout like any other gesture, so ⌘Z undoes it.
import { z } from 'zod'
import { base64Length, FILE_COPY_LIMIT_BYTES, IMAGE_MEDIA_TYPES, imageMediaTypeSchema, type ImageMediaType } from '../agent/attachments'
import { invokeChannel } from './channels'

/** The kind of the Nodes that show an image. */
export const IMAGE_NODE_KIND = 'image'

/** The folder of a Project's images, inside its data folder. */
export const IMAGES_DIR = 'images'

/** The largest image the Canvas takes: the largest file worfy copies into its data folder for a message. */
export const CANVAS_IMAGE_LIMIT_BYTES = FILE_COPY_LIMIT_BYTES

/** The types the Canvas shows; svg is refused (it is XML, and may carry scripts). */
export const CANVAS_IMAGE_TYPES = IMAGE_MEDIA_TYPES

/** The extension of an image file by its type. */
export const IMAGE_EXTENSIONS: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * The name of an image file: 32 hex digits main chose, and the extension of its type. The pattern
 * keeps a name from reaching any other folder (no separators, no dots but the one).
 */
export const IMAGE_FILE_PATTERN = /^[0-9a-f]{32}\.(?:png|jpg|gif|webp)$/

const MB = 1024 * 1024
const megabytes = (bytes: number): string => `${Math.floor((bytes / MB) * 100) / 100} MB`

export const canvasImageTooLarge = (name: string): string => `${name} is too large: images on the canvas go up to ${megabytes(CANVAS_IMAGE_LIMIT_BYTES)}`
export const svgNotSupported = (name: string): string => `${name} is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP`
export const notAnImage = (name: string): string => `${name} is not a supported image: use a PNG, JPEG, GIF or WebP`
export const unreadableImage = (name: string): string => `${name} could not be read as an image`

/** The data of an `image` Node in the Layout. */
export const imageNodeDataSchema = z.object({
  file: z.string().regex(IMAGE_FILE_PATTERN),
  /** The natural size of the image, in pixels. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: imageMediaTypeSchema,
})
export type ImageNodeData = z.output<typeof imageNodeDataSchema>

const projectId = z.string().min(1)
const name = z.string().min(1).max(255)
const data = z
  .string()
  .max(base64Length(CANVAS_IMAGE_LIMIT_BYTES))
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'the data must be base64')

/** main's answer: the stored image, or why it was refused (nothing was written then). */
export const canvasImageResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), image: imageNodeDataSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type CanvasImageResult = z.output<typeof canvasImageResultSchema>

/** Stores the bytes of one image in the Project's data folder; `name` is only for the messages. */
export const canvasImageAdd = invokeChannel('canvasImage.add', z.object({ projectId, name, data }), canvasImageResultSchema, 'project', 'write')

declare module './channels' {
  interface IpcContract {
    'canvasImage.add': typeof canvasImageAdd
  }
}
