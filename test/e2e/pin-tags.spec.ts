import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'

// Ticket 29 against the built app: the minimap moves the viewport and is hidden from the View
// menu, a Node pinned to the screen stays put while the Canvas pans and zooms and after a
// restart, and a tag given to three Nodes at once shows on each and survives a restart.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

interface StateNode {
  id: string
  x: number
  y: number
  pinned: boolean
  tags: string[]
}
interface Layout {
  nodes: StateNode[]
  viewport: { x: number; y: number; zoom: number }
}

let scratch: string
let dataDir: string

function writeLayout(nodes: { id: string; x: number; y: number }[]): void {
  const layout = { nodes: nodes.map((node) => ({ ...node, kind: 'note', w: 220, h: 120, data: { text: node.id } })), viewport: { x: 0, y: 0, zoom: 1 } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify(layout))
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-pin-tags-')))
  dataDir = join(scratch, 'data')
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function layoutOf(window: Page): Promise<Layout> {
  const result = await window.evaluate(
    (id) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: Layout } }> } }).worfy.invoke('layout.get', { projectId: id }),
    PROJECT,
  )
  expect(result.ok).toBe(true)
  return result.value.layout
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const noteById = (window: Page, id: string) => window.locator(`[data-testid="note-node"][data-node-id="${id}"]`)

