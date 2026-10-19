import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// Snapping while a Node is dragged or resized (worfy-week ticket 06) against the built app: the
// guide shows during a drag and goes out on the drop, the outline of the landing place is where the
// Node stands after the drop, ⌘ turns snapping off, a resized edge stops 16 short of a neighbour,
// an Epic frame lands on the grid, and a drag over an Auction-sized Canvas keeps its frame rate.
// The Projects are written into projects.json up front; the Canvas starts at zoom 1, so screen
// pixels are canvas units.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'snap-0000000a'
/** The gap two Nodes on the plane keep (ADR-0038). */
const GAP = 16
/** The Canvas shows canvas x from 800 on, far from where main puts its own Nodes. */
const VIEWPORT = { x: -800, y: 0, zoom: 1 }

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
}
type Box = { x: number; y: number; width: number; height: number }

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface PageGlobals {
  requestAnimationFrame: (callback: (now: number) => void) => number
  performance: { now: () => number }
}

let scratch: string
let dataDir: string
let claudeHome: string

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const cardNode = (id: string, x: number, y: number) => ({ id, kind: 'card', x, y, w: 300, h: 220, ...base, data: { title: id } })
const noteNode = (id: string, x: number, y: number) => ({ id, kind: 'note', x, y, w: 220, h: 120, ...base, data: { text: id } })

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/**
 * The only and active Project, a git repository whose `.scratch` `fill` writes, with the saved
 * `nodes`; the Claude home's bin/epic-status prints `answer`, without one an Epic with no Tickets.
 * Not an empty workflow: with no Epic the "No epics yet" panel (FirstEpic.tsx) lies over the middle
 * of the Canvas, and once the answer comes before a press, the press lands on the panel. The Epic's
 * frame is stacked from x = 0, clear of every Node (epic-layout.ts, stackFrames).
 */
function makeProject(nodes: unknown[], viewport: { x: number; y: number; zoom: number } = VIEWPORT, fill?: (scratchDir: string) => string): void {
  const repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch'), { recursive: true })
  const answer = fill?.(join(repo, '.scratch')) ?? JSON.stringify({ ref: 'main', epics: [{ epic: 'empty', hasSpec: false, hasMap: false }], tickets: [] })
  git(repo, 'init', '-q')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'fixtures')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes, viewport }))
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const file = join(scratch, 'epic-status.json')
  writeFileSync(file, answer)
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(file))
  chmodSync(script, 0o755)
}

/** Epics of `sizes` Tickets each, every Ticket blocked by the one at half its number; returns the epic-status answer. */
function writeEpics(dir: string, sizes: readonly number[]): string {
  const states = ['done', 'open', 'open', 'work', 'done', 'open', 'blocked'] as const
  const answer = { ref: 'main', epics: [] as unknown[], tickets: [] as unknown[] }
  sizes.forEach((size, e) => {
    const epic = `epic-${String(e + 1).padStart(2, '0')}`
    const issues = join(dir, epic, 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(dir, epic, 'spec.md'), `# ${epic}: generated Epic\n`)
    answer.epics.push({ epic, hasSpec: true, hasMap: false })
    for (let num = 1; num <= size; num += 1) {
      const blockers = num > 1 ? [Math.floor(num / 2)] : []
      const state = states[num % states.length]!
      const statusRaw = state === 'work' ? 'claimed — 2026-10-05' : state === 'blocked' ? 'blocked — waiting for review' : state
      const blockedRaw = blockers.length ? blockers.map((b) => String(b).padStart(2, '0')).join(', ') : '—'
      const slug = `generated-${num}`
      const text = [`# ${String(num).padStart(2, '0')} — Generated ticket ${num}`, '', `Status: ${statusRaw}`, `Blocked by: ${blockedRaw}`, '', '## Где в коде', '', `- \`src/${epic}/m${num}.ts\``, ''].join('\n')
      writeFileSync(join(issues, `${String(num).padStart(2, '0')}-${slug}.md`), text)
      answer.tickets.push({ epic, num, slug, title: `Generated ticket ${num}`, statusRaw, state, blockedRaw, blockedNums: blockers, blockedParsed: true })
    }
  })
  return JSON.stringify(answer)
}

