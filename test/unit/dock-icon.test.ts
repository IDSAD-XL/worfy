// The Dock icon of a dev run (ticket 31, src/main/dock-icon.ts): `pnpm dev` runs Electron.app from
// node_modules, so worfy sets its own icon, build/icon.png, through app.dock.setIcon. A packaged app
// gets its icon from the bundle, and only macOS has a Dock. The About window of a dev run gets
// worfy's name and version from package.json (worfy-week ticket 12), not Electron's.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DockIconDeps } from '../../src/main/dock-icon'

// Under ELECTRON_RUN_AS_NODE the electron module is only a path; the module under test gets its app passed in.
vi.mock('electron', () => ({ app: {} }))

const { installDevDockIcon } = await import('../../src/main/dock-icon')
type DockApp = DockIconDeps['app']

const REPO = join(__dirname, '..', '..')

function fakeApp(options: { isPackaged?: boolean; appPath?: string; dock?: boolean } = {}) {
  const setIcon = vi.fn()
  const setAboutPanelOptions = vi.fn()
  const app: DockApp = {
    isPackaged: options.isPackaged ?? false,
    getAppPath: () => options.appPath ?? REPO,
    dock: options.dock === false ? undefined : { setIcon },
    setAboutPanelOptions,
  }
  return { app, setIcon, setAboutPanelOptions }
}

const PACKAGE = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { name: string; version: string }

describe('installDevDockIcon', () => {
  it('on macOS in a dev run sets the Dock icon once, to build/icon.png under the app path', () => {
    const { app, setIcon } = fakeApp()
    const warn = vi.fn()
    installDevDockIcon({ app, platform: 'darwin', warn })
    const expected = join(REPO, 'build', 'icon.png')
    expect(setIcon).toHaveBeenCalledTimes(1)
    expect(setIcon).toHaveBeenCalledWith(expected)
    expect(existsSync(expected)).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves a packaged app alone: the bundle gives its icon', () => {
    const { app, setIcon } = fakeApp({ isPackaged: true })
    installDevDockIcon({ app, platform: 'darwin', warn: vi.fn() })
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('does nothing off macOS, where app.dock does not exist', () => {
    const { app, setIcon } = fakeApp({ dock: false })
    expect(() => installDevDockIcon({ app, platform: 'linux', warn: vi.fn() })).not.toThrow()
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('does nothing on a platform other than macOS even if a dock object is present', () => {
    const { app, setIcon } = fakeApp()
    installDevDockIcon({ app, platform: 'linux', warn: vi.fn() })
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('without build/icon.png warns and goes on, without setting the icon or throwing', () => {
    const appPath = join(REPO, 'test', 'fixtures', 'no-such-app')
    const { app, setIcon } = fakeApp({ appPath })
    const warn = vi.fn()
    expect(() => installDevDockIcon({ app, platform: 'darwin', warn })).not.toThrow()
    expect(setIcon).not.toHaveBeenCalled()
    // The folder has no package.json either: that is the About window's warning, checked below.
    const iconWarnings = warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('icon.png'))
    expect(iconWarnings).toEqual([expect.stringContaining(join(appPath, 'build', 'icon.png'))])
  })

  it('a failing setIcon is a warning, not a failed start', () => {
    const { app, setIcon } = fakeApp()
    setIcon.mockImplementation(() => {
      throw new Error('bad image')
    })
    const warn = vi.fn()
    expect(() => installDevDockIcon({ app, platform: 'darwin', warn })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('bad image')
  })
})

describe('the About window of a dev run', () => {
  it('on macOS in a dev run gets worfy\'s name and version from package.json, once', () => {
    const { app, setAboutPanelOptions } = fakeApp()
    const warn = vi.fn()
    installDevDockIcon({ app, platform: 'darwin', warn })
    expect(PACKAGE.name).toBe('worfy')
    expect(setAboutPanelOptions).toHaveBeenCalledTimes(1)
    expect(setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: 'worfy', applicationVersion: PACKAGE.version, version: PACKAGE.version })
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves a packaged app alone: the bundle gives its name and version', () => {
    const { app, setAboutPanelOptions } = fakeApp({ isPackaged: true })
    installDevDockIcon({ app, platform: 'darwin', warn: vi.fn() })
    expect(setAboutPanelOptions).not.toHaveBeenCalled()
  })

  it('does nothing off macOS', () => {
    const { app, setAboutPanelOptions } = fakeApp()
    installDevDockIcon({ app, platform: 'linux', warn: vi.fn() })
    expect(setAboutPanelOptions).not.toHaveBeenCalled()
  })

  it('without a readable package.json warns and goes on, and still sets the Dock icon', () => {
    const appPath = join(REPO, 'test', 'fixtures', 'no-such-app')
    const { app, setAboutPanelOptions } = fakeApp({ appPath })
    const warn = vi.fn()
    expect(() => installDevDockIcon({ app, platform: 'darwin', warn })).not.toThrow()
    expect(setAboutPanelOptions).not.toHaveBeenCalled()
    // One warning for the About window, one for the missing icon.
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining(join(appPath, 'package.json')), expect.stringContaining('icon.png')])
  })

  it('a failing setAboutPanelOptions is a warning and does not keep the Dock icon from being set', () => {
    const { app, setIcon, setAboutPanelOptions } = fakeApp()
    setAboutPanelOptions.mockImplementation(() => {
      throw new Error('no panel')
    })
    const warn = vi.fn()
    expect(() => installDevDockIcon({ app, platform: 'darwin', warn })).not.toThrow()
    expect(setIcon).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('no panel')
  })

  it('says in its comment what the About window shows in a dev run, icon included', () => {
    const source = readFileSync(join(REPO, 'src', 'main', 'dock-icon.ts'), 'utf8')
    expect(source).not.toMatch(/About worfy" window shows the same picture/)
    expect(source).toMatch(/setAboutPanelOptions/)
  })
})
