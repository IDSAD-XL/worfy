// The frame of the main window by system (src/main/window-frame.ts, worfy-windows ticket 11): the
// frame of design F on macOS, the system's own frame with an opaque background elsewhere.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserPartition, browserPartitions } from '../../src/shared/browser/partition'
import { frameOptions, WINDOW_BACKGROUND } from '../../src/main/window-frame'

type Listener = (...args: unknown[]) => void

/** A session as installWebPolicy sees it: the permission handlers put on it. */
interface FakeSession {
  name: string
  request?: Listener
  check?: Listener
  setPermissionRequestHandler(handler: Listener): void
  setPermissionCheckHandler(handler: Listener): void
}

/**
 * The options of every BrowserWindow made, the handlers put on its web contents, the theme
 * nativeTheme reports, the app's listeners and the sessions made by partition.
 */
const electron = vi.hoisted(() => {
  const fakeSession = (name: string): FakeSession => ({
    name,
    setPermissionRequestHandler(handler) {
      this.request = handler
    },
    setPermissionCheckHandler(handler) {
      this.check = handler
    },
  })
  return {
    options: [] as Record<string, unknown>[],
    handlers: [] as { event: string; handler: Listener }[],
    /** The window's own once() listeners and how it was put on screen. */
    windowOnce: [] as { event: string; handler: Listener }[],
    shows: [] as ('show' | 'showInactive')[],
    /** What the window's isDestroyed() answers. */
    destroyed: false,
    dark: false,
    appListeners: new Map<string, Listener[]>(),
    fakeSession,
    defaultSession: fakeSession('default'),
    partitions: new Map<string, FakeSession>(),
    /** The window's bounds, its on() listeners and every setBounds it got (keepOffPointer, window.ts). */
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    windowOn: [] as { event: string; handler: Listener }[],
    setBounds: [] as { x: number; y: number; width: number; height: number }[],
    /** Where macOS puts the window as it shows it, when it moves it then; undefined leaves it. */
    boundsOnShow: undefined as { x: number; y: number; width: number; height: number } | undefined,
    /** The real mouse pointer and the displays' work areas, as `screen` reports them. */
    cursor: { x: 0, y: 0 },
    cursorReads: 0,
    workAreas: [{ x: 0, y: 25, width: 1440, height: 875 }],
    /** The window made last, for the tests that resize or place it. */
    last: undefined as { setBounds(bounds: { x: number; y: number; width: number; height: number }): void; setSize(width: number, height: number): void } | undefined,
  }
})

vi.mock('electron', () => {
  class FakeWindow {
    webContents = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        electron.handlers.push({ event, handler })
      },
      // The interface scale listens to did-finish-load too (settings/interface-scale.ts).
      setZoomFactor: () => undefined,
    }
    constructor(options: Record<string, unknown>) {
      electron.options.push(options)
      electron.last = this
      // Saved bounds as given; otherwise the system centres the window on the first display.
      const width = options.width as number
      const height = options.height as number
      const area = electron.workAreas[0]!
      electron.bounds =
        typeof options.x === 'number'
          ? { x: options.x, y: options.y as number, width, height }
          : { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
    }
    on(event: string, handler: Listener): void {
      electron.windowOn.push({ event, handler })
    }
    once(event: string, handler: Listener): void {
      electron.windowOnce.push({ event, handler })
    }
    show(): void {
      electron.shows.push('show')
    }
    showInactive(): void {
      electron.shows.push('showInactive')
      if (electron.boundsOnShow) electron.bounds = { ...electron.boundsOnShow }
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { ...electron.bounds }
    }
    getNormalBounds(): { x: number; y: number; width: number; height: number } {
      return { ...electron.bounds }
    }
    /** Like macOS for a programmatic setFrame: 'resize' only when the size changes. */
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      electron.setBounds.push({ ...bounds })
      const resized = bounds.width !== electron.bounds.width || bounds.height !== electron.bounds.height
      electron.bounds = { ...bounds }
      if (resized) for (const each of electron.windowOn.filter((entry) => entry.event === 'resize')) each.handler()
    }
    setSize(width: number, height: number): void {
      electron.bounds = { ...electron.bounds, width, height }
      for (const each of electron.windowOn.filter((entry) => entry.event === 'resize')) each.handler()
    }
    setIgnoreMouseEvents(): void {}
    isDestroyed(): boolean {
      return electron.destroyed
    }
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
  }
  return {
    app: {
      isPackaged: true,
      on: (event: string, listener: Listener) => {
        electron.appListeners.set(event, [...(electron.appListeners.get(event) ?? []), listener])
      },
    },
    BrowserWindow: FakeWindow,
    nativeTheme: {
      get shouldUseDarkColors() {
        return electron.dark
      },
    },
    screen: {
      getAllDisplays: () => electron.workAreas.map((workArea) => ({ workArea })),
      getCursorScreenPoint: () => {
        electron.cursorReads += 1
        return { ...electron.cursor }
      },
    },
    session: {
      get defaultSession() {
        return electron.defaultSession
      },
      fromPartition: (partition: string) => {
        const made = electron.partitions.get(partition) ?? electron.fakeSession(partition)
        electron.partitions.set(partition, made)
        return made
      },
    },
    protocol: {},
  }
})

