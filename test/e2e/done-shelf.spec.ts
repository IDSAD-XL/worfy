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

// The done shelf in the built app (worfy-canvas ticket 02, ADR-0075 point 5). The Project is a
// temporary git repository with five Epics, three of them done (every Ticket done, no Layout Node,
// so their frames are collapsed by default); `bin/epic-status` in a temporary WORFY_CLAUDE_HOME
// answers with them. The done Epics stand as chips on the shelf under the strip of frames; a click
// opens a frame at the end of the strip's order, ⌘Z puts it back on the shelf.

const PROJECT_ID = 'shelf-0000c002'
const RECORD = 'epic-arrangement'

/** Five Epics: how many Tickets each has and how many of them are done. */
const EPICS: { epic: string; tickets: number; done: number }[] = [
  { epic: 'worfy-canvas', tickets: 6, done: 0 },
  { epic: 'worfy-reliability', tickets: 9, done: 9 },
  { epic: 'worfy-review', tickets: 8, done: 8 },
  { epic: 'worfy-ui', tickets: 4, done: 1 },
  { epic: 'worfy-week', tickets: 12, done: 12 },
]
const DONE = ['worfy-reliability', 'worfy-review', 'worfy-week']
const OPEN = ['worfy-canvas', 'worfy-ui']

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

/** What epic-status says about the Project: every Epic, its Tickets in a chain (each even one blocked by the one before), the first `done` done. */
function epicStatus(): unknown {
  const tickets = EPICS.flatMap(({ epic, tickets: count, done }) =>
    Array.from({ length: count }, (_, index) => {
      const num = index + 1
      const state = num <= done ? 'done' : 'open'
      const blocked = num > 1 && num % 2 === 0 ? [num - 1] : []
      return { epic, num, slug: `t${num}`, title: `${nn(num)} — Ticket ${num} of ${epic}`, statusRaw: state === 'done' ? 'done 2026-10-10' : 'open', state, blockedRaw: blocked.length ? nn(blocked[0]!) : '—', blockedNums: blocked, blockedParsed: true }
    }),
  )
  return { ref: 'main', epics: EPICS.map(({ epic }) => ({ epic, hasSpec: true, hasMap: false })), tickets }
}

/**
 * The Project's files; `nodes` are the Layout's Nodes, the camera at the smallest zoom (0.2) so the
 * strip and the shelf under it are on screen: the shelf stands under each frame's height with its
 * done stack open, and a Node off screen is not drawn at all.
 */
function makeProject(nodes: unknown[]): void {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-done-shelf-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify(epicStatus()))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  const repo = join(scratch, 'shelf')
  for (const { epic } of EPICS) {
    mkdirSync(join(repo, '.scratch', epic), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'shelf', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 40, y: 40, zoom: 0.2 } }))
}

/**
 * Today's record, as an app before the shelf wrote it: every Epic in its order, the done ones too.
 * K = 2 holds for the two open frames, so the app does not rewrite it.
 */
const RECORD_ORDER = ['worfy-canvas', 'worfy-reliability', 'worfy-review', 'worfy-ui', 'worfy-week']
const record = () => ({ id: RECORD, kind: RECORD, x: 0, y: 0, w: 1, h: 1, locked: true, data: { order: RECORD_ORDER, columns: 2, at: new Date().toISOString() } })

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

const nodeData = async (window: Page, id: string): Promise<Record<string, unknown> | undefined> => (await layoutNodes(window)).find((node) => node.id === id)?.data

type Rect = { x: number; y: number; w: number; h: number }

/** Where a Node of `selector` is on the Canvas (canvas units, from React Flow's transform) and its size, by the element's `data-epic` or `testid`. */
async function placesOf(window: Page, selector: string): Promise<Record<string, Rect>> {
  return window.evaluate((wanted) => {
    const dom = globalThis as unknown as {
      document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null; offsetWidth: number; offsetHeight: number; closest(s: string): { style: { transform: string } } | null }> }
    }
    const result: Record<string, { x: number; y: number; w: number; h: number }> = {}
    for (const element of Array.from(dom.document.querySelectorAll(wanted))) {
      const node = element.closest('.react-flow__node')
      const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node?.style.transform ?? '')
      if (!match) continue
      result[element.getAttribute('data-epic') ?? element.getAttribute('data-testid') ?? ''] = { x: Number(match[1]), y: Number(match[2]), w: element.offsetWidth, h: element.offsetHeight }
    }
    return result
  }, selector)
}

const chipNames = async (window: Page): Promise<string[]> =>
  window.locator('[data-testid="done-shelf-chip"]').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-epic') ?? ''))

const frameNames = async (window: Page): Promise<string[]> =>
  (await window.locator('[data-testid="epic-frame"]').evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-epic') ?? ''))).sort()

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
  return launched
}

/**
 * The machine's own cursor may rest over the window, and a Node that comes to lie under it is
 * hovered for real (its Family dims the rest): the test's pointer goes to an empty corner first.
 */
