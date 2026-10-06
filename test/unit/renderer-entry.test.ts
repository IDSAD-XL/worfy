// Where the window loads the renderer from (src/main/window.ts, rendererEntry) and which frames the
// IPC sender check trusts as a result (ticket worfy-daily/16). ELECTRON_RENDERER_URL counts only in
// a dev run (app.isPackaged === false): a packaged worfy.app started from a shell that still has the
// variable from `electron-vite dev` loads its own bundle and trusts no dev server origin.
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false } }))

// Under ELECTRON_RUN_AS_NODE the electron module is only a path; window.ts needs app.isPackaged.
vi.mock('electron', () => ({ app: electron.app, protocol: {}, session: {}, screen: {}, BrowserWindow: class {} }))

const { rendererEntry } = await import('../../src/main/window')
const { appUrlMatcher } = await import('../../src/main/ipc/index')

const DEV_SERVER = 'http://127.0.0.1:5173'
const indexHtml = join(__dirname, '..', '..', 'src', 'renderer', 'index.html')

beforeEach(() => {
  electron.app.isPackaged = false
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('rendererEntry', () => {
  it('a packaged app ignores ELECTRON_RENDERER_URL and loads the bundled index.html', () => {
    electron.app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_SERVER)
    const entry = rendererEntry()
    expect(entry.devServerUrl).toBeUndefined()
    expect(entry.indexHtml).toBe(indexHtml)
  })

  it('a packaged app without the variable loads the bundled index.html', () => {
    electron.app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(rendererEntry()).toEqual({ indexHtml, devServerUrl: undefined })
  })

  it('a dev run with the variable loads the dev server', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_SERVER)
    expect(rendererEntry()).toEqual({ indexHtml, devServerUrl: DEV_SERVER })
  })

  it('a dev run without the variable loads the bundled index.html', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(rendererEntry()).toEqual({ indexHtml, devServerUrl: undefined })
  })

  it.each(['not a url', 'localhost:5173', 'file:///tmp/index.html', 'data:text/html,hi'])(
    'a dev run refuses %j: the dev server is an http(s) address, anything else is a start failure',
    (value) => {
      vi.stubEnv('ELECTRON_RENDERER_URL', value)
      expect(() => rendererEntry()).toThrow(`ELECTRON_RENDERER_URL is not an http(s) URL: ${JSON.stringify(value)}`)
    },
  )

  it('a packaged app does not even look at an invalid variable', () => {
    electron.app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'not a url')
    expect(rendererEntry().devServerUrl).toBeUndefined()
  })
})

describe('the IPC sender check built from rendererEntry, as src/main/index.ts builds it', () => {
  it('in a packaged app trusts the bundled index.html and not the origin from ELECTRON_RENDERER_URL', () => {
    electron.app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:1')
    const isAppUrl = appUrlMatcher(rendererEntry())
    expect(isAppUrl('http://127.0.0.1:1/')).toBe(false)
    expect(isAppUrl('http://127.0.0.1:1/index.html')).toBe(false)
    expect(isAppUrl(`file://${indexHtml}`)).toBe(true)
  })

  it('in a dev run trusts the dev server origin', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_SERVER)
    const isAppUrl = appUrlMatcher(rendererEntry())
    expect(isAppUrl(`${DEV_SERVER}/`)).toBe(true)
    expect(isAppUrl(`file://${indexHtml}`)).toBe(false)
  })
})
