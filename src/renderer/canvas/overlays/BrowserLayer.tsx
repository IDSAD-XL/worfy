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
// Every <webview> is on the partition of its Browser's profile (browserPartition,
// src/shared/browser/partition.ts; worfy-browser ticket 03): persistent, so cookies and logins
// survive a restart, and shared by all the Browsers of one profile. The layer opens no page for a
// Browser whose profile is not settled (browserProfileChoice: the frame shows «Choose a profile»),
// and writes the profile the rule picks into a Node that has none yet. main lets
// it attach only on the partition of a Browser profile of a Project of this Machine and without a preload, refuses its
// page every permission, and sends it to the address of a target="_blank" link or window.open
// instead of opening a window (src/main/window.ts). A request main does not open by itself (from a
// frame of another origin, or without a referrer) comes here as `browser.openRequest`, and the
// frame offers its address in the Open bar (worfy-browser ticket 11).
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ViewportPortal } from '@xyflow/react'
import { useBrowserProfiles } from '../../browser/profiles'
import { subscribe } from '../../ipc'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import {
  dismissBrowserOpenRequest,
  offerOwnBrowserOpenRequest,
  registerBrowserPage,
  type BrowserOpenRequestEvent,
  setBrowserHistory,
  webAddress,
} from '../nodes/browser-frame'
import { useFramesStepAsideWhilePressed } from '../nodes/frames-step-aside'
import { useLayoutOps } from '../useLayout'
import { pagesKey, placeBrowserPages, profileWrites, type BrowserLayerPage, type PlacedBrowserPage } from './browser-pages'
import '../nodes/BrowserNode.css'

export const order = 5

/** The part of Electron's <webview> element the layer uses (the renderer has no Electron types). */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  /** The id of the page's web contents; throws until the guest is attached. */
  getWebContentsId(): number
}

/** A navigation event of a <webview>: did-navigate (main frame) or did-navigate-in-page. */
type NavigationEvent = Event & { url: string; isMainFrame?: boolean }

/**
 * The page of one Browser. The <webview> starts on the Node's address (an empty page without
 * one) and is sent anywhere later only by loadURL, from the address bar (navigateBrowserPage): a
 * changed `src` attribute would load the page again, and the attribute would change on every
 * navigation the page makes itself, since the address it reaches is written back into the Node.
 */
function BrowserPage({ page, partition }: { page: BrowserLayerPage; partition: string }) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const view = useRef<WebviewElement>(null)
  const [src] = useState(page.url ?? 'about:blank')
  /** The Node's address, as last drawn: a navigation to it is not written again. */
  const kept = useRef(page.url)
  useEffect(() => {
    kept.current = page.url
  }, [page.url])

  // The frame's requests: the address bar's and the back, forward and reload buttons'. The
  // <webview>'s methods work only once the guest is attached and its first page has started
  // (dom-ready): an address sent before that waits for it, a button does nothing (the frame shows
  // it inactive until then). After every navigation the frame learns where the page can go.
  useEffect(() => {
    const element = view.current
    if (element === null) return
    let ready = false
    let waiting: string | null = null
    const load = (url: string) => {
      element.loadURL(url).catch((error: unknown) => console.warn(`Browser ${page.id}: could not open ${url}`, error))
    }
    const report = () => {
      if (ready) setBrowserHistory(page.id, { canGoBack: element.canGoBack(), canGoForward: element.canGoForward() })
    }
    const onReady = () => {
      ready = true
      report()
      if (waiting !== null) load(waiting)
      waiting = null
    }
    // The Open bar (worfy-browser ticket 11): main names the page by its web contents id, and only
    // this page's requests are this frame's; a navigation of the page takes the bar away.
    const onOpenRequest = (request: BrowserOpenRequestEvent) => offerOwnBrowserOpenRequest(page.id, () => element.getWebContentsId(), request)
    const onNavigated = (event: Event) => {
      if ((event as NavigationEvent).isMainFrame !== false) dismissBrowserOpenRequest(page.id)
    }
    // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
    let stopRequests: () => void = () => undefined
    try {
      stopRequests = subscribe('browser.openRequest', onOpenRequest)
    } catch (error) {
      console.error('browser.openRequest: cannot subscribe', error)
    }
    element.addEventListener('dom-ready', onReady, { once: true })
    element.addEventListener('did-navigate', report)
    element.addEventListener('did-navigate-in-page', report)
    element.addEventListener('did-navigate', onNavigated)
    element.addEventListener('did-navigate-in-page', onNavigated)
    const unregister = registerBrowserPage(page.id, {
      navigate: (url) => {
        if (ready) load(url)
        else waiting = url
      },
      back: () => {
        if (ready && element.canGoBack()) element.goBack()
      },
      forward: () => {
        if (ready && element.canGoForward()) element.goForward()
      },
      reload: () => {
        if (ready) element.reload()
      },
    })
    return () => {
      element.removeEventListener('dom-ready', onReady)
      element.removeEventListener('did-navigate', report)
      element.removeEventListener('did-navigate-in-page', report)
      element.removeEventListener('did-navigate', onNavigated)
      element.removeEventListener('did-navigate-in-page', onNavigated)
      stopRequests()
      unregister()
    }
  }, [page.id])

  // The address the page reaches, by a link or by the address bar, goes into the Node: the address
  // bar shows it, and the Browser opens it again after a restart. Not a step of ⌘Z (history.ts).
  // shortcut: a second window of the Project keeps its page where it is, only its bar follows, redo when two windows must show one page.
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
      {/* allowpopups: without it Electron drops a page's window.open and target="_blank" before main's
          window-open handler sees them; that handler opens no window and sends the page itself to
          the address instead (src/main/window.ts). */}
      {createElement('webview', { ref: view, src, partition, allowpopups: 'true', 'data-browser-id': page.id })}
    </div>
  )
}

export default function BrowserLayer() {
  useFramesStepAsideWhilePressed(useStore((store) => store.domNode))
  const project = activeProject(useProjects())
  const profiles = useBrowserProfiles(project?.id)
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const key = useStore(pagesKey)
  const pages = useMemo(() => JSON.parse(key) as BrowserLayerPage[], [key])
  // Each page with the partition of its profile; null while its frame asks for one. The partition
  // of a <webview> is fixed once it attaches, so a page whose profile changes is a new <webview>
  // (its key); the Canvas of another Project is a new Canvas (Canvas.tsx), and so a new layer.
  const placed = useMemo(() => placeBrowserPages(pages, profiles, project?.id), [pages, profiles, project])

  // The profile the rule picked for a Node without one goes into the Node, as the address bar's
  // address does (not a step of ⌘Z): from then on the Node keeps it whatever profiles come later.
  // Not on a read-only screen: there the frame only shows the profile picked.
  const written = useRef(new Set<string>())
  useEffect(() => {
    if (readOnly !== null) return
    for (const { id, profile } of profileWrites(placed)) {
      const mark = `${id} ${profile}`
      if (written.current.has(mark)) continue
      written.current.add(mark)
      void ops.apply({ op: 'patchData', id, data: { profile } })
    }
  }, [placed, ops, readOnly])

  const shown = placed.filter((each): each is PlacedBrowserPage & { partition: string } => each.partition !== null)
  if (shown.length === 0) return null
  return (
    <ViewportPortal>
      <div className="w-browser-layer" data-testid="browser-layer">
        {shown.map(({ page, partition }) => (
          <BrowserPage key={`${partition} ${page.id}`} page={page} partition={partition} />
        ))}
      </div>
    </ViewportPortal>
  )
}
