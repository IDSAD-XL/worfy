import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import { ORCHESTRATOR_WIDTH } from '../../src/shared/ipc/orchestrator'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'

// Nodes never overlap (ADR-0038) against the built app: main corrects the operation a drop sends,
// a drag of several Nodes is one operation and one step of ⌘Z, a saved Layout with overlapping
// Nodes is fixed on its first read with a line in main's log, and an Epic frame whose offset puts
// it on a Card is drawn next to the Card. The Projects are written into projects.json up front.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
/** The gap two Nodes on the plane keep (ADR-0038). */
const GAP = 16

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  hidden: boolean
  pinned: boolean
  data: Record<string, unknown>
}
type Box = { x: number; y: number; width: number; height: number }

let scratch: string
let dataDir: string

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const cardNode = (id: string, x: number, y: number) => ({ id, kind: 'card', x, y, w: 300, h: 220, ...base, data: { title: id } })
const noteNode = (id: string, x: number, y: number) => ({ id, kind: 'note', x, y, w: 220, h: 120, ...base, data: { text: id } })

/** Two Projects; `layouts` gives each its layout.json. */
function makeProjects(layouts: Record<string, unknown[]>, active = ALPHA): void {
  const projects = [ALPHA, BETA].map((id) => {
    const name = id.split('-')[0] ?? id
    const path = join(scratch, name)
    mkdirSync(path, { recursive: true })
    mkdirSync(join(dataDir, id), { recursive: true })
    if (layouts[id]) writeFileSync(join(dataDir, id, 'layout.json'), JSON.stringify({ nodes: layouts[id], viewport: { x: 0, y: 0, zoom: 1 } }))
    return { id, name, path }
  })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects, activeId: active }))
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-no-overlap-')))
  dataDir = join(scratch, 'data')
  mkdirSync(dataDir)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function layoutOf(window: Page, projectId: string): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', { projectId: id }),
    projectId,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}
const byId = async (window: Page, projectId: string, id: string): Promise<StateNode> => {
  const node = (await layoutOf(window, projectId)).find((each) => each.id === id)
  if (!node) throw new Error(`no Node ${id}`)
  return node
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}
/** How far apart two boxes are on the screen along the axis they are separated on; negative when they overlap. */
const apart = (a: Box, b: Box): number => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height))
/** The same for two Layout Nodes. */
const separation = (a: StateNode, b: StateNode): number => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const found = await box(locator)
  return { x: found.x + found.width / 2, y: found.y + found.height / 2 }
}

/** Presses on `from` and lets go over `to` (or `dx`, `dy` further), once the Canvas is at rest. */
async function drag(window: Page, from: Locator, to: { x: number; y: number } | { dx: number; dy: number }): Promise<void> {
  await canvasReady({ window }, { visible: [from] })
  const start = await center(from)
  const end = 'dx' in to ? { x: start.x + to.dx, y: start.y + to.dy } : to
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.mouse.move(end.x, end.y, { steps: 12 })
  await window.mouse.up()
}

const nodeElement = (window: Page, id: string) => window.getByTestId(`rf__node-${id}`)
const projectButton = (window: Page, name: string) => window.getByTestId('project-row').filter({ hasText: name }).getByRole('button')

test('a Note dropped onto a Card goes next to it and the Card stays, also after a restart', async () => {
  makeProjects({ [ALPHA]: [cardNode('c1', 500, 300), noteNode('n1', 1000, 300)] })
  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  let dropped: StateNode
  try {
    const { window } = first
    await canvasReady(first, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'c1'), nodeElement(window, 'n1')] })
    const cardBefore = await box(nodeElement(window, 'c1'))
    await drag(window, window.locator('[data-testid="note-node"][data-node-id="n1"] .w-note__header'), await center(nodeElement(window, 'c1')))

    await expect.poll(async () => separation(await byId(window, ALPHA, 'n1'), await byId(window, ALPHA, 'c1'))).toBeGreaterThanOrEqual(GAP)
    expect(await byId(window, ALPHA, 'c1')).toMatchObject({ x: 500, y: 300, w: 300, h: 220 })
    dropped = await byId(window, ALPHA, 'n1')
    // On the screen too: the Note stands next to the Card, which has not moved.
    await canvasReady(first)
    expect(await box(nodeElement(window, 'c1'))).toEqual(cardBefore)
    expect(apart(await box(nodeElement(window, 'n1')), await box(nodeElement(window, 'c1')))).toBeGreaterThanOrEqual(GAP - 1)
    await snapshotThemes(window, '04-note-dropped-on-card')
  } finally {
    await first.close()
  }

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = second
    await canvasReady(second, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'c1'), nodeElement(window, 'n1')] })
    expect(await byId(window, ALPHA, 'n1')).toMatchObject({ x: dropped.x, y: dropped.y })
    expect(await byId(window, ALPHA, 'c1')).toMatchObject({ x: 500, y: 300 })
    expect(apart(await box(nodeElement(window, 'n1')), await box(nodeElement(window, 'c1')))).toBeGreaterThanOrEqual(GAP - 1)
  } finally {
    await second.close()
  }
})

