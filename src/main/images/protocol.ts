// The worfy-image:// protocol (worfy-ui ticket 28): the images worfy keeps in its own data folder,
// for the window. The address is worfy-image://<store>[.<machine label>]/<file name>
// (src/shared/images.ts); a store is one folder with one pattern of file names and one size limit,
// found by its name (ImageStoreLocator). Today there is one store, `attachments`: the copies of sent
// images, `<data root>/attachments/images/<sha256>.<ext>` (src/main/agent/attachments.ts,
// storeImages). The images on the Canvas (worfy-canvas ticket 23) are meant to be a second store,
// `<Project data folder>/images/`, under a name of their own; the handler and its checks stay as
// they are.
//
// An address with a machine label is an image of that Linked machine (worfy-canvas ticket 24): its
// bytes come over the link with `images.file` (src/shared/ipc/images.ts), from the second source
// (src/main/images/remote.ts). Only the store name and the file name go there, never a path: the
// Linked machine finds its own store and checks the name and the file as for its own window
// (readImageFileChunk below, on that Machine). What comes back is checked again here: an extension
// served, the one the name asked for, up to the limit. No file is a 404, a file over the limit a
// 413, a Linked machine that did not answer a 502; images.status tells the window which one.
//
// What is served: a file of this Machine whose name matches the store's pattern, read from the
// store's folder itself, never through a symlink — neither the folder, nor the file — and never a
// folder; GET and HEAD only; png, jpeg, gif and webp only, by the name's extension; up to the
// store's limit. Everything else is a 404. The answers carry nosniff, no-store and a CSP that allows nothing, so an
// answer opened as a page runs nothing.
//
// The Evidence store (worfy-evidence ticket 12, src/main/images/stores.ts) is the one that differs, by
// two marks of its own: `nested` — its names are paths of several parts below its folder, `/` between
// them, each part checked, no symlink on any step; `media` — it serves the clips too (webm, mp4,
// EVIDENCE_CONTENT_TYPES), answers a `Range` with 206 and Content-Range so a <video> can seek, and tells
// a file over its limit with a 413, which the window shows as «File over 8 MB». The other stores'
// answers do not change.
//
// The window's CSP opens `img-src` and `media-src` to this scheme ('self' too for images) only
// (src/renderer/index.html). The scheme is standard and secure, like worfy-card://
// (src/main/cards/protocol.ts): its URL has a host, and a page on file:// or on the dev server loads it
// as an image; `stream` lets a <video> read it in ranges.
import { lstat, open, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { protocol, type CustomScheme } from 'electron'
import { FILE_COPY_LIMIT_BYTES, IMAGE_EXTENSIONS, IMAGE_FILE_NAME_PATTERN } from '../../shared/agent/attachments'
import { IMAGE_SCHEME, parseImageHost } from '../../shared/images'
import { IMAGE_FILE_LIMIT_BYTES, IMAGE_STORE_PATTERN, type ImageFileAnswer, type ImageStatus } from '../../shared/ipc/images'
import { readFileChunk, type LinkedFile } from '../link/file-chunks'
import { leadsToRemote, type LinkFs, type PathRules } from '../remote-links'
import { appLinkedImageSource } from './remote'

/** The extensions served, and their content types: those of the stored images. Any other name is a 404. */
export const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(IMAGE_EXTENSIONS).map(([type, ext]) => [`.${ext}`, type]))

/** The extensions the Evidence store serves (`media`): the images', and the clips a test helper records. */
export const EVIDENCE_CONTENT_TYPES: Readonly<Record<string, string>> = { ...IMAGE_CONTENT_TYPES, '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' }

/** The largest sent image served: the largest file worfy copies into its data folder. */
export const ATTACHMENT_IMAGE_LIMIT_BYTES = FILE_COPY_LIMIT_BYTES

/** Headers on every answer, found or not. */
export const IMAGE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

/** The privileges the scheme gets before the app is ready (src/main/schemes.ts). */
export const IMAGE_SCHEME_PRIVILEGES: CustomScheme = { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, stream: true } }

/** One store: its folder, the only names it serves, and the largest file it serves. */
export interface ImageStore {
  dir: string
  names: RegExp
  limit: number
  /** A name is a path of several parts below `dir`, `/` between them; without it a name is one file name. */
  nested?: true
  /** Clips too (EVIDENCE_CONTENT_TYPES), a `Range` answered with 206, a file over the limit a 413. */
  media?: true
}

/** The extensions a store serves, with their content types. */
const typesOf = (store: Pick<ImageStore, 'media'>): Readonly<Record<string, string>> => (store.media ? EVIDENCE_CONTENT_TYPES : IMAGE_CONTENT_TYPES)

