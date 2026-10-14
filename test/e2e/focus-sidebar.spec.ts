import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// Focus mode next to the sidebar, against the built app: the layer covers the main area of the
// window and the sidebar keeps working; the palette and the sidebar's menus open above the layer;
// the sidebar is hidden and shown apart for the normal view and focus mode, by the button of the
// toolbar, the same button in the focus mode bar and View ▸ Toggle Sidebar, and both answers
// outlive a restart; a request to the main area from the sidebar or the palette ends focus mode.
// Playwright cannot press menu accelerators, so Cmd/Ctrl+B itself is a manual check: the item is
// clicked by id (clickMenuItem). Snapshots in both themes: test-results/snapshots/focus-with-sidebar/.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const EPICS = ['epic-one', 'epic-two']
/** The id of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SIDEBAR = 'view.sidebar'
/** The room left of a bar for the window buttons of macOS, in pixels of the window. */
const TRAFFIC_LIGHTS_PX = 80
const mac = process.platform === 'darwin'

const NOTES = [
  { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, data: { text: 'one' } },
  { id: 'n2', kind: 'note', x: 300, y: 40, w: 220, h: 120, data: { text: 'two' } },
]

let scratch: string
let dataDir: string
let claudeHome: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** Writes the Layout of the Project: what its Canvas shows at start. */
function writeLayout(nodes: unknown[]): void {
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 30, y: 20, zoom: 1 } }))
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-focus-sidebar-')))
  dataDir = join(scratch, 'data')
  // A Project in a git repository with two Epics and an ADR, so the sidebar has rows to click.
  const repo = join(scratch, 'alpha')
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'adr', '0001-first.md'), '# First decision\n\nДата: 2026-10-05. Статус: принят.\n\nText.\n')
  for (const epic of EPICS) {
    mkdirSync(join(repo, '.scratch', epic, 'issues'), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
    writeFileSync(join(repo, '.scratch', epic, 'issues', '01-first.md'), '# 01 — First\n\nType: task\nStatus: open\nBlocked by: —\n')
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  // A Claude home whose bin/epic-status answers with these Epics, one open Ticket in each.
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: EPICS.map((epic) => ({ epic, hasSpec: true, hasMap: false })),
      tickets: EPICS.map((epic) => ({ epic, num: 1, slug: 'first', title: '01 — First', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })),
    }),
  )
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeLayout(NOTES)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (env: Record<string, string> = {}): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, ...env } })

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface El {
  contains(other: unknown): boolean
  closest(selector: string): El | null
  ownerDocument: { elementFromPoint(x: number, y: number): El | null; activeElement: El | null; body: El }
}
interface PageGlobals {
  innerWidth: number
  innerHeight: number
  getComputedStyle(element: unknown): { paddingLeft: string }
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const windowSize = (window: Page): Promise<{ width: number; height: number }> =>
  window.evaluate(() => {
    const page = globalThis as unknown as PageGlobals
    return { width: page.innerWidth, height: page.innerHeight }
  })

/** Whether what is drawn on top at the middle of the element is the element itself or something inside it. */
async function onTop(locator: Locator): Promise<boolean> {
  const { x, y, width, height } = await box(locator)
  return locator.evaluate(
    (node, point) => {
      const element = node as unknown as El
      const top = element.ownerDocument.elementFromPoint(point.x, point.y)
      return top !== null && element.contains(top)
    },
    { x: x + width / 2, y: y + height / 2 },
  )
}

/** Whether the keyboard focus is on the element or inside it. */
const holdsFocus = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => {
    const element = node as unknown as El
    return element.contains(element.ownerDocument.activeElement)
  })

const paddingLeft = (locator: Locator): Promise<number> => locator.evaluate((node) => parseFloat((globalThis as unknown as PageGlobals).getComputedStyle(node).paddingLeft))

