import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { printJoined, WINDOWS } from './terminal-shell'
import { settled } from './wait'

// Focus mode against the built app: selected Nodes fill the window as tiles, presets, dividers
// and title-bar drags change the tiling, Esc brings the Canvas back with the same viewport, and
// neither the Layout in main nor layout.json on disk changes on the way.

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
interface LayoutState {
  revision: number
  layout: { nodes: { id: string; data: Record<string, unknown> }[]; viewport: { x: number; y: number; zoom: number } }
}

const NOTES = [
  { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, data: { text: 'one' } },
  { id: 'n2', kind: 'note', x: 300, y: 40, w: 220, h: 120, data: { text: 'two' } },
  { id: 'n3', kind: 'note', x: 40, y: 220, w: 220, h: 120, data: { text: 'three' } },
  { id: 'n4', kind: 'note', x: 300, y: 220, w: 220, h: 120, data: { text: 'four' } },
]
const VIEWPORT = { x: 30, y: 20, zoom: 1 }

let scratch: string
let dataDir: string
let layoutFile: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-focus-')))
  dataDir = join(scratch, 'data')
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, ALPHA), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: ALPHA, name: 'alpha', path }], activeId: ALPHA }))
  layoutFile = join(dataDir, ALPHA, 'layout.json')
  writeFileSync(layoutFile, JSON.stringify({ nodes: NOTES, viewport: VIEWPORT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function stateOf(window: Page): Promise<LayoutState> {
  const result = await window.evaluate(
    (id) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: LayoutState }> } }).worfy.invoke('layout.get', { projectId: id }),
    ALPHA,
  )
  expect(result.ok).toBe(true)
  return result.value
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

async function dragTo(window: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
  const start = await box(from)
  await window.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await window.mouse.down()
  await window.mouse.move(to.x, to.y, { steps: 12 })
  await window.mouse.up()
}

/** Resolves after the renderer has drawn a frame, so a render the last key caused is on screen. */
const nextFrame = (window: Page): Promise<void> =>
  window.evaluate(() => new Promise<void>((resolve) => (globalThis as unknown as { requestAnimationFrame(cb: () => void): void }).requestAnimationFrame(() => resolve())))

const canvasHeader = (window: Page, id: string) => window.locator(`.react-flow__node[data-id="${id}"] .w-note__header`)
const viewportTransform = (window: Page) => window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)

/** Selects the Nodes on the Canvas: a click on the first, ⌘-clicks on the rest. */
async function select(window: Page, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) await canvasHeader(window, id).click(index === 0 ? {} : { modifiers: ['ControlOrMeta'] })
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(ids.length)
}

