import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, screen, session, type HandlerDetails, type WindowOpenHandlerResponse } from 'electron'
import { MIN_SIZE, initialBounds, parseWindowState, serializeWindowState, type Rect } from '../shared/window/bounds'
import { allowFrameNavigation } from './cards/protocol'
import { reportStartupFailure } from './startup-failure'
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

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
  const stateFile = windowStatePath()
  const bounds = initialBounds(
    readSavedBounds(stateFile),
    screen.getAllDisplays().map((display) => display.workArea),
  )

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'worfy',
    show: false,
    // Native macOS frame of design F: no title bar, traffic lights inset into the unified
    // toolbar, a translucent sidebar. The page keeps its own background transparent where the
    // sidebar is, so the vibrancy shows through.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // getNormalBounds: a maximised or full-screen window remembers the size it returns to.
  const remember = (): void => saveBounds(stateFile, window.getNormalBounds())
  window.on('resized', remember)
  window.on('moved', remember)
  window.on('close', remember)

  window.once('ready-to-show', () => {
    window.show()
  })

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
 */
export function rendererEntry(): { indexHtml: string; devServerUrl: string | undefined } {
  // After the build this code runs from out/main/, next to out/renderer/.
  return { indexHtml: join(import.meta.dirname, '../renderer/index.html'), devServerUrl: process.env.ELECTRON_RENDERER_URL }
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
 * Whether a frame is granted a web permission (camera, microphone, notifications, geolocation,
 * clipboard…): only the app's own renderer is. Cards and any other page are refused.
 */
export function grantsPermission(requestingUrl: string, isAppUrl: (url: string) => boolean): boolean {
  return isAppUrl(requestingUrl)
}

/**
 * Puts up main's side of the walls for every web contents: frame navigation (a Card stays on its
 * own origin, the window never shows a Card), no new windows, permissions for the app's renderer
 * only. `isAppUrl` is the same renderer matcher the IPC sender check uses (src/main/index.ts).
 * Runs once, after the app is ready, before the first window.
 */
export function installWebPolicy(isAppUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents) => {
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
