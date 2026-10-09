import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// worfy-ui ticket 2: the Settings window against the built app. Playwright cannot press the menu's
// Cmd/Ctrl+, accelerator, so the test clicks "Settings…" by its id (clickMenuItem), with the window
// a real click passes; the key itself is a manual check. Snapshots in both themes:
// test-results/snapshots/settings-*/ (test/e2e/snapshots.ts).

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'

test('Settings… in the menu opens Settings with General and the version; Esc closes it; the palette opens it again', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    const toolbarVersion = window.getByTestId('app-version')
    await expect(toolbarVersion).toHaveText(/^v\S+$/)
    const version = (await toolbarVersion.textContent())!.slice(1)

    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('General')
    const sections = dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')
    await expect(sections.first()).toHaveText('General')
    await expect(sections.first()).toHaveAttribute('aria-current', 'true')
    await expect(dialog.getByTestId('settings-version')).toHaveText(version)
    // Above everything else of the window: the backdrop covers the toolbar.
    await expect(window.locator('.w-settings__backdrop')).toHaveCSS('z-index', '110')
    await snapshotThemes(window, 'settings-general')

    // The keyboard stays in the window: Tab goes round its controls back to the section list.
    await expect(sections.first()).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(sections.first()).toBeFocused()
    await snapshotThemes(window, 'settings-focus')

    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await window.keyboard.press('Meta+k')
    const input = window.getByTestId('palette-input')
    await input.fill('Settings')
    await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'settings')
    await snapshotThemes(window, 'settings-palette')
    await input.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('General')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
