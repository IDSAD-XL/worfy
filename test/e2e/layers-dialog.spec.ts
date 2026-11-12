import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'
import { printJoined } from './terminal-shell'
import { startUpdateStub, type UpdateStub } from '../update-stub'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// The modal window of the kit (theme/kit/Dialog.tsx, worfy-ui-kit ticket 04) in the built app, in
// the places a layer can go wrong (spec of the Epic, «Seam 2»): over the Canvas, next to a Terminal
// Node, over focus mode, and with a toast on screen. Settings, Keyboard shortcuts and the Guide are
// the windows on it. What is drawn on top is read with document.elementFromPoint; a click is
// Playwright's, which presses only what is on top at that point.

test.setTimeout(ms(120_000))

/** The ids of the app menu (src/main/menu.ts); that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
const SHORTCUTS_MENU_ITEM_ID = 'help.shortcuts'
const GUIDE_MENU_ITEM_ID = 'help.guide'
const PROJECT = 'layers-000000d4'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string
let dataDir: string
let stub: UpdateStub | undefined

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-layers-dialog-')))
  dataDir = join(scratch, 'data')
})

test.afterEach(async () => {
  await stub?.close()
  stub = undefined
  await removeDir(scratch)
})

/** The data folder with one Project whose Canvas holds `nodes`. */
function makeData(nodes: unknown[]): void {
  mkdirSync(join(scratch, 'layers'), { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'layers', path: join(scratch, 'layers') }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 30, y: 20, zoom: 1 } }))
}

const NOTES = [
  { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, data: { text: 'one' } },
  { id: 'n2', kind: 'note', x: 300, y: 40, w: 220, h: 120, data: { text: 'two' } },
]

/** What is drawn on top at the middle of `locator`: whether it lies inside `owner`. */
async function topAt(locator: Locator, owner: Locator): Promise<boolean> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('the element has no box')
  const handle = await owner.elementHandle()
  return locator.page().evaluate(
    ({ point, element }) => {
      const doc = (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): unknown } }).document
      const top = doc.elementFromPoint(point.x, point.y)
      return top !== null && (element as unknown as { contains(other: unknown): boolean }).contains(top)
    },
    { point: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, element: handle },
  )
}

/** Whether the element or one of its ancestors is hidden from assistive tech (aria-hidden or inert). */
const hiddenFromScreenReader = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => {
    for (let at = node as unknown as { getAttribute(name: string): string | null; hasAttribute(name: string): boolean; parentElement: unknown } | null; at !== null; at = at.parentElement as typeof at) {
      if (at.getAttribute('aria-hidden') === 'true' || at.hasAttribute('inert')) return true
    }
    return false
  })

/** Whether the keyboard focus is on the element or inside it. */
const holdsFocus = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => {
    const element = node as unknown as { ownerDocument: { activeElement: unknown }; contains(other: unknown): boolean }
    return element.contains(element.ownerDocument.activeElement)
  })

/** Resolves after the renderer has drawn a frame. */
const nextFrame = (window: Page): Promise<void> =>
  window.evaluate(() => new Promise<void>((resolve) => (globalThis as unknown as { requestAnimationFrame(cb: () => void): void }).requestAnimationFrame(() => resolve())))

