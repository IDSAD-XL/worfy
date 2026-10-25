// Attachments of a user message (ticket 20): what the renderer hands to main, what main makes of
// it, and the limits both sides check. main reads and copies the files (src/main/agent/attachments.ts);
// the renderer only shows chips and the message of a refused file.
//
// An image (png, jpeg, gif, webp, up to IMAGE_LIMIT_BYTES) goes to Claude Code as an image block of
// the user message, and its name in a line `Attached images: …` at the end of the text. Any other
// file goes as its path, in a line `Attached files: …` before it. A file outside the Project is first copied into worfy's own data folder (ADR-0005):
// nothing is ever written into the Project's repository.
import { z } from 'zod'
import { absolutePathSchema } from '../paths'

/** The image types the Messages API takes in an image block. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const imageMediaTypeSchema = z.enum(IMAGE_MEDIA_TYPES)
export type ImageMediaType = z.infer<typeof imageMediaTypeSchema>

const MB = 1024 * 1024

/** The length of `bytes` bytes in base64. */
export const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4

/** The Messages API limits an image block by its base64 data: 5 MB of base64 text. */
export const IMAGE_BASE64_LIMIT = 5 * MB
/**
 * The largest image, in bytes, whose base64 data stays within IMAGE_BASE64_LIMIT: 3.75 MB. Claude
 * Code itself aims raw images at the same size (its `targetRawSize`).
 */
export const IMAGE_LIMIT_BYTES = (IMAGE_BASE64_LIMIT / 4) * 3
/** The largest file worfy carries or copies into its data folder; a file inside the Project goes by its path at any size. */
export const FILE_COPY_LIMIT_BYTES = 20 * MB
/** The most attachments one message takes. */
export const MAX_ATTACHMENTS = 20

// Rounded down, so that the size named is never above the limit.
const megabytes = (bytes: number): string => `${Math.floor((bytes / MB) * 100) / 100} MB`

export const imageTooLarge = (name: string): string => `${name} is too large: images go up to ${megabytes(IMAGE_LIMIT_BYTES)}`
export const fileTooLarge = (name: string): string => `${name} is too large: files from outside the Project go up to ${megabytes(FILE_COPY_LIMIT_BYTES)}`
export const tooManyAttachments = (names: readonly string[]): string => `A message takes up to ${MAX_ATTACHMENTS} attachments: ${names.join(', ')} left out`
export const unsupportedImage = (name: string): string => `${name} is not a supported image: paste a PNG, JPEG, GIF or WebP`

const name = z.string().min(1).max(255)
const absolutePath = absolutePathSchema
const base64 = (bytes: number) =>
  z
    .string()
    .max(base64Length(bytes))
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'the data must be base64')

/** An attachment main has checked, ready to go with a message. */
export const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), name, mediaType: imageMediaTypeSchema, size: z.number().int().nonnegative().max(IMAGE_LIMIT_BYTES), data: base64(IMAGE_LIMIT_BYTES) }),
  z.object({
    kind: z.literal('file'),
    name,
    /** The file Claude Code reads: the user's own, or worfy's copy of it. */
    path: absolutePath,
    size: z.number().int().nonnegative(),
    /** The file came from outside the Project and `path` is worfy's copy. */
    copied: z.boolean(),
  }),
])
export type Attachment = z.output<typeof attachmentSchema>

/** What the user attached, as the renderer has it. */
export const attachmentSourceSchema = z.discriminatedUnion('kind', [
  /** A file on disk: picked with "+" (main's own dialog gives the path). */
  z.object({ kind: z.literal('path'), path: absolutePath }),
  /** An image pasted from the clipboard: only images are taken. */
  z.object({ kind: z.literal('pasted'), name, data: base64(FILE_COPY_LIMIT_BYTES) }),
  /**
   * A file dropped on the input field. The renderer has its bytes but not its path (the preload
   * bridge stays channel-agnostic, ADR-0006): an image becomes an image block, anything else a
   * copy in worfy's data folder.
   */
  z.object({ kind: z.literal('dropped'), name, data: base64(FILE_COPY_LIMIT_BYTES) }),
])
export type AttachmentSource = z.output<typeof attachmentSourceSchema>

/** main's answer for one source: the attachment, or why it was refused. */
export const attachResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), attachment: attachmentSchema }),
  z.object({ ok: z.literal(false), name: z.string(), error: z.string() }),
])
export type AttachResult = z.output<typeof attachResultSchema>

// ── how a sent message shows its attachments (worfy-ui ticket 28) ─────────────────────────────

/** The file extension each image type is stored under: the copy `<sha256>.<ext>` main keeps of a sent image. */
export const IMAGE_EXTENSIONS: Readonly<Record<ImageMediaType, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** The file name of main's copy of an image: `<sha256>.<ext>`. */
export const imageFileName = (ref: string, mediaType: ImageMediaType): string => `${ref}.${IMAGE_EXTENSIONS[mediaType]}`

const IMAGE_REF = '[0-9a-f]{64}'

