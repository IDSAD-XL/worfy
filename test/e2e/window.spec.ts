import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('a data folder that is a file stops the start with exit code 1 and names the step on stderr', async () => {
  // Started without Playwright: launchApp waits for a window, and this start must never open one.
  const root = await mkdtemp(join(tmpdir(), 'worfy-bad-data-'))
  const dataFile = join(root, 'data')
  await writeFile(dataFile, 'not a folder')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  Object.assign(env, {
    WORFY_DATA_DIR: dataFile,
    WORFY_CLAUDE_HOME: root,
    WORFY_AGENT: 'fake',
    WORFY_GH: join(repoRoot, 'test', 'fixtures', 'gh', 'gh'),
    // The native error window is modal and would hold the process until someone dismisses it.
    WORFY_STARTUP_DIALOG: 'off',
  })
  const electron = createRequire(import.meta.url)('electron') as string
  const child = spawn(electron, [repoRoot], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  // Listen before anything can make it exit: an 'exit' that already fired would never resolve once().
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
  const killer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  try {
    const [code, signal] = await exited
    expect(signal, `stderr:\n${stderr}`).toBeNull()
    expect(code, `stderr:\n${stderr}`).toBe(1)
    expect(stderr).toContain('worfy could not start')
    expect(stderr).toContain('Step: checkDataFolder (checking the data folder) failed.')
    expect(stderr).toContain(`${dataFile} is a file, not a folder`)
    expect(stderr).toContain(`worfy's data folder: ${dataFile}`)
    // The single-instance lock was never tried, so the start is not mistaken for a second worfy.
    expect(stderr).not.toContain('another worfy already runs')
  } finally {
    clearTimeout(killer)
    await removeDir(root)
  }
})

// Preloaded into the main process with `electron -r`: once the first window's page load has
// started, another navigation replaces it before it finishes, as View ▸ Reload or a Vite reload
// under `pnpm dev` does. `reload` lets Chromium start the new navigation first (Electron rejects
// the first load with ERR_ABORTED, -3); `stop-reload` stops the first load before the new
// navigation starts (ERR_FAILED, -2). Lines starting with `[interrupt]` go to stdout.
const INTERRUPT_HOOK = `
const { app } = require('electron')
const say = (line) => process.stdout.write('[interrupt] ' + line + '\\n')
let first = true
app.on('browser-window-created', (_event, window) => {
  if (!first) return
  first = false
  const contents = window.webContents
  const loadURL = contents.loadURL.bind(contents)
  let loads = 0
  // loadFile goes through loadURL: report how the first load's promise settles.
  contents.loadURL = (...args) => {
    const promise = loadURL(...args)
    if (++loads === 1) {
      promise.then(
        () => say('first load resolved'),
        (error) => say('first load rejected ' + error.code + ' ' + error.errno),
      )
    }
    return promise
  }
  let finished = false
  let replaced = false
  contents.on('did-finish-load', () => {
    finished = true
    if (replaced) say('page loaded')
  })
  contents.once('did-start-navigation', () => {
    setImmediate(() => {
      say((finished ? 'too late: ' : '') + 'replacing the load while loading=' + contents.isLoading())
      replaced = true
      if (process.env.E2E_INTERRUPT === 'stop-reload') contents.stop()
      contents.reload()
    })
  })
  window.on('show', () => say('shown'))
})
`

for (const [mode, rejection] of [
  ['reload', 'ERR_ABORTED -3'],
  ['stop-reload', 'ERR_FAILED -2'],
] as const) {
  test(`a first page load replaced by another navigation (${rejection}) is no failure of the start`, async () => {
    // src/main/window.ts tells a replaced load from a failed one by the rejection Electron gives
    // and by a newer navigation; this pins both on the real Electron, which a mocked test cannot.
    // Started without Playwright, as the data-folder test above: the hook goes in with `-r`.
    const root = await mkdtemp(join(tmpdir(), 'worfy-interrupt-'))
    const hook = join(root, 'interrupt.cjs')
    await writeFile(hook, INTERRUPT_HOOK)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    Object.assign(env, {
      WORFY_DATA_DIR: join(root, 'data'),
      WORFY_CLAUDE_HOME: root,
      WORFY_AGENT: 'fake',
      WORFY_GH: join(repoRoot, 'test', 'fixtures', 'gh', 'gh'),
      // A failed start would otherwise hold the process with its modal error window.
      WORFY_STARTUP_DIALOG: 'off',
      E2E_INTERRUPT: mode,
    })
    const electron = createRequire(import.meta.url)('electron') as string
    const child = spawn(electron, ['-r', hook, repoRoot], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        output += chunk
      })
    }
    // Listen before anything can make it exit: an 'exit' that already fired would never resolve once().
    let exit: [number | null, NodeJS.Signals | null] | undefined
    const exited = (once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>).then((result) => {
      exit = result
    })
    try {
      // The replacing navigation loads the page and the window is shown, unless the app exits first.
      const shown = (): boolean => output.includes('[interrupt] page loaded') && output.includes('[interrupt] shown')
      await expect.poll(() => exit !== undefined || shown(), { timeout: 30_000 }).toBe(true)
      expect(exit, `the app exited; output:\n${output}`).toBeUndefined()
      expect(shown()).toBe(true)
      expect(output).toContain('[interrupt] replacing the load while loading=true')
      expect(output).not.toContain('too late')
      expect(output).toContain(`[interrupt] first load rejected ${rejection}`)
      // A failed start would have exited by now: the app reports it as soon as the load settles,
      // or a second after it at the latest (window.ts waits that long for a replacing navigation).
      await new Promise((done) => setTimeout(done, 2_500))
      expect(exit, `output:\n${output}`).toBeUndefined()
      expect(output).not.toContain('worfy could not start')
    } finally {
      if (exit === undefined) {
        child.kill('SIGTERM')
        const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
        await exited
        clearTimeout(killer)
      }
      await removeDir(root)
    }
  })
}

