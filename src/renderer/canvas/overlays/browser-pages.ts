// The pages the Browser layer (BrowserLayer.tsx) draws, as plain functions over React Flow's store
// and the Project's Browser profiles: which Browser Nodes have a page, on which partition, and which
// profile the layer writes into a Node that has none yet.
import type { InternalNode, ReactFlowState } from '@xyflow/react'
import { browserPartition } from '../../../shared/browser/partition'
import { BROWSER_KIND, browserPageRect, browserProfileChoice, browserUrl, type BrowserProfileChoice } from '../nodes/browser-frame'
import type { CanvasFlowNode } from '../nodes'

export interface BrowserLayerPage {
  id: string
  /** The address the Node keeps; null for a Browser that has none yet (an empty page). */
  url: string | null
  /**
   * The Node's `data.profile`: the string it keeps; null when the key is there with anything else
   * (a new Browser, worfy-browser ticket 14); absent when the Node has no `profile` key — a Browser
   * saved before profiles existed, which browserProfileChoice keeps on `default` by its address.
   */
  profile?: string | null
  x: number
  y: number
  w: number
  h: number
}

/**
 * Every Browser Node's page as one string, so the selector's result compares by value and the layer
 * draws again only when a page moves, changes size, address or profile, not on every pan. Sorted by
 * id: a <webview> moved in the DOM reloads its page, so the order of the existing ones never
 * changes. It reads React Flow's node lookup, which holds every Node, drawn or not, at the same
 * place the Node renderer reads it, so the frame and its page are drawn in the same commit.
 * JSON drops a `profile` that is undefined, so a page read back has no `profile` key either.
 */
export function pagesKey(state: Pick<ReactFlowState, 'nodeLookup'>): string {
  const pages: BrowserLayerPage[] = []
  // Every Node of this Canvas is a CanvasFlowNode (nodes/index.ts); React Flow's store does not know it.
  for (const node of state.nodeLookup.values() as Iterable<InternalNode<CanvasFlowNode>>) {
    if (node.type !== BROWSER_KIND || node.hidden === true) continue
    const { x, y } = node.internals.positionAbsolute
    const w = node.width ?? node.measured.width ?? node.data.node.w
    const h = node.height ?? node.measured.height ?? node.data.node.h
    const { profile } = node.data.node.data
    pages.push({
      id: node.id,
      url: browserUrl(node.data.node),
      // Absent stays absent: browserProfileChoice tells an old Browser from a new one by the key.
      ...(profile === undefined ? {} : { profile: typeof profile === 'string' ? profile : null }),
      ...browserPageRect({ x, y, w, h }),
    })
  }
  pages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify(pages)
}

export interface PlacedBrowserPage {
  page: BrowserLayerPage
  choice: BrowserProfileChoice
  /** The partition the page opens on; null while its frame asks for a profile or the profiles are not read. */
  partition: string | null
}

/** Each page with the profile the rule picks (browserProfileChoice), as the frame picks it, and its partition. */
export function placeBrowserPages(pages: readonly BrowserLayerPage[], profiles: readonly { id: string }[] | undefined, projectId: string | undefined): PlacedBrowserPage[] {
  return pages.map((page) => {
    const choice = browserProfileChoice(page, profiles)
    const partition = projectId === undefined || choice.kind !== 'use' ? null : browserPartition(projectId, choice.id)
    return { page, choice, partition }
  })
}

/** The profiles the layer writes into Nodes that have none yet: `{ id, profile }` for each page the rule settled. */
export function profileWrites(placed: readonly PlacedBrowserPage[]): { id: string; profile: string }[] {
  return placed.flatMap(({ page, choice }) => (choice.kind === 'use' && choice.write ? [{ id: page.id, profile: choice.id }] : []))
}

/** A box on the window, in CSS px, as getBoundingClientRect() gives it. */
export interface ScreenBox {
  x: number
  y: number
  width: number
  height: number
}

/** Where a page lies over a frame's body in a focus tile, in the layer's own units, and the Canvas zoom it undoes. */
export interface TilePlacement {
  x: number
  y: number
  w: number
  h: number
  zoom: number
}

/**
 * Where the page goes to lie exactly on `body`, the body of its frame in a focus tile (worfy-browser
 * ticket 17), inside the Browser layer whose origin is at `origin` on the window with the Canvas at
 * `zoom`. The layer is inside React Flow's viewport, which scales by `zoom`: the page is placed in
 * Canvas units and scaled back by 1 / zoom, so it is laid out and drawn at the body's size, one CSS
 * px of the page per CSS px of the window.
 */
export function tilePlacement(body: ScreenBox, origin: { x: number; y: number }, zoom: number): TilePlacement {
  return { x: (body.x - origin.x) / zoom, y: (body.y - origin.y) / zoom, w: body.width, h: body.height, zoom }
}

/**
 * What the window shows of the Browsers (`browser.screen`): the ids of those whose page lies at least
 * partly inside the window on the Canvas, with the zoom of the Canvas. Focus mode changes nothing of
 * that for the Browsers on the Canvas under its layer: opening it never puts one to sleep sooner than
 * without it (main's sleep rules, src/main/browser/sleep.ts). The Browsers in its tiles (`inTiles`,
 * worfy-browser ticket 17) count as shown too, wherever their frames are, and the zoom as at least 1 —
 * a tile draws its page at its own size — so those rules never take one of them for far off.
 * shortcut: one zoom per screen, so while a tile shows a Browser the Browsers on the Canvas zoomed out below the readable zoom count readable too and sleep later; redo when `browser.screen` carries a zoom per Browser.
 */
export function screenShown(
  state: Pick<ReactFlowState, 'transform' | 'width' | 'height'>,
  pages: readonly BrowserLayerPage[],
  inTiles: readonly string[],
): { visible: string[]; zoom: number } {
  const [x, y, zoom] = state.transform
  const left = -x / zoom
  const top = -y / zoom
  const right = left + state.width / zoom
  const bottom = top + state.height / zoom
  const onCanvas = (page: BrowserLayerPage) => page.x < right && page.x + page.w > left && page.y < bottom && page.y + page.h > top
  const tiled = (page: BrowserLayerPage) => inTiles.includes(page.id)
  const visible = pages.filter((page) => onCanvas(page) || tiled(page)).map((page) => page.id)
  return { visible, zoom: pages.some(tiled) ? Math.max(zoom, 1) : zoom }
}