describe('frameOptions', () => {
  it('on macOS is the frame of design F: no title bar, inset traffic lights, a translucent window', () => {
    const mac = {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 19 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    }
    expect(frameOptions('darwin', false)).toEqual(mac)
    expect(frameOptions('darwin', true)).toEqual(mac)
  })

  it.each(['win32', 'linux'] as const)('on %s is the system frame: none of the macOS options, an opaque background of the theme', (platform) => {
    expect(frameOptions(platform, false)).toEqual({ backgroundColor: '#f7f7f9' })
    expect(frameOptions(platform, true)).toEqual({ backgroundColor: '#121110' })
    for (const dark of [false, true]) {
      const options = frameOptions(platform, dark)
      for (const key of ['titleBarStyle', 'trafficLightPosition', 'vibrancy', 'visualEffectState']) expect(options).not.toHaveProperty(key)
      // Six hex digits: no alpha channel.
      expect(options.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('takes the opaque backgrounds from --bg of the light and the dark theme', () => {
    const tokens = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'theme', 'tokens.css'), 'utf8')
    const dark = tokens.indexOf('@media (prefers-color-scheme: dark)')
    expect(dark).toBeGreaterThan(0)
    const bg = (css: string): string | undefined => /--bg:\s*(#[0-9a-f]{6});/.exec(css)?.[1]
    expect(WINDOW_BACKGROUND.light).toBe(bg(tokens.slice(0, dark)))
    expect(WINDOW_BACKGROUND.dark).toBe(bg(tokens.slice(dark)))
  })
})

// Review round 1 of PR #215: what createMainWindow (src/main/window.ts) hands to BrowserWindow, over
// a mocked `electron` — the frame of the system the app runs on, in the theme of the system.
describe('createMainWindow', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs()
  })

  /** The options of the window createMainWindow makes on `system`. */
  async function optionsOn(system: NodeJS.Platform, dark: boolean, dataDir?: string, before?: () => void): Promise<Record<string, unknown>> {
    electron.options.length = 0
    electron.handlers.length = 0
    electron.windowOnce.length = 0
    electron.shows.length = 0
    electron.destroyed = false
    electron.dark = dark
    electron.windowOn.length = 0
    electron.setBounds.length = 0
    electron.boundsOnShow = undefined
    electron.cursorReads = 0
    // Far from any window: only the tests of keepOffPointer put the pointer on the window.
    electron.cursor = { x: 5_000, y: 5_000 }
    vi.stubEnv('WORFY_DATA_DIR', dataDir ?? join(tmpdir(), 'worfy-window-options-test'))
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    Object.defineProperty(process, 'platform', { ...platform, value: system })
    before?.()
    const { createMainWindow } = await import('../../src/main/window')
    createMainWindow()
    expect(electron.options).toHaveLength(1)
    return electron.options[0]!
  }

  it.each([false, true])('on Windows makes a window with the system frame and the opaque background of the theme (dark: %s)', async (dark) => {
    const options = await optionsOn('win32', dark)
    expect(options).toMatchObject({ title: 'worfy', show: false, backgroundColor: dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light })
    for (const key of ['titleBarStyle', 'trafficLightPosition', 'vibrancy', 'visualEffectState']) expect(options).not.toHaveProperty(key)
  })

  it('on macOS makes the window of design F', async () => {
    expect(await optionsOn('darwin', true)).toMatchObject({ ...frameOptions('darwin', true), title: 'worfy', show: false })
  })

  // When the window is put on screen (src/main/window-show.ts, test/unit/window-show.test.ts): the
  // window's own events reach the decision, and the window's mode picks show() or showInactive().
  describe('shows the window', () => {
    const fire = (list: { event: string; handler: Listener }[], event: string): void => {
      for (const each of list.filter((entry) => entry.event === event)) each.handler()
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('with show() on ready-to-show', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '')
      await optionsOn('darwin', false)
      fire(electron.windowOnce, 'ready-to-show')
      expect(electron.shows).toEqual(['show'])
      expect(console.info).toHaveBeenCalledWith('[worfy] the window was shown on ready-to-show')
    })

    it('3 s after did-finish-load when ready-to-show does not come, and only once', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '')
      await optionsOn('darwin', false)
      fire(electron.handlers, 'did-finish-load')
      vi.advanceTimersByTime(2_999)
      expect(electron.shows).toEqual([])
      vi.advanceTimersByTime(1)
      expect(electron.shows).toEqual(['show'])
      fire(electron.windowOnce, 'ready-to-show')
      expect(electron.shows).toEqual(['show'])
    })

    it('with showInactive() in quiet mode, by the fallback too', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false)
      fire(electron.handlers, 'did-finish-load')
      vi.advanceTimersByTime(3_000)
      expect(electron.shows).toEqual(['showInactive'])
    })

    it('not when the window is destroyed before the timer fires, even without a closed event', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '')
      await optionsOn('darwin', false)
      fire(electron.handlers, 'did-finish-load')
      electron.destroyed = true
      vi.advanceTimersByTime(3_000)
      expect(electron.shows).toEqual([])
    })

    it('not after the window has closed', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '')
      await optionsOn('darwin', false)
      fire(electron.handlers, 'did-finish-load')
      fire(electron.windowOnce, 'closed')
      vi.advanceTimersByTime(10_000)
      expect(electron.shows).toEqual([])
    })
  })

  // Quiet windows on macOS keep out from under the real mouse pointer (keepOffPointer in
  // src/main/window.ts, avoidPointer in src/main/quiet-windows.ts): AppKit sends the web view of a
  // mouse-through window mouse entered and exited at the pointer when other windows appear or go
  // away over it. The default window here is 1280 × 800 centred on a 1440 × 875 work area at y 25:
  // (80, 63), its centre (720, 463).
  describe('keeps a quiet window off the real pointer', () => {
    const centre = { x: 720, y: 463 }
    const holds = (bounds: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean =>
      point.x >= bounds.x - 8 && point.x < bounds.x + bounds.width + 8 && point.y >= bounds.y - 8 && point.y < bounds.y + bounds.height + 8
    const readyToShow = (): void => {
      for (const each of electron.windowOnce.filter((entry) => entry.event === 'ready-to-show')) each.handler()
    }

    beforeEach(() => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('without a saved place moves the window off the pointer when it is made, and again when macOS moves it back as it shows it', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false, undefined, () => {
        electron.cursor = centre
      })
      expect(electron.setBounds).toHaveLength(1)
      expect(holds(electron.bounds, centre)).toBe(false)
      expect(electron.bounds).toMatchObject({ width: 1280, height: 800 })

      electron.boundsOnShow = { x: 80, y: 63, width: 1280, height: 800 }
      readyToShow()
      expect(electron.shows).toEqual(['showInactive'])
      expect(electron.setBounds).toHaveLength(2)
      expect(holds(electron.bounds, centre)).toBe(false)
    })

    it('after showInactive leaves a window that macOS did not move where it is', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false, undefined, () => {
        electron.cursor = centre
      })
      readyToShow()
      expect(electron.setBounds).toHaveLength(1)
    })

    it('moves the window off the pointer when setSize grows it over the pointer', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false)
      readyToShow()
      expect(electron.setBounds).toEqual([])
      // Clear of the window at 1280 wide (its right edge 1360 and the margin), under it at 1400.
      const pointer = { x: 1400, y: 500 }
      electron.cursor = pointer
      electron.last!.setSize(1400, 850)
      expect(electron.setBounds).toHaveLength(1)
      expect(electron.bounds).toMatchObject({ width: 1400, height: 850 })
      expect(holds(electron.bounds, pointer)).toBe(false)
    })

    it('checks again after setSize a window it already moved: the move is the corner setSize keeps', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false, undefined, () => {
        electron.cursor = centre
      })
      // Moved left at creation: (-568, 63), clear of the pointer.
      expect(electron.setBounds).toEqual([{ x: 720 - 8 - 1280, y: 63, width: 1280, height: 800 }])
      readyToShow()
      // 1400 wide from x -568 reaches 832, over the pointer at 720 again.
      electron.last!.setSize(1400, 850)
      expect(electron.setBounds).toHaveLength(2)
      expect(holds(electron.bounds, centre)).toBe(false)
    })

    it('leaves a place given to setBounds as it is, the pointer under it or not', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      await optionsOn('darwin', false)
      readyToShow()
      const wanted = { x: 60, y: 100, width: 900, height: 560 }
      electron.cursor = { x: 300, y: 300 }
      electron.last!.setBounds(wanted)
      expect(electron.setBounds).toEqual([wanted])
      expect(electron.bounds).toEqual(wanted)
    })

    it('leaves a place restored from the saved state as it is, the pointer under it or not', async () => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', '1')
      const dataDir = mkdtempSync(join(tmpdir(), 'worfy-window-options-saved-'))
      const saved = { x: 100, y: 100, width: 900, height: 600 }
      try {
        writeFileSync(join(dataDir, 'window-state.json'), JSON.stringify({ bounds: saved }))
        await optionsOn('darwin', false, dataDir, () => {
          electron.cursor = { x: 500, y: 400 }
        })
        readyToShow()
        expect(electron.setBounds).toEqual([])
        expect(electron.bounds).toEqual(saved)
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    })

    it.each([
      ['a quiet window on Windows', 'win32', '1'],
      ['a normal window on macOS', 'darwin', ''],
    ] as const)('never reads the pointer for %s', async (_case, system, quiet) => {
      vi.stubEnv('WORFY_QUIET_WINDOWS', quiet)
      await optionsOn(system, false, undefined, () => {
        electron.cursor = centre
      })
      readyToShow()
      electron.last!.setSize(1400, 850)
      expect(electron.cursorReads).toBe(0)
      expect(electron.setBounds).toEqual([])
    })
  })

  // The Browser (worfy-browser ticket 02, ADR-0078 item 3): the <webview> tag is on in every
  // window; installWebPolicy checks each <webview> that attaches (test/unit/webview-attach-policy.test.ts).
  it('turns the <webview> tag on and keeps the window isolated, sandboxed and without Node', async () => {
    const options = await optionsOn('darwin', false)
    expect(options.webPreferences).toMatchObject({ webviewTag: true, contextIsolation: true, sandbox: true, nodeIntegration: false })
  })
})

