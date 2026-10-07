import { rm } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'

// "Tidy up" (worfy-week/07) against the built app: from ⌘K and from the Canvas menu the Nodes of
// the Layout on the plane are packed by ELK in its Web Worker, sent to main as one `moveMany`, and
// stand close and without overlaps; one ⌘Z puts every Node back exactly, ⇧⌘Z tidies again. A
// Canvas of 200 Nodes is laid out within 2 s from the command to the last place on the screen.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'tidy-0000000a'
/** The gap two Nodes on the plane keep (ADR-0038), and the gap "Tidy up" leaves. */
const GAP = 16
const TIDY_GAP = 24
const GRID = 8
/** The limit from the command to the last place on the screen, for 200 Nodes. */
const BUDGET_MS = 2000

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  hidden: boolean
  pinned: boolean
}
type Box = { x: number; y: number; width: number; height: number }

let scratch: string
let dataDir: string

const base = { locked: false, tags: [] }
const card = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, kind: 'card', x, y, w: 300, h: 220, hidden: false, pinned: false, ...base, data: { title: id }, ...extra })
const note = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, kind: 'note', x, y, w: 220, h: 120, hidden: false, pinned: false, ...base, data: { text: id }, ...extra })

/** One Project whose layout.json holds `nodes`, shown at `zoom`. */
function makeProject(nodes: unknown[], zoom: number): void {
  const path = join(scratch, 'tidy')
  mkdirSync(path, { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'tidy', path }], activeId: PROJECT }))
}

/** Nine Nodes scattered off the grid, none crowding another; a pinned Note and a hidden Card stay where they are. */
const SCATTERED = [
  card('c1', 1203, 61),
  note('n1', 437, 803),
  card('c2', 1803, 701),
  note('n2', 905, 1190),
  card('c3', 611, 403),
  note('n3', 2403, 203),
  note('n4', 1501, 1403),
  note('p', 13, 17, { pinned: true }),
  card('h', 905, 805, { hidden: true }),
]

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-tidy-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function state(window: Page): Promise<{ nodes: StateNode[]; revision: number }> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { revision: number; layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId: id,
      }),
    PROJECT,
  )
  expect(result.ok).toBe(true)
  return { nodes: result.value.layout.nodes, revision: result.value.revision }
}

const onPlane = (node: StateNode): boolean => !node.hidden && !node.pinned && !['epic-frame', 'ticket', 'subagent', 'subagent-tree'].includes(node.kind)
const placesOf = (nodes: readonly StateNode[]): Record<string, [number, number]> => Object.fromEntries(nodes.map((node) => [node.id, [node.x, node.y]]))
/** How far apart two Layout Nodes are along the axis they are separated on; negative when they overlap. */
const separation = (a: StateNode, b: StateNode): number => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
const apart = (a: Box, b: Box): number => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height))

/** The tidied Nodes keep the gap, stand close, keep their sizes, have corners on the grid; pinned and hidden stay. */
function expectTidy(before: readonly StateNode[], after: readonly StateNode[]): void {
  const moved = after.filter(onPlane)
  expect(moved.length).toBeGreaterThan(1)
  for (const a of moved) {
    const others = moved.filter((b) => b !== a).map((b) => separation(a, b))
    for (const gap of others) expect(gap, `${a.id} to a neighbour`).toBeGreaterThanOrEqual(GAP)
    // Close: a neighbour TIDY_GAP away, give or take the padding of a size up to the grid.
    expect(Math.min(...others), `${a.id} to its nearest neighbour`).toBeLessThan(TIDY_GAP + GRID)
    expect([a.x % GRID, a.y % GRID], `${a.id} on the grid`).toEqual([0, 0])
    const old = before.find((node) => node.id === a.id)!
    expect([a.w, a.h], `${a.id} keeps its size`).toEqual([old.w, old.h])
  }
  for (const id of ['p', 'h']) expect(after.find((node) => node.id === id)).toEqual(before.find((node) => node.id === id))
}

/** The Node elements on the screen do not overlap, at the Canvas's zoom. */
async function expectApartOnScreen(window: Page, ids: readonly string[], zoom: number): Promise<void> {
  const boxes: [string, Box][] = []
  for (const id of ids) {
    const element = window.getByTestId(`rf__node-${id}`)
    if ((await element.count()) === 0) continue
    const found = await element.boundingBox()
    if (found) boxes.push([id, found])
  }
  expect(boxes.length).toBeGreaterThan(1)
  for (const [a, boxA] of boxes) for (const [b, boxB] of boxes) if (a < b) expect(apart(boxA, boxB), `${a} and ${b} on the screen`).toBeGreaterThanOrEqual(GAP * zoom - 1)
}

/** Waits for main's Layout to take a revision past `revision`, then for the Canvas to come to rest. */
async function nextLayout(launched: { window: Page }, revision: number): Promise<StateNode[]> {
  await expect.poll(async () => (await state(launched.window)).revision, { timeout: 10_000 }).toBeGreaterThan(revision)
  await canvasReady(launched)
  return (await state(launched.window)).nodes
}

async function undoRedo(launched: { window: Page }, before: readonly StateNode[], tidied: readonly StateNode[]): Promise<void> {
  const { window } = launched
  await window.locator('.react-flow__pane').click({ position: { x: 150, y: 600 } })
  await window.keyboard.press('Meta+z')
  await expect.poll(async () => placesOf((await state(window)).nodes)).toEqual(placesOf(before))
  await window.keyboard.press('Meta+Shift+z')
  await expect.poll(async () => placesOf((await state(window)).nodes)).toEqual(placesOf(tidied))
}