test('three selected Nodes fill the window as tiles; presets, dividers and drags change the tiling; Esc restores the Canvas and the Layout is untouched', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(4)
    const before = await stateOf(window)
    const transformBefore = await viewportTransform(window)
    expect(transformBefore).toContain('translate(30px, 20px)')
    // main writes layout.json only after an operation (LAYOUT_SAVE_DELAY_MS after the last one), or
    // at once when it upgrades the file on the first read. An operation at the start leaves a write
    // on its way: it lands with the Layout as main has it now.
    if (before.revision > 0) await expect.poll(() => JSON.parse(readFileSync(layoutFile, 'utf8')) as unknown).toEqual(before.layout)
    const fileBefore = readFileSync(layoutFile, 'utf8')

    await select(window, ['n1', 'n2', 'n3'])
    const entry = window.getByRole('button', { name: /^Focus/ })
    await expect(entry).toBeVisible()
    // The button does not cover the selection toolbar (Pin, Tags) that sits above the selection.
    const [button, toolbar] = [await box(entry), await box(window.getByTestId('selection-toolbar'))]
    expect(button.y >= toolbar.y + toolbar.height || button.y + button.height <= toolbar.y || button.x >= toolbar.x + toolbar.width || button.x + button.width <= toolbar.x).toBe(true)
    await window.screenshot({ path: test.info().outputPath('focus-entry.png') })
    await entry.click()

    const focus = window.getByTestId('focus-mode')
    await expect(focus).toBeVisible()
    const tiles = focus.getByTestId('focus-tile')
    await expect(tiles).toHaveCount(3)
    const tile = (id: string) => focus.locator(`[data-testid="focus-tile"][data-node-id="${id}"]`)
    // Each tile draws the Node itself; the unselected Node is not in focus mode.
    await expect(tile('n1').getByRole('textbox', { name: 'Note text' })).toHaveValue('one')
    await expect(tile('n3').getByRole('textbox', { name: 'Note text' })).toHaveValue('three')
    await expect(tile('n4')).toHaveCount(0)

    // The layer covers the main area of the window, toolbar included, and leaves the sidebar: its
    // left edge is the sidebar's right edge.
    const windowSize = await window.evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number }
      return { width: view.innerWidth, height: view.innerHeight }
    })
    const sidebar = window.getByRole('navigation', { name: 'Sidebar' })
    const side = await box(sidebar)
    expect(side).toMatchObject({ x: 0, y: 0, height: windowSize.height })
    expect(side.width).toBeGreaterThan(0)
    expect(await box(focus)).toEqual({ x: side.width, y: 0, width: windowSize.width - side.width, height: windowSize.height })
    // With the sidebar hidden (the button of the focus mode bar) it is the whole window.
    await focus.getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(sidebar).toHaveCount(0)
    expect(await box(focus)).toEqual({ x: 0, y: 0, ...windowSize })
    await focus.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(sidebar).toBeVisible()
    expect((await box(focus)).x).toBe(side.width)

    // Even: two tiles on top, the third below across the whole width.
    const area = await box(focus.locator('.w-focus__area'))
    const [a, b, c] = [await box(tile('n1')), await box(tile('n2')), await box(tile('n3'))]
    expect(a.y).toBeCloseTo(area.y, 0)
    expect(b.y).toBeCloseTo(area.y, 0)
    expect(a.width).toBeCloseTo(area.width / 2, 0)
    expect(c.width).toBeCloseTo(area.width, 0)
    expect(c.y).toBeCloseTo(area.y + area.height / 2, 0)
    await window.screenshot({ path: test.info().outputPath('focus-even.png') })

    // Pan and zoom are off: the keys and the wheel do not reach the Canvas underneath.
    await window.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await window.keyboard.press('ControlOrMeta+Equal')
    await window.mouse.wheel(0, 300)

    // Columns: one row, equal widths.
    await focus.getByRole('button', { name: 'Columns' }).click()
    const widths = async () => Promise.all(['n1', 'n2', 'n3'].map(async (id) => Math.round((await box(tile(id))).width)))
    await expect.poll(async () => new Set((await Promise.all(['n1', 'n2', 'n3'].map(async (id) => (await box(tile(id))).y))).map(Math.round)).size).toBe(1)
    for (const width of await widths()) expect(width).toBeCloseTo(area.width / 3, -1)

    // Dragging the first divider moves only its two neighbours; a double click evens them out.
    const divider = focus.getByTestId('focus-divider').first()
    const line = await box(divider)
    await dragTo(window, divider, { x: line.x + line.width / 2 + 120, y: line.y + line.height / 2 })
    const [w1, w2, w3] = await widths()
    expect((w1 ?? 0) - area.width / 3).toBeGreaterThan(100)
    expect(area.width / 3 - (w2 ?? 0)).toBeGreaterThan(100)
    expect(w3).toBeCloseTo(area.width / 3, -1)
    await divider.dblclick()
    await expect.poll(async () => Math.round((await box(tile('n1'))).width)).toBeCloseTo(area.width / 3, -1)

    // Rows: one column, equal heights.
    await focus.getByRole('button', { name: 'Rows' }).click()
    await expect.poll(async () => Math.round((await box(tile('n2'))).height)).toBeCloseTo(area.height / 3, -1)
    expect((await box(tile('n1'))).x).toBeCloseTo((await box(tile('n3'))).x, 0)

    // Back to columns; dropping n1's title bar onto the middle of n3 swaps the two.
    await focus.getByRole('button', { name: 'Columns' }).click()
    await expect.poll(async () => Math.round((await box(tile('n3'))).y)).toBe(Math.round(area.y))
    const third = await box(tile('n3'))
    await dragTo(window, tile('n1').getByTestId('focus-tile-title'), { x: third.x + third.width / 2, y: third.y + third.height / 2 })
    await expect.poll(async () => Math.round((await box(tile('n1'))).x)).toBe(Math.round(third.x))
    expect(Math.round((await box(tile('n3'))).x)).toBe(Math.round(area.x))

    // Dropping n2's title bar near the bottom edge of n3 divides n3: n2 goes under it.
    const target = await box(tile('n3'))
    await dragTo(window, tile('n2').getByTestId('focus-tile-title'), { x: target.x + target.width / 2, y: target.y + target.height - 12 })
    await expect.poll(async () => Math.round((await box(tile('n3'))).height)).toBeCloseTo(area.height / 2, -1)
    const [upper, lower] = [await box(tile('n3')), await box(tile('n2'))]
    expect(lower.x).toBeCloseTo(upper.x, 0)
    expect(lower.y).toBeCloseTo(upper.y + upper.height, 0)
    expect(upper.width).toBeCloseTo(area.width / 2, -1)
    await window.screenshot({ path: test.info().outputPath('focus-divided.png') })

    // Esc: the Canvas is back as it was.
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)
    await expect(window.getByTestId('note-node')).toHaveCount(4)
    expect(await viewportTransform(window)).toBe(transformBefore)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)

    // ⌘↩ opens it again for the same selection; Exit focus leaves too.
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(focus.getByTestId('focus-tile')).toHaveCount(3)
    await focus.getByRole('button', { name: /^Exit focus/ }).click()
    await expect(focus).toHaveCount(0)

    // Nothing reached main, and nothing was written: without an operation main has no write to make.
    await settled(window)
    const after = await stateOf(window)
    expect(after.revision).toBe(before.revision)
    expect(after.layout).toEqual(before.layout)
    expect(readFileSync(layoutFile, 'utf8')).toBe(fileBefore)
  } finally {
    await launched.close()
  }
})

