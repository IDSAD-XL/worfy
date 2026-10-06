import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

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