/** 42 Epics, 682 Tickets, the biggest 97: the Auction-sized Project of test/e2e/epic-frame.spec.ts. */
const AUCTION_SIZES = [97, ...Array.from({ length: 41 }, (_, i) => 14 + (i < 11 ? 1 : 0))]

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-snapping-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = () => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

async function layoutOf(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', { projectId: id }),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}
const byId = async (window: Page, id: string): Promise<StateNode> => {
  const node = (await layoutOf(window)).find((each) => each.id === id)
  if (!node) throw new Error(`no Node ${id}`)
  return node
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** The Node's place on the Canvas, from React Flow's transform (canvas units). */
async function flowPosition(window: Page, id: string): Promise<{ x: number; y: number }> {
  const transform = await window.getByTestId(`rf__node-${id}`).evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

const nodeElement = (window: Page, id: string) => window.getByTestId(`rf__node-${id}`)
const header = (window: Page, id: string) => nodeElement(window, id).locator('.w-note__header')
const guides = (window: Page) => window.getByTestId('snap-guide')
const outlines = (window: Page) => window.getByTestId('snap-outline')

/**
 * Presses on `from`, 10 px into it, starts the drag, and moves the Node by `by`; the button stays
 * down. React Flow starts a drag on the first move past its threshold and measures from there, so
 * that first move is a separate one: the Node then moves exactly by `by`.
 */
async function pressAndMove(window: Page, from: Locator, by: { dx: number; dy: number }): Promise<{ x: number; y: number }> {
  const at = await startDrag(window, from)
  const end = { x: at.x + by.dx, y: at.y + by.dy }
  await window.mouse.move(end.x, end.y, { steps: 12 })
  return end
}

/** Presses on `from`, 10 px into it, and moves 4 px down to start the drag; returns where the mouse is. */
async function startDrag(window: Page, from: Locator): Promise<{ x: number; y: number }> {
  const start = await box(from)
  const at = { x: start.x + 10, y: start.y + 10 }
  await window.mouse.move(at.x, at.y)
  await window.mouse.down()
  await window.mouse.move(at.x, at.y + 4)
  return { x: at.x, y: at.y + 4 }
}

test('a Card dragged next to another lines up with it: the guide shows while the mouse is down and goes out on the drop', async () => {
  makeProject([cardNode('c1', 1000, 200), cardNode('c2', 1504, 400)])
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'c1'), nodeElement(window, 'c2')] })
    // c2's top edge 3 px under c1's: it sticks to it.
    await pressAndMove(window, window.getByTestId('rf__node-c2').getByTestId('card-title'), { dx: 0, dy: -197 })
    // A guide is a line 1 px wide and 0 high (or the other way round): Playwright calls it hidden, so it is counted.
    await expect(guides(window)).not.toHaveCount(0)
    expect(await guides(window).evaluateAll((lines) => lines.map((line) => `${line.getAttribute('data-axis')}${line.getAttribute('data-at')}`))).toContain('y200')
    await window.mouse.up()
    await expect(guides(window)).toHaveCount(0)
    await expect.poll(() => byId(window, 'c2')).toMatchObject({ x: 1504, y: 200 })
  } finally {
    await launched.close()
  }
})

test('a Note dragged onto a Card: the outline shows where it lands, and after the drop it stands exactly in the outline', async () => {
  makeProject([cardNode('c1', 1000, 300), noteNode('n1', 1600, 300)])
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'c1'), nodeElement(window, 'n1')] })
    // The Note's corner to (1040, 340), onto the Card.
    await pressAndMove(window, header(window, 'n1'), { dx: -560, dy: 40 })
    await expect(outlines(window)).toHaveCount(1)
    const outline = outlines(window).first()
    const promised = { x: Number(await outline.getAttribute('data-x')), y: Number(await outline.getAttribute('data-y')) }
    const promisedBox = await box(outline)
    await window.mouse.up()
    await expect(outlines(window)).toHaveCount(0)
    await expect.poll(() => byId(window, 'n1')).toMatchObject(promised)
    expect(await flowPosition(window, 'n1')).toEqual(promised)
    // On the screen too: the Note's box is the outline's (the outline is drawn half a pixel in).
    const noteBox = await box(nodeElement(window, 'n1'))
    expect(Math.abs(noteBox.x - promisedBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(noteBox.y - promisedBox.y)).toBeLessThanOrEqual(1)
    const card = await byId(window, 'c1')
    const note = await byId(window, 'n1')
    const apart = Math.max(card.x - (note.x + note.w), note.x - (card.x + card.w), card.y - (note.y + note.h), note.y - (card.y + card.h))
    expect(apart).toBeGreaterThanOrEqual(GAP)
  } finally {
    await launched.close()
  }
})

