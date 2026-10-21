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

/** The id of the profile a Browser Node was opened under before Browser profiles existed (worfy-browser ticket 10). */
const LEGACY_PROFILE = 'default'

/**
 * Which Browser profile the Browser of a Node is opened under (worfy-browser ticket 03, the owner's
 * decisions 3 and 5), from the Node's `data` and the Project's profiles:
 * - `loading` — the profiles are not read yet: no page, no question;
 * - `use` — open the page on that profile's partition; `write` — the profile is not in the Node yet
 *   and goes into `data.profile` (by the Browser layer, never on a read-only screen);
 * - `choose` — the frame shows «Choose a profile»: the Node's profile was deleted (`deleted`), the
 *   Project has several and the Node none yet (`several`), or the Project has none (`none`).
 *
 * A Node without `data.profile` is either a Browser opened before profiles existed or a new one:
 * «New browser» makes a Node with empty `data` (the Canvas menu and the palette, which this ticket
 * does not change). The two are told apart by the page address: an old Browser that had a page keeps
 * a web address in `data.url` and stays on `default`, where its logins are; once `default` is
 * deleted it asks, as any Browser of a deleted profile does. Without an address — a new Browser, or an old empty frame, which loses no page — the only
 * profile of the Project is taken, and with several the frame asks: that is how «New browser» asks
 * for a profile only when there is more than one.
 */
export type BrowserProfileChoice = { kind: 'loading' } | { kind: 'use'; id: string; write: boolean } | { kind: 'choose'; reason: 'deleted' | 'several' | 'none' }

export function browserProfileChoice(data: { profile?: unknown; url?: unknown }, profiles: readonly { id: string }[] | undefined): BrowserProfileChoice {
  if (profiles === undefined) return { kind: 'loading' }
  const has = (id: string) => profiles.some((profile) => profile.id === id)
  if (typeof data.profile === 'string') return has(data.profile) ? { kind: 'use', id: data.profile, write: false } : { kind: 'choose', reason: 'deleted' }
  if (webAddress(data.url) !== null) return has(LEGACY_PROFILE) ? { kind: 'use', id: LEGACY_PROFILE, write: true } : { kind: 'choose', reason: 'deleted' }
  const [only] = profiles
  if (profiles.length === 1 && only !== undefined) return { kind: 'use', id: only.id, write: true }
  return { kind: 'choose', reason: profiles.length === 0 ? 'none' : 'several' }
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

/** A request of main's `browser.openRequest`: the page by its web contents id, and the address it asked for. */
export interface BrowserOpenRequestEvent {
  webContentsId: number
  url: string
}

/**
 * The Browser layer's answer to main's `browser.openRequest` for the page of Browser `id`
 * (worfy-browser ticket 12). Every page of the layer hears every request; main names the page that
 * asked by its web contents id, and only a request of this page goes to this frame's Open bar —
 * otherwise "Open" in one Browser would send its page where another page asked. `ownWebContentsId`
 * reads the id of this Browser's page and throws while the page has none yet (the guest is not
 * attached): then the request is not this page's.
 */
export function offerOwnBrowserOpenRequest(id: string, ownWebContentsId: () => number, request: BrowserOpenRequestEvent): void {
  let own: number
  try {
    own = ownWebContentsId()
  } catch {
    return
  }
  if (request.webContentsId === own) offerBrowserOpenRequest(id, request.url)
}

/** How many characters at the end of a long address the Open bar keeps whole, after the cut in the middle. */
export const OPEN_BAR_ADDRESS_TAIL = 24

/**
 * The address of the Open bar in three parts (worfy-browser ticket 12). `site` — the scheme and the
 * host with its port — is always shown whole: a cut in the middle of a long host could hide the
 * real domain (`https://bank.example.com.aaaa….evil.net/…`). Only the path, query and fragment are
 * cut: `head` gives way with an ellipsis, `tail` — its last OPEN_BAR_ADDRESS_TAIL characters — stays.
 * User info (`https://bank.example.com@evil.net/`) is left out: it can pass for the host. The whole
 * address stays in the bar's tooltip. What is not a URL has no `site` and is cut the same way.
 */
export function openBarAddress(url: string): { site: string; head: string; tail: string } {
  let site = ''
  let rest = url
  if (URL.canParse(url)) {
    const parsed = new URL(url)
    site = `${parsed.protocol}//${parsed.host}`
    rest = `${parsed.pathname}${parsed.search}${parsed.hash}`
  }
  const head = rest.length > OPEN_BAR_ADDRESS_TAIL ? rest.slice(0, -OPEN_BAR_ADDRESS_TAIL) : ''
  return { site, head, tail: rest.slice(head.length) }
}
