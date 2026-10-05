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
  kind: string
  x: number
  y: number
  w: number
  h: number
  pinned: boolean
  tags: string[]
}
interface Layout {
  nodes: StateNode[]
  viewport: { x: number; y: number; zoom: number }
}

let scratch: string
let dataDir: string

function writeLayout(nodes: { id: string; x: number; y: number; pinned?: boolean }[]): void {
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

/** The notes of a Layout: every Project's Canvas also has its Orchestrator Node (ticket 08). */
const notesOf = (layout: Layout): StateNode[] => layout.nodes.filter((node) => node.kind === 'note')

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
    // The two notes and, last, the Orchestrator Node every Canvas has (ticket 08).
    await expect(window.locator('.react-flow__minimap-node')).toHaveCount(3)
    // Drawn in the colour the note's type file declares (NoteNode.tsx, `minimapColor`); the
    // Orchestrator's type declares none and gets the default.
    const fills = await window.locator('.react-flow__minimap-node').evaluateAll((rects) => rects.map((rect) => (rect as unknown as { style: { fill: string } }).style.fill))
    expect(fills).toEqual(['var(--border-strong)', 'var(--border-strong)', 'var(--text-muted)'])

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

/** Expects two boxes to be the same rectangle on the screen, to the pixel. */
function expectSameBox(actual: Awaited<ReturnType<typeof box>>, expected: Awaited<ReturnType<typeof box>>): void {
  expect(actual.x).toBeCloseTo(expected.x, 0)
  expect(actual.y).toBeCloseTo(expected.y, 0)
  expect(actual.width).toBeCloseTo(expected.width, 0)
  expect(actual.height).toBeCloseTo(expected.height, 0)
}

/** Pans the Canvas with the wheel and waits until `witness` has moved on the screen. */
async function panBy(window: Page, witness: Locator, dx: number, dy: number): Promise<void> {
  const before = await box(witness)
  const pane = await box(window.locator('.react-flow__pane'))
  await window.mouse.move(pane.x + 40, pane.y + pane.height - 40)
  await window.mouse.wheel(dx, dy)
  await expect.poll(async () => (await box(witness)).x).not.toBeCloseTo(before.x, 0)
}

/** Zooms out once with ⌘− and waits for the new zoom. */
async function zoomOut(window: Page): Promise<number> {
  const before = (await viewportOf(window)).zoom
  await window.keyboard.press('Meta+Minus')
  await expect.poll(async () => (await viewportOf(window)).zoom).toBeLessThan(before)
  return (await viewportOf(window)).zoom
}

const visibleMinimapNodes = (window: Page) => window.locator('.react-flow__minimap-node:visible')

test('a pinned Node stays at its place on the screen while the Canvas pans and zooms, after a restart too; Pin and Unpin do not move it on the screen', async () => {
  writeLayout([
    { id: 'pinme', x: 120, y: 100 },
    { id: 'other', x: 520, y: 100 },
  ])
  let pinnedBox: Awaited<ReturnType<typeof box>>
  const first = await launch()
  try {
    const { window } = first
    const pinme = noteById(window, 'pinme')
    const other = noteById(window, 'other')

    // The Canvas is panned and zoomed out before the pin, so screen pixels are not canvas units.
    await panBy(window, other, -60, -30)
    const zoomAtPin = await zoomOut(window)
    expect(zoomAtPin).toBeLessThan(1)
    await pinme.locator('.w-note__header').click()
    const beforePin = await box(pinme)
    // The two notes and the Orchestrator Node every Canvas has (ticket 08).
    await expect(visibleMinimapNodes(window)).toHaveCount(3)

    const toolbar = window.getByTestId('selection-toolbar')
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: 'Pin', exact: true }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.find((node) => node.id === 'pinme')?.pinned).toBe(true)
    await expect(toolbar.getByRole('button', { name: 'Unpin' })).toBeVisible()
    // Pinning neither moves nor resizes it on the screen; it keeps its screen size in the Layout.
    pinnedBox = await box(pinme)
    expectSameBox(pinnedBox, beforePin)
    const saved = (await layoutOf(window)).nodes.find((node) => node.id === 'pinme')
    expect(saved?.w).toBeCloseTo(220 * zoomAtPin, 3)
    expect(saved?.h).toBeCloseTo(120 * zoomAtPin, 3)
    // It is not on the plane any more, so the minimap leaves it out.
    await expect(visibleMinimapNodes(window)).toHaveCount(2)

    // Pan with the wheel, then zoom out twice with ⌘−.
    const otherBefore = await box(other)
    await panBy(window, other, 180, 140)
    await zoomOut(window)
    await zoomOut(window)
    await expect.poll(async () => (await box(other)).width).toBeLessThan(otherBefore.width)
    expectSameBox(await box(pinme), pinnedBox)

    await pinme.locator('.w-note__header').click()
    await window.screenshot({ path: test.info().outputPath('pinned-zoomed-out.png') })
    // Main has the zoomed-out viewport before the app quits.
    await expect.poll(async () => (await layoutOf(window)).viewport.zoom).toBeLessThan(zoomAtPin)
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const { window } = second
    const pinme = noteById(window, 'pinme')
    await expect(pinme).toBeVisible()
    const restored = await box(pinme)
    expectSameBox(restored, pinnedBox)

    // Unpin: the Node is put on the Canvas at the rectangle under its place on the screen.
    await pinme.locator('.w-note__header').click()
    const toolbar = window.getByTestId('selection-toolbar')
    await toolbar.getByRole('button', { name: 'Unpin' }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.find((node) => node.id === 'pinme')?.pinned).toBe(false)
    const { viewport, nodes } = await layoutOf(window)
    const node = nodes.find((entry) => entry.id === 'pinme')
    if (!node) throw new Error('no node')
    const canvas = await box(window.locator('.react-flow'))
    // The canvas rectangle saved for it is drawn where it stood on the screen, at the same size.
    expect(canvas.x + node.x * viewport.zoom + viewport.x).toBeCloseTo(restored.x, 0)
    expect(canvas.y + node.y * viewport.zoom + viewport.y).toBeCloseTo(restored.y, 0)
    expect(node.w * viewport.zoom).toBeCloseTo(restored.width, 0)
    const unpinned = await box(pinme)
    expectSameBox(unpinned, restored)
    await expect(visibleMinimapNodes(window)).toHaveCount(3)

    // On the Canvas again, it moves with a pan.
    await panBy(window, pinme, 150, 0)
  } finally {
    await second.close()
  }
})

