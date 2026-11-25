import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, closeSettings, launchApp, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// The automatic archive's Setting and command in the built app (worfy-canvas ticket 08, ADR-0076).
// The Project holds five external Session Nodes: OLD_A and OLD_B, finished, last record 30 h ago;
// KEPT, as old, with Keep; FRESH, finished an hour ago; LIVE, as old, whose Claude Code still runs
// (a `sleep` process the registry sees). The timer runs every 250 ms (WORFY_ARCHIVE_TICK_MS) and the
// Setting is «Never», which the person chose (app-settings.json; the default is 24 h since
// worfy-canvas ticket 10): through Settings → Canvas and many runs, nothing is archived.
// Keep on FRESH is a step of ⌘Z. «Archive finished sessions now» takes OLD_A and OLD_B — 24 h under
// «Never» — and leaves KEPT, FRESH and LIVE; one ⌘Z brings both back. Last, LIVE's process ends and
// the person picks 24 h: the next run of the timer takes LIVE alone (the others were touched or kept).
// PRODUCT, a finished Product Session as old, is never taken — not by the command, not by the timer
// (worfy-product-session ticket 37). Its own Archive takes it off the Canvas, and Restore in the
// Archive brings it back; LIVE's Archive is inactive while its Claude Code runs.

const PROJECT_ID = 'archive-0000c008'
const TICK_MS = 250
const OLD_A = 'aaaaaaaa-0808-4808-8808-000000000001'
const OLD_B = 'bbbbbbbb-0808-4808-8808-000000000002'
const KEPT = 'cccccccc-0808-4808-8808-000000000003'
const FRESH = 'dddddddd-0808-4808-8808-000000000004'
const LIVE = 'eeeeeeee-0808-4808-8808-000000000005'
const PRODUCT = 'ffffffff-0808-4808-8808-000000000006'
/** Another Product Session, at the narrowest a live Node may be (240 px): the line under its header is the fullest. */
const NARROW = 'ffffffff-0808-4808-8808-000000000007'
const HOUR = 3_600_000

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string
let claude: ChildProcess | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'

