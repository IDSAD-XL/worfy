import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, screen, session, type HandlerDetails, type Session, type WebContents, type WindowOpenHandlerResponse } from 'electron'
import { browserOpenRequest } from '../shared/ipc/browser'
import { MIN_SIZE, boundsOffPoint, initialBounds, parseWindowState, serializeWindowState, sizeOnlyChange, type Rect } from '../shared/window/bounds'
import { webviewAttachRefusal } from './browser/attach-policy'
import { allowFrameNavigation } from './cards/protocol'
import { emit } from './ipc/index'
import { quietWindows } from './quiet-windows'
import { followInterfaceScale, interfaceScale } from './settings/interface-scale'
import { reportStartupFailure } from './startup-failure'
import { frameOptions } from './window-frame'
import { windowShow } from './window-show'
import { dataRoot } from './storage/paths'

/** Path of the file that remembers the window's position and size (ADR 0005: worfy's own state). */
export function windowStatePath(root: string = dataRoot()): string {
  return join(root, 'window-state.json')
}

function readSavedBounds(file: string): Rect | undefined {
  try {
    return parseWindowState(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function saveBounds(file: string, bounds: Rect): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, serializeWindowState(bounds))
    renameSync(temporary, file)
  } catch (error) {
    // Losing the window position is not worth interrupting the user for.
    console.warn('worfy: could not save the window position', error)
  }
}

export interface MainWindowOptions {
  /**
   * The window src/main/index.ts creates as the last step of the start. Only for it does a page
   * that fails to load stop the app with the startup error window.
   */
  firstOfStart?: boolean
}

/**
 * How long a load that ended as if replaced waits for the navigation that replaced it. Chromium
 * may stop the load (did-stop-loading) a moment before it starts the next navigation.
 */
export const REPLACED_LOAD_GRACE_MS = 1_000

/**
 * Whether a rejected loadURL / loadFile ended the way a load replaced by another navigation ends
 * in Electron 44: ERR_ABORTED (-3) when the newer navigation started first, ERR_FAILED (-2) when
 * Chromium stopped this load before starting the newer one (test/e2e/window.spec.ts pins both).
 * The rejection alone does not prove a replacement: webContents.stop() and a closed window end a
 * load the same way. createMainWindow also requires that a newer navigation has started.
 */
export function loadEndedAsReplaced(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, errno } = error as { code?: unknown; errno?: unknown }
  return code === 'ERR_ABORTED' || errno === -3 || code === 'ERR_FAILED' || errno === -2
}

/**
 * Quiet windows on macOS (quiet-windows.ts, avoidPointer): keeps the window from containing the
 * real mouse pointer. AppKit sends Chromium's web view mouse entered and exited for a window that
 * ignores the mouse when another window appears or goes away under a still pointer (in e2e runs,
 * the windows of the other Playwright workers open at the same place), and the page then gets a
 * mouseleave or a mousemove at the pointer in the middle of a test that hovers over CDP. Checked
 * when the window is created and right after it is shown (macOS may move a window as it shows
 * it), and after a change of size (setSize grows the window over the pointer; sizeOnlyChange). A window
 * placed from the saved state is not checked until its size changes. A place given to setBounds is
 * kept unless it also has the same x as before, a new size and a top either unchanged or at the top
 * of the work area: that is how a setSize looks once macOS has pulled the window up under the menu
 * bar, and then the window is checked like after setSize. test/e2e/window.spec.ts pins its places
 * with a new x, and those tests do not hover. A move off the pointer fires 'moved', which rewrites
 * window-state.json; quiet mode runs only in e2e, each test with its own temporary data folder.
 * shortcut: no check while the pointer moves (a pointer moved onto a quiet window stays under it), redo
 * with a poll of the pointer only if a hover test still fails and its pointer log shows such a move;
 * moving the window in the middle of a test would itself send the page a mouseleave.
 */