test('Tidy up from ⌘K packs the scattered Nodes without overlaps; one ⌘Z puts each back to the unit, ⇧⌘Z tidies again', async () => {
  makeProject(SCATTERED, 0.5)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [window.getByTestId('rf__node-c1'), window.getByTestId('rf__node-n4')] })
    const before = await state(window)
    await snapshotThemes(window, '07-before')

    await window.keyboard.press('Meta+k')
    const input = window.getByTestId('palette-input')
    await input.fill('Tidy up')
    const first = window.getByTestId('palette-option').first()
    await expect(first).toHaveAttribute('data-command', 'tidy-up')
    await snapshotThemes(window, '07-palette')
    await input.press('Enter')
    await expect(window.getByTestId('command-palette')).toHaveCount(0)

    const tidied = await nextLayout(launched, before.revision)
    expectTidy(before.nodes, tidied)
    await expectApartOnScreen(window, tidied.filter(onPlane).map((node) => node.id), 0.5)
    await snapshotThemes(window, '07-after')

    // A second Tidy up right away sends nothing: the Layout keeps its revision.
    const { revision } = await state(window)
    await window.keyboard.press('Meta+k')
    await input.fill('Tidy up')
    await expect(first).toHaveAttribute('data-command', 'tidy-up')
    await input.press('Enter')
    await canvasReady(launched)
    expect((await state(window)).revision).toBe(revision)

    await undoRedo(launched, before.nodes, tidied)
  } finally {
    await launched.close()
  }
})

test('Tidy up from the Canvas menu, under the New items: the same layout, one ⌘Z, ⇧⌘Z', async () => {
  makeProject(SCATTERED, 0.5)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [window.getByTestId('rf__node-c1'), window.getByTestId('rf__node-n4')] })
    const before = await state(window)

    await window.locator('.react-flow__pane').click({ button: 'right', position: { x: 150, y: 600 } })
    const menu = window.getByRole('menu', { name: 'Canvas' })
    const items = menu.getByRole('menuitem')
    await expect(items.last()).toHaveText('Tidy up')
    expect((await items.allTextContents()).slice(0, -1).every((label) => label.startsWith('New '))).toBe(true)
    await expect(menu.getByRole('separator')).toHaveCount(1)
    await snapshotThemes(window, '07-menu')
    await menu.getByRole('menuitem', { name: 'Tidy up' }).click()
    await expect(menu).toBeHidden()

    const tidied = await nextLayout(launched, before.revision)
    expectTidy(before.nodes, tidied)
    await expectApartOnScreen(window, tidied.filter(onPlane).map((node) => node.id), 0.5)
    await undoRedo(launched, before.nodes, tidied)
  } finally {
    await launched.close()
  }
})

test('200 Nodes are laid out within 2 s from the command to the last place on the screen', async () => {
  // A jittered grid of 20 × 10 cells, 400 × 300 each: no Node crowds another, none is on the 8 px grid.
  let seed = 11
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const nodes = Array.from({ length: 200 }, (_, index) => {
    const x = (index % 20) * 400 + 1 + Math.floor(random() * 80)
    const y = Math.floor(index / 20) * 300 + 3 + Math.floor(random() * 80)
    return index % 2 === 0 ? note(`n${index}`, x, y) : card(`c${index}`, x, y, { h: 160 })
  })
  makeProject(nodes, 0.2)
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [window.getByTestId('rf__node-n0')], timeout: 20_000 })
    const before = await state(window)
    await window.keyboard.press('Meta+k')
    const input = window.getByTestId('palette-input')
    await input.fill('Tidy up')
    await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'tidy-up')

    // From Enter on, every change of a Node element's place or a Node element coming or going is
    // stamped; the last stamp is when the last Node took its place on the screen.
    await window.evaluate(() => {
      type Observed = { observe(target: unknown, options: Record<string, unknown>): void }
      const page = globalThis as unknown as {
        document: { querySelector(selector: string): unknown; addEventListener(type: string, listener: (event: { key: string }) => void, capture: boolean): void }
        performance: { now(): number }
        MutationObserver: new (callback: () => void) => Observed
        tidyTimes: { start: number; last: number }
      }
      page.tidyTimes = { start: 0, last: 0 }
      const nodes = page.document.querySelector('.react-flow__nodes')
      new page.MutationObserver(() => {
        page.tidyTimes.last = page.performance.now()
      }).observe(nodes, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
      page.document.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter' && page.tidyTimes.start === 0) page.tidyTimes.start = page.performance.now()
        },
        true,
      )
    })
    await input.press('Enter')
    const tidied = await nextLayout(launched, before.revision)
    const times = await window.evaluate(() => (globalThis as unknown as { tidyTimes: { start: number; last: number } }).tidyTimes)
    const elapsed = Math.round(times.last - times.start)
    console.log(`Tidy up of 200 Nodes: ${elapsed} ms from the command to the last place on the screen`)
    test.info().annotations.push({ type: 'tidy-up-200-ms', description: String(elapsed) })
    expect(times.start).toBeGreaterThan(0)
    expect(times.last).toBeGreaterThan(times.start)
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS)

    const moved = tidied.filter(onPlane)
    expect(moved.length).toBeGreaterThanOrEqual(nodes.length)
    let closest = Infinity
    for (let i = 0; i < moved.length; i += 1) for (let j = i + 1; j < moved.length; j += 1) closest = Math.min(closest, separation(moved[i]!, moved[j]!))
    expect(closest).toBeGreaterThanOrEqual(GAP)
    expect(placesOf(moved)).not.toEqual(placesOf(before.nodes.filter(onPlane)))
  } finally {
    await launched.close()
  }
})