/** `sidebar.visible` of app-settings.json; undefined while the file is not written. */
function savedVisibility(): { normal?: boolean; focus?: boolean } | undefined {
  try {
    return (JSON.parse(readFileSync(join(dataDir, 'app-settings.json'), 'utf8')) as { sidebar?: { visible?: { normal?: boolean; focus?: boolean } } }).sidebar?.visible
  } catch {
    return undefined
  }
}

/** Clicks View ▸ Toggle Sidebar for the app's window number `index`, oldest first, as a click with that window in front does. */
async function toggleFor(app: ElectronApplication, index: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow, Menu }, { id, index }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id)
      if (!item) throw new Error(`the app menu has no item ${id}`)
      const target = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[index]
      if (!target) throw new Error(`the app has no window number ${index}`)
      item.click(undefined, target)
    },
    { id: SIDEBAR, index },
  )
}

const sidebarOf = (window: Page): Locator => window.getByRole('navigation', { name: 'Sidebar' })
const focusOf = (window: Page): Locator => window.getByTestId('focus-mode')
const region = (window: Page, name: string): Locator => window.getByRole('region', { name, exact: true })
const heading = (window: Page, name: string): Locator => region(window, name).getByRole('button', { name, exact: true })

/**
 * Selects the notes on the Canvas and opens focus mode over them with the keys. Leaving focus mode
 * keeps the selection, and a click with ⌘ on a selected Node would take it out again, so Nodes
 * already selected are left alone.
 */
async function enterFocus(window: Page, ids: string[] = ['n1', 'n2']): Promise<Locator> {
  const selected = window.locator('.react-flow__node.selected')
  if ((await selected.count()) !== ids.length) {
    for (const [index, id] of ids.entries()) await window.locator(`.react-flow__node[data-id="${id}"] .w-note__header`).click(index === 0 ? {} : { modifiers: ['ControlOrMeta'] })
  }
  await expect(selected).toHaveCount(ids.length)
  await window.keyboard.press('ControlOrMeta+Enter')
  const focus = focusOf(window)
  await expect(focus.getByTestId('focus-tile')).toHaveCount(ids.length)
  return focus
}

/** Leaves focus mode with its button: Esc is the layer's only while the keyboard focus is in the layer. */
async function exitFocus(window: Page): Promise<void> {
  await focusOf(window).getByRole('button', { name: /^Exit focus/ }).click()
  await expect(focusOf(window)).toHaveCount(0)
}

