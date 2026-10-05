// Attachments of a user message (ticket 20; the shapes and limits are in src/shared/agent/attachments.ts).
//
// attach() checks one thing the user attached and makes it ready to send:
// - an image (png, jpeg, gif, webp — told by its bytes, not its name) up to IMAGE_LIMIT_BYTES
//   (3.75 MB: its base64 data stays within the Messages API's 5 MB) becomes an image block; a
//   bigger one is refused;
// - any other file goes by its path. A file inside the Project (its root or the Session's cwd) keeps
//   its own path, whatever its size: nothing is read or written. A file from outside the Project,
//   and a dropped one whose path the renderer does not know, is copied into
//   `<Project data folder>/attachments/<id>/<name>` (ADR-0005: worfy writes only into its own data
//   folder, never into the Project's repository), up to FILE_COPY_LIMIT_BYTES.
// recheck() checks again, before a message is sent, an attachment the renderer hands back: main
// does not take the renderer's word for what attach() made (ADR-0006).
// userContent() builds the content of the SDK user message from the text and the attachments.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  FILE_COPY_LIMIT_BYTES,
  IMAGE_LIMIT_BYTES,
  fileTooLarge,
  imageTooLarge,
  messageText,
  unsupportedImage,
  type Attachment,
  type AttachmentSource,
  type AttachResult,
  type ImageMediaType,
} from '../../shared/agent/attachments'

/** Where a Session's attachments come from and go to. */
export interface AttachTarget {
  /** Root of the Project the Session works in; null when its cwd is in no Project. */
  projectRoot: string | null
  /** The Session's cwd: a file under it is inside the Project too (a worktree outside the root). */
  cwd: string
  /** Where copies go: `<Project data folder>/attachments`. */
  attachmentsDir: string
}

/** The longest head of a file the image types are told by. */
const HEAD_BYTES = 12