test('a Node inside a tile works as on the Canvas: typing in a note reaches main', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(4)
    await select(window, ['n4'])
    const focus = window.getByTestId('focus-mode')

    // ⌘↩ typed in a text field stays with the field: focus mode does not open.
    await window.locator('.react-flow__node[data-id="n4"]').getByRole('textbox', { name: 'Note text' }).focus()
    await window.keyboard.press('ControlOrMeta+Enter')
    await nextFrame(window)
    await expect(focus).toHaveCount(0)

    await select(window, ['n4'])
    await window.keyboard.press('ControlOrMeta+Enter')
    const textbox = focus.getByTestId('focus-tile').getByRole('textbox', { name: 'Note text' })
    await expect(textbox).toHaveValue('four')
    await textbox.fill('four, edited in focus')
    await expect.poll(async () => (await stateOf(window)).layout.nodes.find((node) => node.id === 'n4')?.data).toEqual({ text: 'four, edited in focus' })

    // Esc from inside the note still leaves; the Canvas copy shows the new text.
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)
    await expect(window.locator('.react-flow__node[data-id="n4"]').getByRole('textbox', { name: 'Note text' })).toHaveValue('four, edited in focus')
  } finally {
    await launched.close()
  }
})

test('keys pressed in focus mode stay in the layer: the selected Nodes on the Canvas do not move, and the focus comes back on Esc', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('note-node')).toHaveCount(4)
    const before = await stateOf(window)
    const nodeTransform = (id: string) =>
      window.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
    const transformBefore = await nodeTransform('n1')
    // The last ⌘-click leaves the keyboard focus on n2's Canvas Node, where React Flow moves the
    // selected Nodes on arrow keys and unselects on Esc.
    await select(window, ['n1', 'n2'])
    const activeNodeId = () => window.evaluate(() => (globalThis as unknown as { document: { activeElement: { closest(s: string): { getAttribute(a: string): string | null } | null } | null } }).document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)
    expect(await activeNodeId()).toBe('n2')

    await window.keyboard.press('ControlOrMeta+Enter')
    const focus = window.getByTestId('focus-mode')
    await expect(focus.getByTestId('focus-tile')).toHaveCount(2)
    await expect(focus).toBeFocused()
    await window.keyboard.press('ArrowRight')
    await window.keyboard.press('ArrowRight')
    // Tab walks the layer's own controls and then the sidebar's, which stays in reach next to the
    // layer; it never reaches what the layer covers, the toolbar and the Canvas underneath.
    const where = () =>
      focus.evaluate((layer) => {
        const active = (layer.ownerDocument as unknown as { activeElement: { closest(selector: string): unknown } | null }).activeElement
        if (active === null) return 'nowhere'
        if (layer.contains(active as never)) return 'layer'
        if (active.closest('.w-sidebar') !== null) return 'sidebar'
        return active.closest('.w-toolbar, .w-shell__content') !== null ? 'covered' : 'page'
      })
    const visited = new Set<string>()
    for (let step = 0; step < 40; step += 1) {
      await window.keyboard.press('Tab')
      const place = await where()
      expect(place).not.toBe('covered')
      visited.add(place)
    }
    // Forty presses are more than the layer has controls: the walk went through the sidebar as well.
    expect([...visited].sort()).toEqual(expect.arrayContaining(['layer', 'sidebar']))
    // Esc is the layer's while the keyboard focus is in it.
    await focus.focus()
    await expect(focus).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(focus).toHaveCount(0)

    expect(await nodeTransform('n1')).toBe(transformBefore)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
    expect(await activeNodeId()).toBe('n2')
    const after = await stateOf(window)
    expect(after.revision).toBe(before.revision)
    expect(after.layout).toEqual(before.layout)
  } finally {
    await launched.close()
  }
})

