// Attachments of a user message (ticket 20): what the renderer hands to main, what main makes of
// it, and the limits both sides check. main reads and copies the files (src/main/agent/attachments.ts);
// the renderer only shows chips and the message of a refused file.
//
// An image (png, jpeg, gif, webp, up to IMAGE_LIMIT_BYTES) goes to Claude Code as an image block of
// the user message. Any other file goes as its path, in a line `Attached files: …` at the end of
// the text. A file outside the Project is first copied into worfy's own data folder (ADR-0005):
// nothing is ever written into the Project's repository.
import { z } from 'zod'

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
const absolutePath = z.string().startsWith('/', 'the path must be absolute')
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

const fileLine = (attachments: readonly Attachment[]): string | null => {
  const paths = attachments.flatMap((each) => (each.kind === 'file' ? [each.path] : []))
  return paths.length === 0 ? null : `Attached files: ${paths.join(', ')}`
}

const joinParts = (parts: readonly (string | null)[]): string => parts.filter((part): part is string => part !== null && part !== '').join('\n\n')

/** The text block of the message: the user's text, then the paths of the attached files. */
export function messageText(text: string, attachments: readonly Attachment[]): string {
  return joinParts([text.trim() === '' ? null : text, fileLine(attachments)])
}

const ATTACHMENT_LINE = /^Attached (files|images): /

/**
 * The user's own text of a message as the transcript shows it (messageLabel): without the
 * `Attached files: …` and `Attached images: …` lines at its end. ↑ in the input field brings back
 * this text; the attachments themselves are not brought back.
 */
export function typedText(label: string): string {
  const parts = label.split('\n\n')
  while (parts.length > 0 && ATTACHMENT_LINE.test(parts.at(-1) ?? '')) parts.pop()
  return parts.join('\n\n')
}

/**
 * How the message shows in the transcript and the queue: its text block, and the names of its
 * images, which go as image blocks rather than text.
 */
export function messageLabel(text: string, attachments: readonly Attachment[]): string {
  const images = attachments.flatMap((each) => (each.kind === 'image' ? [each.name] : []))
  return joinParts([messageText(text, attachments), images.length === 0 ? null : `Attached images: ${images.join(', ')}`])
}
