// The frame of the main window by system (src/main/window-frame.ts, worfy-windows ticket 11): the
// frame of design F on macOS, the system's own frame with an opaque background elsewhere.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { frameOptions, WINDOW_BACKGROUND } from '../../src/main/window-frame'

/** The options of every BrowserWindow made, and the theme nativeTheme reports. */
const electron = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], dark: false }))

vi.mock('electron', () => {
  class FakeWindow {
    webContents = { on: () => undefined }
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
})
