// The layer of live Browsers (ADR-0078 item 12). The Canvas draws only the Nodes on screen
// (onlyRenderVisibleElements in Canvas.tsx), for all Nodes at once, so a <webview> inside a Browser
// Node would be unmounted, and its page lost, whenever the frame left the screen. This layer draws
// the <webview> of every Browser Node of the Canvas instead, whether its frame is on screen or not,
// inside React Flow's viewport (ViewportPortal), so the page moves and scales with the same
// transform as its frame, at the frame's body (browserPageRect).
//
// The layer sits under every Node (z-index -1 in BrowserNode.css): the frame's body is a window
// onto the page, and any other Node or menu over the frame covers the page. While a mouse button
// pressed on the Canvas is held, no page takes the mouse (frames-step-aside.ts).
//
// Every <webview> is on the Browser partition (src/shared/browser/partition.ts); main lets it attach
// only there and without a preload, and refuses its page every permission (src/main/window.ts).
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ViewportPortal, type InternalNode, type ReactFlowState } from '@xyflow/react'
import { BROWSER_PARTITION } from '../../../shared/browser/partition'
import { useReadOnly } from '../../projects/useProjects'
import { BROWSER_KIND, browserPageRect, browserUrl, registerBrowserPage, webAddress } from '../nodes/browser-frame'
import { useFramesStepAsideWhilePressed } from '../nodes/frames-step-aside'
import type { CanvasFlowNode } from '../nodes'
import { useLayoutOps } from '../useLayout'
import '../nodes/BrowserNode.css'

export const order = 5

interface Page {
  id: string
  /** The address the Node keeps; null for a Browser that has none yet (an empty page). */
  url: string | null
  x: number
  y: number
  w: number
  h: number
}

/** The part of Electron's <webview> element the layer uses (the renderer has no Electron types). */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
}

/** A navigation event of a <webview>: did-navigate (main frame) or did-navigate-in-page. */
type NavigationEvent = Event & { url: string; isMainFrame?: boolean }

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
    const { x, y } = node.internals.positionAbsolute
    const w = node.width ?? node.measured.width ?? node.data.node.w
    const h = node.height ?? node.measured.height ?? node.data.node.h
    pages.push({ id: node.id, url: browserUrl(node.data.node), ...browserPageRect({ x, y, w, h }) })
  }
  pages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify(pages)
}

/**
 * The page of one Browser. The <webview> starts on the Node's address (an empty page without
 * one) and is sent anywhere later only by loadURL, from the address bar (navigateBrowserPage): a
 * changed `src` attribute would load the page again, and the attribute would change on every
 * navigation the page makes itself, since the address it reaches is written back into the Node.
 */
function BrowserPage({ page }: { page: Page }) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const view = useRef<WebviewElement>(null)
  const [src] = useState(page.url ?? 'about:blank')
  /** The Node's address, as last drawn: a navigation to it is not written again. */
  const kept = useRef(page.url)
  useEffect(() => {
    kept.current = page.url
  }, [page.url])

  // The address bar's requests. loadURL works only once the guest is attached and its first page
  // has started (dom-ready); a request before that waits for it.
  useEffect(() => {
    const element = view.current
    if (element === null) return
    let ready = false
    let waiting: string | null = null
    const load = (url: string) => {
      element.loadURL(url).catch((error: unknown) => console.warn(`Browser ${page.id}: could not open ${url}`, error))
    }
    const onReady = () => {
      ready = true
      if (waiting !== null) load(waiting)
      waiting = null
    }
    element.addEventListener('dom-ready', onReady, { once: true })
    const unregister = registerBrowserPage(page.id, (url) => {
      if (ready) load(url)
      else waiting = url
    })
    return () => {
      element.removeEventListener('dom-ready', onReady)
      unregister()
    }
  }, [page.id])

  // The address the page reaches, by a link or by the address bar, goes into the Node: the address
  // bar shows it, and the Browser opens it again after a restart. Not a step of ⌘Z (history.ts).
  // shortcut: another window of the same Project (ADR-0053) shows the new address in its bar but
  // keeps its own page where it is; redo when two windows of one Project must show one page.
  useEffect(() => {
    const element = view.current
    if (element === null || readOnly !== null) return
    const onNavigate = (event: Event) => {
      const { url, isMainFrame } = event as NavigationEvent
      if (isMainFrame === false || url === kept.current) return
      const address = webAddress(url)
      if (address === null) return
      kept.current = address
      void ops.apply({ op: 'patchData', id: page.id, data: { url: address } })
    }
    element.addEventListener('did-navigate', onNavigate)
    element.addEventListener('did-navigate-in-page', onNavigate)
    return () => {
      element.removeEventListener('did-navigate', onNavigate)
      element.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [page.id, ops, readOnly])

  return (
    <div className="w-browser-layer__page" style={{ transform: `translate(${page.x}px, ${page.y}px)`, width: page.w, height: page.h }}>
      {createElement('webview', { ref: view, src, partition: BROWSER_PARTITION, 'data-browser-id': page.id })}
    </div>
  )
}

export default function BrowserLayer() {
  useFramesStepAsideWhilePressed(useStore((store) => store.domNode))
  const key = useStore(pagesKey)
  const pages = useMemo(() => JSON.parse(key) as Page[], [key])
  if (pages.length === 0) return null
  return (
    <ViewportPortal>
      <div className="w-browser-layer" data-testid="browser-layer">
        {pages.map((page) => (
          <BrowserPage key={page.id} page={page} />
        ))}
      </div>
    </ViewportPortal>
  )
}