/** The image type of a file, told by its first bytes; null for anything else. */
export function imageTypeOf(head: Uint8Array): ImageMediaType | null {
  const ascii = (from: number, to: number) => Buffer.from(head.subarray(from, to)).toString('latin1')
  if (head.length >= 8 && head[0] === 0x89 && ascii(1, 4) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif'
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

const refuse = (name: string, error: string): AttachResult => ({ ok: false, name, error })

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null)

const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/** The file is inside the Project: under its root or the Session's cwd, links resolved. */
async function insideProject(file: string, target: AttachTarget): Promise<boolean> {
  if (target.projectRoot === null) return false
  const roots = await Promise.all([target.projectRoot, target.cwd].map(realOrNull))
  return roots.some((root) => root !== null && isUnder(file, root))
}

/** A name safe to use as one path segment. */
function safeName(name: string): string {
  const last = basename(name.replaceAll('\\', '/'))
  return last === '' || last === '.' || last === '..' ? 'attachment' : last
}

/** A fresh folder for one copy, so files of one name never overwrite each other. */
async function copyDir(target: AttachTarget): Promise<string> {
  const dir = join(target.attachmentsDir, randomUUID())
  await mkdir(dir, { recursive: true })
  return dir
}

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function image(name: string, mediaType: ImageMediaType, bytes: Buffer): AttachResult {
  return { ok: true, attachment: { kind: 'image', name, mediaType, size: bytes.length, data: bytes.toString('base64') } }
}

async function attachPath(path: string, target: AttachTarget): Promise<AttachResult> {
  const name = safeName(path)
  const info = await stat(path).catch(() => null)
  if (info === null) return refuse(name, `${name} was not found`)
  if (!info.isFile()) return refuse(name, `${name} is not a file`)
  const mediaType = imageTypeOf(await readHead(path))
  if (mediaType !== null) {
    if (info.size > IMAGE_LIMIT_BYTES) return refuse(name, imageTooLarge(name))
    return image(name, mediaType, await readFile(path))
  }
  const real = await realpath(path)
  if (await insideProject(real, target)) return { ok: true, attachment: { kind: 'file', name, path, size: info.size, copied: false } }
  if (info.size > FILE_COPY_LIMIT_BYTES) return refuse(name, fileTooLarge(name))
  const copy = join(await copyDir(target), name)
  await copyFile(real, copy)
  return { ok: true, attachment: { kind: 'file', name, path: copy, size: info.size, copied: true } }
}

async function attachBytes(source: Extract<AttachmentSource, { kind: 'pasted' | 'dropped' }>, target: AttachTarget): Promise<AttachResult> {
  const name = safeName(source.name)
  const bytes = Buffer.from(source.data, 'base64')
  const mediaType = imageTypeOf(bytes.subarray(0, HEAD_BYTES))
  if (mediaType !== null) {
    if (bytes.length > IMAGE_LIMIT_BYTES) return refuse(name, imageTooLarge(name))
    return image(name, mediaType, bytes)
  }
  if (source.kind === 'pasted') return refuse(name, unsupportedImage(name))
  if (bytes.length > FILE_COPY_LIMIT_BYTES) return refuse(name, fileTooLarge(name))
  const copy = join(await copyDir(target), name)
  await writeFile(copy, bytes)
  return { ok: true, attachment: { kind: 'file', name, path: copy, size: bytes.length, copied: true } }
}

/** Checks one attachment and makes it ready to send; a refused one says why, and nothing is written for it. */
export async function attach(source: AttachmentSource, target: AttachTarget): Promise<AttachResult> {
  try {
    return source.kind === 'path' ? await attachPath(source.path, target) : await attachBytes(source, target)
  } catch (error) {
    const name = safeName(source.kind === 'path' ? source.path : source.name)
    return refuse(name, `${name} could not be attached: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Why an attachment handed back for sending was refused. */
const notAttached = (name: string, why: string): Error => new Error(`${name} cannot be sent: ${why}`)

/**
 * Checks once more an attachment the renderer hands back with a message, and rebuilds it from what
 * main sees itself: an image's type and size from its bytes, a file's size from the disk. A file
 * must be one attach() could have given: a copy in the attachments folder, or a file inside the
 * Project. Throws when it is not.
 */
export async function recheck(attachment: Attachment, target: AttachTarget): Promise<Attachment> {
  const name = safeName(attachment.name)
  if (attachment.kind === 'image') {
    const bytes = Buffer.from(attachment.data, 'base64')
    // Only the base64 main itself writes: Buffer.from skips what it cannot read.
    if (bytes.toString('base64') !== attachment.data) throw notAttached(name, 'its data is not base64')
    const mediaType = imageTypeOf(bytes.subarray(0, HEAD_BYTES))
    if (mediaType === null || mediaType !== attachment.mediaType) throw notAttached(name, `it is not ${attachment.mediaType}`)
    if (bytes.length > IMAGE_LIMIT_BYTES) throw new Error(imageTooLarge(name))
    return { kind: 'image', name, mediaType, size: bytes.length, data: attachment.data }
  }
  const real = await realOrNull(attachment.path)
  const info = real === null ? null : await stat(real).catch(() => null)
  if (real === null || info === null) throw notAttached(name, `${attachment.path} was not found`)
  if (!info.isFile()) throw notAttached(name, `${attachment.path} is not a file`)
  if (attachment.copied) {
    const copies = await realOrNull(target.attachmentsDir)
    if (copies === null || !isUnder(real, copies)) throw notAttached(name, `${attachment.path} is not a copy worfy made`)
  } else if (!(await insideProject(real, target))) throw notAttached(name, `${attachment.path} is outside the Project`)
  return { kind: 'file', name, path: attachment.path, size: info.size, copied: attachment.copied }
}

/** The content of the SDK user message: the text alone, or the images first and then the text. */
export function userContent(text: string, attachments: readonly Attachment[]): SDKUserMessage['message']['content'] {
  const body = messageText(text, attachments)
  const images = attachments.flatMap((each) => (each.kind === 'image' ? [each] : []))
  if (images.length === 0) return body
  return [
    ...images.map((each) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: each.mediaType, data: each.data } })),
    ...(body === '' ? [] : [{ type: 'text' as const, text: body }]),
  ]
}