/** The store of the images sent in messages, in `dir` (attachmentImagesDir). */
export const attachmentImageStore = (dir: string): ImageStore => ({ dir, names: IMAGE_FILE_NAME_PATTERN, limit: ATTACHMENT_IMAGE_LIMIT_BYTES })

/** The store of this Machine a store name (src/shared/images.ts) names, or null for a name that names none. */
export type ImageStoreLocator = (store: string) => ImageStore | null | Promise<ImageStore | null>

/** What a worfy-image:// URL names: a host, and one file name, decoded. */
export interface ImageAddress {
  host: string
  name: string
}

/** Splits a worfy-image:// URL; null for any other URL, and for a path that is not exactly one file name. */
export function parseImageUrl(url: string): ImageAddress | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (parsed.protocol !== `${IMAGE_SCHEME}:` || parsed.port !== '' || parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') return null
  const segments = parsed.pathname.split('/')
  if (segments.length !== 2 || segments[0] !== '') return null
  let name: string
  try {
    name = decodeURIComponent(segments[1] ?? '')
  } catch {
    return null
  }
  return { host: parsed.hostname, name }
}

/** What resolveImageFile asks of the system; replaced in tests. */
export interface ImageFileOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules & Pick<typeof nativePath, 'basename' | 'extname'>
  /** lstat and readlink for the links on the way to the file (remote-links.ts). */
  links?: LinkFs
  /** realpath; rejects when there is nothing at the path. */
  real?: (path: string) => Promise<string>
  /** The file's size when the path is a file, null otherwise. */
  fileSize?: (path: string) => Promise<number | null>
  /** Reads the file served; rejects when it cannot. */
  read?: (path: string) => Promise<Uint8Array>
  /** Opens a file of a `media` store for reading (fs.open); rejects when it cannot. */
  open?: (path: string) => Promise<MediaFile>
  /** lstat of a path (fs.lstat with `bigint`): the file the name leads to now, by device and inode. */
  lstat?: (path: string, options: { bigint: true }) => Promise<FileIdentity>
}

const fileSizeOf = async (path: string): Promise<number | null> => {
  const info = await stat(path)
  return info.isFile() ? info.size : null
}

/** What findImageFile found: the file and its size, or why there is none to serve. */
export type FoundImageFile = { path: string; size: number } | 'missing' | 'too-large'

/** The parts of a name in a store: one, or for a `nested` store its parts between `/`; null for a part that is empty, `.` or `..`. */
function partsOf(store: Pick<ImageStore, 'nested'>, name: string): string[] | null {
  if (name.includes('\\')) return null
  if (!store.nested) return name.includes('/') ? null : [name]
  const parts = name.split('/')
  // The store's pattern refuses these already; what is served never depends on the pattern alone.
  return parts.some((part) => part === '' || part === '.' || part === '..') ? null : parts
}

/**
 * The file a name stands for in a store, or why there is none to serve. `missing`: the name does not
 * match the store's pattern, has an empty, `.` or `..` part, or an extension the store does not serve
 * (typesOf); the store's folder is a symlink, or a symlink leads to the file on any step below it; the
 * file is missing or a folder. `too-large`: the file is over the store's limit. On Windows the links on
 * the way are read before any realpath, as for a Card (resolveCardFile): realpath of a link to
 * `\\host\share\…` would contact that host.
 */
export async function findImageFile(store: ImageStore, name: string, options: ImageFileOptions = {}): Promise<FoundImageFile> {
  const paths = options.paths ?? nativePath
  const real = options.real ?? realpath
  const fileSize = options.fileSize ?? fileSizeOf
  const parts = store.names.test(name) ? partsOf(store, name) : null
  if (parts === null) return 'missing'
  if (typesOf(store)[paths.extname(name).toLowerCase()] === undefined) return 'missing'
  try {
    if (await leadsToRemote(paths.join(store.dir, ...parts), [paths.dirname(store.dir)], { paths, ...(options.links ? { links: options.links } : {}) })) return 'missing'
    // The store's own folder is not a link: its real path is its parent's real path and its name.
    const realDir = await real(store.dir)
    if (realDir !== paths.join(await real(paths.dirname(store.dir)), paths.basename(store.dir))) return 'missing'
    const candidate = paths.join(realDir, ...parts)
    // Nor is the file, nor a folder on the way to it: what is served is the file of that path in that folder.
    if ((await real(candidate)) !== candidate) return 'missing'
    const size = await fileSize(candidate)
    if (size === null) return 'missing'
    return size > store.limit ? 'too-large' : { path: candidate, size }
  } catch {
    return 'missing'
  }
}

