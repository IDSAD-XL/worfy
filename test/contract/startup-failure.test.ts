// What the user sees when worfy cannot start (src/main/startup-failure.ts), over a mocked
// `electron` module: one error window naming the step that failed, the error, what to try and
// the data folder, then exit code 1. The window's own page load (src/main/window.ts) reports
// through the same function instead of ending as an unhandled rejection.
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTestTree } from '../remove'

const DATA_DIR = '/tmp/worfy-startup-failure-test/data'

const electron = vi.hoisted(() => ({
  showErrorBox: vi.fn(),
  exit: vi.fn(),
  /** What the next BrowserWindow's loadFile / loadURL answers. */
  load: (): Promise<void> => Promise.resolve(),
  destroyed: false,
  /** Emits did-start-navigation on the last window's webContents, as Chromium does. */
  startNavigation: (() => undefined) as (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
  requestSingleInstanceLock: vi.fn(() => true),
  /**
   * app.isPackaged. ELECTRON_RENDERER_URL counts only in a dev run (ticket worfy-daily/16), so the
   * tests of the dev server load set it to false.
   */
  isPackaged: true,
}))

vi.mock('electron', () => {
  class FakeWindow {
    static getAllWindows(): FakeWindow[] {
      return []
    }
    webContents = {
      on(event: string, listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): void {
        if (event === 'did-start-navigation') electron.startNavigation = listener
      },
    }
    on(): void {}
    once(): void {}
    getNormalBounds() {
      return { x: 0, y: 0, width: 1280, height: 800 }
    }
    isDestroyed(): boolean {
      return electron.destroyed
    }
    loadFile(): Promise<void> {
      return electron.load()
    }
    loadURL(): Promise<void> {
      return electron.load()
    }
  }
  return {
    // Enough of the app for src/main/index.ts to run its start (as in main-ipc-wiring.test.ts).
    app: {
      exit: electron.exit,
      on: vi.fn(),
      get isPackaged() {
        return electron.isPackaged
      },
      requestSingleInstanceLock: electron.requestSingleInstanceLock,
      setPath: vi.fn(),
      // On Windows the start sets the AppUserModelId (worfy-windows ticket 11).
      setAppUserModelId: vi.fn(),
      getPath: () => DATA_DIR,
      whenReady: () => Promise.resolve(),
      getVersion: () => '1.2.3',
    },
    Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn() },
    ipcMain: { handle: vi.fn() },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    dialog: { showErrorBox: electron.showErrorBox },
    BrowserWindow: FakeWindow,
    // The frame of the window follows the theme outside macOS (src/main/window-frame.ts).
    nativeTheme: { shouldUseDarkColors: false },
    screen: { getAllDisplays: () => [] },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
  }
})

/** Lets the promise callbacks queued so far run. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

beforeEach(() => {
  vi.resetModules()
  electron.showErrorBox.mockClear()
  electron.exit.mockClear()
  electron.requestSingleInstanceLock.mockClear()
  electron.load = () => Promise.resolve()
  electron.destroyed = false
  electron.startNavigation = () => undefined
  electron.isPackaged = true
  unhandled.length = 0
  process.on('unhandledRejection', onUnhandled)
  vi.stubEnv('WORFY_DATA_DIR', DATA_DIR)
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})

afterEach(() => {
  vi.useRealTimers()
  process.off('unhandledRejection', onUnhandled)
  vi.unstubAllEnvs()
})

type Module = typeof import('../../src/main/startup-failure')
const load = (): Promise<Module> => import('../../src/main/startup-failure')

/** The steps of the start the ticket names, and the words the window says each one was doing. */
const STEPS = [
  ['checkDataFolder', 'checking the data folder'],
  ['registerIpc', 'registering the handlers the window calls'],
  ['installWebPolicy', 'installing the web policy for pages and Cards'],
  ['startOrchestrators', 'starting the Orchestrators'],
  ['createMainWindow', 'creating the main window'],
  ['loadURL', 'loading the window from the dev server'],
  ['loadFile', 'loading the window from the app bundle'],
] as const

/** The one error window shown: its title and text. */
function shownWindow(): { title: string; text: string } {
  expect(electron.showErrorBox).toHaveBeenCalledTimes(1)
  const [title, text] = electron.showErrorBox.mock.calls[0] as [string, string]
  return { title, text }
}