/** React Flow's viewport as its transform shows it. */
async function viewportOf(window: Page): Promise<{ x: number; y: number; zoom: number }> {
  const transform = await window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.e-]+)px,\s*(-?[\d.e-]+)px\)\s*scale\((-?[\d.e-]+)\)/.exec(transform)
  if (!match) throw new Error(`unexpected viewport transform: ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
}

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
  return launched
}

/** Clicks View ▸ Show Minimap the way the menu does. */
async function toggleMinimapMenu(app: LaunchedApp['app']): Promise<boolean> {
  return app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('view.minimap')
    if (!item) throw new Error('View ▸ Show Minimap is missing')
    item.click()
    return item.checked
  })
}

test('a click on the minimap moves the viewport there; View ▸ Show Minimap hides and shows it', async () => {
  writeLayout([
    { id: 'near', x: 80, y: 80 },
    { id: 'far', x: 2600, y: 1800 },
  ])
  const launched = await launch()
  try {
    const { window, app } = launched
    const minimap = window.getByRole('img', { name: 'Minimap' })
    await expect(minimap).toBeVisible()
    await expect(window.locator('.react-flow__minimap-node')).toHaveCount(2)

    // The far note is off screen; a click on its rectangle in the minimap centres the viewport on it.
    const far = noteById(window, 'far')
    const pane = await box(window.locator('.react-flow'))
    const before = await viewportOf(window)
    await window.locator('.react-flow__minimap-node').nth(1).click()
    await expect.poll(async () => (await viewportOf(window)).x).not.toBe(before.x)
    await expect(far).toBeVisible()
    const farBox = await box(far)
    const centre = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 }
    // The click lands somewhere on the note's rectangle, so the centre is within the note.
    expect(Math.abs(farBox.x + farBox.width / 2 - centre.x)).toBeLessThan(farBox.width)
    expect(Math.abs(farBox.y + farBox.height / 2 - centre.y)).toBeLessThan(farBox.height)
    const viewport = await viewportOf(window)
    expect(viewport.zoom).toBe(before.zoom)
    // The new viewport is saved like any other move of the Canvas.
    await expect.poll(async () => (await layoutOf(window)).viewport.x).toBeCloseTo(viewport.x, 0)

    // The View menu hides it and shows it again.
    expect(await toggleMinimapMenu(app)).toBe(false)
    await expect(minimap).toHaveCount(0)
    expect(await toggleMinimapMenu(app)).toBe(true)
    await expect(minimap).toBeVisible()
  } finally {
    await launched.close()
  }
})

test('a pinned Node stays at its place on the screen while the Canvas pans and zooms, after a restart too; Unpin puts it on the Canvas under it', async () => {
  writeLayout([
    { id: 'pinme', x: 120, y: 100 },
    { id: 'other', x: 520, y: 100 },
  ])
  let pinnedBox: Awaited<ReturnType<typeof box>>
  let otherBefore: Awaited<ReturnType<typeof box>>
  const first = await launch()
  try {
    const { window } = first
    const pinme = noteById(window, 'pinme')
    const other = noteById(window, 'other')
    await pinme.locator('.w-note__header').click()
    const toolbar = window.getByTestId('selection-toolbar')
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: 'Pin', exact: true }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.find((node) => node.id === 'pinme')?.pinned).toBe(true)
    await expect(toolbar.getByRole('button', { name: 'Unpin' })).toBeVisible()
    pinnedBox = await box(pinme)
    otherBefore = await box(other)

    // Pan with the wheel, then zoom out twice with ⌘−.
    const pane = await box(window.locator('.react-flow__pane'))
    await window.mouse.move(pane.x + 40, pane.y + pane.height - 40)
    await window.mouse.wheel(180, 140)
    await expect.poll(async () => (await box(other)).x).not.toBe(otherBefore.x)
    await window.keyboard.press('Meta+Minus')
    await window.keyboard.press('Meta+Minus')
    await expect.poll(async () => (await viewportOf(window)).zoom).toBeLessThan(1)
    await expect.poll(async () => (await box(other)).width).toBeLessThan(otherBefore.width)

    const after = await box(pinme)
    expect(after.x).toBeCloseTo(pinnedBox.x, 0)
    expect(after.y).toBeCloseTo(pinnedBox.y, 0)
    expect(after.width).toBeCloseTo(pinnedBox.width, 0)
    expect(after.height).toBeCloseTo(pinnedBox.height, 0)

    await pinme.locator('.w-note__header').click()
    await window.screenshot({ path: test.info().outputPath('pinned-zoomed-out.png') })
    // Main has the zoomed-out viewport before the app quits.
    await expect.poll(async () => (await layoutOf(window)).viewport.zoom).toBeLessThan(1)
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const { window } = second
    const pinme = noteById(window, 'pinme')
    await expect(pinme).toBeVisible()
    const restored = await box(pinme)
    expect(restored.x).toBeCloseTo(pinnedBox.x, 0)
    expect(restored.y).toBeCloseTo(pinnedBox.y, 0)
    expect(restored.width).toBeCloseTo(pinnedBox.width, 0)

    // Unpin: the Node is put on the Canvas at the point under its place on the screen.
    await pinme.locator('.w-note__header').click()
    const toolbar = window.getByTestId('selection-toolbar')
    await toolbar.getByRole('button', { name: 'Unpin' }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.find((node) => node.id === 'pinme')?.pinned).toBe(false)
    const { viewport, nodes } = await layoutOf(window)
    const node = nodes.find((entry) => entry.id === 'pinme')
    if (!node) throw new Error('no node')
    const canvas = await box(window.locator('.react-flow'))
    const unpinned = await box(pinme)
    // The canvas point saved for it is drawn where it stood on the screen; it now has the canvas zoom.
    expect(canvas.x + node.x * viewport.zoom + viewport.x).toBeCloseTo(restored.x, 0)
    expect(canvas.y + node.y * viewport.zoom + viewport.y).toBeCloseTo(restored.y, 0)
    expect(unpinned.x).toBeCloseTo(restored.x, 0)
    expect(unpinned.y).toBeCloseTo(restored.y, 0)

    // On the Canvas again, it moves with a pan.
    const pane = await box(window.locator('.react-flow__pane'))
    await window.mouse.move(pane.x + 40, pane.y + pane.height - 40)
    await window.mouse.wheel(150, 0)
    await expect.poll(async () => (await box(pinme)).x).not.toBeCloseTo(unpinned.x, 0)
  } finally {
    await second.close()
  }
})

test('a tag added to three Nodes at once shows on each and survives a restart; it can be removed from all of them', async () => {
  writeLayout([
    { id: 'a', x: 80, y: 120 },
    { id: 'b', x: 340, y: 120 },
    { id: 'c', x: 600, y: 120 },
  ])
  const ids = ['a', 'b', 'c']
  const first = await launch()
  try {
    const { window } = first
    await noteById(window, 'a').locator('.w-note__header').click()
    await noteById(window, 'b').locator('.w-note__header').click({ modifiers: ['Meta'] })
    await noteById(window, 'c').locator('.w-note__header').click({ modifiers: ['Meta'] })
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)

    const toolbar = window.getByTestId('selection-toolbar')
    await toolbar.getByRole('button', { name: 'Add tag' }).click()
    const input = toolbar.getByRole('textbox', { name: 'New tag' })
    await input.fill('  needs   review ')
    await input.press('Enter')

    for (const id of ids) await expect(noteById(window, id).locator('..').getByTestId('node-tags')).toHaveText('needs review')
    await expect.poll(async () => (await layoutOf(window)).nodes.map((node) => node.tags)).toEqual([['needs review'], ['needs review'], ['needs review']])
    await expect(toolbar.getByText('needs review')).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('tags-three-nodes.png') })
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const { window } = second
    for (const id of ids) await expect(noteById(window, id).locator('..').getByTestId('node-tags')).toHaveText('needs review')

    // Removed from the selection only: a and b lose it, c keeps it.
    await noteById(window, 'a').locator('.w-note__header').click()
    await noteById(window, 'b').locator('.w-note__header').click({ modifiers: ['Meta'] })
    await window.getByTestId('selection-toolbar').getByRole('button', { name: 'Remove tag needs review' }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.map((node) => node.tags)).toEqual([[], [], ['needs review']])
    await expect(noteById(window, 'a').locator('..').getByTestId('node-tags')).toHaveCount(0)
    await expect(noteById(window, 'c').locator('..').getByTestId('node-tags')).toHaveText('needs review')
  } finally {
    await second.close()
  }
})
