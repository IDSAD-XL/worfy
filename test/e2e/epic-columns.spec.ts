import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { settled } from './wait'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The Epic frames in a strip of K columns in the built app (worfy-canvas ticket 01, ADR-0075). The
// Project is a temporary git repository with 11 Epics, two of them done and so on the done shelf
// (worfy-canvas ticket 02); `bin/epic-status` in a temporary
// WORFY_CLAUDE_HOME answers with them. The order of the frames and K come from the Layout's
// `epic-arrangement` record: on the first opening of a day the app writes it with the Epics with
// work first, past ⌘Z; "Re-pack" writes it as one step of ⌘Z. The strip does not depend on the
// window: two windows of different size show the frames at the same places.

const PROJECT_ID = 'cols-0000c001'
const RECORD = 'epic-arrangement'
/** The one Epic with work: its Ticket 01 is claimed. By name it comes last. */
const ACTIVE = 'worfy-windows'

/** 11 Epics: how many Tickets each has, how many of them are done, and whether one is claimed. */
const EPICS: { epic: string; tickets: number; done: number; claimed?: boolean }[] = [
  { epic: 'worfy-canvas', tickets: 7, done: 0 },
  { epic: 'worfy-daily', tickets: 4, done: 4 },
  { epic: 'worfy-harness', tickets: 6, done: 2 },
  { epic: 'worfy-link', tickets: 5, done: 3 },
  { epic: 'worfy-mvp', tickets: 3, done: 3 },
  { epic: 'worfy-neutral', tickets: 2, done: 0 },
  { epic: 'worfy-pipeline', tickets: 4, done: 1 },
  { epic: 'worfy-polish', tickets: 3, done: 0 },
  { epic: 'worfy-review', tickets: 6, done: 1 },
  { epic: 'worfy-ui', tickets: 2, done: 0 },
  { epic: ACTIVE, tickets: 5, done: 1, claimed: true },
]
const BY_NAME = EPICS.map(({ epic }) => epic).sort()
/**
 * The Epics with a frame in the strip: worfy-daily and worfy-mvp have every Ticket done, so their
 * frames are collapsed by default and they stand on the done shelf instead (worfy-canvas ticket 02).
 */
const SHELF = ['worfy-daily', 'worfy-mvp']
const STRIP = BY_NAME.filter((epic) => !SHELF.includes(epic))

let scratch: string
let dataDir: string
let claudeHome: string

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const nn = (num: number): string => String(num).padStart(2, '0')

/** What epic-status says about the Project: every Epic, its Tickets in a chain (each blocked by the one before), the first `done` done. */
function epicStatus(): unknown {
  const tickets = EPICS.flatMap(({ epic, tickets: count, done, claimed }) =>
    Array.from({ length: count }, (_, index) => {
      const num = index + 1
      const state = num <= done ? 'done' : claimed === true && num === done + 1 ? 'work' : 'open'
      const statusRaw = state === 'done' ? 'done 2026-10-10' : state === 'work' ? 'claimed 2026-10-19T08:00Z' : 'open'
      const blocked = num > 1 && num % 2 === 0 ? [num - 1] : []
      return { epic, num, slug: `t${num}`, title: `${nn(num)} — Ticket ${num} of ${epic}`, statusRaw, state, blockedRaw: blocked.length ? nn(blocked[0]!) : '—', blockedNums: blocked, blockedParsed: true }
    }),
  )
  return { ref: 'main', epics: EPICS.map(({ epic }) => ({ epic, hasSpec: true, hasMap: false })), tickets }
}

/** The Project's files; `nodes` are the Layout's Nodes, the camera at zoom 0.2 so every frame is drawn. */
function makeProject(nodes: unknown[]): void {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-epic-columns-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify(epicStatus()))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  const repo = join(scratch, 'cols')
  for (const { epic } of EPICS) {
    mkdirSync(join(repo, '.scratch', epic), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'cols', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 30, y: 60, zoom: 0.2 } }))
}

/** The record in a Layout file, as the app writes it. */
const record = (order: string[], columns: number, at: Date) => ({ id: RECORD, kind: RECORD, x: 0, y: 0, w: 1, h: 1, locked: true, data: { order, columns, at: at.toISOString() } })

test.afterEach(async () => {
  if (scratch) await removeDir(scratch)
})

interface StateNode {
  id: string
  kind: string
  data: Record<string, unknown>
}

/** The Layout's Nodes as main has them. */
async function layoutNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId: id,
      }),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}

const recordIn = async (window: Page): Promise<Record<string, unknown> | undefined> => (await layoutNodes(window)).find((node) => node.id === RECORD)?.data

type Rect = { x: number; y: number; w: number; h: number }

/** Every frame's place on the Canvas, from React Flow's transform (canvas units), and its size, by Epic. */
async function frames(window: Page): Promise<Record<string, Rect>> {
  return window.evaluate(() => {
    const dom = globalThis as unknown as {
      document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null; offsetWidth: number; offsetHeight: number; closest(s: string): { style: { transform: string } } | null }> }
    }
    const result: Record<string, { x: number; y: number; w: number; h: number }> = {}
    for (const frame of Array.from(dom.document.querySelectorAll('[data-testid="epic-frame"]'))) {
      const node = frame.closest('.react-flow__node')
      const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node?.style.transform ?? '')
      if (!match) continue
      result[frame.getAttribute('data-epic') ?? ''] = { x: Number(match[1]), y: Number(match[2]), w: frame.offsetWidth, h: frame.offsetHeight }
    }
    return result
  })
}

/** The frames' places in the order of the strip: top to bottom, then left to right — the left column's x values first. */
const columnsOf = (placed: Record<string, Rect>): number => new Set(Object.values(placed).map((rect) => rect.x)).size