test('in focus mode the sidebar stays and works; the palette and a menu of the sidebar open above the layer, and Esc in them or in the sidebar leaves focus mode open', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length)
    await canvasReady(launched)
    // A fresh user: nothing is saved about the sidebar yet.
    expect(savedVisibility()).toBeUndefined()

    const focus = await enterFocus(window)
    const sidebar = sidebarOf(window)
    await expect(sidebar).toBeVisible()
    // The layer covers the main area, toolbar included: from the sidebar's right edge to the window's.
    const size = await windowSize(window)
    const side = await box(sidebar)
    expect(side.x).toBe(0)
    const layer = await box(focus)
    expect(layer.x).toBeCloseTo(side.width, 0)
    expect(layer.y).toBe(0)
    expect(layer.x + layer.width).toBeCloseTo(size.width, 0)
    expect(layer.height).toBeCloseTo(size.height, 0)
    await expect(window.locator('.w-toolbar')).toHaveAttribute('inert', '')
    expect(await onTop(window.locator('.w-toolbar'))).toBe(false)
    // No tile lies under the sidebar, and the sidebar is what is drawn in its own place.
    for (const tile of await focus.getByTestId('focus-tile').all()) expect((await box(tile)).x).toBeGreaterThanOrEqual(side.x + side.width)
    expect(await onTop(sidebar)).toBe(true)
    // With the sidebar next to it the bar leaves no room for the window buttons: they are over the sidebar.
    const bar = focus.locator('.w-focus__bar')
    await expect(bar).toHaveAttribute('data-sidebar', 'visible')
    expect(await paddingLeft(bar)).toBe(8)
    await expect(focus).toHaveAttribute('role', 'region')
    await snapshotThemes(window, 'focus-with-sidebar')

    // The sidebar works: a section collapses and expands, and its rows answer.
    const epics = heading(window, 'Epics')
    await epics.click()
    await expect(epics).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    await expect(focus).toBeVisible()
    // The click left the keyboard focus in the sidebar: Esc there is not focus mode's.
    expect(await holdsFocus(sidebar)).toBe(true)
    await window.keyboard.press('Escape')
    await expect(focus).toBeVisible()
    await epics.click()
    await expect(epics).toHaveAttribute('aria-expanded', 'true')
    await expect(window.getByTestId('sidebar-epic').first()).toBeVisible()

    // The command palette opens above the layer; Esc closes it alone.
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    expect(await onTop(palette)).toBe(true)
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await expect(focus).toBeVisible()

    // The context menu of a Project row opens above the layer too; Esc closes it alone.
    await window.getByTestId('project-row').first().click({ button: 'right' })
    const menu = window.getByRole('menu')
    await expect(menu).toBeVisible()
    expect(await onTop(menu)).toBe(true)
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(focus).toBeVisible()

    // Back in the layer (a click on its bar), Esc leaves focus mode.
    await focus.locator('.w-focus__title').click()
    expect(await holdsFocus(focus)).toBe(true)
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)
    await expect(window.locator('.w-toolbar')).not.toHaveAttribute('inert', '')
    // Collapsing a section wrote the app settings; whether the sidebar is shown was not touched.
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: true })
  } finally {
    await launched.close()
  }
})

