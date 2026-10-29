import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// worfy-ui ticket 2: the Settings window against the built app. Playwright cannot press the menu's
// Cmd/Ctrl+, accelerator, so the test clicks "Settings…" by its id (clickMenuItem), with the window
// a real click passes; the key itself is a manual check. Snapshots in both themes:
// test-results/e2e/snapshots/settings-*/ (test/e2e/snapshots.ts).

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'

test('the menu that carries Settings… keeps every item of the Electron role it spells out', async () => {
  // src/main/menu.ts replaces a role (appMenu on macOS, fileMenu elsewhere) by a list of its items,
  // because "Settings…" goes inside. The list is compared with what this Electron builds from the
  // bare role, so an item the role has and the list forgot fails here.
  const launched = await launchApp()
  try {
    const menus = await launched.app.evaluate(({ Menu }, settingsId) => {
      const role: 'appMenu' | 'fileMenu' = process.platform === 'darwin' ? 'appMenu' : 'fileMenu'
      const bare = Menu.buildFromTemplate([{ role }]).items[0]?.submenu?.items
      const installed = Menu.getApplicationMenu()?.items[0]?.submenu?.items
      if (!bare || !installed) throw new Error('the app menu or the menu of the bare role has no items')
      const names = (items: Electron.MenuItem[]): string[] => items.map((item) => (item.type === 'separator' ? 'separator' : String(item.role ?? item.label).toLowerCase()))
      const at = installed.findIndex((item) => item.id === settingsId)
      // Settings… and the separator after it are worfy's; the rest is the role's.
      const rest = installed.filter((_item, index) => index !== at && index !== at + 1)
      return { platform: process.platform, at, afterSettings: installed[at + 1]?.type, expected: names(bare), actual: names(rest) }
    }, SETTINGS_MENU_ITEM_ID)
    // After About and its separator on macOS; the first item of File elsewhere.
    expect(menus.at).toBe(menus.platform === 'darwin' ? 2 : 0)
    expect(menus.afterSettings).toBe('separator')
    expect(menus.expected.length).toBeGreaterThan(0)
    expect(menus.actual).toEqual(menus.expected)
  } finally {
    await launched.close()
  }
})

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

    // The keyboard stays in the window: Tab goes through the rows of the section list, however many
    // sections there are, then the controls of the section shown — the interface scale slider of
    // General and the switch of worfy's memory in the toolbar (worfy-ui ticket 20) — then Close,
    // and round to the first row again.
    const rows = await sections.count()
    expect(rows).toBeGreaterThan(0)
    for (let row = 0; row < rows; row++) {
      await expect(sections.nth(row)).toBeFocused()
      await window.keyboard.press('Tab')
    }
    await expect(dialog.getByRole('slider', { name: 'Interface scale' })).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(dialog.getByRole('switch', { name: "Show worfy's memory in the toolbar" })).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await snapshotThemes(window, 'settings-focus')
    await window.keyboard.press('Tab')
    await expect(sections.first()).toBeFocused()

    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await window.keyboard.press('ControlOrMeta+k')
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

/** Resolves after the renderer has drawn a frame, so a render the last key caused is on screen. */
const nextFrame = (window: Page): Promise<void> =>
  window.evaluate(() => new Promise<void>((resolve) => (globalThis as unknown as { requestAnimationFrame(cb: () => void): void }).requestAnimationFrame(() => resolve())))

/** Whether what is drawn on top at the middle of the element is the element itself or something inside it. */
async function onTop(locator: Locator): Promise<boolean> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return locator.evaluate(
    (node, point) => {
      const element = node as unknown as { ownerDocument: { elementFromPoint(x: number, y: number): unknown }; contains(other: unknown): boolean }
      const top = element.ownerDocument.elementFromPoint(point.x, point.y)
      return top !== null && element.contains(top)
    },
    { x: found.x + found.width / 2, y: found.y + found.height / 2 },
  )
}

/** Whether the keyboard focus is on the element or inside it. */
const holdsFocus = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => {
    const element = node as unknown as { ownerDocument: { activeElement: unknown }; contains(other: unknown): boolean }
    return element.contains(element.ownerDocument.activeElement)
  })

/** Takes the focus off the focused control of `dialog`, as when a focused element goes away: the page has it then. */
async function focusToPage(window: Page, dialog: Locator): Promise<void> {
  await dialog.locator(':focus').evaluate((element) => (element as unknown as { blur(): void }).blur())
  await expect(window.locator('body')).toBeFocused()
}

