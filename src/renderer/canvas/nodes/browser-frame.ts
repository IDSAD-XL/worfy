// The geometry and the address of a Browser frame (ADR-0078), shared by the frame
// (BrowserNode.tsx) and the Browser layer that draws its page (../overlays/BrowserLayer.tsx), so
// the page always lands exactly in the frame's body.
import type { LayoutNode } from '../../../shared/layout/types'

/** The `kind` of a Browser Node in the Layout. */
export const BROWSER_KIND = 'browser'
/** Height of the frame's header, in Canvas units. */
export const BROWSER_HEADER_HEIGHT = 28
/** Width of the frame's border, in Canvas units. */
export const BROWSER_BORDER = 1

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where the page of a frame at `frame` goes, in Canvas units: the frame's body, inside the border and under the header. */
export function browserPageRect(frame: Rect): Rect {
  return {
    x: frame.x + BROWSER_BORDER,
    y: frame.y + BROWSER_BORDER + BROWSER_HEADER_HEIGHT,
    w: Math.max(0, frame.w - 2 * BROWSER_BORDER),
    h: Math.max(0, frame.h - 2 * BROWSER_BORDER - BROWSER_HEADER_HEIGHT),
  }
}

/** `url` when it is an http(s) URL, the only addresses a Browser keeps; null for anything else. */
export function webAddress(url: unknown): string | null {
  if (typeof url !== 'string' || !URL.canParse(url)) return null
  const { protocol } = new URL(url)
  return protocol === 'http:' || protocol === 'https:' ? url : null
}

/** The page address a Browser Node keeps in `data.url`: an http(s) URL, or null for anything else. */
export function browserUrl(node: LayoutNode): string | null {
  return webAddress(node.data.url)
}

/**
 * The address typed into a frame's address bar as the URL to open, or null when it is none. An
 * http(s) URL is taken as it is; an address without a scheme (`example.com/path`,
 * `127.0.0.1:3000`) gets https://. Anything else — another scheme, text with spaces — is refused:
 * a Browser shows web pages only.
 */
export function addressUrl(typed: string): string | null {
  const text = typed.trim()
  if (text === '' || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  if (!URL.canParse(withScheme)) return null
  const url = new URL(withScheme)
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? url.href : null
}

/**
 * The pages the Browser layer of this window draws, by Node id: how to send each one to an
 * address. The address bar of a frame (BrowserNode.tsx) calls navigateBrowserPage; the layer
 * (../overlays/BrowserLayer.tsx) registers each <webview> it draws.
 */
const pages = new Map<string, (url: string) => void>()

/** Registers the page of Browser `id`; the returned function removes it again. */
export function registerBrowserPage(id: string, navigate: (url: string) => void): () => void {
  pages.set(id, navigate)
  return () => {
    if (pages.get(id) === navigate) pages.delete(id)
  }
}

/** Sends the page of Browser `id` to `url`; false when this window draws no page for it. */
export function navigateBrowserPage(id: string, url: string): boolean {
  const navigate = pages.get(id)
  navigate?.(url)
  return navigate !== undefined
}