// What the sidebar can open next to focus mode, and what Esc does with each. The rule: something
// always happens. A popup that closes on Esc gets the first press and focus mode the second; one
// that does not react to the press is not in the way, and the press leaves focus mode.
test('Esc with a popup of the sidebar open next to focus mode: History, the ADR panel, the menu of a Project, Project settings, Link a machine', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await expect(window.getByTestId('sidebar-adr')).toHaveCount(1)
    await canvasReady(launched)
    const focus = focusOf(window)
    /** The keyboard focus into the layer, as a click on its bar puts it there. */
    const intoLayer = async (): Promise<void> => {
      await focus.locator('.w-focus__bar').click({ position: { x: 60, y: 6 } })
      expect(await holdsFocus(focus)).toBe(true)
    }
    /** Focus mode over the Nodes still selected, whatever has the focus now. */
    const again = async (): Promise<void> => {
      if ((await focus.count()) > 0) return
      // ⌘↩ typed in a text field stays with the field: the focus goes off whatever holds it first.
      await window.evaluate(() => (globalThis as unknown as { document: { activeElement: { blur?(): void } | null } }).document.activeElement?.blur?.())
      await window.keyboard.press('ControlOrMeta+Enter')
      await expect(focus.getByTestId('focus-tile')).toHaveCount(2)
    }
    const escape = (): Promise<void> => window.keyboard.press('Escape')

    // History. It closes on Esc only with the focus inside it.
    const history = window.getByTestId('history-popover')
    await enterFocus(window)
    await window.getByTestId('sidebar-history').click()
    await expect(history).toBeVisible()
    await expect(focus).toBeVisible()
    // The focus in the layer: History does not react, so the press leaves focus mode.
    await intoLayer()
    await escape()
    await expect(focus).toHaveCount(0)
    await expect(history).toBeVisible()
    // The same from the field of a note in a tile.
    await again()
    await focus.getByTestId('focus-tile').first().getByRole('textbox', { name: 'Note text' }).click()
    await escape()
    await expect(focus).toHaveCount(0)
    await expect(history).toBeVisible()
    // The focus inside History: the first press closes History, the second leaves focus mode.
    await again()
    await history.getByRole('button', { name: 'Close' }).focus()
    await escape()
    await expect(history).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)
    // In the normal view too: Esc inside History closes it, and outside it leaves it open.
    await window.getByTestId('sidebar-history').click()
    await expect(history).toBeVisible()
    await escape()
    await expect(history).toBeVisible()
    await history.getByRole('button', { name: 'Close' }).focus()
    // Only Esc: another key pressed inside leaves it open.
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('a')
    await expect(history).toBeVisible()
    await escape()
    await expect(history).toHaveCount(0)
    // The notes are still selected: that Esc was History's alone.
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

    // The ADR panel closes on Esc wherever the focus is: the first press is its, the second focus mode's.
    const panel = window.getByTestId('adr-panel')
    await again()
    await window.getByTestId('sidebar-adr').first().click()
    await expect(panel).toBeVisible()
    await expect(focus).toBeVisible()
    expect(await onTop(panel)).toBe(true)
    await intoLayer()
    await escape()
    await expect(panel).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)
    // With the focus left on the row that opened it, in the sidebar: the panel closes all the same.
    await again()
    await window.getByTestId('sidebar-adr').first().click()
    await expect(panel).toBeVisible()
    await escape()
    await expect(panel).toHaveCount(0)
    await expect(focus).toBeVisible()
    // The focus is still on that row, and an Esc pressed in the sidebar is never focus mode's.
    await expect(window.getByTestId('sidebar-adr').first()).toBeFocused()
    await escape()
    await expect(focus).toBeVisible()

    // Both open, the focus inside History: one press closes History alone, the next the panel, the
    // third — the focus is nowhere by then — leaves focus mode.
    await window.getByTestId('sidebar-adr').first().click()
    await expect(panel).toBeVisible()
    await window.getByTestId('sidebar-history').click()
    await history.getByRole('button', { name: 'Close' }).focus()
    await escape()
    await expect(history).toHaveCount(0)
    await expect(panel).toBeVisible()
    await expect(focus).toBeVisible()
    await escape()
    await expect(panel).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)
    await again()

    // The context menu of a Project takes the focus and closes on Esc; the next press leaves focus mode.
    const menu = window.getByRole('menu', { name: 'Project' })
    await window.getByTestId('project-row').first().click({ button: 'right' })
    await expect(menu).toBeVisible()
    expect(await holdsFocus(menu)).toBe(true)
    await escape()
    await expect(menu).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)

    // Project settings, a modal dialog from that menu: it holds the focus and closes on Esc.
    const settings = window.getByTestId('project-settings')
    await again()
    await window.getByTestId('project-row').first().click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Project settings…' }).click()
    await expect(settings).toBeVisible()
    expect(await onTop(settings)).toBe(true)
    await expect.poll(() => holdsFocus(settings)).toBe(true)
    await escape()
    await expect(settings).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)

    // A menu or a modal dialog that has lost the focus to the layer (Tab can walk out of it) does
    // not react to Esc. It is not in the way: the press leaves focus mode, and it stays open.
    await again()
    await window.getByTestId('project-row').first().click({ button: 'right' })
    await expect(menu).toBeVisible()
    await focus.focus()
    await escape()
    await expect(focus).toHaveCount(0)
    await expect(menu).toBeVisible()
    // A press outside the menu closes it, as ever.
    await window.locator('.w-toolbar__name').click()
    await expect(menu).toHaveCount(0)
    await again()
    await window.getByTestId('project-row').first().click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Project settings…' }).click()
    await expect(settings).toBeVisible()
    await focus.focus()
    await escape()
    await expect(focus).toHaveCount(0)
    await expect(settings).toBeVisible()
    await settings.locator('input, button').first().focus()
    await escape()
    await expect(settings).toHaveCount(0)

    // Link a machine, a modal dialog of the Machines section, which the test expands first.
    const link = window.getByTestId('link-machine-dialog')
    await again()
    const machines = heading(window, 'Machines')
    if ((await machines.getAttribute('aria-expanded')) !== 'true') await machines.click()
    await window.getByTestId('link-machine-button').click()
    await expect(link).toBeVisible()
    expect(await onTop(link)).toBe(true)
    await expect.poll(() => holdsFocus(link)).toBe(true)
    await escape()
    await expect(link).toHaveCount(0)
    await expect(focus).toBeVisible()
    await escape()
    await expect(focus).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('the sidebar is hidden and shown apart for the normal view and focus mode, by the buttons and by View ▸ Toggle Sidebar, and both answers outlive a restart', async () => {
  const first = await launch()
  try {
    const { app, window } = first
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await canvasReady(first)
    const sidebar = sidebarOf(window)
    const toolbar = window.locator('.w-toolbar')

    // The button of the focus mode bar hides the sidebar: the layer is the whole window, and its bar
    // keeps clear of the window buttons.
    const focus = await enterFocus(window)
    const bar = focus.locator('.w-focus__bar')
    await focus.getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(sidebar).toHaveCount(0)
    await expect(bar).toHaveAttribute('data-sidebar', 'hidden')
    const size = await windowSize(window)
    expect(await box(focus)).toEqual({ x: 0, y: 0, ...size })
    if (mac) expect(await paddingLeft(bar)).toBe(TRAFFIC_LIGHTS_PX)
    await expect(focus.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: false })

    // Esc: the normal view still has its sidebar. Focus mode again: hidden, as it was left.
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)
    await expect(sidebar).toBeVisible()
    await expect(toolbar).toHaveAttribute('data-sidebar', 'visible')
    await enterFocus(window)
    await expect(sidebar).toHaveCount(0)
    await expect(bar).toHaveAttribute('data-sidebar', 'hidden')

    // View ▸ Toggle Sidebar works in focus mode, on focus mode's answer.
    await clickMenuItem(app, SIDEBAR)
    await expect(sidebar).toBeVisible()
    await expect(bar).toHaveAttribute('data-sidebar', 'visible')
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: true })
    await clickMenuItem(app, SIDEBAR)
    await expect(sidebar).toHaveCount(0)
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: false })
    await exitFocus(window)
    await expect(sidebar).toBeVisible()

    // And in the normal view, on the normal view's: the toolbar keeps clear of the window buttons.
    await clickMenuItem(app, SIDEBAR)
    await expect(sidebar).toHaveCount(0)
    await expect(toolbar).toHaveAttribute('data-sidebar', 'hidden')
    if (mac) expect(await paddingLeft(toolbar)).toBe(TRAFFIC_LIGHTS_PX)
    await expect.poll(savedVisibility).toEqual({ normal: false, focus: false })
    // The toolbar button and the menu item are one switch.
    await window.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(sidebar).toBeVisible()
    await window.getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(sidebar).toHaveCount(0)
    await expect.poll(savedVisibility).toEqual({ normal: false, focus: false })

    // Many quick clicks of the item land where an odd number of switches does.
    for (let press = 0; press < 5; press += 1) await clickMenuItem(app, SIDEBAR)
    await expect(sidebar).toBeVisible()
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: false })
  } finally {
    await first.close()
  }

  // A restart over the same data folder: shown in the normal view, hidden in focus mode.
  const second = await launch()
  try {
    const { app, window } = second
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await canvasReady(second)
    const sidebar = sidebarOf(window)
    await expect(sidebar).toBeVisible()
    const focus = await enterFocus(window)
    await expect(sidebar).toHaveCount(0)
    await expect(focus.locator('.w-focus__bar')).toHaveAttribute('data-sidebar', 'hidden')
    // The other way round for the next restart: hidden in the normal view, shown in focus mode.
    await clickMenuItem(app, SIDEBAR)
    await expect(sidebar).toBeVisible()
    await exitFocus(window)
    await window.getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(sidebar).toHaveCount(0)
    await expect.poll(savedVisibility).toEqual({ normal: false, focus: true })
  } finally {
    await second.close()
  }

  const third = await launch()
  try {
    const { window } = third
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await canvasReady(third)
    const sidebar = sidebarOf(window)
    await expect(window.locator('.w-toolbar')).toHaveAttribute('data-sidebar', 'hidden')
    await expect(sidebar).toHaveCount(0)
    const focus = await enterFocus(window)
    await expect(sidebar).toBeVisible()
    await expect(focus.locator('.w-focus__bar')).toHaveAttribute('data-sidebar', 'visible')
    const side = await box(sidebar)
    expect((await box(focus)).x).toBeCloseTo(side.width, 0)
    await exitFocus(window)
    await expect(sidebar).toHaveCount(0)
    expect(savedVisibility()).toEqual({ normal: false, focus: true })
  } finally {
    await third.close()
  }
})

