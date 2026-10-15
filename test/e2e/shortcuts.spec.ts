import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes, type ThemeSnapshots } from './snapshots'

// worfy-ui ticket 11: the Keyboard shortcuts window against the built app. "?" on the Canvas opens
// it and Esc closes it; Help ▸ Keyboard Shortcuts opens it — clicked by its id (clickMenuItem):
// Playwright cannot press the menu's Cmd/Ctrl+/ accelerator, so the key itself is a manual check —,
// also over focus mode, which stays under it; Settings → Shortcuts shows the same list; and ⌘K, ⌘F
// and ⌘↩, now read from the registry of shortcuts, work as before. Snapshots in both themes:
// test-results/snapshots/shortcuts*/ (test/e2e/snapshots.ts); with WORFY_EVIDENCE_DIR set, the
// window's two are copied there as 11-shortcuts-light.png and 11-shortcuts-dark.png.

/** SHORTCUTS_MENU_ITEM_ID and SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron. */
const SHORTCUTS_MENU_ITEM_ID = 'help.shortcuts'
const SETTINGS_MENU_ITEM_ID = 'app.settings'

const PROJECT = 'alpha-0000000a'

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string
let dataDir: string

test.beforeEach(() => {
  // A Project with two notes: ⌘F searches its Canvas and ⌘↩ opens focus mode on the selected note.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-shortcuts-')))
  dataDir = join(scratch, 'data')
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
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Copies the two snapshots of the window into WORFY_EVIDENCE_DIR, when it is set. */
async function keepEvidence(shots: ThemeSnapshots, name: string): Promise<void> {
  const evidence = process.env.WORFY_EVIDENCE_DIR
  if (evidence === undefined || evidence === '') return
  await mkdir(evidence, { recursive: true })
  await copyFile(shots.light, join(evidence, `${name}-light.png`))
  await copyFile(shots.dark, join(evidence, `${name}-dark.png`))
}

/** Resolves after the renderer has drawn a frame, so a render the last key caused is on screen. */
const nextFrame = (window: Page): Promise<void> =>
  window.evaluate(() => new Promise<void>((resolve) => (globalThis as unknown as { requestAnimationFrame(cb: () => void): void }).requestAnimationFrame(() => resolve())))

test('"?" on the Canvas opens Keyboard shortcuts in groups and Esc closes it; "?" in a note does not', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    const shortcuts = window.getByRole('dialog', { name: 'Keyboard shortcuts' })

    // In the text of a note "?" is a character.
    const text = window.locator('.react-flow__node[data-id="n1"]').getByRole('textbox', { name: 'Note text' })
    await text.click()
    await window.keyboard.press('Shift+Slash')
    await nextFrame(window)
    await expect(shortcuts).toHaveCount(0)
    await expect(text).toHaveValue(/\?/)

    // On the plane of the Canvas it opens the window.
    await window.locator('.react-flow__pane').click({ position: { x: 600, y: 400 } })
    await window.keyboard.press('Shift+Slash')
    await expect(shortcuts).toBeVisible()
    await expect(shortcuts.getByRole('heading', { level: 3 })).toHaveText(['Window', 'Canvas', 'Focus mode', 'Find', 'Session', 'Terminal'])
    const mac = process.platform === 'darwin'
    await expect(shortcuts.locator('[data-shortcut="palette"] kbd')).toHaveText(mac ? '⌘K' : 'Ctrl+K')
    await expect(shortcuts.locator('[data-shortcut="session.new-line"] kbd')).toHaveText(mac ? '⇧⏎' : 'Shift+Enter')
    // Above everything else of the window, in the layer of Settings.
    await expect(window.locator('.w-shortcuts__backdrop')).toHaveCSS('z-index', '110')
    await keepEvidence(await snapshotThemes(window, 'shortcuts'), '11-shortcuts')

    await window.keyboard.press('Escape')
    await expect(shortcuts).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('Help ▸ Keyboard Shortcuts opens the window, over focus mode too, and Esc leaves focus mode as it was', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    const shortcuts = window.getByRole('dialog', { name: 'Keyboard shortcuts' })

    await clickMenuItem(app, SHORTCUTS_MENU_ITEM_ID)
    await expect(shortcuts).toBeVisible()
    await shortcuts.getByRole('button', { name: 'Close' }).click()
    await expect(shortcuts).toHaveCount(0)

    // Focus mode on the selected note: the window opens over its layer and takes a click.
    await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
    await window.keyboard.press('ControlOrMeta+Enter')
    const focusMode = window.getByTestId('focus-mode')
    await expect(focusMode).toBeVisible()
    await clickMenuItem(app, SHORTCUTS_MENU_ITEM_ID)
    await expect(shortcuts).toBeVisible()
    await shortcuts.getByRole('heading', { name: 'Keyboard shortcuts' }).click()
    await snapshotThemes(window, 'shortcuts-focus-mode')
    await window.keyboard.press('Escape')
    await expect(shortcuts).toHaveCount(0)
    await nextFrame(window)
    await expect(focusMode).toBeVisible()
    // The next Esc is focus mode's again.
    await window.keyboard.press('Escape')
    await expect(focusMode).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('Settings → Shortcuts shows the list of the window; Help ▸ Keyboard Shortcuts with Settings open shows that section', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    const settings = window.getByRole('dialog', { name: 'Settings' })
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(settings).toBeVisible()
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Shortcuts' }).click()
    await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Shortcuts')
    const inSettings = await settings.locator('[data-shortcut]').evaluateAll((rows) => rows.map((row) => (row as unknown as { textContent: string }).textContent))
    expect(inSettings.length).toBeGreaterThan(10)
    await snapshotThemes(window, 'shortcuts-settings')

    // Back to General; the menu item shows the Shortcuts section, not a second window.
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'General' }).click()
    await clickMenuItem(app, SHORTCUTS_MENU_ITEM_ID)
    await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Shortcuts')
    await expect(window.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect(settings).toHaveCount(0)

    await clickMenuItem(app, SHORTCUTS_MENU_ITEM_ID)
    const shortcuts = window.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcuts).toBeVisible()
    const inWindow = await shortcuts.locator('[data-shortcut]').evaluateAll((rows) => rows.map((row) => (row as unknown as { textContent: string }).textContent))
    expect(inWindow).toEqual(inSettings)
  } finally {
    await launched.close()
  }
})

test('⌘K, ⌘F and ⌘↩ work as before the registry; the palette opens Keyboard shortcuts', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await window.locator('.react-flow__pane').click({ position: { x: 600, y: 400 } })

    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    const input = window.getByTestId('palette-input')
    await input.fill('Keyboard shortcuts')
    await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'shortcuts')
    await input.press('Enter')
    await expect(palette).toHaveCount(0)
    const shortcuts = window.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcuts).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(shortcuts).toHaveCount(0)

    await window.keyboard.press('ControlOrMeta+f')
    await expect(window.getByTestId('find-input')).toBeFocused()
    await window.getByTestId('find-input').press('Escape')
    await expect(window.getByTestId('canvas-find')).toHaveCount(0)

    await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(window.getByTestId('focus-mode')).toBeVisible()
  } finally {
    await launched.close()
  }
})