/** The file a name stands for in a store, or null when there is none to serve (findImageFile), a file over the limit included. */
export async function resolveImageFile(store: ImageStore, name: string, options: ImageFileOptions = {}): Promise<string | null> {
  const found = await findImageFile(store, name, options)
  return typeof found === 'string' ? null : found.path
}

/**
 * On the Machine that keeps the image: one piece of it for a Linked machine that shows it
 * (`images.file`, src/main/ipc/images.ts). The file is found and checked as for this Machine's own
 * window (resolveImageFile): `store` null — no store of that name; a name outside the store's
 * pattern, a symlink, a folder or a missing file — `missing`. A file over the store's limit is
 * `too-large` and is not read.
 */
export async function readImageFileChunk(store: ImageStore | null, name: string, offset: number, length: number, options: ImageFileOptions = {}): Promise<ImageFileAnswer> {
  if (store === null) return { status: 'missing' }
  // The limit is told apart from a missing file here: resolveImageFile itself turns both into null.
  const file = await resolveImageFile({ ...store, limit: Number.POSITIVE_INFINITY }, name, options)
  return readFileChunk(file, offset, length, store.limit)
}

/** What the handler asks of the second source: one image of the Linked machine `machineLabel` names. */
export interface LinkedImageRequest {
  machineLabel: string
  store: string
  /** The file name, decoded; the Linked machine checks it against its store's pattern. */
  name: string
  /** HEAD: the size and type are enough, the bytes are not needed. */
  head: boolean
}

/** The second source of images: the stored images of Linked machines (src/main/images/remote.ts). */
export type LinkedImageSource = (request: LinkedImageRequest) => Promise<LinkedFile>

/** What the handler reads of a request: the URL, the method and, for a `media` store, the `Range` header. */
type ImageRequest = Pick<Request, 'url' | 'method'> & { headers?: Pick<Headers, 'get'> }

