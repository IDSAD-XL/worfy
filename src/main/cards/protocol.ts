// The worfy-card:// protocol: how a Card (CONTEXT.md, "Card") reaches the window, and the
// walls around it.
//
// A Card is a folder <Project data folder>/cards/<id>/ (ADR-0003, ADR-0005) with an index.html and
// whatever files it needs. Its address is worfy-card://<card id>.<project label>/<path>, where the
// project label is the hash that ends the Project's id (projectIdHash, src/main/projects/store.ts):
// the folder-name part of a Project id may hold capitals, spaces or non-ASCII letters, which a host
// name cannot carry unchanged. The scheme is registered as standard and secure, so every Card has
// an origin of its own: one Card cannot reach another, nor the worfy window, which is on file://
// (or the dev server). The Node shows it in an iframe with sandbox="allow-scripts allow-same-origin"
// (src/renderer/canvas/nodes/CardNode.tsx); "same origin" there is the Card's own origin.
//
// What is served: only regular files inside the Card's folder (after resolving symlinks), with an
// extension from CARD_CONTENT_TYPES, with the CSP below, nosniff and no-store. Everything else is a
// 404 with the same headers. Which navigations a Card frame may make is decided here
// (allowFrameNavigation); the handlers that enforce it, refuse new windows and refuse web
// permissions belong to the app as a whole (installWebPolicy, src/main/window.ts).
//
// Every HTML file a Card serves gets the Card API runtime (src/card-runtime/worfy-card.ts) as an
// inline script at the start of its <head>, before the Card's own scripts: that is how a Card gets
// window.worfy (ticket 26). The file on disk is not changed.
//
// A Card of a Linked machine M (worfy-link ticket 10; ADR-0052, ADR-0053) is shown in a window of
// this Machine at worfy-card://<card id>.<project label>.<machine label>/<path>, where the machine
// label names M (machineLabel, src/shared/cards/bridge.ts). Its origin is not the origin of any Card
// of this Machine, even one with the same card id and project label. The Cards of one Project of M
// share the site <project label>.<machine label>, but they cannot meet there through
// `document.domain`: a sandboxed iframe (CARD_SANDBOX, CardNode.tsx) may not set it at all, whatever
// its allow- keywords. (The header Origin-Agent-Cluster, which would forbid it too, makes Electron
// 44 close the window that loads such a frame.) Its files come from M through
// the second source of the handler (src/main/cards/remote.ts): M finds and checks the file
// (readCardFileChunk below, on M) and sends its bytes; this Machine's main puts its own runtime into
// the HTML, since the runtime must match the bridge of the window that shows the Card.
import { open, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { extname } from 'node:path'
import { protocol } from 'electron'
import { installWorfyCard } from '../../card-runtime/worfy-card'
import { MACHINE_LABEL_PATTERN } from '../../shared/cards/bridge'
import { CARD_FILE_CHUNK_BYTES, CARD_FILE_LIMIT_BYTES, CARD_ID_PATTERN, type CardFileAnswer } from '../../shared/ipc/cards'
import { isProjectIdHash, projectIdHash } from '../projects/store'
import { leadsToRemote, type LinkFs, type PathRules } from '../remote-links'
import { appLinkedCardSource } from './remote'

export const CARD_SCHEME = 'worfy-card'

/**
 * The Content-Security-Policy of every Card response. Scripts and styles only from the Card itself
 * (inline allowed: a Card is often one HTML file), images and fonts also from https and data:,
 * network only to https, no frames, forms, plugins or <base>.
 */
export const CARD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  'connect-src https:',
  "frame-src 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

/** Headers on every answer of the protocol, found or not. */
export const CARD_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CARD_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

/** The extensions a Card may serve, and their content types. Any other file is a 404. */
export const CARD_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * The Card API runtime as a script: installWorfyCard's own source, called on the Card's window.
 * The function is self-contained (src/card-runtime/worfy-card.ts), so its text runs as it is.
 */
export const CARD_RUNTIME_SCRIPT = `(${installWorfyCard.toString()})(window);`

if (/<\/script/i.test(CARD_RUNTIME_SCRIPT)) throw new Error('the Card runtime must not contain a closing script tag')

const RUNTIME_TAG = `<script data-worfy-runtime>${CARD_RUNTIME_SCRIPT}</script>`

/**
 * An HTML document with the runtime at the start of its <head>: right after the <head> tag, else
 * after <html>, else after the doctype, else at the very start. The browser puts a script found
 * before <head> into the head it makes, so the runtime runs first whichever way the Card is written.
 */
export function injectCardRuntime(html: string): string {
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(html)
    if (match) {
      const end = match.index + match[0].length
      return html.slice(0, end) + RUNTIME_TAG + html.slice(end)
    }
  }
  return RUNTIME_TAG + html
}

