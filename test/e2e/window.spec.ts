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

test('a page load cut short by another navigation rejects with the ERR_ABORTED that the start ignores', async () => {
  // src/main/window.ts (loadWasAborted) tells a replaced load from a failed one by Electron's
  // `code` and `errno`; this pins that shape on the real Electron, which a mocked test cannot.
  const launched = await launchApp()
  try {
    await expect(launched.window.getByTestId('app-shell')).toBeVisible()
    const rejection = await launched.app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('no window')
      // Without the fragment: a load of the same document with another fragment would only scroll.
      const [url = ''] = window.webContents.getURL().split('#')
      const first = window.loadURL(`${url}?first`).then(
        () => null,
        (error: { code?: unknown; errno?: unknown }) => ({ code: error.code, errno: error.errno }),
      )
      // A second navigation while the first load runs replaces it, as View ▸ Reload or a Vite
      // reload does.
      await window.loadURL(url)
      return first
    })
    expect(rejection).toEqual({ code: 'ERR_ABORTED', errno: -3 })
    // The app is still there with its window.
    await expect(launched.window.getByTestId('app-shell')).toBeVisible()
  } finally {
    await launched.close()
  }
})

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