// installWebPolicy (src/main/window.ts) for the page of a Browser, the guest of a <webview>
// (worfy-browser ticket 02, ADR-0078 item 3), over the mocked `electron` above. The rules for the
// window and the Cards are pinned in test/contract/web-policy.test.ts.
describe('installWebPolicy for the page of a Browser', () => {
  const APP_URL = 'file:///app/out/renderer/index.html#/canvas'
  const CARD = 'worfy-card://c1.0a1b2c3d/index.html'
  const isAppUrl = (url: string): boolean => url.startsWith('file:///app/out/renderer/index.html')

  /** The address of the Browser pages the tests make: the page that asks for a window is on it. */
  const PAGE_URL = 'https://shop.example.com/cart'

  /** A web contents of `type` as installWebPolicy sees it, created with the app's listener; a page at PAGE_URL. */
  function created(type: 'window' | 'webview', contentsSession: FakeSession = electron.fakeSession(`guest-${type}`)) {
    const listeners = new Map<string, Listener>()
    let openHandler: Listener | undefined
    const loadURL = vi.fn(() => Promise.resolve())
    /** The window that shows a Browser page: the renderer that draws its <webview>. */
    const host = { send: vi.fn(), isDestroyed: () => false }
    const contents = {
      id: 42,
      session: contentsSession,
      hostWebContents: type === 'webview' ? host : null,
      loadURL,
      getType: () => type,
      getURL: () => PAGE_URL,
      on: (event: string, listener: Listener) => listeners.set(event, listener),
      setWindowOpenHandler: (handler: Listener) => {
        openHandler = handler
      },
    }
    const appListeners = electron.appListeners.get('web-contents-created') ?? []
    expect(appListeners).toHaveLength(1)
    for (const listener of appListeners) listener({}, contents)
    return {
      /** Whether the navigation went through will-frame-navigate. */
      navigate: (isMainFrame: boolean, frameUrl: string, url: string): boolean => {
        const preventDefault = vi.fn()
        listeners.get('will-frame-navigate')?.({ isMainFrame, frame: { url: frameUrl }, url, preventDefault })
        return preventDefault.mock.calls.length === 0
      },
      /** The handler's answer to a window asked for by a frame at `referrer` ('' — no referrer). */
      open: (url: string, { disposition = 'new-window', referrer = PAGE_URL }: { disposition?: string; referrer?: string } = {}): unknown =>
        openHandler?.({ url, referrer: { url: referrer, policy: referrer === '' ? 'no-referrer' : 'strict-origin-when-cross-origin' }, frameName: '', features: '', disposition }),
      /** The addresses main sent this web contents to with loadURL. */
      loaded: (): unknown[] => loadURL.mock.calls.map((call: unknown[]) => call[0]),
      /** What main told the window that shows this page, as [channel, payload] pairs. */
      told: (): unknown[] => host.send.mock.calls.map((call: unknown[]) => [call[0], call[1]]),
      host,
      /** Whether a <webview> with these preferences attaches to this web contents. */
      attach: (webPreferences: Record<string, unknown>): boolean => {
        const preventDefault = vi.fn()
        listeners.get('will-attach-webview')?.({ preventDefault }, { ...webPreferences }, { src: 'http://127.0.0.1/' })
        return preventDefault.mock.calls.length === 0
      },
    }
  }

  /** The answer of `browserSession`'s request handler to a request for `permission`. */
  function requested(browserSession: FakeSession, permission: string): unknown {
    const callback = vi.fn()
    browserSession.request?.({}, permission, callback, { requestingUrl: 'http://127.0.0.1/page.html' })
    expect(callback, `the request for ${permission} is answered`).toHaveBeenCalledTimes(1)
    return callback.mock.calls[0]?.[0]
  }

  /** The Projects of this Machine, as main's Project list holds them; a test may add one later. */
  const PROJECT = 'alpha-0a1b2c3d'
  const projects: string[] = []

  beforeEach(async () => {
    electron.appListeners.clear()
    electron.partitions.clear()
    electron.defaultSession = electron.fakeSession('default')
    projects.splice(0, projects.length, PROJECT)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { installWebPolicy } = await import('../../src/main/window')
    installWebPolicy(isAppUrl, () => browserPartitions(projects))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The frame rules of the window refuse only Card addresses (allowFrameNavigation of
  // src/main/cards/protocol.ts): a main frame never goes to a Card, a Card frame never leaves its
  // Card. The page of a Browser is not under them at all, so the same navigations pass there. (The
  // Browser partition has no handler of the Card protocol: such a page would not load.)
  it('puts the frame rules of the window and the Cards on the window, and none on the page of a Browser', () => {
    const window = created('window')
    expect(window.navigate(true, APP_URL, CARD)).toBe(false)
    expect(window.navigate(false, CARD, 'https://example.com/')).toBe(false)

    const guest = created('webview')
    expect(guest.navigate(true, 'http://127.0.0.1/page.html', 'https://example.com/')).toBe(true)
    expect(guest.navigate(true, 'https://example.com/', CARD)).toBe(true)
    expect(guest.navigate(false, CARD, 'https://example.com/')).toBe(true)
  })

  // The owner's answer to question 5 of worfy-browser ticket 02 (ticket 10): a target="_blank" link
  // or window.open of the page opens in the same Browser. No new window either way.
  it('opens no window for the page of a Browser and sends the page itself to the address instead', () => {
    const guest = created('webview')
    expect(guest.open('https://example.com/a')).toEqual({ action: 'deny' })
    expect(guest.open('http://127.0.0.1:3000/b', { disposition: 'foreground-tab' })).toEqual({ action: 'deny' })
    // The referrer may be the page's address or only its origin (strict-origin-when-cross-origin).
    expect(guest.open('https://example.com/c', { referrer: 'https://shop.example.com/' })).toEqual({ action: 'deny' })
    expect(guest.loaded()).toEqual(['https://example.com/a', 'http://127.0.0.1:3000/b', 'https://example.com/c'])
    // A request the page goes to by itself is not put to the user (worfy-browser ticket 11).
    expect(guest.told()).toEqual([])
  })

  // A frame of another origin (an ad, an embedded widget) must not replace the page: the address
  // of a window asked for by it goes nowhere. Same for a request without a referrer, whose frame
  // is unknown (rel="noreferrer", Referrer-Policy: no-referrer).
  it('sends the page of a Browser nowhere when the window is asked for by a frame of another origin or without a referrer', () => {
    const guest = created('webview')
    for (const referrer of ['https://ads.example.net/frame.html', 'http://shop.example.com/cart', 'https://shop.example.com:8443/cart', 'https://evil.shop.example.com/', '', 'not a url']) {
      expect(guest.open('https://phish.example.org/login', { referrer }), referrer).toEqual({ action: 'deny' })
    }
    expect(guest.loaded()).toEqual([])
  })

  // worfy-browser ticket 11: the address a request refused by origin or for want of a referrer
  // asked for goes to the window that shows the page, with the page's web contents id, so its
  // Browser frame offers it in the Open bar; the user's click there is what opens it.
  it('tells the window that shows the page the address of a request refused by origin or without a referrer, with the page\'s web contents id', () => {
    const guest = created('webview')
    const refused = ['https://ads.example.net/frame.html', 'http://shop.example.com/cart', '']
    for (const referrer of refused) guest.open('https://phish.example.org/login', { referrer })
    guest.open('http://example.com/plain', { referrer: '', disposition: 'foreground-tab' })
    expect(guest.told()).toEqual([
      ...refused.map(() => ['worfy:browser.openRequest', { webContentsId: 42, url: 'https://phish.example.org/login' }]),
      ['worfy:browser.openRequest', { webContentsId: 42, url: 'http://example.com/plain' }],
    ])
    expect(guest.loaded()).toEqual([])
  })

  it('tells nobody when the window that showed the page is gone', () => {
    const guest = created('webview')
    guest.host.isDestroyed = () => true
    expect(guest.open('https://phish.example.org/login', { referrer: '' })).toEqual({ action: 'deny' })
    expect(guest.told()).toEqual([])
  })

  it('sends the page of a Browser to no address that is not a web page, and does not offer it either', () => {
    const guest = created('webview')
    for (const url of ['', 'about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'worfy-card://c1.0a1b2c3d/index.html', 'data:text/html,hi']) {
      expect(guest.open(url), url).toEqual({ action: 'deny' })
      expect(guest.open(url, { referrer: '' }), url).toEqual({ action: 'deny' })
      expect(guest.open(url, { referrer: 'https://ads.example.net/frame.html' }), url).toEqual({ action: 'deny' })
    }
    expect(guest.loaded()).toEqual([])
    expect(guest.told()).toEqual([])
  })

  it('opens no window for the app window either, and does not send it anywhere', () => {
    const window = created('window')
    expect(window.open('https://example.com/')).toEqual({ action: 'deny' })
    expect(window.loaded()).toEqual([])
  })

  it('checks every <webview> that attaches: on the partition of a Project of this Machine without a preload yes, with a preload or off those partitions no', () => {
    const window = created('window')
    const safe = { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: browserPartition(PROJECT) }
    expect(window.attach({ ...safe })).toBe(true)
    expect(window.attach({ ...safe, preload: '/tmp/evil.js' })).toBe(false)
    expect(window.attach({ ...safe, partition: '' })).toBe(false)
    expect(window.attach({ ...safe, partition: 'persist:other' })).toBe(false)
    // The in-memory partition of ticket 02 is no Browser's any more.
    expect(window.attach({ ...safe, partition: 'worfy-browser' })).toBe(false)
    // A Project this Machine does not know.
    expect(window.attach({ ...safe, partition: browserPartition('beta-99999999') })).toBe(false)
  })

  it('reads the Projects at each attach: a Project added after the start gets its Browsers, a removed one loses them', () => {
    const window = created('window')
    const safe = { nodeIntegration: false, contextIsolation: true, sandbox: true }
    const later = 'beta-99999999'
    expect(window.attach({ ...safe, partition: browserPartition(later) })).toBe(false)
    projects.push(later)
    expect(window.attach({ ...safe, partition: browserPartition(later) })).toBe(true)
    projects.splice(0, projects.length)
    expect(window.attach({ ...safe, partition: browserPartition(PROJECT) })).toBe(false)
  })

  it('guards the session of a Browser partition when its first <webview> attaches, before the page exists: every request refused, every check false', () => {
    const partition = browserPartition(PROJECT)!
    // Not before: a Project whose Browsers never open leaves no session behind.
    expect(electron.partitions.has(partition)).toBe(false)
    expect(created('window').attach({ nodeIntegration: false, contextIsolation: true, sandbox: true, partition })).toBe(true)
    const browserSession = electron.partitions.get(partition)
    expect(browserSession, 'the session of the Browser partition').toBeDefined()
    expect(browserSession!.request).toBeTypeOf('function')
    expect(browserSession!.check).toBeTypeOf('function')
    for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read']) {
      expect(requested(browserSession!, permission), permission).toBe(false)
      expect(browserSession!.check!({}, permission, 'http://127.0.0.1', {}), permission).toBe(false)
    }
  })

  it('guards the session of any Browser page when the page is created, and leaves the app session to the app', () => {
    const later = electron.fakeSession('persist:a-later-profile')
    created('webview', later)
    expect(requested(later, 'notifications')).toBe(false)
    expect(later.check?.({}, 'notifications', 'http://127.0.0.1', {})).toBe(false)

    // A web contents on the app's own session: the renderer is still granted, a web page refused.
    created('window', electron.defaultSession)
    const answer = (requestingUrl: string): unknown => {
      const callback = vi.fn()
      electron.defaultSession.request?.({}, 'notifications', callback, { requestingUrl })
      return callback.mock.calls[0]?.[0]
    }
    expect(answer(APP_URL)).toBe(true)
    expect(answer('https://example.com/')).toBe(false)
    expect(electron.defaultSession.check).toBeUndefined()
  })
})

// The partition of a Project's Browsers (worfy-browser ticket 10, the owner's answer to question 1
// of ticket 02): persistent, one per Project, named by the hash that ends the Project id, so the
// name has no spaces and none of the folder's name (ticket 03 makes it the first Browser profile).
describe('browserPartition', () => {
  it('is a persist: partition named by the hash that ends the Project id', () => {
    expect(browserPartition('alpha-0a1b2c3d')).toBe('persist:worfy-browser-0a1b2c3d-default')
    expect(browserPartition('My Project (copy) é-0a1b2c3d')).toBe('persist:worfy-browser-0a1b2c3d-default')
  })

  it('is the same for the same Project and differs between Projects', () => {
    expect(browserPartition('alpha-0a1b2c3d')).toBe(browserPartition('alpha-0a1b2c3d'))
    expect(browserPartition('alpha-0a1b2c3d')).not.toBe(browserPartition('alpha-0a1b2c3e'))
  })

  it('is none for an id that does not end with the hash', () => {
    for (const id of ['', 'alpha', 'alpha-0A1B2C3D', 'alpha-0a1b2c3', 'alpha-0a1b2c3d/..', '0a1b2c3d']) expect(browserPartition(id), id).toBeNull()
  })

  it('lists the partitions of the Projects that have one, once each', () => {
    expect(browserPartitions(['alpha-0a1b2c3d', 'odd', 'beta-99999999', 'alpha-0a1b2c3d'])).toEqual([
      'persist:worfy-browser-0a1b2c3d-default',
      'persist:worfy-browser-99999999-default',
    ])
  })
})