/** The host part that names a Project: the hash that ends its id (src/main/projects/store.ts), or null when the id has none. */
export function projectLabel(projectId: string): string | null {
  return projectIdHash(projectId)
}

/** The address of a file of a Card; `path` is relative to the Card's folder. */
export function cardUrl(projectId: string, cardId: string, path = 'index.html'): string {
  const label = projectLabel(projectId)
  if (label === null) throw new Error(`Project id ${projectId} does not end with -<8 hex characters>`)
  if (!CARD_ID_PATTERN.test(cardId)) throw new Error(`${cardId} is not a valid Card id`)
  return `${CARD_SCHEME}://${cardId}.${label}/${path.replace(/^\/+/, '')}`
}

/** Which Card an address names. */
export interface CardHost {
  cardId: string
  projectLabel: string
  /** Set for a Card of a Linked machine: the label of that Machine. Absent for a Card of this one. */
  machineLabel?: string
}

export interface CardAddress extends CardHost {
  /** The path of the URL, still percent-encoded. */
  pathname: string
}

/**
 * Splits a worfy-card:// URL; null for any other URL or a host that is neither <card id>.<project
 * label> nor <card id>.<project label>.<machine label>.
 */
export function parseCardUrl(url: string): CardAddress | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (parsed.protocol !== `${CARD_SCHEME}:` || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return null
  const parts = parsed.hostname.split('.')
  if (parts.length !== 2 && parts.length !== 3) return null
  const [cardId = '', label = '', machine] = parts
  if (!CARD_ID_PATTERN.test(cardId) || !isProjectIdHash(label)) return null
  if (machine === undefined) return { cardId, projectLabel: label, pathname: parsed.pathname }
  if (!MACHINE_LABEL_PATTERN.test(machine)) return null
  return { cardId, projectLabel: label, machineLabel: machine, pathname: parsed.pathname }
}

export function isCardUrl(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === `${CARD_SCHEME}:`
}

/** What resolveCardFile asks of the system; replaced in tests. */
export interface CardFileOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules & Pick<typeof nativePath, 'extname'>
  /** lstat and readlink for the links on the way to the file (remote-links.ts). */
  links?: LinkFs
  /** realpath; rejects when there is nothing at the path. */
  real?: (path: string) => Promise<string>
  /** Whether the path is a file. */
  isFile?: (path: string) => Promise<boolean>
}

/**
 * The file a request path names inside a Card's folder, or null when there is none to serve: the
 * path leaves the folder (with .. or through a symlink), names a directory or a missing file, or
 * has an extension that is not in CARD_CONTENT_TYPES. `cardsDir` is the folder of all the
 * Project's Cards; the Card's own folder must be a real folder inside it, not a symlink out.
 *
 * On Windows the links on the way — the Cards folder, the Card's folder, each folder of the path
 * and the file — are read before any realpath: realpath of a link to `\\host\share\…` would make
 * Windows contact that host with the user's credentials before the path is refused (worfy-windows
 * ticket 18). A path that leads there is not served.
 */
