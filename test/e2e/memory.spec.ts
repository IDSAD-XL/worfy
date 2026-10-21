import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeSettings, launchApp, openSecondWindow } from './helpers'
import { clickMenuItem } from './menu'

// worfy-ui ticket 20: worfy's own memory on the second line of the toolbar's Harness column, after
// the app version, and the switch of Settings → General that hides it in every open window at once,
// without a reload. Playwright cannot press the menu's Cmd/Ctrl+, accelerator, so Settings opens by
// the menu item's id (clickMenuItem), as test/e2e/settings.spec.ts does.

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
const FIGURE = /^\d+(\.\d)? (MB|GB)$/
const SWITCH = "Show worfy's memory in the toolbar"

test('the memory figure shows by default; the switch in Settings hides it in every open window and brings it back, without a reload', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    const figure = window.getByRole('banner').getByTestId('app-memory')
    await expect(figure).toHaveText(FIGURE)
    await expect(figure).toHaveAttribute('title', /^Memory used by worfy's own processes \(not counting terminal sessions\)\nMain \d+(\.\d)? (MB|GB) · Windows /)
    // On the line of the app version, after it.
    const line = window.getByTestId('app-line')
    await expect(line.getByTestId('app-version')).toBeVisible()
    await expect(line.getByTestId('app-memory')).toBeVisible()
    const version = await line.getByTestId('app-version').boundingBox()
    const shown = await figure.boundingBox()
    expect(version !== null && shown !== null && shown.x >= version.x + version.width).toBe(true)

    // At the smallest window the figure stays on the version's line, one line high, inside the toolbar.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(800, 520))
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeLessThanOrEqual(800)
    const bar = await window.getByRole('banner').boundingBox()
    const lineBox = await line.boundingBox()
    const small = await figure.boundingBox()
    expect(lineBox !== null && small !== null && bar !== null).toBe(true)
    expect(small!.height, 'the figure is one line').toBeLessThan(20)
    expect(Math.abs(small!.y - lineBox!.y), 'the figure is on the version line').toBeLessThan(4)
    expect(lineBox!.y + lineBox!.height, 'the line is inside the toolbar').toBeLessThanOrEqual(bar!.y + bar!.height)

    const second = await openSecondWindow(launched)
    const secondFigure = second.getByRole('banner').getByTestId('app-memory')
    await expect(secondFigure).toHaveText(FIGURE)

    // A mark on the page: a reload would drop it.
    await window.evaluate(() => {
      ;(globalThis as { memoryMark?: boolean }).memoryMark = true
    })

    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('General')
    const toggle = dialog.getByRole('switch', { name: SWITCH, exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(figure).toHaveCount(0)
    await expect(secondFigure).toHaveCount(0)
    // The version keeps its place.
    await expect(window.getByRole('banner').getByTestId('app-version')).toBeVisible()
    expect(JSON.parse(readFileSync(join(launched.dataDir, 'app-settings.json'), 'utf8'))).toMatchObject({ memoryIndicator: false })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(figure).toHaveText(FIGURE)
    await expect(secondFigure).toHaveText(FIGURE)
    await closeSettings(window)

    expect(await window.evaluate(() => (globalThis as { memoryMark?: boolean }).memoryMark)).toBe(true)
  } finally {
    await launched.close()
  }
})