async function parkPointer(window: Page): Promise<void> {
  const canvas = (await window.locator('.react-flow').boundingBox())!
  await window.mouse.move(canvas.x + 8, canvas.y + canvas.height - 8)
}

/** Waits until the strip and the shelf are drawn as `frames` and `chips` say and the Canvas is at rest. */
async function shown(launched: { window: Page; app?: LaunchedApp['app'] }, frames: string[], chips: string[], size?: { width: number; height: number }): Promise<void> {
  const { window } = launched
  await expect.poll(() => frameNames(window), { timeout: 20_000 }).toEqual([...frames].sort())
  await expect.poll(() => chipNames(window), { timeout: 20_000 }).toEqual(chips)
  await canvasReady(launched, { ...(size ? { size } : {}), frames: 20, timeout: 20_000 })
}

test('the done Epics stand as chips on the shelf under the strip; a click opens the frame last in the order, ⌘Z puts it back on the shelf', async () => {
  makeProject([record()])
  const launched = await launch()
  try {
    const { window } = launched
    await parkPointer(window)
    await shown(launched, OPEN, DONE, { width: 1400, height: 900 })
    await parkPointer(window)

    // The shelf: at the strip's left edge, under every frame of the strip.
    const frames = await placesOf(window, '[data-testid="epic-frame"]')
    const shelf = (await placesOf(window, '[data-testid="done-shelf"]'))['done-shelf']!
    expect(shelf.x).toBe(Math.min(...Object.values(frames).map((rect) => rect.x)))
    for (const rect of Object.values(frames)) expect(rect.y + rect.h).toBeLessThanOrEqual(shelf.y)
    // Each chip says what it is and is a button.
    await expect(window.getByRole('button', { name: 'Expand worfy-week, 12 of 12 done' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Expand worfy-reliability, 9 of 9 done' })).toContainText('9/9')

    await snapshotThemes(window, 'done-shelf')

    // A click opens worfy-review: its frame comes into the strip, last in the record's order.
    await window.getByRole('button', { name: 'Expand worfy-review, 8 of 8 done' }).click()
    await shown(launched, [...OPEN, 'worfy-review'], ['worfy-reliability', 'worfy-week'])
    await expect(window.locator('[data-testid="epic-frame"][data-epic="worfy-review"]')).toHaveAttribute('data-collapsed', 'false')
    await expect.poll(async () => (await nodeData(window, 'epic:worfy-review'))?.collapsed).toBe(false)
    expect(((await nodeData(window, RECORD))?.order as string[]).at(-1)).toBe('worfy-review')

    // ⌘Z: one step puts it back on the shelf and the order back as it was.
    await window.getByTestId('canvas').click({ position: { x: 10, y: 10 } })
    await window.keyboard.press('ControlOrMeta+z')
    await shown(launched, OPEN, DONE)
    expect((await nodeData(window, RECORD))?.order).toEqual(RECORD_ORDER)

    // The keyboard: Tab reaches a chip, Enter opens it; the frame's collapse button sends it back.
    const chip = window.getByRole('button', { name: 'Expand worfy-week, 12 of 12 done' })
    await chip.focus()
    await expect(chip).toBeFocused()
    await window.keyboard.press('Enter')
    await shown(launched, [...OPEN, 'worfy-week'], ['worfy-reliability', 'worfy-review'])
    await window.locator('[data-testid="epic-frame"][data-epic="worfy-week"]').getByRole('button', { name: 'Collapse epic worfy-week' }).click()
    await shown(launched, OPEN, DONE)
    await settled(window)
    expect((await nodeData(window, 'epic:worfy-week'))?.collapsed).toBe(true)
  } finally {
    await launched.close()
  }
  // Opening and collapsing are saved in worfy's own data, never in the repository (ADR-0005).
  expect(git(join(scratch, 'shelf'), 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

test('a second window of the same Project shows the same shelf, and sees a chip opened in the first', async () => {
  makeProject([record()])
  const launched = await launch()
  try {
    const { window } = launched
    await shown(launched, OPEN, DONE, { width: 1400, height: 900 })
    const second = await openSecondWindow(launched, { size: { width: 1000, height: 760 } })
    await expect(second.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
    await shown({ window: second }, OPEN, DONE)
    expect(await placesOf(second, '[data-testid="done-shelf"]')).toEqual(await placesOf(window, '[data-testid="done-shelf"]'))

    await window.getByRole('button', { name: 'Expand worfy-reliability, 9 of 9 done' }).click()
    await shown({ window: second }, [...OPEN, 'worfy-reliability'], ['worfy-review', 'worfy-week'])
    await shown(launched, [...OPEN, 'worfy-reliability'], ['worfy-review', 'worfy-week'])
    expect(await placesOf(second, '[data-testid="epic-frame"]')).toEqual(await placesOf(window, '[data-testid="epic-frame"]'))
  } finally {
    await launched.close()
  }
})