function keepOffPointer(window: BrowserWindow, checkNow: boolean): { afterShow: () => void } {
  let last = window.getBounds()
  const check = (): void => {
    if (window.isDestroyed()) return
    const next = boundsOffPoint(
      window.getBounds(),
      screen.getCursorScreenPoint(),
      screen.getAllDisplays().map((display) => display.workArea),
    )
    if (next) window.setBounds(next)
    last = window.getBounds()
  }
  if (checkNow) check()
  window.on('resize', () => {
    const now = window.getBounds()
    const sizeOnly = sizeOnlyChange(last, now, screen.getAllDisplays().map((display) => display.workArea))
    last = now
    if (sizeOnly) check()
  })
  return {
    afterShow: () => {
      if (checkNow) check()
    },
  }
}

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
  const stateFile = windowStatePath()
  const bounds = initialBounds(
    readSavedBounds(stateFile),
    screen.getAllDisplays().map((display) => display.workArea),
  )

  // WORFY_QUIET_WINDOWS=1, e2e tests only: shown without taking the focus, transparent, mouse-through
  // and still painted (quiet-windows.ts); WORFY_KEEP_PAINTING=1, every e2e start: still painted. A
  // normal start gets Electron's defaults, as before.
  const quiet = quietWindows()

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'worfy',
    show: false,
    // The frame of design F on macOS, the system's own frame elsewhere (window-frame.ts).
    ...frameOptions(process.platform, nativeTheme.shouldUseDarkColors),
    ...(quiet.opacity === undefined ? {} : { opacity: quiet.opacity }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The interface scale of the app settings: the page is drawn at it from the first paint.
      zoomFactor: interfaceScale(),
      ...(quiet.backgroundThrottling === undefined ? {} : { backgroundThrottling: quiet.backgroundThrottling }),
      // The <webview> of the Browsers (ADR-0078 item 3). installWebPolicy checks every one that
      // attaches (browser/attach-policy.ts) and keeps its page off every permission.
      webviewTag: true,
    },
  })
  if (quiet.ignoreMouseEvents) window.setIgnoreMouseEvents(true)
  // Quiet windows on macOS only. A place from the saved state is not checked at creation or show
  // ('x' in bounds: initialBounds reused it), only after a change of size; a window centred by the
  // system is moved off the pointer at once.
  const offPointer = quiet.avoidPointer ? keepOffPointer(window, !('x' in bounds)) : undefined
  // And again after every load, and on every change (settings/interface-scale.ts).
  followInterfaceScale(window)

  // getNormalBounds: a maximised or full-screen window remembers the size it returns to.
  const remember = (): void => saveBounds(stateFile, window.getNormalBounds())
  window.on('resized', remember)
  window.on('moved', remember)
  window.on('close', remember)

  // On 'ready-to-show', or, when that does not come, a few seconds after the page has loaded
  // (window-show.ts); either way once, and the app's output names the path.
  const shower = windowShow({
    // show() makes worfy the active app on macOS; showInactive() puts the window on screen without that.
    show: () => {
      if (quiet.show === 'showInactive') window.showInactive()
      else window.show()
      offPointer?.afterShow()
    },
    isDestroyed: () => window.isDestroyed(),
    log: (line) => console.info(line),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  })
  window.once('ready-to-show', shower.readyToShow)
  window.webContents.on('did-finish-load', shower.didFinishLoad)
  window.once('closed', shower.dispose)

  // Navigations of the main frame to a new document: the first is the load below, any later one
  // replaces it (View ▸ Reload, a Vite reload under `pnpm dev`). Same-document navigations
  // (a fragment, history.pushState) and frames (Cards) replace nothing.
  let navigations = 0
  let onNewerNavigation: (() => void) | undefined
  window.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    navigations += 1
    if (navigations > 1) onNewerNavigation?.()
  })

  // The first window of the start whose page does not load leaves the start without a window: say
  // so and exit (startup-failure.ts). Any other failed load is only logged: a window opened later
  // (Dock icon, a second start, a notification) must not end an app with live Sessions, and
  // app.exit would skip the will-quit handlers that save the Layout. A load replaced by a newer
  // navigation is no failure at all, and a window closed while loading is not one either.
  const failed = (step: 'loadURL' | 'loadFile', error: unknown): void => {
    if (window.isDestroyed()) return
    if (options.firstOfStart === true) {
      reportStartupFailure(error, step)
    } else {
      console.error(`[worfy] the window could not load its page (${step})`, error)
    }
  }
  const loaded = (step: 'loadURL' | 'loadFile') => (error: unknown) => {
    if (window.isDestroyed()) return
    if (!loadEndedAsReplaced(error)) return failed(step, error)
    if (navigations > 1) return
    // Ended as if replaced, with no newer navigation yet: wait a moment for it, then call it a failure.
    const timer = setTimeout(() => {
      onNewerNavigation = undefined
      failed(step, error)
    }, REPLACED_LOAD_GRACE_MS)
    onNewerNavigation = () => {
      onNewerNavigation = undefined
      clearTimeout(timer)
    }
  }
  const { indexHtml, devServerUrl } = rendererEntry()
  if (devServerUrl) {
    window.loadURL(devServerUrl).catch(loaded('loadURL'))
  } else {
    window.loadFile(indexHtml).catch(loaded('loadFile'))
  }
  return window
}

