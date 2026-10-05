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