test('with ⌘ held a Note stays where it was let go, with no guide', async () => {
  makeProject([noteNode('n1', 1000, 300), noteNode('n2', 1000, 600)])
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'n1'), nodeElement(window, 'n2')] })
    const at = await startDrag(window, header(window, 'n2'))
    await window.keyboard.down('ControlOrMeta')
    // Left edge 3 from n1's, top 21 further: both would snap without ⌘.
    await window.mouse.move(at.x + 3, at.y + 21, { steps: 12 })
    await expect(guides(window)).toHaveCount(0)
    await window.mouse.up()
    await window.keyboard.up('ControlOrMeta')
    await expect.poll(() => byId(window, 'n2')).toMatchObject({ x: 1003, y: 621 })
  } finally {
    await launched.close()
  }
})

test('a Note resized towards a Card stops 16 short of it while the mouse is down, and keeps that size', async () => {
  makeProject([noteNode('n1', 1000, 300), cardNode('c1', 1500, 300)])
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'n1'), nodeElement(window, 'c1')] })
    await header(window, 'n1').click()
    const edge = nodeElement(window, 'n1').locator('.react-flow__resize-control.line.right')
    const at = await box(edge)
    await window.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
    await window.mouse.down()
    // 400 to the right: the edge would end 120 inside the Card.
    await window.mouse.move(at.x + at.width / 2 + 400, at.y + at.height / 2, { steps: 12 })
    const during = await box(nodeElement(window, 'n1'))
    const card = await box(nodeElement(window, 'c1'))
    expect(Math.round(card.x - (during.x + during.width))).toBe(GAP)
    await window.mouse.up()
    await expect.poll(() => byId(window, 'n1')).toMatchObject({ x: 1000, w: 1500 - GAP - 1000 })
  } finally {
    await launched.close()
  }
})

test('an Epic frame dragged by its header lands on the grid as a whole', async () => {
  makeProject([], { x: 0, y: 0, zoom: 1 }, (dir) => writeEpics(dir, [3]))
  const launched = await launch()
  try {
    const { window } = launched
    const frame = window.locator('[data-testid="epic-frame"][data-epic="epic-01"]')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame] })
    await pressAndMove(window, frame.locator('.w-epic__drag'), { dx: 213, dy: 141 })
    await window.mouse.up()
    await expect.poll(async () => (await layoutOf(window)).some((node) => node.id === 'epic:epic-01')).toBe(true)
    await canvasReady({ window })
    const place = await flowPosition(window, 'epic:epic-01')
    expect(place.x % 8, `the frame's x ${place.x} is on the grid`).toBe(0)
    expect(place.y % 8, `the frame's y ${place.y} is on the grid`).toBe(0)
  } finally {
    await launched.close()
  }
})