/** What a terminal shows; xterm.js draws spaces as no-break spaces. */
const screenText = async (terminal: Locator): Promise<string> => (await terminal.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')

/** The size of the terminal's pty as `stty size` reports it (PowerShell: its window size), typed into this view of the shell. */
async function sttySize(window: Page, terminal: Locator, tag: string): Promise<{ rows: number; cols: number }> {
  await terminal.getByTestId('terminal-screen').click()
  // The output differs from the echoed command line (`$(…)`), so the regex matches only the output.
  await window.keyboard.type(WINDOWS ? `echo "${tag}=$($Host.UI.RawUI.WindowSize.Height)x$($Host.UI.RawUI.WindowSize.Width)"` : `echo "${tag}=$(stty size | tr ' ' x)"`)
  await window.keyboard.press('Enter')
  const pattern = new RegExp(`^${tag}=(\\d+)x(\\d+)$`, 'm')
  await expect.poll(async () => pattern.test(await screenText(terminal)), { timeout: 10_000 }).toBe(true)
  const [, rows, cols] = pattern.exec(await screenText(terminal)) ?? []
  return { rows: Number(rows), cols: Number(cols) }
}

/** The terminal node colors of design F (docs/design/F-SPEC.md, color table): background, text. */
const TERMINAL_COLORS = { light: ['rgb(29, 29, 31)', 'rgb(229, 229, 234)'], dark: ['rgb(11, 10, 9)', 'rgb(236, 232, 225)'] } as const

/**
 * Screenshots of the window in the light and the dark appearance, with the terminal's colors
 * checked against design F; the appearance goes back to the system's after.
 */
async function snapshots(window: Page, terminal: Locator, where: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const colors = () =>
      terminal.locator('.xterm-screen').evaluate((screen) => {
        // xterm.js paints the background on the scrollable element around its screen, the text on the rows.
        const { getComputedStyle } = globalThis as unknown as { getComputedStyle(e: unknown): { backgroundColor: string; color: string } }
        const { parentElement, querySelector } = screen as unknown as { parentElement: unknown; querySelector(s: string): unknown }
        return [getComputedStyle(parentElement).backgroundColor, getComputedStyle(querySelector.call(screen, '.xterm-rows')).color]
      })
    await expect.poll(colors).toEqual([...TERMINAL_COLORS[scheme]])
    await window.screenshot({ path: test.info().outputPath(`terminal-${where}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('a Terminal in focus mode gets the size of its tile, and after leaving focus mode the pty has the size of the Canvas Node again', async () => {
  const home = join(scratch, 'home')
  mkdirSync(home)
  writeFileSync(layoutFile, JSON.stringify({ nodes: [{ id: 'term', kind: 'terminal', x: 40, y: 40, w: 560, h: 340, data: {} }], viewport: VIEWPORT }))
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, SHELL: '/bin/sh', HOME: home } })
  try {
    const { window } = launched
    const onCanvas = window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    await expect(onCanvas).toHaveAttribute('data-state', 'running')
    const canvasSize = await sttySize(window, onCanvas, 'canvas')
    expect(canvasSize.cols).toBeGreaterThan(40)
    await snapshots(window, onCanvas, 'canvas')

    await window.locator('.react-flow__node[data-id="term"] .w-terminal__header').click()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    await window.keyboard.press('ControlOrMeta+Enter')
    const focus = window.getByTestId('focus-mode')
    const inTile = focus.getByTestId('focus-tile').getByTestId('terminal-node')
    await expect(inTile).toHaveAttribute('data-state', 'running')
    // One tile fills the window: the pty follows the bigger view.
    const tileSize = await sttySize(window, inTile, 'tile')
    expect(tileSize.cols).toBeGreaterThan(canvasSize.cols)
    await snapshots(window, inTile, 'focus')

    // Esc typed into the terminal goes to the shell, so the button leaves focus mode.
    await focus.getByRole('button', { name: /Exit focus/ }).click()
    await expect(focus).toHaveCount(0)
    expect(await sttySize(window, onCanvas, 'back')).toEqual(canvasSize)
    // Typing and output still work on the Canvas copy.
    await onCanvas.getByTestId('terminal-screen').click()
    await window.keyboard.type(printJoined('mark', 'er-after'))
    await window.keyboard.press('Enter')
    await expect.poll(() => screenText(onCanvas), { timeout: 10_000 }).toMatch(/^marker-after$/m)

    // The Canvas Node resized while focus mode is open (by main, as a tool would): the Canvas copy
    // under the layer fits itself, but the pty keeps the size of the tile until focus mode ends.
    await window.locator('.react-flow__node[data-id="term"] .w-terminal__header').click()
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(inTile).toHaveAttribute('data-state', 'running')
    const canvasWidth = async () => (await onCanvas.boundingBox())?.width ?? 0
    const widthBefore = await canvasWidth()
    const resized = await window.evaluate(
      (projectId) =>
        (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean }> } }).worfy.invoke('layout.apply', {
          projectId,
          op: { op: 'resize', id: 'term', w: 480, h: 260 },
        }),
      ALPHA,
    )
    expect(resized.ok).toBe(true)
    await expect.poll(canvasWidth).toBeLessThan(widthBefore - 40)
    // The Canvas copy's ResizeObserver runs before the next frame.
    await nextFrame(window)
    await nextFrame(window)
    expect(await sttySize(window, inTile, 'tile-again')).toEqual(tileSize)
    await focus.getByRole('button', { name: /Exit focus/ }).click()
    await expect(focus).toHaveCount(0)
    const smaller = await sttySize(window, onCanvas, 'smaller')
    expect(smaller.cols).toBeLessThan(canvasSize.cols)
    expect(smaller.rows).toBeLessThan(canvasSize.rows)
  } finally {
    await launched.close()
  }
})
