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
//
// Each page that starts tells main which Browser it is (`browser.page.live`, worfy-browser ticket
// 04): main then reaches it over CDP when a Session drives the Browser (src/main/browser/live.ts).
//
// Only a Live Browser has a page here (worfy-browser ticket 05, ADR-0078 items 6 and 7): main decides
// which ones are Live for every window at once, and the layer tells it what this window shows — the
// Browser frames inside the window and the zoom of the Canvas (`browser.screen`) — whenever that
// changes. A window that is hidden (minimised, on another
// Space) or shows another Project shows no Browser of this one. A page that goes to sleep is closed
// here; its frame shows the picture main kept (BrowserNode.tsx).
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react'
import { announceBrowserPage, keepWindowFocus } from '../../browser/control'
import { reportBrowserScreen, useFollowBrowserLives, useLiveBrowserIds } from '../../browser/lives'
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
function BrowserPage({ page, partition, projectId }: { page: BrowserLayerPage; partition: string; projectId: string }) {
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
    // Every page the guest starts, the first one and one after a crash alike; main keeps one per guest.
    const announce = () => {
      try {
        announceBrowserPage(projectId, page.id, element.getWebContentsId())
      } catch (error) {
        // No guest yet, or no preload bridge (a unit test of the Canvas): no page to tell of.
        console.warn(`Browser ${page.id}: its page could not be told to main`, error)
      }
    }
    element.addEventListener('dom-ready', onReady, { once: true })
    element.addEventListener('dom-ready', announce)
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
      element.removeEventListener('dom-ready', announce)
      element.removeEventListener('did-navigate', report)
      element.removeEventListener('did-navigate-in-page', report)
      element.removeEventListener('did-navigate', onNavigated)
      element.removeEventListener('did-navigate-in-page', onNavigated)
      stopRequests()
      unregister()
    }
  }, [page.id, projectId])

  // A Session's click on the page leaves the window's keyboard focus where the user has it.
  useEffect(() => {
    try {
      return keepWindowFocus(projectId, page.id)
    } catch (error) {
      // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
      console.error('browser.pressing: cannot subscribe', error)
      return undefined
    }
  }, [page.id, projectId])

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

/** How long what the window shows stays unchanged before the layer tells main. */
const REPORT_REST_MS = 150

/** The ids of the Browsers whose page lies at least partly inside the window, and the zoom, as one string: compared by value. */
function screenKey(state: Pick<ReactFlowState, 'transform' | 'width' | 'height'>, pages: readonly BrowserLayerPage[]): string {
  const [x, y, zoom] = state.transform
  const left = -x / zoom
  const top = -y / zoom
  const right = left + state.width / zoom
  const bottom = top + state.height / zoom
  const visible = pages.filter((page) => page.x < right && page.x + page.w > left && page.y < bottom && page.y + page.h > top).map((page) => page.id)
  return JSON.stringify({ visible, zoom })
}

/**
 * Tells main what this window shows of Project `projectId` whenever it changes (`browser.screen`),
 * and that it shows nothing of it once the layer goes (another Project, the window closes its Canvas).
 */
function useReportScreen(projectId: string | undefined, pages: readonly BrowserLayerPage[]): void {
  const shown = useStore((state) => screenKey(state, pages))
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const visibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  useEffect(() => {
    if (projectId === undefined) return
    const { visible, zoom } = JSON.parse(shown) as { visible: string[]; zoom: number }
    // Once a pan or a zoom comes to rest: main's rules count in seconds, not in frames.
    const timer = setTimeout(() => reportBrowserScreen({ projectId, visible: hidden ? [] : visible, zoom }), REPORT_REST_MS)
    return () => clearTimeout(timer)
  }, [projectId, shown, hidden])
  useEffect(() => {
    if (projectId === undefined) return
    return () => reportBrowserScreen({ projectId, visible: [], zoom: 1 })
  }, [projectId])
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
  useFollowBrowserLives(project?.id)
  const live = useLiveBrowserIds(project?.id)
  useReportScreen(project?.id, pages)

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

  const shown = placed.filter((each): each is PlacedBrowserPage & { partition: string } => each.partition !== null && live.has(each.page.id))
  // A page has a partition only with a Project (placeBrowserPages).
  if (shown.length === 0 || project === undefined) return null
  return (
    <ViewportPortal>
      <div className="w-browser-layer" data-testid="browser-layer">
        {shown.map(({ page, partition }) => (
          <BrowserPage key={`${partition} ${page.id}`} page={page} partition={partition} projectId={project.id} />
        ))}
      </div>
    </ViewportPortal>
  )
}