test('a request to the main area ends focus mode: an Epic of the sidebar, "Tidy up" and "Switch to Session" of the palette', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length)
    await canvasReady(launched)
    const focus = focusOf(window)
    const palette = window.getByTestId('command-palette')
    /** Runs the palette's first command for `query`. */
    const run = async (query: string, title: RegExp): Promise<void> => {
      await window.keyboard.press('ControlOrMeta+k')
      await expect(palette).toBeVisible()
      await palette.getByRole('combobox').fill(query)
      await expect(palette.getByRole('option').first()).toHaveText(title)
      await window.keyboard.press('Enter')
      await expect(palette).toHaveCount(0)
    }

    /** Focus mode again over the Nodes still selected: they may be off the Canvas by now, where a click cannot reach them. */
    const again = async (): Promise<void> => {
      await window.keyboard.press('ControlOrMeta+Enter')
      await expect(focus.getByTestId('focus-tile')).toHaveCount(2)
    }

    // "Switch to Session" of the palette: focus mode ends and the Session view is on screen.
    await enterFocus(window)
    await run('Switch to Session', /Switch to Session/)
    await expect(focus).toHaveCount(0)
    await expect(window.getByRole('main', { name: 'Session' })).toBeVisible()
    await expect(window.locator('.w-shell__view[data-view="session"]')).toBeVisible()
    await expect(window.locator('.w-toolbar')).not.toHaveAttribute('inert', '')
    await window.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
    await expect(window.getByRole('main', { name: 'Canvas' })).toBeVisible()

    // "Tidy up" of the palette asks the Canvas for something: focus mode gives the Canvas back.
    await again()
    await run('tidy up', /Tidy up/)
    await expect(focus).toHaveCount(0)
    await expect(window.getByRole('main', { name: 'Canvas' })).toBeVisible()

    // So does a click on an Epic in the sidebar, which centers the Canvas on its frame.
    await again()
    const row = window.getByTestId('sidebar-epic').first()
    await row.click()
    await expect(focus).toHaveCount(0)
    await expect(window.getByRole('main', { name: 'Canvas' })).toBeVisible()
    await expect(window.locator('.w-toolbar')).not.toHaveAttribute('inert', '')
    // The focus stays on the row that was clicked: leaving focus mode does not take it to the Canvas.
    await expect(row).toBeFocused()
  } finally {
    await launched.close()
  }
})

