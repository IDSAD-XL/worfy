// The worfy-card:// protocol: how a Card (CONTEXT.md, «Карточка») reaches the window, and the
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
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { protocol } from 'electron'
import { CARD_ID_PATTERN } from '../../shared/ipc/cards'
import { isProjectIdHash, projectIdHash } from '../projects/store'

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
}

export interface CardAddress extends CardHost {
  /** The path of the URL, still percent-encoded. */
  pathname: string
}

/** Splits a worfy-card:// URL; null for any other URL or a host that is not <card id>.<project label>. */
export function parseCardUrl(url: string): CardAddress | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (parsed.protocol !== `${CARD_SCHEME}:` || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return null
  const parts = parsed.hostname.split('.')
  if (parts.length !== 2) return null
  const [cardId = '', label = ''] = parts
  if (!CARD_ID_PATTERN.test(cardId) || !isProjectIdHash(label)) return null
  return { cardId, projectLabel: label, pathname: parsed.pathname }
}

export function isCardUrl(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === `${CARD_SCHEME}:`
}

const isInside = (root: string, path: string): boolean => path.startsWith(root + sep)

/**
 * The file a request path names inside a Card's folder, or null when there is none to serve: the
 * path leaves the folder (with .. or through a symlink), names a directory or a missing file, or
 * has an extension that is not in CARD_CONTENT_TYPES. `cardsDir` is the folder of all the
 * Project's Cards; the Card's own folder must be a real folder inside it, not a symlink out.
 */
export async function resolveCardFile(cardsDir: string, cardId: string, pathname: string): Promise<string | null> {
  if (!CARD_ID_PATTERN.test(cardId)) return null
  let segments: string[]
  try {
    segments = pathname.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (segments.some((segment) => segment.includes('\0') || segment.includes('\\'))) return null
  const relativePath = segments.filter((segment) => segment !== '').join('/')
  const requested = relativePath === '' || pathname.endsWith('/') ? join(relativePath, 'index.html') : relativePath
  if (CARD_CONTENT_TYPES[extname(requested).toLowerCase()] === undefined) return null

  try {
    const realCards = await realpath(cardsDir)
    const realCard = await realpath(join(cardsDir, cardId))
    if (realCard !== join(realCards, cardId)) return null
    const candidate = resolve(realCard, requested)
    if (!isInside(realCard, candidate)) return null
    const real = await realpath(candidate)
    if (!isInside(realCard, real)) return null
    if (!(await stat(real)).isFile()) return null
    return real
  } catch {
    return null
  }
}

/** Finds the folder of all Cards of the Project a host names, or null when no single Project has that label. */
export type CardsDirLocator = (host: CardHost) => string | null

type CardRequest = Pick<Request, 'url' | 'method'>

const notFound = (): Response =>
  new Response('Not found', { status: 404, headers: { ...CARD_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })

/** The protocol's request handler; Electron gives it to protocol.handle, tests call it directly. */
export function createCardHandler(locate: CardsDirLocator): (request: CardRequest) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...CARD_HEADERS, Allow: 'GET, HEAD' } })
    }
    const address = parseCardUrl(request.url)
    if (address === null) return notFound()
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
    const headers = { ...CARD_HEADERS, 'Content-Type': CARD_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers })
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
 * a reload); the window itself never shows a Card. Navigations that involve no Card are not this
 * module's business and are let through.
 */
export function allowFrameNavigation({ isMainFrame, frameUrl, targetUrl }: FrameNavigation): boolean {
  const target = parseCardUrl(targetUrl)
  if (isMainFrame) return target === null && !isCardUrl(targetUrl)
  if (!isCardUrl(frameUrl)) return true
  const current = parseCardUrl(frameUrl)
  return current !== null && target !== null && current.cardId === target.cardId && current.projectLabel === target.projectLabel
}

/** Must run before the app is ready: a scheme gets its privileges only then. */
export function registerCardScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: CARD_SCHEME, privileges: { standard: true, secure: true } }])
}

/** Serves the protocol. Runs once, after the app is ready, before the first window. */
export function installCardRuntime(locate: CardsDirLocator): void {
  protocol.handle(CARD_SCHEME, createCardHandler(locate))
}