test('the window has no system title bar: traffic lights sit inset in the toolbar', async () => {
  const launched = await launchApp()
  try {
    await expect(launched.window.getByTestId('app-shell')).toBeVisible()
    const frame = await launched.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('no window')
      return {
        bounds: window.getBounds(),
        content: window.getContentBounds(),
        buttons: window.getWindowButtonPosition(),
      }
    })
    // With a system title bar the content area would be shorter than the window.
    expect(frame.content).toEqual(frame.bounds)
    expect(frame.buttons).toEqual({ x: 20, y: 19 })
    const toolbarHeight = await launched.window.locator('header.w-toolbar').evaluate((element) => element.getBoundingClientRect().height)
    expect(toolbarHeight).toBe(52)
  } finally {
    await launched.close()
  }
})

test('the window position and size survive a restart', async () => {
  // One data directory for both runs: the launch helper would give each run a fresh one.
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-window-'))
  // Wholly inside the GitHub macOS runner's display (1024 × 768; the work area is x 0–1024,
  // y 31–708): macOS moves or shrinks a window that sticks out of the display when it is shown,
  // and the window is shown before the test gets it (test/e2e/helpers.ts).
  const wanted = { x: 60, y: 100, width: 900, height: 560 }
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await first.app.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0]?.setBounds(bounds)
      }, wanted)
    } finally {
      await first.close()
    }
    const saved = JSON.parse(await readFile(join(dataDir, 'window-state.json'), 'utf8')) as unknown
    expect(saved).toEqual({ bounds: wanted })

    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const bounds = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
      expect(bounds).toEqual(wanted)
    } finally {
      await second.close()
    }
  } finally {
    await removeDir(dataDir)
  }
})

test('a moved or resized window is saved at once, without waiting for the window to close', async () => {
  const launched = await launchApp()
  const stateFile = join(launched.dataDir, 'window-state.json')
  const wanted = { x: 180, y: 120, width: 960, height: 640 }
  const readSaved = async (): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(stateFile, 'utf8')) as unknown
    } catch {
      return undefined
    }
  }
  const appProcess = launched.app.process()
  try {
    await expect(launched.window.getByTestId('app-shell')).toBeVisible()
    // A drag by the user ends with Electron's 'resized' and 'moved' events. The test emits them
    // itself after setBounds: on the GitHub macOS runner a programmatic setBounds, even an
    // animated one, delivered neither event within 5 s, while a desktop session does. The window
    // is never closed in this test.
    await launched.app.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('no window')
      window.setBounds(bounds)
      window.emit('resized')
      window.emit('moved')
    }, wanted)
    await expect.poll(readSaved, { timeout: 5_000 }).toEqual({ bounds: wanted })
    // A crash or a kill skips the 'close' event: what is on disk is all that survives.
    // Listen before the kill: an 'exit' that has already fired would never resolve once().
    const exited = once(appProcess, 'exit')
    appProcess.kill('SIGKILL')
    await exited
    expect(await readSaved()).toEqual({ bounds: wanted })
  } finally {
    // Still running only when the test failed before the kill.
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      await launched.app.close()
    }
    await removeDir(launched.dataDir)
    await removeDir(launched.claudeHome)
  }
})