export async function resolveCardFile(cardsDir: string, cardId: string, pathname: string, options: CardFileOptions = {}): Promise<string | null> {
  const paths = options.paths ?? nativePath
  const real = options.real ?? realpath
  const isFile = options.isFile ?? (async (path: string) => (await stat(path)).isFile())
  const inside = (root: string, path: string): boolean => path.startsWith(root + paths.sep)

  if (!CARD_ID_PATTERN.test(cardId)) return null
  let segments: string[]
  try {
    segments = pathname.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (segments.some((segment) => segment.includes('\0') || segment.includes('\\'))) return null
  const relativePath = segments.filter((segment) => segment !== '').join('/')
  const requested = relativePath === '' || pathname.endsWith('/') ? paths.join(relativePath, 'index.html') : relativePath
  if (CARD_CONTENT_TYPES[paths.extname(requested).toLowerCase()] === undefined) return null

  try {
    // The Cards folder is the only place this path may go: also when it lies on a share itself.
    if (await leadsToRemote(paths.join(cardsDir, cardId, requested), [cardsDir], { paths, links: options.links })) return null
    const realCards = await real(cardsDir)
    const realCard = await real(paths.join(cardsDir, cardId))
    if (realCard !== paths.join(realCards, cardId)) return null
    const candidate = paths.resolve(realCard, requested)
    if (!inside(realCard, candidate)) return null
    const target = await real(candidate)
    if (!inside(realCard, target)) return null
    if (!(await isFile(target))) return null
    return target
  } catch {
    return null
  }
}

/** Finds the folder of all Cards of the Project a host names, or null when no single Project has that label. */
export type CardsDirLocator = (host: CardHost) => string | null

/** What the handler asks of the second source: one file of a Card of the Linked machine `machineLabel` names. */
export interface LinkedCardRequest {
  machineLabel: string
  projectLabel: string
  cardId: string
  /** The path of the URL, still percent-encoded; the Linked machine resolves it. */
  pathname: string
  /** HEAD: the type is enough, the bytes are not needed. */
  head: boolean
}

/** What the second source answers. `extension` is the file's, in lower case; this side picks the content type. */
export type LinkedCardFile =
  | { status: 'file'; extension: string; bytes: Uint8Array }
  | { status: 'unknown-machine' }
  | { status: 'missing' }
  | { status: 'too-large' }
  | { status: 'unreachable'; reason: string }

/** The second source of files: Cards of Linked machines (src/main/cards/remote.ts). */
export type LinkedCardSource = (request: LinkedCardRequest) => Promise<LinkedCardFile>

type CardRequest = Pick<Request, 'url' | 'method'>

const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { ...CARD_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })

const notFound = (): Response => plain(404, 'Not found')

/** The answer for a file found, by its extension; the body only for GET. HTML gets this Machine's runtime. */
function fileResponse(method: string, extension: string, body: Uint8Array): Response {
  const headers = { ...CARD_HEADERS, 'Content-Type': CARD_CONTENT_TYPES[extension] ?? 'application/octet-stream' }
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  const content = extension === '.html' || extension === '.htm' ? new TextEncoder().encode(injectCardRuntime(new TextDecoder('utf-8', { ignoreBOM: true }).decode(body))) : body
  return new Response(content, { status: 200, headers })
}

/** A Card of a Linked machine: its file from the second source, the answers as for a Card of this Machine. */
async function linkedResponse(method: string, address: CardAddress & { machineLabel: string }, source: LinkedCardSource | undefined): Promise<Response> {
  if (source === undefined) return notFound()
  const { machineLabel, projectLabel, cardId, pathname } = address
  const file = await source({ machineLabel, projectLabel, cardId, pathname, head: method === 'HEAD' })
  switch (file.status) {
    case 'unknown-machine':
    case 'missing':
      return notFound()
    case 'too-large':
      return plain(413, `A Card file is served up to ${CARD_FILE_LIMIT_BYTES} bytes`)
    case 'unreachable':
      return plain(502, file.reason)
    case 'file':
      // The extension is checked here too: a Linked machine does not choose what this side serves.
      if (CARD_CONTENT_TYPES[file.extension] === undefined) return notFound()
      if (file.bytes.byteLength > CARD_FILE_LIMIT_BYTES) return plain(413, `A Card file is served up to ${CARD_FILE_LIMIT_BYTES} bytes`)
      return fileResponse(method, file.extension, file.bytes)
  }
}

