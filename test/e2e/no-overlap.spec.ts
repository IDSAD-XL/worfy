import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import { ORCHESTRATOR_WIDTH } from '../../src/shared/ipc/orchestrator'
import { canvasReady, launchApp, settledBoxes } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// Nodes never overlap (ADR-0038) against the built app: an Epic frame whose offset puts it on a
// Card is drawn next to the Card. The correction of a drop, of a drag of several Nodes and of a
// saved Layout with overlapping Nodes is checked in main's layout store
// (test/contract/layout-store.test.ts, "Nodes never overlap"), its ⌘Z in test/unit/history.test.ts,
// the operation a drag sends in test/unit/canvas.test.tsx, and a drop on a Card in the window in
// test/e2e/snapping.spec.ts.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

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

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-no-overlap-')))
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

/** How far apart two boxes are on the screen along the axis they are separated on; negative when they overlap. */
const apart = (a: Box, b: Box): number => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height))

const nodeElement = (window: Page, id: string) => window.getByTestId(`rf__node-${id}`)

/** How far apart the elements of two Nodes are on the screen, both boxes from one pass once the layout is still (helpers.ts). */
async function apartOnScreen(window: Page, a: string, b: string): Promise<number> {
  const boxes = await settledBoxes(window, { a: `[data-testid="rf__node-${a}"]`, b: `[data-testid="rf__node-${b}"]` }, `the boxes of ${a} and ${b}`)
  return apart(boxes.a, boxes.b)
}

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
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
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
    expect(await apartOnScreen(window, 'epic:demo', 'c1')).toBeGreaterThanOrEqual(GAP * 0.6 - 1)
    expect(await byId(window, DEMO, 'c1')).toMatchObject({ x: column + 40, y: 700 })
    expect(await byId(window, DEMO, 'epic:demo')).toMatchObject({ x: offset.x, y: offset.y })
    await snapshotThemes(window, '04-frame-next-to-card')
  } finally {
    await launched.close()
  }
})