test('Settings is modal: ⌘K, ⌘F and ⌘↩ do nothing under it, also with the focus on the page, where Tab comes back and Esc closes; it opens over focus mode and leaves it as it was', async () => {
  // A Project with two notes: ⌘F searches its Canvas and ⌘↩ opens focus mode on the selected note.
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-settings-')))
  const PROJECT = 'alpha-0000000a'
  const dataDir = join(scratch, 'data')
  mkdirSync(join(scratch, 'alpha'))
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: join(scratch, 'alpha') }], activeId: PROJECT }))
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, data: { text: 'one' } },
        { id: 'n2', kind: 'note', x: 300, y: 40, w: 220, h: 120, data: { text: 'two' } },
      ],
      viewport: { x: 30, y: 20, zoom: 1 },
    }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    const selectNote = async (): Promise<void> => {
      await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    }
    await selectNote()

    const dialog = window.getByRole('dialog', { name: 'Settings' })
    const palette = window.getByTestId('command-palette')
    const find = window.getByTestId('canvas-find')
    const focusMode = window.getByTestId('focus-mode')
    const sections = dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')
    /** The app's shortcuts, pressed while Settings is open: none of them does anything. */
    const shortcutsDoNothing = async (): Promise<void> => {
      for (const keys of ['ControlOrMeta+k', 'ControlOrMeta+f', 'ControlOrMeta+Enter']) {
        await window.keyboard.press(keys)
        await nextFrame(window)
        await expect(palette, keys).toHaveCount(0)
        await expect(find, keys).toHaveCount(0)
        await expect(focusMode, keys).toHaveCount(0)
        await expect(dialog, keys).toBeVisible()
      }
    }

    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(dialog).toBeVisible()
    await expect(sections.first()).toBeFocused()
    await shortcutsDoNothing()

    // The focus on the page behind, as after a focused element went away.
    await focusToPage(window, dialog)
    await shortcutsDoNothing()
    await window.keyboard.press('Tab')
    await expect(sections.first()).toBeFocused()
    await focusToPage(window, dialog)
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    // Nothing behind took that Esc or the keys before it: the note is still selected.
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

    // Closed, the same keys work, so the checks above were not empty.
    await window.keyboard.press('ControlOrMeta+k')
    await expect(palette).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await window.keyboard.press('ControlOrMeta+f')
    await expect(find).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(find).toHaveCount(0)

    // Focus mode is drawn in the main area, under the Settings window: "Settings…" opens over it.
    await selectNote()
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(focusMode).toBeVisible()
    const tileText = focusMode.getByTestId('focus-tile').getByRole('textbox', { name: 'Note text' })
    await expect(tileText).toHaveCount(1)
    await expect(tileText).toHaveValue('one')
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(dialog).toBeVisible()
    expect(await onTop(dialog)).toBe(true)
    // A click on a section reaches the window: Playwright clicks only what is drawn on top at that
    // point. Machines, not Health: Health would check this Machine's tools for the snapshot.
    const machines = sections.filter({ hasText: 'Machines' })
    await machines.click()
    await expect(machines).toHaveAttribute('aria-current', 'true')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Machines')
    await snapshotThemes(window, 'settings-over-focus')
    // Under the window the app's shortcuts do nothing, and focus mode stays as it was.
    for (const keys of ['ControlOrMeta+k', 'ControlOrMeta+f', 'ControlOrMeta+Enter']) {
      await window.keyboard.press(keys)
      await nextFrame(window)
      await expect(palette, keys).toHaveCount(0)
      await expect(find, keys).toHaveCount(0)
      await expect(dialog, keys).toBeVisible()
      await expect(tileText, keys).toHaveValue('one')
    }
    // Esc closes the window alone: focus mode is there with the same tile and has the keyboard focus back.
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(focusMode).toBeVisible()
    await expect(tileText).toHaveValue('one')
    expect(await holdsFocus(focusMode)).toBe(true)
    // The next Esc is focus mode's, as before.
    await window.keyboard.press('Escape')
    await expect(focusMode).toHaveCount(0)

    // From the palette too: it opens over focus mode, and the window opens over both.
    await selectNote()
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(focusMode).toBeVisible()
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('Settings')
    await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'settings')
    await window.getByTestId('palette-input').press('Enter')
    await expect(dialog).toBeVisible()
    await expect(palette).toHaveCount(0)
    expect(await onTop(dialog)).toBe(true)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(focusMode).toBeVisible()
    await expect(tileText).toHaveValue('one')
  } finally {
    await launched.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('Settings → Autopilot: the daily budget is off at first with the reserve disabled; on, the reserve can be picked, and both are kept in app-settings.json', async () => {
  // worfy-throughput ticket 41: the budget of the Limits for Autopilot. No price anywhere.
  const launched = await launchApp()
  try {
    const { app, window, dataDir } = launched
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Autopilot', exact: true }).click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Autopilot')

    const budget = dialog.getByRole('switch', { name: 'Daily budget of the Limits', exact: true })
    const reserve = dialog.getByTestId('settings-autopilot-reserve')
    const reserveRow = dialog.getByTestId('settings-autopilot-reserve-row')
    await expect(budget).toHaveAttribute('aria-checked', 'false')
    await expect(reserve).toBeDisabled()
    await expect(reserve).toHaveText(/15 % of the week/)
    await expect(reserveRow).toHaveAttribute('data-disabled', '')
    await expect(dialog).not.toContainText(/\$|USD|€|price/i)
    await snapshotThemes(window, 'settings-autopilot-off')

    await budget.click()
    await expect(budget).toHaveAttribute('aria-checked', 'true')
    await expect(reserve).toBeEnabled()
    await expect(reserveRow).not.toHaveAttribute('data-disabled', '')
    await reserve.click()
    await window.getByRole('option', { name: '25 % of the week', exact: true }).click()
    await expect(reserve).toHaveText(/25 % of the week/)
    await snapshotThemes(window, 'settings-autopilot-on')
    await expect
      .poll(() => (JSON.parse(readFileSync(join(dataDir, 'app-settings.json'), 'utf8')) as { autopilotBudget?: unknown }).autopilotBudget)
      .toEqual({ enabled: true, reservePercent: 25 })

    await budget.click()
    await expect(budget).toHaveAttribute('aria-checked', 'false')
    await expect(reserve).toBeDisabled()
    await expect(reserve).toHaveText(/25 % of the week/)
  } finally {
    await launched.close()
  }
})
