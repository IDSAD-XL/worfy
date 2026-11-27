import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeSettings, launchApp, openSecondWindow, openVersionPopover, smallestWindow } from './helpers'
import { clickMenuItem } from './menu'

// worfy-ui ticket 20: worfy's own memory, and the switch of Settings → General that hides it in every open
// window at once, without a reload. Since worfy-layout ticket 03 the figure is the last row of the version chip's
// popover in the footer (src/renderer/shell/footer/VersionChip.tsx), "Memory in the version popover". Playwright
// cannot press the menu's Cmd/Ctrl+, accelerator, so Settings opens by the menu item's id (clickMenuItem), as
// test/e2e/settings.spec.ts does.

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
const FIGURE = /^\d+(\.\d)? (MB|GB)$/
const SWITCH = "Show worfy's memory in the version popover"

test('the memory figure shows by default in the version popover; the switch in Settings hides it in every open window and brings it back, without a reload', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    const popover = await openVersionPopover(window)
    const figure = popover.getByTestId('app-memory')
    await expect(figure).toHaveText(FIGURE)
    await expect(figure).toHaveAttribute('title', /^Memory used by worfy's own processes \(not counting terminal sessions\)\nMain \d+(\.\d)? (MB|GB) · Windows /)
    // The last row of the popover, under the app version's.
    const row = popover.getByTestId('version-memory-line')
    await expect(row).toHaveText(/^Memory\d+(\.\d)? (MB|GB)$/)
    const appRow = await popover.getByTestId('version-app-line').boundingBox()
    const shown = await row.boundingBox()
    expect(appRow !== null && shown !== null && shown.y >= appRow.y + appRow.height).toBe(true)
    await window.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // At the smallest window the figure is one line high, and the popover stays inside the window.
    const page = await smallestWindow(launched)
    // The page is no larger than the window (a frame, where the system draws one, takes part of it).
    expect(page.width).toBeLessThanOrEqual(801)
    expect(page.height).toBeLessThanOrEqual(521)
    await openVersionPopover(window)
    const frame = await popover.boundingBox()
    const small = await figure.boundingBox()
    expect(frame !== null && small !== null).toBe(true)
    expect(small!.height, 'the figure is one line').toBeLessThan(20)
    expect(frame!.x, 'the popover starts inside the window').toBeGreaterThanOrEqual(0)
    expect(frame!.y, 'the popover starts inside the window').toBeGreaterThanOrEqual(0)
    expect(frame!.x + frame!.width, 'the popover ends inside the window').toBeLessThanOrEqual(page.width)
    await window.keyboard.press('Escape')

    const second = await openSecondWindow(launched)
    const secondFigure = (await openVersionPopover(second)).getByTestId('app-memory')
    await expect(secondFigure).toHaveText(FIGURE)
    await second.keyboard.press('Escape')

    // A mark on the page: a reload would drop it.
    await window.evaluate(() => {
      ;(globalThis as { memoryMark?: boolean }).memoryMark = true
    })

    const openSettings = async () => {
      await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
      const dialog = window.getByRole('dialog', { name: 'Settings' })
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('General')
      return dialog.getByRole('switch', { name: SWITCH, exact: true })
    }
    let toggle = await openSettings()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(JSON.parse(readFileSync(join(launched.dataDir, 'app-settings.json'), 'utf8'))).toMatchObject({ memoryIndicator: false })
    await closeSettings(window)
    // Off: no memory row in either window's popover; the version keeps its place.
    await openVersionPopover(window)
    await expect(popover.getByTestId('version-app-line')).toBeVisible()
    await expect(popover.getByTestId('version-memory-line')).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect((await openVersionPopover(second)).getByTestId('version-memory-line')).toHaveCount(0)
    await second.keyboard.press('Escape')

    toggle = await openSettings()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await closeSettings(window)
    await openVersionPopover(window)
    await expect(figure).toHaveText(FIGURE)
    await window.keyboard.press('Escape')
    await openVersionPopover(second)
    await expect(secondFigure).toHaveText(FIGURE)

    expect(await window.evaluate(() => (globalThis as { memoryMark?: boolean }).memoryMark)).toBe(true)
  } finally {
    await launched.close()
  }
})