test('a click on a Session in the sidebar ends focus mode and shows the Canvas with that Session’s Node — not the Session view', async () => {
  // The fake agent writes the Orchestrator's entry to <Claude home>/sessions as Claude Code does,
  // so the sidebar lists one live Session without a process of the test's own.
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  const launched = await launch({ WORFY_AGENT_SCRIPT: 'turn', WORFY_AGENT_REGISTRY: '1' })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')
    await canvasReady(launched)
    // The notes are selected first: the new Session's Node may take the Canvas away from them.
    for (const [index, id] of ['n1', 'n2'].entries()) await window.locator(`.react-flow__node[data-id="${id}"] .w-note__header`).click(index === 0 ? {} : { modifiers: ['ControlOrMeta'] })
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

    // A Session with a Node in the Layout: "New session" of the sidebar. Its row is the one to click.
    await window.getByTestId('sidebar-new-session').click()
    const node = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(node).toHaveCount(1)
    await expect(node.getByTestId('session-node-status')).toHaveText('idle')
    // Its first turn: until then the Node does not name the Session in the Layout, and the row
    // finds no Node to lead to (SessionsSection.tsx, nodeOf).
    await node.getByTestId('session-node-input').fill('hello')
    await node.getByTestId('session-node-input').press('Enter')
    const named = (): Promise<string[]> =>
      window.evaluate(async (projectId) => {
        const bridge = (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ value: { layout: { nodes: { kind: string; data: { sessionId?: string } }[] } } }> } }).worfy
        const result = await bridge.invoke('layout.get', { projectId })
        return result.value.layout.nodes.flatMap((each) => (each.kind === 'session' && each.data.sessionId !== undefined ? [each.data.sessionId] : []))
      }, PROJECT)
    await expect.poll(named).toHaveLength(1)
    const [sessionId] = await named()
    const row = window.locator(`[data-testid="sidebar-session"][data-session-id="${sessionId}"]`)
    await expect(row).toHaveCount(1)
    await expect(node.getByTestId('session-node-status')).toHaveText('idle')

    // Focus mode over the Nodes selected now, whichever they are.
    const focus = focusOf(window)
    await window.evaluate(() => (globalThis as unknown as { document: { activeElement: { blur?(): void } | null } }).document.activeElement?.blur?.())
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(focus.getByTestId('focus-tile').first()).toBeVisible()

    await row.click()
    // The row asks the Canvas for the Session's Node (SessionsSection.tsx): focus mode gives the
    // Canvas back. The Session view is opened by a double click on the Node, not by this row.
    await expect(focus).toHaveCount(0)
    await expect(window.getByRole('main', { name: 'Canvas' })).toBeVisible()
    await expect(window.locator('.w-shell__view[data-view="session"]')).toBeHidden()
    await expect(node).toBeVisible()
    await expect(window.locator('.w-toolbar')).not.toHaveAttribute('inert', '')
    await expect(row).toBeFocused()
  } finally {
    await launched.close()
  }
})