/** The sha256 of an image's bytes in lower-case hex: the name of main's copy of it, without the extension. */
export const IMAGE_REF_PATTERN = new RegExp(`^${IMAGE_REF}$`)

/** The name of main's copy of an image, imageFileName: `<sha256>.<ext>` with an extension of IMAGE_EXTENSIONS. */
export const IMAGE_FILE_NAME_PATTERN = new RegExp(`^${IMAGE_REF}\\.(?:${Object.values(IMAGE_EXTENSIONS).join('|')})$`)

/**
 * An attachment as a sent message shows it: no path and no bytes. An image is named by `ref`, the
 * sha256 of its bytes (the copy main keeps, src/main/agent/attachments.ts); null when there is no
 * copy to show. A file has its name, its extension (lower case, without the dot; '' when none) and,
 * when known, its size.
 */
export const messageAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), name: z.string(), mediaType: imageMediaTypeSchema, ref: z.string().regex(IMAGE_REF_PATTERN).nullable() }),
  z.object({ kind: z.literal('file'), name: z.string(), ext: z.string().max(32), size: z.number().int().nonnegative().optional() }),
])
export type MessageAttachment = z.output<typeof messageAttachmentSchema>

/** The last segment of a path, `/` and `\` alike: a path from either platform. */
export const baseName = (path: string): string => path.split(/[\\/]/).at(-1) ?? path

/** The extension of a file name, lower case, without the dot; '' when it has none (`Makefile`, `.env`). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** A file attachment as a sent message shows it: by its name, never its path. */
export const shownFile = (name: string, size?: number): MessageAttachment => ({ kind: 'file', name, ext: fileExtension(name), ...(size === undefined ? {} : { size }) })

const FILES_LINE = 'Attached files: '
const IMAGES_LINE = 'Attached images: '
/** Paths and names in the lines are joined with this. */
const LIST_SEPARATOR = ', '

const fileLine = (attachments: readonly Attachment[]): string | null => {
  const paths = attachments.flatMap((each) => (each.kind === 'file' ? [each.path] : []))
  return paths.length === 0 ? null : `${FILES_LINE}${paths.join(LIST_SEPARATOR)}`
}

const imageLine = (attachments: readonly Attachment[]): string | null => {
  const names = attachments.flatMap((each) => (each.kind === 'image' ? [each.name] : []))
  return names.length === 0 ? null : `${IMAGES_LINE}${names.join(LIST_SEPARATOR)}`
}

const joinParts = (parts: readonly (string | null)[]): string => parts.filter((part): part is string => part !== null && part !== '').join('\n\n')

/**
 * The text block of the message: the user's text, then the paths of the attached files (Claude
 * Code reads them), then the names of the images, which go as image blocks of their own. The
 * transcript Claude Code writes keeps this text, so a restart finds the names again
 * (src/shared/transcript/parse.ts).
 */
export function messageText(text: string, attachments: readonly Attachment[]): string {
  return joinParts([text.trim() === '' ? null : text, fileLine(attachments), imageLine(attachments)])
}

/** The text of a message as the user typed it, its attachment lines split off. */
export interface AttachmentLines {
  /** What the user typed. */
  typed: string
  /** The paths of the `Attached files: …` line, in order. */
  files: string[]
  /** The names of the `Attached images: …` line, in order. */
  images: string[]
}

/** A path as messageText writes it: absolute — from the root, from a Windows drive letter, or a Windows network path. */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

/**
 * Splits a message's text (messageText) into what the user typed and its attachment lines: the
 * `Attached files: …` and `Attached images: …` paragraphs at its end, as messageText writes them.
 * A paragraph that only starts the same way in the middle of the text is the user's own, and so is
 * a files line with a path that is not absolute, and, when `imageCount` is given (the image blocks
 * of the message), an images line that names another number of images.
 */
// shortcut: a path or a name that holds ", " splits in two here, redo when such a chip shows up or the lines get a format that can be read back unambiguously.
export function attachmentLines(text: string, imageCount?: number): AttachmentLines {
  const parts = text.split('\n\n')
  // The last paragraph, when it is the line `prefix` starts and its list `fits`; nothing otherwise.
  const take = (prefix: string, fits: (list: readonly string[]) => boolean): string[] => {
    const last = parts.at(-1)
    if (last === undefined || !last.startsWith(prefix) || last.length === prefix.length) return []
    const list = last.slice(prefix.length).split(LIST_SEPARATOR)
    if (!fits(list)) return []
    parts.pop()
    return list
  }
  // messageText writes the files first, the images last.
  const images = take(IMAGES_LINE, (names) => imageCount === undefined || names.length === imageCount)
  const files = take(FILES_LINE, (paths) => paths.every((path) => ABSOLUTE_PATH.test(path)))
  return { typed: parts.join('\n\n'), files, images }
}

/**
 * The user's own text of a message as the transcript shows it: without the `Attached files: …` and
 * `Attached images: …` lines at its end. ↑ in the input field brings back this text; the
 * attachments themselves are not brought back.
 */
export function typedText(label: string): string {
  return attachmentLines(label).typed
}
