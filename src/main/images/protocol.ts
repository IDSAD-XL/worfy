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
// The window's CSP opens `img-src` to this scheme and 'self' only (src/renderer/index.html).
// The scheme is standard and secure, like worfy-card:// (src/main/cards/protocol.ts): its URL has a
// host, and a page on file:// or on the dev server loads it as an image.
import { readFile, realpath, stat } from 'node:fs/promises'
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

/** The largest sent image served: the largest file worfy copies into its data folder. */
export const ATTACHMENT_IMAGE_LIMIT_BYTES = FILE_COPY_LIMIT_BYTES

/** Headers on every answer, found or not. */
export const IMAGE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

/** The privileges the scheme gets before the app is ready (src/main/schemes.ts). */
export const IMAGE_SCHEME_PRIVILEGES: CustomScheme = { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }

/** One store: its folder, the only names it serves, and the largest file it serves. */
export interface ImageStore {
  dir: string
  names: RegExp
  limit: number
}

/** The store of the images sent in messages, in `dir` (attachmentImagesDir). */
export const attachmentImageStore = (dir: string): ImageStore => ({ dir, names: IMAGE_FILE_NAME_PATTERN, limit: ATTACHMENT_IMAGE_LIMIT_BYTES })

/** The store of this Machine a store name (src/shared/images.ts) names, or null for a name that names none. */
export type ImageStoreLocator = (store: string) => ImageStore | null

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
}

const fileSizeOf = async (path: string): Promise<number | null> => {
  const info = await stat(path)
  return info.isFile() ? info.size : null
}

/**
 * The file a name stands for in a store, or null when there is none to serve: the name does not
 * match the store's pattern or has an extension not in IMAGE_CONTENT_TYPES; the store's folder is a
 * symlink, or a symlink leads to the file; the file is missing, a folder, or over the store's
 * limit. On Windows the links on the way are read before any realpath, as for a
 * Card (resolveCardFile): realpath of a link to `\\host\share\…` would contact that host.
 */
export async function resolveImageFile(store: ImageStore, name: string, options: ImageFileOptions = {}): Promise<string | null> {
  const paths = options.paths ?? nativePath
  const real = options.real ?? realpath
  const fileSize = options.fileSize ?? fileSizeOf
  if (!store.names.test(name) || name.includes('/') || name.includes('\\')) return null
  if (IMAGE_CONTENT_TYPES[paths.extname(name).toLowerCase()] === undefined) return null
  try {
    if (await leadsToRemote(paths.join(store.dir, name), [paths.dirname(store.dir)], { paths, ...(options.links ? { links: options.links } : {}) })) return null
    // The store's own folder is not a link: its real path is its parent's real path and its name.
    const realDir = await real(store.dir)
    if (realDir !== paths.join(await real(paths.dirname(store.dir)), paths.basename(store.dir))) return null
    const candidate = paths.join(realDir, name)
    // Nor is the file: what is served is the file of that name in that folder.
    if ((await real(candidate)) !== candidate) return null
    const size = await fileSize(candidate)
    if (size === null || size > store.limit) return null
    return candidate
  } catch {
    return null
  }
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

type ImageRequest = Pick<Request, 'url' | 'method'>

const plain = (status: number, text: string): Response => new Response(text, { status, headers: { ...IMAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })

const notFound = (): Response => plain(404, 'Not found')

const tooLarge = (): Response => plain(413, `An image is served up to ${IMAGE_FILE_LIMIT_BYTES} bytes`)

/** The answer for an image found, by its extension; the body only for GET. */
function imageResponse(method: string, extension: string, body: Uint8Array): Response {
  const headers = { ...IMAGE_HEADERS, 'Content-Type': IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream' }
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(new Uint8Array(body), { status: 200, headers })
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
    const store = locate(host.store)
    if (store === null) return notFound()
    const file = await resolveImageFile(store, address.name, options)
    if (file === null) return notFound()
    const extension = nativePath.extname(file).toLowerCase()
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