describe('reportStartupFailure', () => {
  it.each(STEPS)('a failed %s gives one window with the step, the error, what to try and the data folder', async (step, doing) => {
    const { inStep, reportStartupFailure } = await load()
    let failure: unknown
    try {
      inStep(step, () => {
        throw new Error(`boom in ${step}`)
      })
    } catch (error) {
      failure = error
    }
    reportStartupFailure(failure)

    const { title, text } = shownWindow()
    expect(title).toBe('worfy could not start')
    expect(text).toContain(`Step: ${step} (${doing}) failed.`)
    expect(text).toContain(`Error: boom in ${step}`)
    expect(text).toMatch(/What to try: \S+/)
    // The app prints the folder resolved: C:\tmp\… on Windows.
    expect(text).toContain(`worfy's data folder: ${resolve(DATA_DIR)}`)
    expect(electron.exit).toHaveBeenCalledTimes(1)
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('names the step of a rejected async step, as registerIpc is', async () => {
    const { inStep, reportStartupFailure } = await load()
    const failure = await inStep('registerIpc', () => Promise.reject(new Error('channel handled twice'))).catch((error: unknown) => error)
    reportStartupFailure(failure)
    expect(shownWindow().text).toContain('Step: registerIpc')
    expect(shownWindow().text).toContain('Error: channel handled twice')
  })

  it('the advice differs between a bad data folder and a broken build', async () => {
    const { startupFailureText } = await load()
    const folder = startupFailureText('checkDataFolder', new Error('x'), DATA_DIR)
    const ipc = startupFailureText('registerIpc', new Error('x'), DATA_DIR)
    expect(folder).toContain('WORFY_DATA_DIR')
    expect(ipc).toContain('Install worfy again')
    expect(folder).not.toContain('Install worfy again')
  })

  it('a failure outside any step still gives the window, without a step name', async () => {
    const { reportStartupFailure } = await load()
    reportStartupFailure('not an Error')
    const { text } = shownWindow()
    expect(text).toContain('An unexpected step of the start failed.')
    expect(text).toContain('Error: not an Error')
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('a second failure opens no second window and does not exit again', async () => {
    const { reportStartupFailure } = await load()
    reportStartupFailure(new Error('first'), 'createMainWindow')
    reportStartupFailure(new Error('second'), 'loadFile')
    expect(shownWindow().text).toContain('first')
    expect(electron.exit).toHaveBeenCalledTimes(1)
  })

  it('writes the text with the step to stderr, also when the window is turned off', async () => {
    vi.stubEnv('WORFY_STARTUP_DIALOG', 'off')
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { reportStartupFailure } = await load()
      reportStartupFailure(new Error('ENOTDIR'), 'checkDataFolder')
      expect(electron.showErrorBox).not.toHaveBeenCalled()
      expect(electron.exit).toHaveBeenCalledWith(1)
      const written = stderr.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(written).toContain('Step: checkDataFolder')
      expect(written).toContain('ENOTDIR')
    } finally {
      stderr.mockRestore()
    }
  })
})

describe('inStep', () => {
  it('passes a value through and keeps the step of a nested failure', async () => {
    const { inStep, StartupError } = await load()
    expect(inStep('installWebPolicy', () => 7)).toBe(7)
    await expect(inStep('registerIpc', () => Promise.resolve('ok'))).resolves.toBe('ok')
    let caught: unknown
    try {
      inStep('createMainWindow', () => inStep('loadFile', () => {
        throw new Error('inner')
      }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StartupError)
    expect((caught as InstanceType<typeof StartupError>).step).toBe('loadFile')
  })
})

describe('checkDataFolder', () => {
  it('refuses a file and anything under a file, accepts a folder and a folder not made yet', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { checkDataFolder } = await load()
    const root = mkdtempSync(join(tmpdir(), 'worfy-data-check-'))
    try {
      const file = join(root, 'data')
      writeFileSync(file, '')
      expect(() => checkDataFolder(file)).toThrow(/is a file, not a folder/)
      expect(() => checkDataFolder(join(file, 'inner'))).toThrow(/ENOTDIR/)
      // Two missing levels: the walk up goes past the first missing folder.
      expect(() => checkDataFolder(join(file, 'a', 'b'))).toThrow(/ENOTDIR/)
      expect(() => checkDataFolder(root)).not.toThrow()
      expect(() => checkDataFolder(join(root, 'not-yet'))).not.toThrow()
      expect(() => checkDataFolder(join(root, 'x', 'y'))).not.toThrow()
    } finally {
      removeTestTree(root)
    }
  })
})

describe('the start in src/main/index.ts', () => {
  const failing = (step: string) => () => {
    throw new Error(`${step} broke`)
  }

  /** Runs the start with the given modules replaced and returns the error window's text. */
  async function start(mocks: Record<string, () => Promise<object>>): Promise<string> {
    for (const [path, factory] of Object.entries(mocks)) vi.doMock(path, factory)
    try {
      await import('../../src/main/index')
      // The first start that gets past registerIpc imports every IPC module cold: about 2 s on
      // Windows, more than waitFor's default of 1 s. A start still running after a timed-out test
      // would show its window in the next one.
      await vi.waitFor(() => expect(electron.showErrorBox).toHaveBeenCalled(), { timeout: 10_000 })
      return shownWindow().text
    } finally {
      for (const path of Object.keys(mocks)) vi.doUnmock(path)
    }
  }

  const window = (overrides: Record<string, unknown>) => async () => ({
    ...(await vi.importActual<object>('../../src/main/window')),
    ...overrides,
  })

  it('a registerIpc that rejects is named in the window', async () => {
    const text = await start({
      '../../src/main/ipc/index': async () => ({
        ...(await vi.importActual<object>('../../src/main/ipc/index')),
        registerIpc: () => Promise.reject(new Error('channel app.version handled twice')),
      }),
    })
    expect(text).toContain('Step: registerIpc')
    expect(text).toContain('channel app.version handled twice')
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('an installWebPolicy that throws is named in the window', async () => {
    const text = await start({ '../../src/main/window': window({ installWebPolicy: failing('installWebPolicy') }) })
    expect(text).toContain('Step: installWebPolicy')
  })

  it('a startOrchestrators that throws is named in the window', async () => {
    const text = await start({
      '../../src/main/agent/app-orchestrators': async () => ({
        ...(await vi.importActual<object>('../../src/main/agent/app-orchestrators')),
        startOrchestrators: failing('startOrchestrators'),
      }),
    })
    expect(text).toContain('Step: startOrchestrators')
  })

  it('a createMainWindow that throws is named in the window', async () => {
    const text = await start({ '../../src/main/window': window({ createMainWindow: failing('createMainWindow') }) })
    expect(text).toContain('Step: createMainWindow (creating the main window) failed.')
    expect(text).toContain('createMainWindow broke')
  })

  it('a dev run whose ELECTRON_RENDERER_URL is not a URL names step loadURL and the variable, before any handler is registered', async () => {
    electron.isPackaged = false
    vi.stubEnv('ELECTRON_RENDERER_URL', 'not a url')
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockClear()
    const text = await start({})
    expect(text).toContain('Step: loadURL (loading the window from the dev server) failed.')
    expect(text).toContain('ELECTRON_RENDERER_URL is not an http(s) URL: "not a url"')
    expect(ipcMain.handle).not.toHaveBeenCalled()
    expect(unhandled).toEqual([])
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('a packaged app ignores an ELECTRON_RENDERER_URL that is not a URL and starts', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'not a url')
    const loaded: string[] = []
    vi.doMock('../../src/main/window', async () => ({
      ...(await vi.importActual<object>('../../src/main/window')),
      createMainWindow: () => loaded.push('createMainWindow'),
    }))
    try {
      await import('../../src/main/index')
      await vi.waitFor(() => expect(loaded).toEqual(['createMainWindow']))
    } finally {
      vi.doUnmock('../../src/main/window')
    }
    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('a data folder that is a file stops the start before the single-instance lock', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = mkdtempSync(join(tmpdir(), 'worfy-data-file-'))
    const file = join(root, 'data')
    writeFileSync(file, '')
    vi.stubEnv('WORFY_DATA_DIR', file)
    try {
      const text = await start({})
      expect(text).toContain('Step: checkDataFolder')
      expect(text).toContain(`worfy's data folder: ${file}`)
      expect(electron.requestSingleInstanceLock).not.toHaveBeenCalled()
      expect(electron.exit).toHaveBeenCalledWith(1)
    } finally {
      removeTestTree(root)
    }
  })
})

/** A rejection shaped as Electron's for a failed navigation: errno is the net error, code its name. */
function navigationError(code: string, errno: number): Error {
  return Object.assign(new Error(`${code} (${errno}) loading 'file:///app/out/renderer/index.html'`), { code, errno })
}

describe('the window page load', () => {
  it('a loadFile of the first window that fails opens the error window with the step, not an unhandled rejection', async () => {
    const { createMainWindow } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError('ERR_FILE_NOT_FOUND', -6))
    createMainWindow({ firstOfStart: true })
    await settle()
    await settle()

    expect(unhandled).toEqual([])
    const { title, text } = shownWindow()
    expect(title).toBe('worfy could not start')
    expect(text).toContain('Step: loadFile')
    expect(text).toContain('ERR_FILE_NOT_FOUND (-6)')
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('a loadURL of the first window that fails (the dev server) is reported as step loadURL', async () => {
    electron.isPackaged = false
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const { createMainWindow } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError('ERR_CONNECTION_REFUSED', -102))
    createMainWindow({ firstOfStart: true })
    await settle()
    await settle()

    expect(unhandled).toEqual([])
    expect(shownWindow().text).toContain('Step: loadURL')
    expect(shownWindow().text).toContain('ERR_CONNECTION_REFUSED')
  })

  /** The main-frame navigation of a new document that a load starts, as did-start-navigation reports it. */
  const DOCUMENT = { isMainFrame: true, isSameDocument: false }

  it.each([
    ['loadFile', '', 'ERR_ABORTED', -3],
    ['loadURL', 'http://localhost:5173', 'ERR_ABORTED', -3],
    ['loadFile', '', 'ERR_FAILED', -2],
    ['loadURL', 'http://localhost:5173', 'ERR_FAILED', -2],
  ])('a %s replaced by a newer navigation (%s, View ▸ Reload, a Vite reload) is no failure', async (_load, devServer, code, errno) => {
    electron.isPackaged = false
    vi.stubEnv('ELECTRON_RENDERER_URL', devServer)
    vi.useFakeTimers()
    const { createMainWindow } = await import('../../src/main/window')
    let reject: (error: unknown) => void = () => undefined
    electron.load = () => new Promise((_resolve, rejectLoad) => (reject = rejectLoad))
    createMainWindow({ firstOfStart: true })
    electron.startNavigation(DOCUMENT)
    electron.startNavigation(DOCUMENT)
    reject(navigationError(code, errno))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(unhandled).toEqual([])
    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('a load stopped (ERR_FAILED) a moment before the navigation that replaces it starts is no failure', async () => {
    vi.useFakeTimers()
    const { createMainWindow, REPLACED_LOAD_GRACE_MS } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError('ERR_FAILED', -2))
    createMainWindow({ firstOfStart: true })
    electron.startNavigation(DOCUMENT)
    await vi.advanceTimersByTimeAsync(REPLACED_LOAD_GRACE_MS - 100)
    electron.startNavigation(DOCUMENT)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it.each([
    ['ERR_FAILED', -2, 'ERR_FAILED (-2)'],
    ['ERR_ABORTED', -3, 'ERR_ABORTED (-3)'],
  ])('a first load that ends with %s while no newer navigation starts fails the start after the wait', async (code, errno, shown) => {
    vi.useFakeTimers()
    const { createMainWindow, REPLACED_LOAD_GRACE_MS } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError(code, errno))
    createMainWindow({ firstOfStart: true })
    // Its own navigation, then ones that replace no document: a fragment and a frame (a Card).
    electron.startNavigation(DOCUMENT)
    electron.startNavigation({ isMainFrame: true, isSameDocument: true })
    electron.startNavigation({ isMainFrame: false, isSameDocument: false })
    await vi.advanceTimersByTimeAsync(REPLACED_LOAD_GRACE_MS - 1)
    expect(electron.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(unhandled).toEqual([])
    expect(shownWindow().text).toContain('Step: loadFile')
    expect(shownWindow().text).toContain(shown)
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('a first window closed while its stopped load waits for a newer navigation is no failure of the start', async () => {
    vi.useFakeTimers()
    const { createMainWindow, REPLACED_LOAD_GRACE_MS } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError('ERR_FAILED', -2))
    createMainWindow({ firstOfStart: true })
    electron.startNavigation(DOCUMENT)
    await vi.advanceTimersByTimeAsync(0)
    electron.destroyed = true
    await vi.advanceTimersByTimeAsync(REPLACED_LOAD_GRACE_MS * 2)

    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('a window opened after the start (Dock icon, second start) only logs a failed load and keeps the app running', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { createMainWindow } = await import('../../src/main/window')
      electron.load = () => Promise.reject(navigationError('ERR_FILE_NOT_FOUND', -6))
      createMainWindow()
      await settle()
      await settle()

      expect(unhandled).toEqual([])
      expect(electron.showErrorBox).not.toHaveBeenCalled()
      expect(electron.exit).not.toHaveBeenCalled()
      const written = stderr.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
      expect(written).toContain('the window could not load its page (loadFile)')
      expect(written).toContain('ERR_FILE_NOT_FOUND')
    } finally {
      stderr.mockRestore()
    }
  })

  it('a first window closed while loading is no failure of the start', async () => {
    const { createMainWindow } = await import('../../src/main/window')
    electron.load = () => Promise.reject(navigationError('ERR_FILE_NOT_FOUND', -6))
    electron.destroyed = true
    createMainWindow({ firstOfStart: true })
    await settle()
    await settle()

    expect(unhandled).toEqual([])
    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('loadEndedAsReplaced takes ERR_ABORTED and ERR_FAILED, by code or errno, and nothing else', async () => {
    const { loadEndedAsReplaced } = await import('../../src/main/window')
    expect(loadEndedAsReplaced(navigationError('ERR_ABORTED', -3))).toBe(true)
    expect(loadEndedAsReplaced(navigationError('ERR_FAILED', -2))).toBe(true)
    // Electron leaves `code` empty when did-fail-load reports no description.
    expect(loadEndedAsReplaced(Object.assign(new Error('x'), { code: '', errno: -3 }))).toBe(true)
    expect(loadEndedAsReplaced(Object.assign(new Error('x'), { errno: -2 }))).toBe(true)
    expect(loadEndedAsReplaced(navigationError('ERR_FILE_NOT_FOUND', -6))).toBe(false)
    expect(loadEndedAsReplaced(navigationError('ERR_CONNECTION_REFUSED', -102))).toBe(false)
    expect(loadEndedAsReplaced(new Error('ERR_ABORTED (-3)'))).toBe(false)
    expect(loadEndedAsReplaced('ERR_FAILED')).toBe(false)
    expect(loadEndedAsReplaced(null)).toBe(false)
  })
})

describe('which windows src/main/index.ts opens as the first of the start', () => {
  it('the start opens its window with firstOfStart; a window for the Dock icon or a second start without it', async () => {
    const createMainWindow = vi.fn()
    vi.doMock('../../src/main/window', async () => ({
      ...(await vi.importActual<object>('../../src/main/window')),
      createMainWindow,
    }))
    try {
      const { app } = await import('electron')
      const on = app.on as unknown as ReturnType<typeof vi.fn>
      on.mockClear()
      await import('../../src/main/index')
      await vi.waitFor(() => expect(createMainWindow).toHaveBeenCalledTimes(1))
      expect(createMainWindow).toHaveBeenLastCalledWith({ firstOfStart: true })

      const listener = (event: string) => {
        const found = on.mock.calls.find((call) => call[0] === event)
        if (!found) throw new Error(`no ${event} listener`)
        return found[1] as () => void
      }
      // No window is open (getAllWindows() is empty in this mock): both open a new one.
      await vi.waitFor(() => listener('activate'))
      listener('activate')()
      listener('second-instance')()
      expect(createMainWindow).toHaveBeenCalledTimes(3)
      expect(createMainWindow.mock.calls.slice(1)).toEqual([[], []])
      expect(electron.showErrorBox).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/main/window')
    }
  })
})
