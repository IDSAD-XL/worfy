// The layer of live Browsers (ADR-0078 item 12; prototype of worfy-browser ticket 01). The Canvas
// draws only the Nodes on screen (onlyRenderVisibleElements in Canvas.tsx), for all Nodes at once,
// so a <webview> inside a Browser Node would be unmounted, and its page lost, whenever the frame
// left the screen. This layer draws the <webview> of every Browser Node of the Canvas instead,
// whether its frame is on screen or not, inside React Flow's viewport (ViewportPortal), so the page
// moves and scales with the same transform as its frame, at the frame's body (browserPageRect).
//
// The layer sits under every Node (z-index -1 in BrowserNode.css): the frame's body is a window
// onto the page, and any other Node or menu over the frame covers the page.
import { createElement, useMemo } from 'react'
import { useStore, ViewportPortal, type InternalNode, type ReactFlowState } from '@xyflow/react'
import { BROWSER_KIND, browserPageRect, browserUrl } from '../nodes/browser-frame'
import type { CanvasFlowNode } from '../nodes'
import '../nodes/BrowserNode.css'

export const order = 5

interface Page {
  id: string
  url: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Every Browser Node's page as one string, so the selector's result compares by value and the layer
 * draws again only when a page moves, changes size or address, not on every pan. Sorted by id: a
 * <webview> moved in the DOM reloads its page, so the order of the existing ones never changes.
 * It reads React Flow's node lookup, which holds every Node, drawn or not, at the same place the
 * Node renderer reads it, so the frame and its page are drawn in the same commit.
 */
function pagesKey(state: ReactFlowState): string {
  const pages: Page[] = []
  // Every Node of this Canvas is a CanvasFlowNode (nodes/index.ts); React Flow's store does not know it.
  for (const node of state.nodeLookup.values() as Iterable<InternalNode<CanvasFlowNode>>) {
    if (node.type !== BROWSER_KIND || node.hidden === true) continue
    const url = browserUrl(node.data.node)
    if (url === null) continue
    const { x, y } = node.internals.positionAbsolute
    const w = node.width ?? node.measured.width ?? node.data.node.w
    const h = node.height ?? node.measured.height ?? node.data.node.h
    pages.push({ id: node.id, url, ...browserPageRect({ x, y, w, h }) })
  }
  pages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify(pages)
}

export default function BrowserLayer() {
  const key = useStore(pagesKey)
  const pages = useMemo(() => JSON.parse(key) as Page[], [key])
  if (pages.length === 0) return null
  return (
    <ViewportPortal>
      <div className="w-browser-layer" data-testid="browser-layer">
        {pages.map((page) => (
          <div key={page.id} className="w-browser-layer__page" style={{ transform: `translate(${page.x}px, ${page.y}px)`, width: page.w, height: page.h }}>
            {/* The <webview> tag exists only while main turns it on (src/main/window.ts, browserPrototype). */}
            {createElement('webview', { src: page.url, 'data-browser-id': page.id })}
          </div>
        ))}
      </div>
    </ViewportPortal>
  )
}
