// The images on a Project's Canvas (worfy-canvas ticket 23; the shapes are in
// src/shared/ipc/canvas-images.ts): one file per image, `<Project data folder>/images/<id>.<ext>`,
// inside worfy's own data folder (ADR-0005). Every path here is built from the Project's data
// folder and a name main chose itself (IMAGE_FILE_PATTERN): a name from the user never becomes a
// path.
//
// storeImage() takes the bytes the renderer read. It refuses, writing nothing, an image over
// CANVAS_IMAGE_LIMIT_BYTES, anything whose first bytes are not png, jpeg, gif or webp (an svg gets
// its own message), and an image whose header tells no size. The natural size comes from the
// image's own header, so the Layout never takes the renderer's word for it.
//
// The window shows an image through worfy-image://canvas.<project label>/<file>
// (src/shared/images.ts): canvasImageStore() is that store for the protocol's locator, which serves
// only names of IMAGE_FILE_PATTERN from the Project's images folder, up to CANVAS_IMAGE_LIMIT_BYTES.
//
// A file leaves the folder with its Node when the Node goes to the trash (trash.ts). ⌘Z of the
// paste removes the Node but keeps the file, which ⇧⌘Z needs again; sweepImages(), run when the
// app starts, deletes the files no Node of the Layout shows any more.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IMAGE_EXTENSIONS, type ImageMediaType } from '../../shared/agent/attachments'
import {
  CANVAS_IMAGE_LIMIT_BYTES,
  canvasImageTooLarge,
  IMAGE_FILE_PATTERN,
  IMAGE_NODE_KIND,
  IMAGES_DIR,
  notAnImage,
  svgNotSupported,
  unreadableImage,
  type CanvasImageResult,
} from '../../shared/ipc/canvas-images'
import { canvasImagesStore } from '../../shared/images'
import type { LayoutNode } from '../../shared/layout/types'
import { imageTypeOf } from '../agent/attachments'
import type { ImageStore } from '../images/protocol'
import { removeFile } from '../storage/remove'

/** The folder of a Project's images. */
export const imagesDirOf = (dataDir: string): string => join(dataDir, IMAGES_DIR)

/** The Projects canvasImageStore() looks through: the ids in worfy's list and their data folders. */
export interface CanvasImageProjects {
  ids: () => readonly string[]
  dataDirOf: (projectId: string) => string
}

/**
 * The store a store name of the worfy-image:// protocol names when it is `canvas.<project label>`
 * of exactly one Project in the list: that Project's images folder. Null for any other name.
 */
export function canvasImageStore(store: string, projects: CanvasImageProjects): ImageStore | null {
  const matches = projects.ids().filter((id) => canvasImagesStore(id) === store)
  if (matches.length !== 1) return null
  return { dir: imagesDirOf(projects.dataDirOf(matches[0]!)), names: IMAGE_FILE_PATTERN, limit: CANVAS_IMAGE_LIMIT_BYTES }
}

/** The image file a Node shows: `data.file` of an `image` Node when it is a name main could have chosen; null otherwise. */
export function imageFileOf(node: Pick<LayoutNode, 'kind' | 'data'>): string | null {
  if (node.kind !== IMAGE_NODE_KIND) return null
  const file = node.data.file
  return typeof file === 'string' && IMAGE_FILE_PATTERN.test(file) ? file : null
}

/** An svg: XML text whose first element is <svg>, after an optional byte order mark (trimStart takes it), declaration, comments or doctype. */
export function isSvg(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes.subarray(0, 4096)).toString('utf8').trimStart().toLowerCase()
  return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*<svg[\s>]/.test(text)
}

interface Size {
  width: number
  height: number
}

const positive = (size: Size): Size | null => (size.width > 0 && size.height > 0 ? size : null)

/** The size a JPEG's first frame header (SOF0–SOF15 but DHT, JPG and DAC) gives. */
function jpegSize(bytes: Buffer): Size | null {
  let at = 2
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]!
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1
      continue
    }
    const length = bytes.readUInt16BE(at + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return positive({ height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) })
    }
    at += 2 + length
  }
  return null
}