test('two windows: View ▸ Toggle Sidebar switches the sidebar of the window it is chosen for, and a window showing the same view follows', async () => {
  const launched = await launch()
  try {
    const { app, window: a } = launched
    await expect(a.getByTestId('note-node')).toHaveCount(2)
    await canvasReady(launched)
    const b = await openSecondWindow(launched)
    await expect(b.getByTestId('note-node')).toHaveCount(2)
    await expect(sidebarOf(b)).toBeVisible()

    // Window A is in focus mode, window B in the normal view. The item chosen for A hides A's
    // sidebar — focus mode's answer — and B keeps its own.
    await enterFocus(a)
    await toggleFor(app, 0)
    await expect(sidebarOf(a)).toHaveCount(0)
    await expect.poll(savedVisibility).toEqual({ normal: true, focus: false })
    await expect(sidebarOf(b)).toBeVisible()
    await expect(focusOf(b)).toHaveCount(0)

    // Chosen for B, it hides B's — the normal view's answer. A, back in the normal view, follows:
    // the answer is the app's, not one window's.
    await toggleFor(app, 1)
    await expect(sidebarOf(b)).toHaveCount(0)
    await expect.poll(savedVisibility).toEqual({ normal: false, focus: false })
    await expect(focusOf(a)).toBeVisible()
    await exitFocus(a)
    await expect(sidebarOf(a)).toHaveCount(0)
    await expect(a.locator('.w-toolbar')).toHaveAttribute('data-sidebar', 'hidden')

    // The button of one window shows the sidebar in both.
    await b.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(sidebarOf(b)).toBeVisible()
    await expect(sidebarOf(a)).toBeVisible()
  } finally {
    await launched.close()
  }
})