/** A transcript in the Claude home whose only record, the person's `text`, is `ago` ms old. */
function transcript(sessionId: string, ago: number, text = 'hello'): void {
  const dir = join(claudeHome, 'projects', repo.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const record = { type: 'user', uuid: `${sessionId}-1`, sessionId, isSidechain: false, cwd: repo, timestamp: new Date(Date.now() - ago).toISOString(), message: { role: 'user', content: text } }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`)
}

const sessionNode = (sessionId: string, x: number, fields: Record<string, unknown> = {}) => ({
  id: `session:${sessionId}`,
  kind: 'session',
  x,
  y: 0,
  w: 300,
  h: 120,
  data: { sessionId, origin: 'external', source: 'terminal', cwd: repo },
  ...fields,
})

function makeProject(): void {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-archive-now-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  repo = join(scratch, 'demo')
  mkdirSync(repo, { recursive: true })
  transcript(OLD_A, 30 * HOUR)
  transcript(OLD_B, 30 * HOUR)
  transcript(KEPT, 30 * HOUR)
  transcript(FRESH, HOUR)
  transcript(LIVE, 30 * HOUR)
  transcript(PRODUCT, 30 * HOUR, 'Plan the roadmap')
  transcript(NARROW, 30 * HOUR, 'Narrow plan')
  // LIVE's Claude Code: a process the registry sees alive, with the record Claude Code writes for it.
  claude = spawn('sleep', ['600'], { stdio: 'ignore' })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId: LIVE, cwd: repo, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289' }),
  )
  const project = join(dataDir, PROJECT_ID)
  mkdirSync(project, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  // «Never», chosen by the person: the choice outlives the 24 h default (APP_SETTINGS_FILE of src/main/settings/store.ts).
  writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify({ sessionArchive: { after: 'never' } }))
  // A Product Session's Node as main writes it (src/main/agent/node-sessions.ts); nothing runs it in this test.
  const product = { ...sessionNode(PRODUCT, 0), y: 300, w: 340, h: 220, data: { origin: 'worfy', vendor: 'claude', kind: 'product', sessionId: PRODUCT } }
  const narrow = { ...product, id: `session:${NARROW}`, x: 800, w: 240, data: { ...product.data, sessionId: NARROW } }
  const nodes = [sessionNode(OLD_A, 0), sessionNode(OLD_B, 400), sessionNode(KEPT, 800, { keep: true }), sessionNode(FRESH, 1200), sessionNode(LIVE, 1600), product, narrow]
  writeFileSync(join(project, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 40, y: 40, zoom: 0.6 } }))
}

interface StateNode {
  id: string
  keep?: boolean
  archived?: { batch: string } | null
}

/** The Project's Session Nodes as main has them: which are archived, and which kept. */
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
const keepOf = async (window: Page, sessionId: string): Promise<boolean> => (await layoutNodes(window)).find((node) => node.id === `session:${sessionId}`)?.keep === true

const nodeOf = (window: Page, sessionId: string): Locator => window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)

/** Ends LIVE's process and waits for it to exit. */
async function endClaude(): Promise<void> {
  const child = claude
  claude = undefined
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

/** Opens Settings → Canvas the way a person does: "Settings…" of the app menu, then the row of the section list. */
async function openCanvasSettings(launched: Pick<LaunchedApp, 'app' | 'window'>): Promise<Locator> {
  await clickMenuItem(launched.app, SETTINGS_MENU_ITEM_ID)
  const dialog = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Canvas', exact: true }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Canvas')
  return dialog
}

test.afterEach(async () => {
  await endClaude()
  if (scratch) await removeDir(scratch)
})

test('«Never» archives nothing on a fast timer; Settings → Canvas offers the thresholds; the command archives the finished Sessions but the kept one, and ⌘Z brings them back in one step', async () => {
  makeProject()
  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_ARCHIVE_TICK_MS: String(TICK_MS) } })
  try {
    const { window } = launched
    const started = Date.now()
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
    await canvasReady(launched, { size: { width: 1400, height: 900 }, timeout: ms(20_000) })
    for (const id of [OLD_A, OLD_B, KEPT, FRESH, LIVE, PRODUCT, NARROW]) await expect(nodeOf(window, id)).toBeVisible({ timeout: ms(20_000) })
    // Every Node shows Archive whole, within its line: on the line under the header the source gives way, then
    // the «Product Session» label, down to the narrowest live Node (NARROW, 240 px, with the label and the badge).
    for (const id of [OLD_A, OLD_B, KEPT, FRESH, LIVE, PRODUCT, NARROW]) {
      const node = nodeOf(window, id)
      await expect(node.getByTestId('session-node-archive')).toBeVisible()
      const [line, archive] = [await node.getByTestId('session-node-source').locator('..').boundingBox(), await node.getByTestId('session-node-archive').boundingBox()]
      expect(archive!.x + archive!.width, `${id}: Archive ends within its line`).toBeLessThanOrEqual(line!.x + line!.width + 0.5)
    }
    // At the default 340 px the source gives way first: the «Product Session» label is whole, not cut.
    expect(await nodeOf(window, PRODUCT).getByTestId('session-node-kind').evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true)
    // The title keeps its share of the header, which this PR leaves as on main: about 0.14 of a 300 px read-only
    // Node (chip, Keep, Hide, Remove) and 0.09 of a 340 px finished worfy Node (Resume as well), measured on a
    // Mac. Archive in the header once left a 300 px Codex Node's title none on Windows. At 240 px main's header
    // already leaves a finished worfy Node's title nothing, so NARROW is not checked here.
    const titleShare = async (id: string): Promise<number> =>
      ((await nodeOf(window, id).getByTestId('session-node-title').boundingBox())?.width ?? 0) / ((await nodeOf(window, id).boundingBox())?.width ?? 1)
    for (const id of [OLD_A, OLD_B, KEPT, FRESH, LIVE]) expect(await titleShare(id), `the share of ${id}'s width its title keeps`).toBeGreaterThan(0.08)
    expect(await titleShare(PRODUCT), 'the share of the Product Session\'s width its title keeps').toBeGreaterThan(0.05)
    await snapshotThemes(window, '37-session-nodes-archive')
    await expect(nodeOf(window, KEPT).getByTestId('session-node-keep')).toHaveAttribute('aria-pressed', 'true')
    await expect(nodeOf(window, FRESH).getByTestId('session-node-keep')).toHaveAttribute('aria-pressed', 'false')
    // Archive on a Node: inactive while its Session runs, saying why.
    await expect(nodeOf(window, LIVE).getByTestId('session-node-archive')).toBeDisabled()
    await expect(nodeOf(window, LIVE).getByTestId('session-node-archive')).toHaveAttribute('title', /still runs/)

    // Settings → Canvas: «Never» as chosen, the switch's default, the five thresholds, a snapshot in both themes. The timer runs meanwhile.
    let dialog = await openCanvasSettings(launched)
    const threshold = dialog.getByRole('combobox', { name: 'Archive finished sessions after' })
    await expect(threshold).toContainText('Never')
    await expect(dialog.getByTestId('settings-archive-after-row')).toContainText('A Product Session never leaves by itself')
    await expect(dialog.getByRole('switch', { name: '…and when their Ticket is done' })).toHaveAttribute('aria-checked', 'true')
    await threshold.click()
    await expect(window.getByRole('listbox', { name: 'Archive finished sessions after' }).getByRole('option')).toHaveText(['Never', '6 h', '24 h', '3 days', '7 days'])
    await window.keyboard.press('Escape')
    await expect(window.getByRole('listbox', { name: 'Archive finished sessions after' })).toHaveCount(0)
    await snapshotThemes(window, '08-settings-canvas')
    await closeSettings(window)

    // «Never»: the timer has had time for eight runs since the start, and archived nothing. A wait
    // on the clock, as only the absence of a change is checked; the last step shows the timer runs.
    await expect.poll(() => Date.now() - started, { timeout: ms(10_000) }).toBeGreaterThan(8 * TICK_MS)
    expect(await archivedIds(window)).toEqual([])

    // Keep is a step of ⌘Z.
    await nodeOf(window, FRESH).getByTestId('session-node-keep').click()
    await expect(nodeOf(window, FRESH).getByTestId('session-node-keep')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => keepOf(window, FRESH)).toBe(true)
    await window.getByTestId('canvas').click({ position: { x: 10, y: 10 } })
    await window.keyboard.press('ControlOrMeta+z')
    await expect(nodeOf(window, FRESH).getByTestId('session-node-keep')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => keepOf(window, FRESH)).toBe(false)

    // The command: 24 h under «Never»; KEPT has Keep, FRESH is too fresh.
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('archive finished')
    const command = palette.locator('[data-testid="palette-option"][data-command="archive-finished"]')
    await expect(command).toHaveText(/Archive finished sessions now/)
    await command.click()
    await expect(palette).toHaveCount(0)
    await expect.poll(() => archivedIds(window)).toEqual([`session:${OLD_A}`, `session:${OLD_B}`])
    const batches = new Set((await layoutNodes(window)).flatMap((node) => (node.archived == null ? [] : [node.archived.batch])))
    expect(batches.size, 'one batch').toBe(1)
    await expect(nodeOf(window, OLD_A)).toHaveCount(0)
    await expect(nodeOf(window, OLD_B)).toHaveCount(0)
    await expect(nodeOf(window, KEPT)).toBeVisible()
    await expect(nodeOf(window, FRESH)).toBeVisible()

    // One ⌘Z brings both back.
    await window.getByTestId('canvas').click({ position: { x: 10, y: 10 } })
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => archivedIds(window)).toEqual([])
    await expect(nodeOf(window, OLD_A)).toBeVisible()
    await expect(nodeOf(window, OLD_B)).toBeVisible()

    // LIVE's Claude Code ends, and the person picks 24 h: the timer, which main reads the Setting
    // for at every run, takes LIVE. OLD_A and OLD_B came back by the user's ⌘Z — touched, so left.
    await endClaude()
    dialog = await openCanvasSettings(launched)
    await dialog.getByRole('combobox', { name: 'Archive finished sessions after' }).click()
    await window.getByRole('listbox', { name: 'Archive finished sessions after' }).getByRole('option', { name: '24 h' }).click()
    await expect(dialog.getByRole('combobox', { name: 'Archive finished sessions after' })).toContainText('24 h')
    await closeSettings(window)
    await expect.poll(() => archivedIds(window), { timeout: ms(15_000) }).toEqual([`session:${LIVE}`])
    await expect(nodeOf(window, LIVE)).toHaveCount(0)
    await expect(nodeOf(window, PRODUCT)).toBeVisible()

    // PRODUCT's own Archive: off the Canvas, into the Archive; Restore brings it back, and the timer leaves it.
    const archiveAction = nodeOf(window, PRODUCT).getByTestId('session-node-archive')
    await expect(archiveAction).toBeEnabled()
    await archiveAction.click()
    await expect.poll(() => archivedIds(window)).toEqual([`session:${LIVE}`, `session:${PRODUCT}`])
    await expect(nodeOf(window, PRODUCT)).toHaveCount(0)
    await window.getByTestId('archive-button').click()
    const popover = window.getByRole('dialog', { name: 'Archive' })
    await expect(popover.getByTestId('archive-row')).toHaveCount(2)
    await popover.getByTestId('archive-row').filter({ hasText: 'Plan the roadmap' }).getByRole('button', { name: /^Restore / }).click()
    await expect.poll(() => archivedIds(window)).toEqual([`session:${LIVE}`])
    await expect(nodeOf(window, PRODUCT)).toBeVisible()
    const restored = Date.now()
    await expect.poll(() => Date.now() - restored, { timeout: ms(10_000) }).toBeGreaterThan(4 * TICK_MS)
    expect(await archivedIds(window)).toEqual([`session:${LIVE}`])
  } finally {
    await launched.close()
  }
})
