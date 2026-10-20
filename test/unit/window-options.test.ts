// The frame of the main window by system (src/main/window-frame.ts, worfy-windows ticket 11): the
// frame of design F on macOS, the system's own frame with an opaque background elsewhere.
import { readFileSync } from 'node:fs'
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
    dark: false,
    appListeners: new Map<string, Listener[]>(),
    fakeSession,
    defaultSession: fakeSession('default'),
    partitions: new Map<string, FakeSession>(),
  }
})

vi.mock('electron', () => {
  class FakeWindow {
    webContents = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        electron.handlers.push({ event, handler })
      },
    }
    constructor(options: Record<string, unknown>) {
      electron.options.push(options)
    }
    on(): void {}
    once(): void {}
    isDestroyed(): boolean {
      return false
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
    screen: { getAllDisplays: () => [] },
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
  async function optionsOn(system: NodeJS.Platform, dark: boolean): Promise<Record<string, unknown>> {
    electron.options.length = 0
    electron.handlers.length = 0
    electron.dark = dark
    vi.stubEnv('WORFY_DATA_DIR', join(tmpdir(), 'worfy-window-options-test'))
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    Object.defineProperty(process, 'platform', { ...platform, value: system })
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

  /** A web contents of `type` as installWebPolicy sees it, created with the app's listener. */
  function created(type: 'window' | 'webview', contentsSession: FakeSession = electron.fakeSession(`guest-${type}`)) {
    const listeners = new Map<string, Listener>()
    let openHandler: Listener | undefined
    const loadURL = vi.fn(() => Promise.resolve())
    const contents = {
      session: contentsSession,
      loadURL,
      getType: () => type,
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
      open: (url: string, disposition = 'new-window'): unknown => openHandler?.({ url, referrer: { url: '', policy: 'no-referrer' }, frameName: '', features: '', disposition }),
      /** The addresses main sent this web contents to with loadURL. */
      loaded: (): unknown[] => loadURL.mock.calls.map((call: unknown[]) => call[0]),
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
    expect(guest.open('http://127.0.0.1:3000/b', 'foreground-tab')).toEqual({ action: 'deny' })
    expect(guest.loaded()).toEqual(['https://example.com/a', 'http://127.0.0.1:3000/b'])
  })

  it('sends the page of a Browser to no address that is not a web page', () => {
    const guest = created('webview')
    for (const url of ['', 'about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'worfy-card://c1.0a1b2c3d/index.html', 'data:text/html,hi']) {
      expect(guest.open(url), url).toEqual({ action: 'deny' })
    }
    expect(guest.loaded()).toEqual([])
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