/** The size a WebP's first chunk gives: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(bytes: Buffer): Size | null {
  if (bytes.length < 30) return null
  const chunk = bytes.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') return positive({ width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff })
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!]
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
  }
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  return null
}

/**
 * The natural size of an image of a known type, from its header; null when the header is cut short
 * or tells no size.
 * shortcut: the stored size of a JPEG ignores its EXIF orientation, so a photo taken sideways starts
 * with width and height swapped (the image itself is never stretched: object-fit contain); read the
 * orientation tag when photos from a phone become a common paste.
 */
export function imageSizeOf(bytes: Buffer, mime: ImageMediaType): Size | null {
  try {
    if (mime === 'image/png') return bytes.length >= 24 ? positive({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }) : null
    if (mime === 'image/gif') return bytes.length >= 10 ? positive({ width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }) : null
    if (mime === 'image/jpeg') return jpegSize(bytes)
    return webpSize(bytes)
  } catch {
    // A length that runs past the end of a cut-short file.
    return null
  }
}

/** What storeImage() asks of the system; replaced in tests. */
export interface ImageWriteOptions {
  /** A new file id: 32 hex digits. */
  newId?: () => string
}

/**
 * Checks the bytes of one image and writes them to `<dataDir>/images/<id>.<ext>`. `name` is the
 * user's name for the file, used only in the messages. A refused image writes nothing.
 */
export function storeImage(dataDir: string, name: string, data: string, options: ImageWriteOptions = {}): CanvasImageResult {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > CANVAS_IMAGE_LIMIT_BYTES) return { ok: false, error: canvasImageTooLarge(name) }
  const mime = imageTypeOf(bytes.subarray(0, 12))
  if (mime === null) return { ok: false, error: isSvg(bytes) ? svgNotSupported(name) : notAnImage(name) }
  const size = imageSizeOf(bytes, mime)
  if (size === null) return { ok: false, error: unreadableImage(name) }
  const file = `${(options.newId ?? (() => randomBytes(16).toString('hex')))()}.${IMAGE_EXTENSIONS[mime]}`
  if (!IMAGE_FILE_PATTERN.test(file)) throw new Error(`${file} is not an image file name`)
  const dir = imagesDirOf(dataDir)
  mkdirSync(dir, { recursive: true })
  // `wx`: a file of that name is never overwritten.
  writeFileSync(join(dir, file), bytes, { flag: 'wx' })
  return { ok: true, image: { file, width: size.width, height: size.height, mime } }
}

/** How long a file stays safe from the sweep after it was written: a paste may be waiting for its Node. */
export const SWEEP_GRACE_MS = 10 * 60 * 1000

/** What sweepImages() asks of the system; replaced in tests. */
export interface SweepOptions {
  now?: () => number
  remove?: (path: string) => void
}

/**
 * Deletes the image files of the folder that no Node of `nodes` shows, older than SWEEP_GRACE_MS,
 * and returns their names. Only names main itself chooses (IMAGE_FILE_PATTERN) are looked at.
 * `layoutTrusted` false — the Layout was not read from a sound layout.json (none yet, or one set
 * aside as unreadable, which the user may still restore): nothing is deleted.
 */
export function sweepImages(dataDir: string, nodes: readonly Pick<LayoutNode, 'kind' | 'data'>[], layoutTrusted: boolean, options: SweepOptions = {}): string[] {
  if (!layoutTrusted) return []
  const dir = imagesDirOf(dataDir)
  if (!existsSync(dir)) return []
  const shown = new Set(nodes.flatMap((node) => imageFileOf(node) ?? []))
  const oldest = (options.now ?? Date.now)() - SWEEP_GRACE_MS
  const remove = options.remove ?? ((path: string) => removeFile(path))
  const removed: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !IMAGE_FILE_PATTERN.test(entry.name) || shown.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (statSync(path).mtimeMs >= oldest) continue
    remove(path)
    removed.push(entry.name)
  }
  return removed
}
