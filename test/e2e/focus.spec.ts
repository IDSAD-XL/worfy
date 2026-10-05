import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// Focus mode against the built app: selected Nodes fill the window as tiles, presets, dividers
// and title-bar drags change the tiling, Esc brings the Canvas back with the same viewport, and
// neither the Layout in main nor layout.json on disk changes on the way.

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
/** Longer than main's save delay (LAYOUT_SAVE_DELAY_MS, 250 ms): a write that was coming has landed. */
const SAVE_SETTLE_MS = 800

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

const canvasHeader = (window: Page, id: string) => window.locator(`.react-flow__node[data-id="${id}"] .w-note__header`)
const viewportTransform = (window: Page) => window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)

/** Selects the Nodes on the Canvas: a click on the first, ⌘-clicks on the rest. */
async function select(window: Page, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) await canvasHeader(window, id).click(index === 0 ? {} : { modifiers: ['Meta'] })
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
    await window.waitForTimeout(SAVE_SETTLE_MS)
    const fileBefore = readFileSync(layoutFile, 'utf8')

    await select(window, ['n1', 'n2', 'n3'])
    const entry = window.getByRole('button', { name: /^Focus/ })
    await expect(entry).toBeVisible()
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

    // The layer covers the whole window, sidebar and toolbar included.
    const windowSize = await window.evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number }
      return { width: view.innerWidth, height: view.innerHeight }
    })
    expect(await box(focus)).toEqual({ x: 0, y: 0, ...windowSize })

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
    await window.keyboard.press('Meta+Equal')
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
    await window.keyboard.press('Meta+Enter')
    await expect(focus.getByTestId('focus-tile')).toHaveCount(3)
    await focus.getByRole('button', { name: /^Exit focus/ }).click()
    await expect(focus).toHaveCount(0)

    // Nothing reached main, and nothing was written.
    const after = await stateOf(window)
    expect(after.revision).toBe(before.revision)
    expect(after.layout).toEqual(before.layout)
    await window.waitForTimeout(SAVE_SETTLE_MS)
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
    await window.keyboard.press('Meta+Enter')
    const focus = window.getByTestId('focus-mode')
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
