// The geometry and the address of a Browser frame (ADR-0078), shared by the frame
// (BrowserNode.tsx) and the Browser layer that draws its page (../overlays/BrowserLayer.tsx), so
// the page always lands exactly in the frame's body.
import { create } from 'zustand'
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
 * What the frame of a Browser can do to its page: send it to an address, and the three buttons
 * left of the address bar (worfy-browser ticket 10).
 */
export interface BrowserPageControl {
  navigate(url: string): void
  back(): void
  forward(): void
  reload(): void
}

/** Where the page of a Browser can go, as its frame's buttons show it. */
export interface BrowserHistory {
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * The pages the Browser layer of this window draws, by Node id: how to send each one to an
 * address and through its history. The frame (BrowserNode.tsx) calls navigateBrowserPage and
 * stepBrowserPage; the layer (../overlays/BrowserLayer.tsx) registers each <webview> it draws.
 */
const pages = new Map<string, BrowserPageControl>()

/**
 * The history of each page the layer draws, by Node id, once its first document is ready. A page
 * that is not here (not drawn in this window, or not ready yet) can go nowhere.
 */
const useHistories = create<Record<string, BrowserHistory>>(() => ({}))

/**
 * The address each page asked to open and main did not open by itself, by Node id (worfy-browser
 * ticket 11): a window.open or target="_blank" link from a frame of another origin or without a
 * referrer (src/main/window.ts). The frame offers it in its Open bar until the user opens or
 * closes it, the page goes elsewhere, or the page is gone; a new request replaces the old one.
 */
const useOpenRequests = create<Record<string, string>>(() => ({}))

/** Registers the page of Browser `id`; the returned function removes it, its history and its open request again. */
export function registerBrowserPage(id: string, control: BrowserPageControl): () => void {
  pages.set(id, control)
  return () => {
    if (pages.get(id) !== control) return
    pages.delete(id)
    useHistories.setState((histories) => {
      const rest = { ...histories }
      delete rest[id]
      return rest
    }, true)
    dismissBrowserOpenRequest(id)
  }
}

/** Sends the page of Browser `id` to `url`; false when this window draws no page for it. */
export function navigateBrowserPage(id: string, url: string): boolean {
  const control = pages.get(id)
  control?.navigate(url)
  return control !== undefined
}

/** Takes the page of Browser `id` back, forward or loads it again; nothing when this window draws no page for it. */
export function stepBrowserPage(id: string, step: 'back' | 'forward' | 'reload'): void {
  pages.get(id)?.[step]()
}

/** The layer's report of where the page of Browser `id` can go now. */
export function setBrowserHistory(id: string, history: BrowserHistory): void {
  const current = useHistories.getState()[id]
  if (current?.canGoBack === history.canGoBack && current.canGoForward === history.canGoForward) return
  useHistories.setState({ [id]: history })
}

/** Where the page of Browser `id` can go; undefined while this window has no ready page for it. */
export function useBrowserHistory(id: string): BrowserHistory | undefined {
  return useHistories((histories) => histories[id])
}

/** The layer's report that the page of Browser `id` asked to open `url`; anything but an http(s) address is ignored. */
export function offerBrowserOpenRequest(id: string, url: string): void {
  const address = webAddress(url)
  if (address !== null) useOpenRequests.setState({ [id]: address })
}

/** Takes the Open bar of Browser `id` away: the user closed it or opened it, or the page went elsewhere. */
export function dismissBrowserOpenRequest(id: string): void {
  if (!(id in useOpenRequests.getState())) return
  useOpenRequests.setState((requests) => {
    const rest = { ...requests }
    delete rest[id]
    return rest
  }, true)
}

/** The address the page of Browser `id` asks to open; undefined when it asks for none. */
export function useBrowserOpenRequest(id: string): string | undefined {
  return useOpenRequests((requests) => requests[id])
}