test('View ▸ Toggle Sidebar works wherever the keyboard focus is — a Terminal, the palette, the Session field, an open list — and takes the focus from none of them', async () => {
  const home = join(scratch, 'home')
  mkdirSync(home)
  writeLayout([...NOTES, { id: 'term', kind: 'terminal', x: 40, y: 220, w: 480, h: 260, data: {} }])
  const launched = await launch({ SHELL: '/bin/sh', HOME: home, WORFY_AGENT_SCRIPT: 'session-view' })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(2)
    const sidebar = sidebarOf(window)
    /** One click of the item, and the sidebar is the other way round. */
    const toggle = async (): Promise<void> => {
      const shown = (await sidebar.count()) > 0
      await clickMenuItem(app, SIDEBAR)
      await expect(sidebar).toHaveCount(shown ? 0 : 1)
    }

    // In the sidebar itself, which goes away with the focus inside it: the focus goes to the button
    // that brings the sidebar back, not to nowhere.
    await heading(window, 'Epics').focus()
    await toggle()
    await expect(window.getByRole('button', { name: 'Show sidebar' })).toBeFocused()
    await toggle()

    // In a Terminal Node: the shell keeps the focus, and what is typed after still reaches it.
    const terminal = window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    await expect(terminal).toHaveAttribute('data-state', 'running')
    await terminal.getByTestId('terminal-screen').click()
    expect(await holdsFocus(terminal)).toBe(true)
    await toggle()
    expect(await holdsFocus(terminal)).toBe(true)
    await window.keyboard.type('echo side""bar-toggled')
    await window.keyboard.press('Enter')
    await expect.poll(async () => (await terminal.locator('.xterm-rows').innerText()).replaceAll(String.fromCharCode(160), ' '), { timeout: 10_000 }).toMatch(/^sidebar-toggled$/m)
    await toggle()
    expect(await holdsFocus(terminal)).toBe(true)

    // In the same Terminal as a tile of focus mode.
    await window.locator('.react-flow__node[data-id="term"] .w-terminal__header').click()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    await window.keyboard.press('ControlOrMeta+Enter')
    const focus = focusOf(window)
    const tile = focus.getByTestId('focus-tile').getByTestId('terminal-node')
    await expect(tile).toHaveAttribute('data-state', 'running')
    await tile.getByTestId('terminal-screen').click()
    await toggle()
    expect(await holdsFocus(tile)).toBe(true)
    await expect(focus).toBeVisible()
    await toggle()
    // From the sidebar next to focus mode the focus goes to the button of the focus mode bar: the
    // toolbar's is under the layer. It is in the layer then, so Esc leaves focus mode.
    await heading(window, 'Epics').focus()
    await toggle()
    await expect(focus.getByRole('button', { name: 'Show sidebar' })).toBeFocused()
    await toggle()
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)

    // With the palette open: it stays open, with the focus in its field.
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    const field = palette.getByRole('combobox')
    await expect(field).toBeFocused()
    await field.fill('swi')
    await toggle()
    await expect(palette).toBeVisible()
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('swi')
    await toggle()
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    // In the field of the Session view: the text and the focus stay.
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toBeVisible()
    const message = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await message.fill('a draft')
    await toggle()
    await expect(message).toBeFocused()
    await expect(message).toHaveValue('a draft')
    await toggle()
    await expect(message).toBeFocused()

    // With a list of the Session's pickers open: the sidebar switches, and Esc then closes the list alone.
    const model = view.getByTestId('picker-model')
    await model.click()
    const list = window.getByTestId('picker-model-list')
    await expect(list).toBeVisible()
    await toggle()
    await window.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(view).toBeVisible()
    await toggle()
    await expect(sidebar).toBeVisible()
  } finally {
    await launched.close()
  }
})