test('a pinned Node saved outside a smaller Canvas is shown inside it, and Unpin puts it where it is shown', async () => {
  // Pinned near the right edge of a larger screen: its screen place is outside this window. (Kept
  // near the top, clear of the minimap at the bottom right; pinning.test.tsx covers every side.)
  writeLayout([
    { id: 'away', x: 5000, y: 100, pinned: true },
    { id: 'other', x: 120, y: 100 },
  ])
  const launched = await launch()
  try {
    const { window } = launched
    const away = noteById(window, 'away')
    const canvas = await box(window.locator('.react-flow'))
    await expect.poll(async () => (await box(away)).x).toBeLessThan(canvas.x + canvas.width)
    const shown = await box(away)
    // Moved in as far as it fits: its right edge at the Canvas's, at its saved height and size.
    expect(shown.x + shown.width).toBeCloseTo(canvas.x + canvas.width, 0)
    expect(shown.y).toBeCloseTo(canvas.y + 100, 0)
    expect(shown.width).toBeCloseTo(220, 0)
    // React Flow's own Node is placed there too, so its selection and toolbar are where it is shown.
    expectSameBox(await box(window.locator('.react-flow__node[data-id="away"]')), shown)

    // Reachable: it can be selected and unpinned, and lands on the Canvas where it was shown.
    await away.locator('.w-note__header').click()
    await window.getByTestId('selection-toolbar').getByRole('button', { name: 'Unpin' }).click()
    await expect.poll(async () => (await layoutOf(window)).nodes.find((node) => node.id === 'away')?.pinned).toBe(false)
    const { viewport, nodes } = await layoutOf(window)
    const node = nodes.find((entry) => entry.id === 'away')
    if (!node) throw new Error('no node')
    expect(canvas.x + node.x * viewport.zoom + viewport.x).toBeCloseTo(shown.x, 0)
    expect(canvas.y + node.y * viewport.zoom + viewport.y).toBeCloseTo(shown.y, 0)
    expectSameBox(await box(away), shown)
  } finally {
    await launched.close()
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
    await expect.poll(async () => notesOf(await layoutOf(window)).map((node) => node.tags)).toEqual([['needs review'], ['needs review'], ['needs review']])
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
    await expect.poll(async () => notesOf(await layoutOf(window)).map((node) => node.tags)).toEqual([[], [], ['needs review']])
    await expect(noteById(window, 'a').locator('..').getByTestId('node-tags')).toHaveCount(0)
    await expect(noteById(window, 'c').locator('..').getByTestId('node-tags')).toHaveText('needs review')
  } finally {
    await second.close()
  }
})