test('the guide, the equal gaps and the landing outline in both themes', async () => {
  // A row of two Notes 80 apart, and a Card under where the third Note of the row goes.
  makeProject([noteNode('a', 1000, 200), noteNode('b', 1300, 200), cardNode('d', 1650, 260), noteNode('c', 1000, 600)])
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'a'), nodeElement(window, 'd'), nodeElement(window, 'c')] })
    // c to (1602, 203): 2 off the gap of 80 after b, 3 under the row's top edges.
    await pressAndMove(window, header(window, 'c'), { dx: 602, dy: -397 })
    // A guide is a line 1 px wide and 0 high (or the other way round): Playwright calls it hidden, so it is counted.
    await expect(guides(window)).not.toHaveCount(0)
    await expect(window.getByTestId('snap-gap')).toHaveCount(2)
    await expect(outlines(window)).toHaveCount(1)
    // 1 px lines in the accent colour of each theme.
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const style = await guides(window)
        .first()
        .evaluate((line) => {
          const computed = (globalThis as unknown as { getComputedStyle(element: unknown): { stroke: string; strokeWidth: string } }).getComputedStyle(line)
          const root = (globalThis as unknown as { getComputedStyle(element: unknown): { getPropertyValue(name: string): string }; document: { documentElement: unknown } })
          return { stroke: computed.stroke, width: computed.strokeWidth, accent: root.getComputedStyle(root.document.documentElement).getPropertyValue('--accent').trim() }
        })
      expect(style.width).toBe('1px')
      expect(style.stroke.length).toBeGreaterThan(0)
      expect(style.accent.length).toBeGreaterThan(0)
    }
    await window.emulateMedia({ colorScheme: null })
    // test-results/e2e/snapshots/snapping/{light,dark}.png; the ticket's evidence is copied from there.
    await snapshotThemes(window, 'snapping')
    await window.mouse.up()
    await expect(outlines(window)).toHaveCount(0)
    await expect(window.getByTestId('snap-gap')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('a drag over an Auction-sized Canvas for 2 s keeps the frame rate', async () => {
  makeProject([noteNode('mover', 40, 300)], { x: 0, y: 0, zoom: 1 }, (dir) => writeEpics(dir, AUCTION_SIZES))
  const enforce = process.env.WORFY_PERF === '1'
  const launched = await launch()
  try {
    const { window } = launched
    await expect(window.locator('[data-testid="epic-frame"][data-epic="epic-01"]')).toBeVisible({ timeout: 20_000 })
    await expect(window.locator('[data-testid="ticket-node"][data-epic="epic-01"]').first()).toBeVisible({ timeout: 20_000 })
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'mover')] })
    const from = await startDrag(window, header(window, 'mover'))
    await window.evaluate(() => {
      const { requestAnimationFrame, performance } = globalThis as unknown as PageGlobals
      const w = globalThis as unknown as { __frames: number[]; __stop: boolean }
      w.__frames = []
      w.__stop = false
      let last = performance.now()
      const tick = (now: number) => {
        w.__frames.push(now - last)
        last = now
        if (!w.__stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Back and forth over the frames for 2 s.
    const until = Date.now() + 2_000
    let step = 0
    while (Date.now() < until) {
      const t = step / 30
      await window.mouse.move(from.x + 300 + 300 * Math.sin(t), from.y + 150 * Math.cos(t * 1.3))
      step += 1
    }
    const frames = await window.evaluate(() => {
      const w = globalThis as unknown as { __frames: number[]; __stop: boolean }
      w.__stop = true
      return w.__frames.slice(1)
    })
    await window.mouse.up()
    const sorted = [...frames].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity
    const fps = Math.round((1000 / median) * 10) / 10
    const longest = Math.round(Math.max(...frames))
    console.log(`auction-size drag 2 s: ${frames.length} frames, ${step} moves, median ${fps} fps, longest frame ${longest} ms`)
    test.info().annotations.push({ type: 'perf', description: `dragMedianFps=${fps} dragLongestFrame=${longest}ms frames=${frames.length}` })
    // Frame rates depend on the machine: CI only prints them, WORFY_PERF=1 on the developer's Mac checks them.
    if (enforce) {
      expect(fps).toBeGreaterThanOrEqual(55)
      expect(longest).toBeLessThanOrEqual(100)
    }
  } finally {
    await launched.close()
  }
})

/**
 * 250 Layout Nodes in 20 columns 360 × 280 apart, each moved up to 20 off its place, every other
 * one a Card and the rest Notes (the Canvas of worfy-week ticket 14's measurement), from canvas
 * (800, 480) on.
 */
function scatteredGrid(): (ReturnType<typeof noteNode> | ReturnType<typeof cardNode>)[] {
  let state = 7
  const off = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.round((state / 2147483648) * 40 - 20)
  }
  return Array.from({ length: 250 }, (_, index) => {
    const x = 800 + (index % 20) * 360 + off()
    const y = 480 + Math.floor(index / 20) * 280 + off()
    return index % 2 === 0 ? cardNode(`grid-${index}`, x, y) : noteNode(`grid-${index}`, x, y)
  })
}