test('two neighbouring Notes dragged together move by the same distance, uncorrected, and one ⌘Z brings both back', async () => {
  // 20 px apart: alone, the first Note would land within 16 px of the second, not yet moved.
  makeProjects({ [ALPHA]: [noteNode('a', 500, 300), noteNode('b', 740, 300)] })
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    const header = (id: string) => window.locator(`[data-testid="note-node"][data-node-id="${id}"] .w-note__header`)
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [header('a'), header('b')] })
    await header('a').click()
    await header('b').click({ modifiers: ['Meta'] })
    await drag(window, header('a'), { dx: 100, dy: 0 })

    await expect.poll(async () => (await byId(window, ALPHA, 'a')).x).toBeGreaterThan(550)
    const a = await byId(window, ALPHA, 'a')
    const b = await byId(window, ALPHA, 'b')
    // The same distance for both: the group moved as one and main did not move it off itself.
    expect(b.x - a.x).toBeCloseTo(240, 6)
    expect(b.y - a.y).toBeCloseTo(0, 6)
    // The group moves by the shift that puts a on the grid of 8 (worfy-week ticket 06): y 300 goes to 304.
    expect(a.y).toBeCloseTo(304, 6)
    expect(a.x % 8).toBe(0)
    // About the 100 px the pointer went (React Flow starts a drag past a small threshold), give or take the grid.
    expect(a.x - 500).toBeGreaterThan(50)
    expect(a.x - 500).toBeLessThanOrEqual(104)

    await window.locator('.react-flow__pane').click({ position: { x: 300, y: 700 } })
    await window.keyboard.press('Meta+z')
    await expect.poll(async () => [await byId(window, ALPHA, 'a'), await byId(window, ALPHA, 'b')].map(({ x, y }) => [x, y])).toEqual([
      [500, 300],
      [740, 300],
    ])
  } finally {
    await launched.close()
  }
})

test('a saved Layout with two overlapping Nodes: on its first read the later Node goes next to the earlier one, main logs the move, and the screen shows no overlap', async () => {
  // BETA is opened only after the test listens to main's console: its layout.json is read then.
  makeProjects({ [ALPHA]: [], [BETA]: [cardNode('A', 500, 300), noteNode('B', 540, 340)] })
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    const lines: string[] = []
    app.on('console', (message) => lines.push(message.text()))
    await projectButton(window, 'beta').click()
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    await expect.poll(() => lines.find((line) => line.includes('moved Node B'))).toMatch(new RegExp(`^\\[layout\\] ${BETA}: moved Node B from \\(540, 340\\) to \\(-?\\d+, -?\\d+\\)`))
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [nodeElement(window, 'A'), nodeElement(window, 'B')] })
    expect(await byId(window, BETA, 'A')).toMatchObject({ x: 500, y: 300 })
    expect(separation(await byId(window, BETA, 'B'), await byId(window, BETA, 'A'))).toBeGreaterThanOrEqual(GAP)
    expect(apart(await box(nodeElement(window, 'B')), await box(nodeElement(window, 'A')))).toBeGreaterThanOrEqual(GAP - 1)
  } finally {
    await launched.close()
  }
})

// ── an Epic frame with an offset yields to a Card ───────────────────────────

const DEMO = 'demo-0000000d'

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test('an Epic frame whose saved offset puts it on a Card is drawn next to the Card; the Card and the offset stay', async () => {
  // A repository with one Epic of one Ticket, and an epic-status that answers with it.
  const repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# demo: a small Epic\n')
  writeFileSync(join(repo, '.scratch', 'demo', 'issues', '01-t1.md'), '# 01 — Ticket 1\n\nType: task\nStatus: open\nBlocked by: —\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: 'demo', hasSpec: true, hasMap: false }],
      tickets: [{ epic: 'demo', num: 1, slug: 't1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  // main puts the Orchestrator at (40, 40), so the frames' column starts right of it (ADR-0032).
  // The Card is far below the column's band, so the column stays; the offset sends the frame onto it.
  const column = 40 + ORCHESTRATOR_WIDTH + FRAME_GAP
  const offset = { x: 0, y: 700 }
  mkdirSync(join(dataDir, DEMO), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: DEMO, name: 'demo', path: repo }], activeId: DEMO }))
  writeFileSync(
    join(dataDir, DEMO, 'layout.json'),
    JSON.stringify({
      nodes: [
        cardNode('c1', column + 40, 700),
        { id: 'epic:demo', kind: 'epic-frame', x: offset.x, y: offset.y, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { collapsed: false } },
      ],
      viewport: { x: 0, y: 0, zoom: 0.6 },
    }),
  )

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const frame = nodeElement(window, 'epic:demo')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame, nodeElement(window, 'c1')] })
    // The gap on the screen at zoom 0.6, less a pixel of rounding.
    expect(apart(await box(frame), await box(nodeElement(window, 'c1')))).toBeGreaterThanOrEqual(GAP * 0.6 - 1)
    expect(await byId(window, DEMO, 'c1')).toMatchObject({ x: column + 40, y: 700 })
    expect(await byId(window, DEMO, 'epic:demo')).toMatchObject({ x: offset.x, y: offset.y })
    await snapshotThemes(window, '04-frame-next-to-card')
  } finally {
    await launched.close()
  }
})