/** The Epics in the order the strip shows them: frame i is in column i mod K, so row by row, left to right. */
function shownOrder(placed: Record<string, Rect>): string[] {
  const xs = [...new Set(Object.values(placed).map((rect) => rect.x))].sort((a, b) => a - b)
  const columns = xs.map((x) =>
    Object.entries(placed)
      .filter(([, rect]) => rect.x === x)
      .sort(([, a], [, b]) => a.y - b.y)
      .map(([epic]) => epic),
  )
  const order: string[] = []
  for (let row = 0; columns.some((column) => column[row] !== undefined); row += 1) for (const column of columns) if (column[row] !== undefined) order.push(column[row]!)
  return order
}

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
  return launched
}

/** Waits until the 9 frames of the strip and the 2 chips of the shelf are drawn and the Canvas is at rest (ELK has answered for every Epic). */
async function allFrames(launched: LaunchedApp, size?: { width: number; height: number }): Promise<Record<string, Rect>> {
  await expect(launched.window.locator('[data-testid="epic-frame"]')).toHaveCount(STRIP.length, { timeout: ms(20_000) })
  await expect(launched.window.locator('[data-testid="done-shelf-chip"]')).toHaveCount(SHELF.length)
  await canvasReady(launched, { ...(size ? { size } : {}), frames: 20, timeout: ms(20_000) })
  return frames(launched.window)
}

test('the first opening of a day writes the record with the Epic with work first, past ⌘Z; the strip has several columns', async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  makeProject([record(BY_NAME, 1, yesterday)])
  const launched = await launch()
  try {
    const { window } = launched
    await expect.poll(async () => ((await recordIn(window))?.order as string[] | undefined)?.[0]).toBe(ACTIVE)
    const written = (await recordIn(window))!
    // The Epics on the done shelf are not in the strip's order.
    expect(written.order).toEqual([ACTIVE, ...STRIP.filter((epic) => epic !== ACTIVE)])
    expect(new Date(written.at as string).toDateString()).toBe(new Date().toDateString())
    const placed = await allFrames(launched, { width: 1400, height: 900 })
    expect(columnsOf(placed)).toBe(written.columns)
    expect(written.columns as number).toBeGreaterThan(1)
    expect(shownOrder(placed)).toEqual(written.order)

    // The write was the app's own: ⌘Z does not take it back.
    await window.getByTestId('canvas').click({ position: { x: 10, y: 10 } })
    await window.keyboard.press('ControlOrMeta+z')
    await settled(window)
    expect(await recordIn(window)).toEqual(written)
    expect(await frames(window)).toEqual(placed)
  } finally {
    await launched.close()
  }
})

test('fit to the window\'s width, the strip of 9 frames is at most 1.5 window heights; Re-pack puts the active Epic first and ⌘Z puts the strip back', async () => {
  // Today's record, by name and with K = 3: the app keeps it while it holds.
  makeProject([record(BY_NAME, 3, new Date())])
  const launched = await launch()
  try {
    const { window } = launched
    const before = await allFrames(launched, { width: 1400, height: 900 })
    // The app takes the two done Epics, on the shelf, out of the record's order (past ⌘Z).
    await expect.poll(async () => (await recordIn(window))?.order).toEqual(STRIP)
    const recordBefore = await recordIn(window)
    expect(shownOrder(before)).toEqual(STRIP)

    // "Fit": the strip scaled to the Canvas's width is no taller than 1.5 of its height.
    const canvas = (await window.getByTestId('canvas').boundingBox())!
    const rects = Object.values(before)
    const left = Math.min(...rects.map((r) => r.x))
    const right = Math.max(...rects.map((r) => r.x + r.w))
    const top = Math.min(...rects.map((r) => r.y))
    const bottom = Math.max(...rects.map((r) => r.y + r.h))
    const fitted = (bottom - top) * (canvas.width / (right - left))
    expect(fitted, `strip ${right - left} × ${bottom - top} in a Canvas ${canvas.width} × ${canvas.height}`).toBeLessThanOrEqual(1.5 * canvas.height)

    await snapshotThemes(window, 'epic-columns')

    // Re-pack from the Canvas menu: the Epic with work goes first.
    await window.locator('.react-flow__pane').click({ button: 'right', position: { x: 12, y: 12 } })
    await window.getByRole('menuitem', { name: 'Re-pack' }).click()
    await expect.poll(async () => ((await recordIn(window))?.order as string[] | undefined)?.[0]).toBe(ACTIVE)
    await expect.poll(async () => shownOrder(await frames(window))[0]).toBe(ACTIVE)
    await canvasReady(launched, { frames: 20, timeout: ms(20_000) })
    const repacked = await frames(window)
    expect(repacked).not.toEqual(before)

    // ⌘Z: one step brings the record and the strip back.
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await recordIn(window))?.order).toEqual(STRIP)
    expect(await recordIn(window)).toEqual(recordBefore)
    await canvasReady(launched, { frames: 20, timeout: ms(20_000) })
    expect(await frames(window)).toEqual(before)
  } finally {
    await launched.close()
  }
})

test('two windows of one Project of different size show the frames at the same places', async () => {
  makeProject([record(BY_NAME, 3, new Date())])
  const launched = await launch()
  try {
    const big = await allFrames(launched, { width: 1500, height: 950 })
    const second = await openSecondWindow(launched, { size: { width: 1000, height: 760 } })
    await expect(second.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
    await expect(second.locator('[data-testid="epic-frame"]')).toHaveCount(STRIP.length, { timeout: ms(20_000) })
    await canvasReady({ window: second }, { frames: 20, timeout: ms(20_000) })
    expect(await frames(second)).toEqual(big)
    expect(columnsOf(big)).toBeGreaterThan(1)
  } finally {
    await launched.close()
  }
})
