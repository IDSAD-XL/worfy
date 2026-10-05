import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

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
  const wanted = { x: 140, y: 160, width: 1000, height: 700 }
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
    await rm(dataDir, { recursive: true, force: true })
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
  try {
    await expect(launched.window.getByTestId('app-shell')).toBeVisible()
    // animate: true makes macOS report the change as a finished move/resize ('moved', 'resized'),
    // as a drag by the user does; the window is never closed in this test.
    await launched.app.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0]?.setBounds(bounds, true)
    }, wanted)
    await expect.poll(readSaved, { timeout: 5_000 }).toEqual({ bounds: wanted })
    // A crash or a kill skips the 'close' event: what is on disk is all that survives.
    launched.app.process().kill('SIGKILL')
    expect(await readSaved()).toEqual({ bounds: wanted })
  } finally {
    if (launched.app.process().exitCode === null && !launched.app.process().killed) {
      await launched.app.close()
    }
    await rm(launched.dataDir, { recursive: true, force: true })
    await rm(launched.claudeHome, { recursive: true, force: true })
  }
})