test('over the Canvas and over focus mode: the window is on top, a press beside it does not reach the Canvas, Esc closes only the window', async () => {
  makeData(NOTES)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1280, height: 800 } })
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    const note = window.locator('.react-flow__node[data-id="n1"]')
    await note.locator('.w-note__header').click()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

    // Settings over the Canvas: on top in its middle and over the notes; the page behind is hidden
    // from a screen reader.
    const settings = window.getByRole('dialog', { name: 'Settings' })
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(settings).toBeVisible()
    expect(await topAt(settings, settings)).toBe(true)
    expect(await topAt(note, window.locator('.w-settings__backdrop'))).toBe(true)
    expect(await hiddenFromScreenReader(note)).toBe(true)
    expect(await hiddenFromScreenReader(settings)).toBe(false)
    await snapshotThemes(window, 'layers-dialog-canvas')
    // A press beside the window does not reach the Canvas: the note keeps its selection, and
    // Settings stays open (its backdrop does not close it).
    await window.mouse.click(1240, 760)
    await nextFrame(window)
    await expect(settings).toBeVisible()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    await window.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    expect(await hiddenFromScreenReader(note)).toBe(false)

    // The Guide over the Canvas: a press on its backdrop closes it, and the press stops there.
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    await expect(guide).toBeVisible()
    expect(await topAt(guide, guide)).toBe(true)
    await window.mouse.click(8, 400)
    await expect(guide).toHaveCount(0)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

    // Over focus mode: Keyboard shortcuts on top of the tile; Esc closes the window alone and gives
    // focus mode the keyboard back; the next Esc is focus mode's.
    await window.keyboard.press('ControlOrMeta+Enter')
    const focusMode = window.getByTestId('focus-mode')
    await expect(focusMode).toBeVisible()
    const tile = focusMode.getByTestId('focus-tile')
    const shortcuts = window.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await clickMenuItem(app, SHORTCUTS_MENU_ITEM_ID)
    await expect(shortcuts).toBeVisible()
    expect(await topAt(shortcuts, shortcuts)).toBe(true)
    expect(await topAt(tile, window.locator('.w-shortcuts__backdrop'))).toBe(true)
    await snapshotThemes(window, 'layers-dialog-focus-mode')
    await window.keyboard.press('Escape')
    await expect(shortcuts).toHaveCount(0)
    await expect(focusMode).toBeVisible()
    expect(await holdsFocus(focusMode)).toBe(true)
    await window.keyboard.press('Escape')
    await expect(focusMode).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('next to a Terminal Node: keys typed while Settings is open never reach the shell, and Tab stays in the window', async () => {
  makeData([{ id: 'term', kind: 'terminal', x: 40, y: 40, w: 560, h: 340, data: {} }])
  const home = join(scratch, 'home')
  mkdirSync(home)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, SHELL: '/bin/sh', HOME: home, ...windowsProfileEnv(join(scratch, 'profile')) } })
  try {
    const { app, window } = launched
    const terminal = window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    await expect(terminal).toHaveAttribute('data-state', 'running')
    const screen = terminal.getByTestId('terminal-screen')
    const screenText = async (): Promise<string> => (await terminal.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')
    // The terminal has the keyboard before the window opens.
    await screen.click()

    const settings = window.getByRole('dialog', { name: 'Settings' })
    const sections = settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(settings).toBeVisible()
    await expect(sections.first()).toBeFocused()
    expect(await topAt(terminal, window.locator('.w-settings__backdrop'))).toBe(true)
    await window.keyboard.type(printJoined('lost', '-typing'))
    await window.keyboard.press('Enter')
    // Tab goes round the window and never into the terminal.
    for (let step = 0; step < 12; step++) {
      await window.keyboard.press('Tab')
      expect(await holdsFocus(settings)).toBe(true)
    }
    await window.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    // The focus is back on the terminal; what is typed now reaches the shell, and nothing before did.
    await window.keyboard.type(printJoined('mark', 'er-after'))
    await window.keyboard.press('Enter')
    await expect.poll(screenText, { timeout: ms(10_000) }).toMatch(/^marker-after$/m)
    expect(await screenText()).not.toContain('lost-typing')
  } finally {
    await launched.close()
  }
})

test('with a toast on screen: the toast is above the window, a press on it does not close the window, and a screen reader still hears it', async () => {
  // A build ready at the start shows the sticky toast "worfy <version> ready" (as update-toasts.spec.ts).
  makeData(NOTES)
  const sha = 'd'.repeat(40)
  const version = `0.9.0+${sha.slice(0, 7)}`
  mkdirSync(join(dataDir, 'update'), { recursive: true })
  writeFileSync(
    join(dataDir, 'update', 'state.json'),
    JSON.stringify({ available: { sha, version, quiet: false }, build: { phase: 'ready', sha, version, appPath: join(tmpdir(), 'worfy-e2e-layers-dialog-not-there.app') } }),
  )
  stub = await startUpdateStub({ head: sha, version: '0.9.0' }, { stable: join(scratch, 'stable') })
  const launched = await launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: join(scratch, 'claude-home'),
      WORFY_UPDATE: '1',
      WORFY_UPDATE_API: stub.url,
      WORFY_UPDATE_STABLE: join(scratch, 'stable', process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app'),
    },
  })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1280, height: 800 }, timeout: ms(20_000) })
    const toast = window.getByTestId('update-ready')
    await expect(toast).toBeVisible({ timeout: ms(20_000) })
    await expect(toast.getByRole('button', { name: 'Later' })).toBeVisible({ timeout: ms(20_000) })

    const settings = window.getByRole('dialog', { name: 'Settings' })
    await clickMenuItem(app, SETTINGS_MENU_ITEM_ID)
    await expect(settings).toBeVisible()
    // The toast is drawn above the window's layer, and the window leaves it to a screen reader.
    expect(await topAt(toast, toast)).toBe(true)
    expect(await hiddenFromScreenReader(toast)).toBe(false)
    await expect(window.getByRole('region', { name: 'Notifications' }).getByRole('status')).toContainText(`worfy ${version} ready`)
    await snapshotThemes(window, 'layers-dialog-toast')

    // A press on the toast's text and on its button: the window stays open.
    await toast.locator('.w-toast__text').click()
    await nextFrame(window)
    await expect(settings).toBeVisible()
    await toast.getByRole('button', { name: 'Later' }).click()
    await expect(toast).toHaveCount(0)
    await expect(settings).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
