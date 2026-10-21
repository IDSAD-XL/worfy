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
