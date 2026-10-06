// The Dock icon of a dev run (ticket 31, src/main/dock-icon.ts): `pnpm dev` runs Electron.app from
// node_modules, so worfy sets its own icon, build/icon.png, through app.dock.setIcon. A packaged app
// gets its icon from the bundle, and only macOS has a Dock.
import { existsSync } from 'node:fs'
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
  const app: DockApp = {
    isPackaged: options.isPackaged ?? false,
    getAppPath: () => options.appPath ?? REPO,
    dock: options.dock === false ? undefined : { setIcon },
  }
  return { app, setIcon }
}

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
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(join(appPath, 'build', 'icon.png'))
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
