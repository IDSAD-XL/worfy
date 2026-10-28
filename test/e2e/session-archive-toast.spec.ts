import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The toast of a batch of the automatic archive in the built app (worfy-canvas ticket 10, ADR-0076,
// point 8). The Machine chose nothing in Settings → Canvas, so the default threshold, 24 h, is in
// force. The Project holds three external Session Nodes: OLD_A and OLD_B, finished, last record 30 h
// ago, and FRESH, finished an hour ago. The timer runs every 250 ms (WORFY_ARCHIVE_TICK_MS): the run
// at main's first read of the Layout, as the window is created, takes OLD_A and OLD_B as one batch,
// and the window shows «Archived 2 finished sessions» with Undo (snapshots in both themes). That
// batch can come before the page listens to `layout.archived` (in 3 of 24 runs under load); the page
// then has it from `layout.recentBatches`, asked once it listens. Undo brings both back
// to their places; ⌘Z after it does not take them again, nor do the next runs of the timer.

const PROJECT_ID = 'archive-0000c010'
const TICK_MS = 250
const OLD_A = 'aaaaaaaa-1010-4010-8010-000000000001'
const OLD_B = 'bbbbbbbb-1010-4010-8010-000000000002'
const FRESH = 'cccccccc-1010-4010-8010-000000000003'
const HOUR = 3_600_000
const PLACES: Record<string, { x: number; y: number }> = { [OLD_A]: { x: 0, y: 0 }, [OLD_B]: { x: 400, y: 0 }, [FRESH]: { x: 800, y: 0 } }

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** A transcript in the Claude home whose only record is `ago` ms old. */
function transcript(sessionId: string, ago: number): void {
  const dir = join(claudeHome, 'projects', repo.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const record = { type: 'user', uuid: `${sessionId}-1`, sessionId, isSidechain: false, cwd: repo, timestamp: new Date(Date.now() - ago).toISOString(), message: { role: 'user', content: 'hello' } }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`)
}

const sessionNode = (sessionId: string) => ({
  id: `session:${sessionId}`,
  kind: 'session',
  ...PLACES[sessionId]!,
  w: 300,
  h: 120,
  data: { sessionId, origin: 'external', source: 'terminal', cwd: repo },
})

function makeProject(): void {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-archive-toast-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  repo = join(scratch, 'demo')
  mkdirSync(repo, { recursive: true })
  transcript(OLD_A, 30 * HOUR)
  transcript(OLD_B, 30 * HOUR)
  transcript(FRESH, HOUR)
  const project = join(dataDir, PROJECT_ID)
  mkdirSync(project, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  // No app-settings.json: the Machine chose nothing, the default threshold is in force.
  writeFileSync(join(project, 'layout.json'), JSON.stringify({ nodes: [sessionNode(OLD_A), sessionNode(OLD_B), sessionNode(FRESH)], viewport: { x: 40, y: 200, zoom: 0.6 } }))
}

interface StateNode {
  id: string
  x: number
  y: number
  archived?: { batch: string } | null
}

/** The Project's Session Nodes as main has them. */
async function layoutNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (projectId) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId,
      }),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}

const archivedIds = async (window: Page): Promise<string[]> => (await layoutNodes(window)).filter((node) => node.archived != null).map((node) => node.id)
const placesOf = async (window: Page): Promise<Record<string, { x: number; y: number }>> =>
  Object.fromEntries((await layoutNodes(window)).flatMap((node) => (node.id.startsWith('session:') ? [[node.id.slice('session:'.length), { x: node.x, y: node.y }]] : [])))

const nodeOf = (window: Page, sessionId: string): Locator => window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)

test.afterEach(async () => {
  if (scratch) await removeDir(scratch)
})

test('with the default threshold the timer archives the finished Sessions as one batch; the toast tells how many, Undo brings them back to their places, and ⌘Z after it does not take them again', async () => {
  makeProject()
  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_ARCHIVE_TICK_MS: String(TICK_MS) } })
  try {
    const { window } = launched
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
    await canvasReady(launched, { size: { width: 1400, height: 900 }, timeout: 20_000 })

    // The first run after the window read the Layout: one batch of OLD_A and OLD_B; FRESH stays.
    await expect.poll(() => archivedIds(window), { timeout: 20_000 }).toEqual([`session:${OLD_A}`, `session:${OLD_B}`])
    const batches = new Set((await layoutNodes(window)).flatMap((node) => (node.archived == null ? [] : [node.archived.batch])))
    expect(batches.size, 'one batch').toBe(1)
    await expect(nodeOf(window, OLD_A)).toHaveCount(0)
    await expect(nodeOf(window, OLD_B)).toHaveCount(0)
    await expect(nodeOf(window, FRESH)).toBeVisible()

    // One toast with the count and Undo; it stays until closed.
    const toast = window.getByTestId('archive-toast')
    await expect(toast).toHaveCount(1)
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Archived 2 finished sessions')
    const undo = toast.getByRole('button', { name: 'Undo' })
    await expect(undo).toBeVisible()
    await snapshotThemes(window, '10-archive-toast')
    await expect(toast).toHaveCount(1)

    // Undo: the batch comes back, each to its old place, and the toast closes.
    await undo.click()
    await expect.poll(() => archivedIds(window)).toEqual([])
    await expect(toast).toHaveCount(0)
    await expect(nodeOf(window, OLD_A)).toBeVisible()
    await expect(nodeOf(window, OLD_B)).toBeVisible()
    expect(await placesOf(window)).toEqual(PLACES)

    // ⌘Z after the Undo: the Undo is no step of the history, so ⌘Z does not archive the batch again.
    await window.getByTestId('canvas').click({ position: { x: 10, y: 10 } })
    await window.keyboard.press('ControlOrMeta+z')
    // The Undo touched the Nodes: the timer, with eight runs' time from here, leaves them for a threshold.
    // A wait on the clock, as only the absence of a change is checked.
    const after = Date.now()
    await expect.poll(() => Date.now() - after, { timeout: 10_000 }).toBeGreaterThan(8 * TICK_MS)
    expect(await archivedIds(window)).toEqual([])
    expect(await placesOf(window)).toEqual(PLACES)
    await expect(nodeOf(window, OLD_A)).toBeVisible()
    await expect(nodeOf(window, OLD_B)).toBeVisible()
    await expect(toast).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
