import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The Archive of the Canvas in the built app (worfy-canvas ticket 09, ADR-0076). The Project is a
// temporary git repository with one Epic of two Tickets; `bin/epic-status` in a temporary
// WORFY_CLAUDE_HOME answers with them. Its Layout holds two Session Nodes the automatic archive
// took: BOUND, which a manual Binding (bindings.json) ties to Ticket 01, and FREE, without a
// Binding, whose old place a Note has taken since. BOUND is in the history of Ticket 01 («1 session»),
// not in the Archive; Show puts it next to the Ticket, right of the strip of frames, and ⌘Z
// archives it again at its old place. FREE is in «Archive 1»; Restore puts it on the nearest clear
// place, off the Note. Snapshots of both popovers are taken in both themes.

const PROJECT_ID = 'archive-0000c009'
const EPIC = 'demo'
const BOUND = 'aaaaaaaa-0909-4909-8909-000000000001'
const FREE = 'bbbbbbbb-0909-4909-8909-000000000002'
const BOUND_NODE = `session:${BOUND}`
const FREE_NODE = `session:${FREE}`
/** Where BOUND stood before the archive took it: far off the strip. */
const BOUND_AT = { x: 1800, y: 1400 }
/** Where FREE stood; the Note stands there now. */
const FREE_AT = { x: 0, y: 1300 }

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const sessionNode = (sessionId: string, name: string, at: { x: number; y: number }, archivedAt: number) => ({
  id: `session:${sessionId}`,
  kind: 'session',
  x: at.x,
  y: at.y,
  w: 300,
  h: 120,
  data: { sessionId, origin: 'external', source: 'terminal', cwd: '/tmp', name },
  archived: { at: archivedAt, rule: 'idle', batch: 'batch-1' },
})

function makeProject(): void {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-archive-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = (num: number) => ({ epic: EPIC, num, slug: `t${num}`, title: `0${num} — Ticket ${num}`, statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticket(1), ticket(2)] }))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch', EPIC), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), `# ${EPIC}\n`)
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const project = join(dataDir, PROJECT_ID)
  mkdirSync(project, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  const now = Date.now()
  const nodes = [
    sessionNode(BOUND, 'Ship ticket one', BOUND_AT, now - 120_000),
    sessionNode(FREE, 'Spike without a ticket', FREE_AT, now - 60_000),
    { id: 'note-1', kind: 'note', x: FREE_AT.x, y: FREE_AT.y, w: 300, h: 120, data: { text: 'took the place' } },
  ]
  writeFileSync(join(project, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 40, y: 40, zoom: 0.5 } }))
  writeFileSync(join(project, 'bindings.json'), JSON.stringify({ bindings: [{ sessionId: BOUND, agentId: null, target: { kind: 'ticket', epic: EPIC, num: 1 } }] }))
}

interface StateNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  archived?: { at: number } | null
}

async function layoutNode(window: Page, id: string): Promise<StateNode | undefined> {
  const result = await window.evaluate(
    (projectId) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId,
      }),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes.find((node) => node.id === id)
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** The machine's own cursor may rest over the window: the test's pointer goes to an empty corner first. */
async function parkPointer(window: Page): Promise<void> {
  const canvas = await box(window.locator('.react-flow'))
  await window.mouse.move(canvas.x + 8, canvas.y + canvas.height - 8)
}

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
  return launched
}

test.afterEach(async () => {
  if (scratch) await removeDir(scratch)
})

test('a bound Session is in its Ticket\'s history, Show puts it next to the Ticket and ⌘Z archives it again; one without a Binding is in the Archive, Restore puts it on a clear place', async () => {
  makeProject()
  const launched = await launch()
  try {
    const { window } = launched
    const ticket = window.locator(`[data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="1"]`)
    await expect(ticket).toBeVisible({ timeout: 20_000 })
    await canvasReady(launched, { size: { width: 1400, height: 900 }, frames: 20, timeout: 20_000 })
    await parkPointer(window)

    // Neither archived Session is on the Canvas.
    await expect(window.locator('[data-testid="session-node"]')).toHaveCount(0)

    // The bound Session: «1 session» on its Ticket, a button with its name.
    const badge = ticket.getByRole('button', { name: '1 session archived of ticket demo/01' })
    await expect(badge).toBeVisible({ timeout: 20_000 })
    await expect(window.locator(`[data-testid="ticket-node"][data-ticket="2"]`).getByTestId('ticket-sessions-button')).toHaveCount(0)
    // The Epic frame's header counts it too.
    await expect(window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`).getByRole('button', { name: '1 session archived of epic demo' })).toBeVisible()
    await badge.click()
    const history = window.getByRole('dialog', { name: 'Archived sessions of demo/01' })
    await expect(history).toBeVisible()
    await expect(history.getByTestId('archive-row')).toHaveText([/Ship ticket one/])
    await snapshotThemes(window, 'ticket-sessions')

    // The Session without a Binding is in the Archive, the bound one is not.
    const archive = window.getByTestId('archive-button')
    await expect(archive).toHaveText('Archive1')
    await window.keyboard.press('Escape')
    await expect(history).toBeHidden()

    // Show: the Node comes back right of the strip of frames, at the Ticket's height.
    await badge.click()
    await history.getByRole('button', { name: 'Show Ship ticket one' }).click()
    await expect(history).toBeHidden()
    await expect.poll(async () => (await layoutNode(window, BOUND_NODE))?.archived ?? null).toBeNull()
    const shown = window.locator(`[data-testid="session-node"][data-node-id="${BOUND_NODE}"]`)
    await expect(shown).toBeVisible()
    await canvasReady(launched, { frames: 20, timeout: 20_000 })
    const frame = await box(window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`))
    const ticketBox = await box(ticket)
    const shownBox = await box(shown)
    expect(shownBox.x).toBeGreaterThan(frame.x + frame.width)
    expect(Math.abs(shownBox.y - ticketBox.y)).toBeLessThan(2)
    // The history is empty now: the badge is gone.
    await expect(ticket.getByTestId('ticket-sessions-button')).toHaveCount(0)

    // ⌘Z: one step takes it back into the archive, at its old place.
    await window.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await layoutNode(window, BOUND_NODE))?.archived ?? null).not.toBeNull()
    expect(await layoutNode(window, BOUND_NODE)).toMatchObject(BOUND_AT)
    await expect(shown).toHaveCount(0)
    await expect(badge).toBeVisible()

    // The Archive: its popover, then Restore.
    await archive.click()
    const popover = window.getByRole('dialog', { name: 'Archive' })
    await expect(popover.getByTestId('archive-row')).toHaveText([/Spike without a ticket/])
    await snapshotThemes(window, 'archive-popover')
    await popover.getByRole('button', { name: 'Restore Spike without a ticket' }).click()
    await expect.poll(async () => (await layoutNode(window, FREE_NODE))?.archived ?? null).toBeNull()
    const free = (await layoutNode(window, FREE_NODE))!
    const note = (await layoutNode(window, 'note-1'))!
    // Off the Note that took its old place: no overlap.
    const apart = free.x >= note.x + note.w || note.x >= free.x + free.w || free.y >= note.y + note.h || note.y >= free.y + free.h
    expect(apart).toBe(true)
    await expect(archive).toBeHidden()
  } finally {
    await launched.close()
  }
  // Show, Restore and the undo are saved in worfy's own data, never in the repository (ADR-0005).
  expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})