const plain = (status: number, text: string): Response => new Response(text, { status, headers: { ...IMAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })

const notFound = (): Response => plain(404, 'Not found')

const tooLarge = (): Response => plain(413, `An image is served up to ${IMAGE_FILE_LIMIT_BYTES} bytes`)

/** The answer for an image found, by its extension; the body only for GET. */
function imageResponse(method: string, extension: string, body: Uint8Array): Response {
  const headers = { ...IMAGE_HEADERS, 'Content-Type': IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream' }
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(new Uint8Array(body), { status: 200, headers })
}

/** One range of bytes of a file, both ends included. */
export interface ByteRange {
  start: number
  end: number
}

const RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * The bytes a `Range` header asks of a file of `size` bytes (RFC 9110, 14.1.2): `bytes=a-b`, `bytes=a-`,
 * or the last n, `bytes=-n`; an end past the file stops at its last byte. `unsatisfiable` — the range
 * starts at or past the end, or asks for the last 0 bytes: a 416. null — no header, or one this handler
 * does not read (another unit, several ranges, an end before the start): the whole file, a 200.
 */
export function byteRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header == null ? null : RANGE.exec(header.trim())
  if (match === null) return null
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return null
  if (first === '') {
    const suffix = Number(last)
    return suffix === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(first)
  if (last !== '' && Number(last) < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) }
}

/**
 * What tells one file from another: its device and inode (fs.BigIntStats). Read as bigints: on Windows
 * the NTFS file id has 64 bits and a number keeps 53, so two files made one after the other could get
 * one inode as numbers, and another file put at the path would pass for the one opened (worfy-polish 47).
 */
export interface FileIdentity {
  dev: bigint
  ino: bigint
}

/** An open file of a `media` store: the part of fs/promises' FileHandle the handler uses. */
export interface MediaFile {
  stat(options: { bigint: true }): Promise<FileIdentity & { size: bigint }>
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  close(): Promise<void>
}

const tooLargeMedia = (limit: number): Response => plain(413, `An Evidence file is served up to ${limit} bytes`)

/**
 * The answer of a `media` store for the file findImageFile checked: the whole file with Accept-Ranges, or the
 * range asked for with 206 and Content-Range. The file is opened once, and that descriptor is what is served:
 * its device and inode must be those of the path now (lstat) — a link or another file put at the path since
 * the check is a 404 — its size is the descriptor's, checked against the limit again, and only the bytes of
 * the range are read from it. A file that ends before them (cut since) is a 404.
 */
async function mediaResponse(method: string, extension: string, file: string, limit: number, header: string | null | undefined, options: ImageFileOptions): Promise<Response> {
  let handle: MediaFile
  try {
    handle = await (options.open ?? ((path: string) => open(path, 'r')))(file)
  } catch {
    return notFound()
  }
  try {
    const [opened, named] = await Promise.all([handle.stat({ bigint: true }), (options.lstat ?? lstat)(file, { bigint: true })])
    if (opened.dev !== named.dev || opened.ino !== named.ino) return notFound()
    const size = Number(opened.size)
    if (size > limit) return tooLargeMedia(limit)
    const headers = { ...IMAGE_HEADERS, 'Content-Type': EVIDENCE_CONTENT_TYPES[extension] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }
    const range = byteRange(header, size)
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    const status = range === null ? 200 : 206
    const span = range ?? { start: 0, end: size - 1 }
    const length = Math.max(0, span.end - span.start + 1)
    const rangeHeaders = { ...headers, 'Content-Length': String(length), ...(range === null ? {} : { 'Content-Range': `bytes ${span.start}-${span.end}/${size}` }) }
    if (method === 'HEAD') return new Response(null, { status, headers: rangeHeaders })
    const body = new Uint8Array(length)
    for (let done = 0; done < length; ) {
      const { bytesRead } = await handle.read(body, done, length - done, span.start + done)
      if (bytesRead === 0) return notFound()
      done += bytesRead
    }
    return new Response(body, { status, headers: rangeHeaders })
  } catch {
    return notFound()
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** An image of a Linked machine: its bytes from the second source, checked again on this side. */
async function linkedResponse(method: string, request: Omit<LinkedImageRequest, 'head'>, source: LinkedImageSource | undefined): Promise<Response> {
  const extension = nativePath.extname(request.name).toLowerCase()
  // Asked only for a store and a name that could be served at all: no separator, an image's extension.
  if (source === undefined || !IMAGE_STORE_PATTERN.test(request.store) || /[/\\\0]/.test(request.name) || IMAGE_CONTENT_TYPES[extension] === undefined) return notFound()
  const file = await source({ ...request, head: method === 'HEAD' })
  switch (file.status) {
    case 'unknown-machine':
    case 'missing':
      return notFound()
    case 'too-large':
      return tooLarge()
    case 'unreachable':
      return plain(502, file.reason)
    case 'file':
      // A Linked machine does not choose what this side serves: the type the name asked for, up to the limit.
      if (file.extension !== extension) return notFound()
      if (file.bytes.byteLength > IMAGE_FILE_LIMIT_BYTES) return tooLarge()
      return imageResponse(method, extension, file.bytes)
  }
}

/**
 * The protocol's request handler; Electron gives it to protocol.handle, tests call it directly.
 * `locate` finds the stores of this Machine; `linked`, the second source, the images of Linked
 * machines (an address with a machine label). Without it such an address is a 404.
 */
export function createImageHandler(locate: ImageStoreLocator, options: ImageFileOptions = {}, linked?: LinkedImageSource): (request: ImageRequest) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...IMAGE_HEADERS, Allow: 'GET, HEAD' } })
    }
    const address = parseImageUrl(request.url)
    if (address === null) return notFound()
    const host = parseImageHost(address.host)
    // An image of a Linked machine is in that Machine's data folder: it comes over the link.
    if (host.machineLabel !== null) return linkedResponse(request.method, { machineLabel: host.machineLabel, store: host.store, name: address.name }, linked)
    let store: ImageStore | null
    try {
      store = await locate(host.store)
    } catch {
      return notFound()
    }
    if (store === null) return notFound()
    const found = await findImageFile(store, address.name, options)
    // Only a `media` store tells a file over its limit; for the others it is not there, as before.
    if (found === 'too-large' && store.media) return tooLargeMedia(store.limit)
    if (typeof found === 'string') return notFound()
    const file = found.path
    const extension = nativePath.extname(file).toLowerCase()
    if (store.media) return mediaResponse(request.method, extension, file, store.limit, request.headers?.get('range'), options)
    if (request.method === 'HEAD') return imageResponse('HEAD', extension, new Uint8Array())
    let body: Uint8Array
    try {
      body = await (options.read ?? readFile)(file)
    } catch {
      return notFound()
    }
    return imageResponse(request.method, extension, body)
  }
}

/** What the window's <img> could not tell: why the handler does not serve an address (images.status). */
export async function imageStatus(handler: (request: ImageRequest) => Promise<Response>, url: string): Promise<ImageStatus> {
  const { status } = await handler({ url, method: 'HEAD' })
  if (status === 200) return 'ok'
  if (status === 413) return 'too-large'
  if (status === 502) return 'unreachable'
  return 'missing'
}

/**
 * Serves the protocol: the stores of this Machine from `locate`, the images of Linked machines from
 * the app's link (src/main/images/remote.ts). Runs once, after the app is ready, before the first window.
 */
export function installImageProtocol(locate: ImageStoreLocator): void {
  protocol.handle(IMAGE_SCHEME, createImageHandler(locate, {}, appLinkedImageSource))
}