test('a group of 10 Notes and a Card dragged over 250 Layout Nodes for 2 s makes no long task', async () => {
  // Two rows of five Notes and a Card right of them, above the grid.
  const group = [...Array.from({ length: 10 }, (_, index) => noteNode(`g${index}`, 820 + (index % 5) * (220 + GAP), 80 + Math.floor(index / 5) * (120 + GAP))), cardNode('gc', 820 + 5 * (220 + GAP), 80)]
  // At zoom 0.5 the window shows canvas x from 800 on, and the drag reaches the middle rows of the grid.
  makeProject([...group, ...scatteredGrid()], { x: -400, y: 0, zoom: 0.5 })
  const enforce = process.env.WORFY_PERF === '1'
  const launched = await launch()
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'g0'), nodeElement(window, 'gc'), nodeElement(window, 'g9')] })
    // A selection box from the empty Canvas above-left of the group to below-right of it, short of the grid.
    const first = await box(nodeElement(window, 'g0'))
    const card = await box(nodeElement(window, 'gc'))
    const last = await box(nodeElement(window, 'g9'))
    await window.mouse.move(first.x - 10, first.y - 10)
    await window.mouse.down()
    await window.mouse.move(card.x + card.width + 10, last.y + last.height + 10, { steps: 10 })
    await window.mouse.up()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(11)

    const from = await startDrag(window, header(window, 'g0'))
    await window.evaluate(() => {
      const { requestAnimationFrame, performance } = globalThis as unknown as PageGlobals
      const w = globalThis as unknown as {
        __frames: number[]
        __long: number[]
        __stop: boolean
        PerformanceObserver: new (callback: (list: { getEntries(): { duration: number }[] }) => void) => { observe(options: { type: string }): void; disconnect(): void }
        __observer: { disconnect(): void }
      }
      w.__frames = []
      w.__long = []
      w.__stop = false
      const observer = new w.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push(entry.duration)
      })
      observer.observe({ type: 'longtask' })
      w.__observer = observer
      let last = performance.now()
      const tick = (now: number) => {
        w.__frames.push(now - last)
        last = now
        if (!w.__stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Over the middle rows of the grid and back along a sine wave for 2 s: 1300 ± 400 canvas units down.
    const until = Date.now() + 2_000
    let step = 0
    while (Date.now() < until) {
      const t = step / 30
      await window.mouse.move(from.x + 400 + 400 * Math.sin(t), from.y + 650 + 200 * Math.sin(t * 1.3))
      step += 1
    }
    const { frames, long } = await window.evaluate(() => {
      const w = globalThis as unknown as { __frames: number[]; __long: number[]; __stop: boolean; __observer: { disconnect(): void } }
      w.__stop = true
      w.__observer.disconnect()
      return { frames: w.__frames.slice(1), long: w.__long }
    })
    await window.mouse.up()
    const sorted = [...frames].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity
    const fps = Math.round((1000 / median) * 10) / 10
    const longest = Math.round(Math.max(...frames))
    const longTasks = long.map(Math.round)
    console.log(`group drag 2 s over 250 Nodes: ${frames.length} frames, ${step} moves, median ${fps} fps, longest frame ${longest} ms, long tasks ${longTasks.length} [${longTasks.join(', ')}] ms`)
    test.info().annotations.push({ type: 'perf', description: `groupDragLongTasks=${longTasks.length} groupDragLongestFrame=${longest}ms groupDragMedianFps=${fps}` })

    // Main still keeps every Node on the plane NODE_GAP clear of the others after the drop (ADR-0038).
    await expect.poll(async () => (await byId(window, 'g0')).y, { message: 'the group is saved where it landed' }).toBeGreaterThan(80 + GAP)
    const nodes = await layoutOf(window)
    // Closer than the gap on both axes, with the rounding slack of src/shared/layout/free-place.ts.
    const near = GAP - 1e-6
    const crowded = nodes.flatMap((a, index) =>
      nodes.slice(index + 1).filter((b) => a.x < b.x + b.w + near && b.x < a.x + a.w + near && a.y < b.y + b.h + near && b.y < a.y + a.h + near).map((b) => `${a.id}/${b.id}`),
    )
    expect(crowded).toEqual([])
    // Frame times depend on the machine: CI only prints them, WORFY_PERF=1 on the developer's Mac checks them.
    if (enforce) {
      expect(longTasks).toEqual([])
      expect(longest).toBeLessThanOrEqual(50)
    }
  } finally {
    await launched.close()
  }
})