/**
 * Where the window loads the renderer from: the dev server in `electron-vite dev`, the bundled
 * index.html otherwise. The IPC frame check trusts exactly this location (src/main/index.ts), so
 * the two cannot drift apart.
 *
 * ELECTRON_RENDERER_URL counts only in a dev run (app.isPackaged false; the e2e tests run the
 * unpacked out/ build, which is one too). The variable outlives `electron-vite dev` in a shell or a
 * CI job, and a packaged worfy.app started from there would otherwise load a dev server that is
 * not running and trust IPC from any page on its origin. In a dev run a value that is not an
 * http(s) URL throws, so the start fails with a message instead of loading or trusting it.
 */
export function rendererEntry(): { indexHtml: string; devServerUrl: string | undefined } {
  // After the build this code runs from out/main/, next to out/renderer/.
  const indexHtml = join(import.meta.dirname, '../renderer/index.html')
  const value = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  if (!value) return { indexHtml, devServerUrl: undefined }
  if (!isHttpUrl(value)) {
    throw new Error(
      `ELECTRON_RENDERER_URL is not an http(s) URL: ${JSON.stringify(value)}. Unset it, or start worfy with \`pnpm dev\`, which sets it to the dev server.`,
    )
  }
  return { indexHtml, devServerUrl: value }
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

// What a page inside worfy may do beyond showing itself. Electron keeps one window-open handler per
// web contents and one permission handler per session, so this is the single place that sets
// them: a ticket that needs another rule (an external link opened in the browser, say) changes
// these functions instead of installing a handler of its own over them.

/**
 * main's answer to every window.open, target="_blank" link or similar from any page: no. worfy
 * shows one window and opens nothing on a page's request. The answer does not depend on who asks:
 * the opener of a Card's popup is not knowable here (its referrer is empty under the Card
 * iframe's no-referrer policy), so a rule keyed on the opener would let a Card's popup through.
 */
export const windowOpenResponse: (details: HandlerDetails) => WindowOpenHandlerResponse = () => ({ action: 'deny' })

/**
 * The window-open handler of a Browser's page (worfy-browser ticket 10): no new window either, but
 * the page itself goes to the address, as the owner chose for target="_blank" links and
 * window.open. Only a web address: main's loadURL is not held by the rules Chromium puts on a
 * page's own navigations, and a page must not reach a file or a Card by asking for a window.
 * Only when the frame that asks is of the page's own origin: the handler is not told which frame
 * asks, nor whether the user clicked, so a third-party frame (an ad, a widget) could otherwise
 * replace the whole page — on a partition that keeps logins — by calling window.open. The
 * referrer is the asking frame's address or origin; a request without one (rel="noreferrer",
 * Referrer-Policy: no-referrer) cannot be placed and does not open by itself.
 * Such a refused web address goes to `refused` instead (worfy-browser ticket 11): the Browser's
 * frame offers it in its Open bar, and only the user's click there opens it. An address that is
 * not a web page is neither opened nor offered.
 * shortcut: a target="_blank" form that posts opens its address as a plain GET, redo when a Browser must submit such forms.
 */
export function browserWindowOpenHandler(
  page: Pick<WebContents, 'loadURL' | 'getURL'>,
  refused: (url: string) => void = () => undefined,
): (details: HandlerDetails) => WindowOpenHandlerResponse {
  return ({ url, referrer }) => {
    if (!isHttpUrl(url)) return { action: 'deny' }
    if (sameOrigin(referrer.url, page.getURL())) {
      page.loadURL(url).catch((error: unknown) => console.warn(`[worfy] a Browser page could not open ${url}`, error))
    } else {
      refused(url)
    }
    return { action: 'deny' }
  }
}

/**
 * Tells the window that draws the Browser page `guest` (its <webview>'s embedder) that the page
 * asked for `url` and main did not open it: the window's Browser frame shows the Open bar.
 * Nothing when that window is gone.
 */
function offerToHost(guest: Pick<WebContents, 'id' | 'hostWebContents'>, url: string): void {
  // Electron's types say a WebContents, but a guest whose embedder has gone has none.
  const host = guest.hostWebContents as WebContents | null | undefined
  if (host === null || host === undefined || host.isDestroyed()) return
  emit(host, browserOpenRequest, { webContentsId: guest.id, url })
}

/** Whether `a` and `b` are http(s) URLs of one origin (scheme, host and port). */
function sameOrigin(a: string, b: string): boolean {
  return isHttpUrl(a) && isHttpUrl(b) && new URL(a).origin === new URL(b).origin
}

/**
 * Whether a frame is granted a web permission (camera, microphone, notifications, geolocation,
 * clipboard…): only the app's own renderer is. Cards and any other page are refused.
 */
export function grantsPermission(requestingUrl: string, isAppUrl: (url: string) => boolean): boolean {
  return isAppUrl(requestingUrl)
}

/**
 * Puts the permission handlers of a Browser's page on `browserSession`, the session of a Browser
 * partition (ADR-0078 item 3): every permission request (camera, microphone, notifications,
 * geolocation, clipboard…) is refused, and every permission check answers no. Without them
 * Electron grants a page every permission it asks for. The app's own session keeps its own
 * handlers: it is never a Browser's.
 */
export function guardBrowserSession(browserSession: Session): void {
  if (browserSession === session.defaultSession) return
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
}

/**
 * Puts up main's side of the walls for every web contents: frame navigation (a Card stays on its
 * own origin, the window never shows a Card), no new windows, permissions for the app's renderer
 * only. `isAppUrl` is the same renderer matcher the IPC sender check uses (src/main/index.ts).
 *
 * The page of a Browser (the guest of a <webview>, ADR-0078 item 3) attaches only as the attach
 * policy allows (browser/attach-policy.ts), on one of `browserPartitions()` — read at each attach,
 * so a Project added after the start gets its Browsers — and goes to any site (the frame rules of
 * the window and the Cards are not its). It opens no window: a target="_blank" link or
 * window.open sends the page itself there, or offers the address in the Browser's Open bar when
 * the request is not the page's own (browserWindowOpenHandler). It gets no permission: the
 * session of its partition is guarded when the <webview> is allowed to attach, before the page
 * exists, and the session of any guest again when the guest is created.
 * Runs once, after the app is ready, before the first window.
 */
export function installWebPolicy(isAppUrl: (url: string) => boolean, browserPartitions: () => readonly string[] = () => []): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const refusal = webviewAttachRefusal({ webPreferences, params }, browserPartitions())
      if (refusal === null) {
        // The policy has checked the partition: one of browserPartitions(), never the app's own.
        guardBrowserSession(session.fromPartition(webPreferences.partition ?? ''))
        return
      }
      console.warn(`[worfy] a <webview> was not attached: ${refusal}`)
      event.preventDefault()
    })
    if (contents.getType() === 'webview') {
      guardBrowserSession(contents.session)
      contents.setWindowOpenHandler(browserWindowOpenHandler(contents, (url) => offerToHost(contents, url)))
      return
    }
    contents.on('will-frame-navigate', (details) => {
      const allowed = allowFrameNavigation({ isMainFrame: details.isMainFrame, frameUrl: details.frame?.url ?? '', targetUrl: details.url })
      if (!allowed) details.preventDefault()
    })
    contents.setWindowOpenHandler(windowOpenResponse)
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback, details) => {
    callback(grantsPermission(details.requestingUrl, isAppUrl))
  })
}
