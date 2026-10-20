// The frame of the main window by system (src/main/window-frame.ts, worfy-windows ticket 11): the
// frame of design F on macOS, the system's own frame with an opaque background elsewhere.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { frameOptions, WINDOW_BACKGROUND } from '../../src/main/window-frame'

/** The options of every BrowserWindow made, the handlers put on its web contents, and the theme nativeTheme reports. */
const electron = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  handlers: [] as { event: string; handler: (...args: unknown[]) => void }[],
  dark: false,
}))

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
    app: { isPackaged: true },
    BrowserWindow: FakeWindow,
    nativeTheme: {
      get shouldUseDarkColors() {
        return electron.dark
      },
    },
    screen: { getAllDisplays: () => [] },
    session: {},
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

  // The prototype of the Browser layer (worfy-browser ticket 01, ADR-0078 items 3 and 12): the
  // <webview> tag only under the e2e flag, and every <webview> attached without worfy's preload.
  const webPreferences = (options: Record<string, unknown>) => options.webPreferences as Record<string, unknown>
  const attachHandlers = () => electron.handlers.filter(({ event }) => event === 'will-attach-webview')

  it('without the prototype flag turns the <webview> tag off and watches no <webview> attach', async () => {
    vi.stubEnv('WORFY_BROWSER_PROTOTYPE', '')
    const options = await optionsOn('darwin', false)
    expect(webPreferences(options)).not.toHaveProperty('webviewTag')
    expect(webPreferences(options)).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false })
    expect(attachHandlers()).toHaveLength(0)
  })

  it('under the prototype flag turns the <webview> tag on, and a <webview> attaches without the preload and without Node', async () => {
    vi.stubEnv('WORFY_BROWSER_PROTOTYPE', '1')
    const options = await optionsOn('darwin', false)
    expect(webPreferences(options)).toMatchObject({ webviewTag: true, contextIsolation: true, sandbox: true, nodeIntegration: false })
    expect(attachHandlers()).toHaveLength(1)
    // What a page could ask for in the <webview> element's attributes (preload, nodeintegration).
    const guest: Record<string, unknown> = { preload: 'file:///tmp/evil.js', nodeIntegration: true, nodeIntegrationInSubFrames: true, contextIsolation: false, sandbox: false }
    attachHandlers()[0]!.handler({ preventDefault: () => undefined }, guest, { src: 'http://127.0.0.1/' })
    expect(guest).not.toHaveProperty('preload')
    expect(guest).toMatchObject({ nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true })
  })

  it.each(['0', 'true', 'yes'])('takes only "1" as the prototype flag (%s keeps the <webview> tag off)', async (value) => {
    vi.stubEnv('WORFY_BROWSER_PROTOTYPE', value)
    expect(webPreferences(await optionsOn('darwin', false))).not.toHaveProperty('webviewTag')
    expect(attachHandlers()).toHaveLength(0)
  })
})