/**
 * The protocol's request handler; Electron gives it to protocol.handle, tests call it directly.
 * `locate` finds the Cards of this Machine; `linked`, the second source, the Cards of Linked
 * machines (an address with a machine label). Without it such an address is a 404.
 */
export function createCardHandler(locate: CardsDirLocator, linked?: LinkedCardSource): (request: CardRequest) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...CARD_HEADERS, Allow: 'GET, HEAD' } })
    }
    const address = parseCardUrl(request.url)
    if (address === null) return notFound()
    const { machineLabel } = address
    if (machineLabel !== undefined) return linkedResponse(request.method, { ...address, machineLabel }, linked)
    const cardsDir = locate(address)
    if (cardsDir === null) return notFound()
    const file = await resolveCardFile(cardsDir, address.cardId, address.pathname)
    if (file === null) return notFound()
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return notFound()
    }
    return fileResponse(request.method, extname(file).toLowerCase(), new Uint8Array(body))
  }
}

/**
 * On the Machine of a Project: one piece of a file of its Card for a Linked machine that shows the
 * Card (`cards.file`, src/main/ipc/cards.ts). The file is found and checked as for this Machine's
 * own frames (resolveCardFile), and sent as it is on disk: no runtime, the Machine that shows the
 * Card adds its own. `cardsDir` null — no single Project has the label. A file over
 * CARD_FILE_LIMIT_BYTES is not read. `length` is capped at CARD_FILE_CHUNK_BYTES, so one answer
 * stays well inside a link message.
 */
export async function readCardFileChunk(cardsDir: string | null, cardId: string, pathname: string, offset: number, length: number): Promise<CardFileAnswer> {
  if (cardsDir === null) return { status: 'missing' }
  const file = await resolveCardFile(cardsDir, cardId, pathname)
  if (file === null) return { status: 'missing' }
  let handle
  try {
    handle = await open(file, 'r')
  } catch {
    return { status: 'missing' }
  }
  try {
    const { size, mtimeMs } = await handle.stat()
    if (size > CARD_FILE_LIMIT_BYTES) return { status: 'too-large', size }
    const start = Math.min(offset, size)
    const wanted = Math.min(length, CARD_FILE_CHUNK_BYTES, size - start)
    const buffer = Buffer.alloc(wanted)
    const { bytesRead } = wanted === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, wanted, start)
    return { status: 'file', extension: extname(file).toLowerCase(), size, mtimeMs, base64: buffer.subarray(0, bytesRead).toString('base64') }
  } catch {
    return { status: 'missing' }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export interface FrameNavigation {
  isMainFrame: boolean
  /** The URL the frame shows now; empty or about:blank for a frame that has shown nothing yet. */
  frameUrl: string
  /** Where it is about to go. */
  targetUrl: string
}

/**
 * Whether main lets a frame navigate. A Card frame may go only to its own origin (its own files,
 * a reload): the whole host — card id, project label and, for a Card of a Linked machine, machine
 * label — stays the same. The window itself never shows a Card. Navigations that involve no Card
 * are not this module's business and are let through.
 */
export function allowFrameNavigation({ isMainFrame, frameUrl, targetUrl }: FrameNavigation): boolean {
  const target = parseCardUrl(targetUrl)
  if (isMainFrame) return target === null && !isCardUrl(targetUrl)
  if (!isCardUrl(frameUrl)) return true
  const current = parseCardUrl(frameUrl)
  return (
    current !== null &&
    target !== null &&
    current.cardId === target.cardId &&
    current.projectLabel === target.projectLabel &&
    current.machineLabel === target.machineLabel
  )
}

/** Must run before the app is ready: a scheme gets its privileges only then. */
export function registerCardScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: CARD_SCHEME, privileges: { standard: true, secure: true } }])
}

/**
 * Serves the protocol: the Cards of this Machine from `locate`, those of Linked machines from the
 * app's link (src/main/cards/remote.ts). Runs once, after the app is ready, before the first window.
 */
export function installCardRuntime(locate: CardsDirLocator): void {
  protocol.handle(CARD_SCHEME, createCardHandler(locate, appLinkedCardSource))
}
