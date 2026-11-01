import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { projectDirName } from '../../src/main/claude-home/registry'
import { formatJournalLine, makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'
import { launchApp, type LaunchedApp } from './helpers'
import { relocatedJsonText } from './relocate-fixture'

// The Run history screen (worfy-flight-recorder ticket 18) in the built app on the fake agent.
//
// The first test shows the night Run of test/fixtures/flight-recorder/night-run/ — its Journal, its
// transcripts as WORFY_CLAUDE_HOME, its gate logs as the Harness home, gh through the fixture's stand-in
// (WORFY_GH) — and two small Runs of the same Project written here: one that stopped on a block, one whose
// Journal ends without run-stopped (cut-off) and whose block reason is too long for its row. The fixture is
// copied with its root `/Users/someone/Stuff/CanvasForAI` replaced by a folder of the test, so the transcripts'
// `cwd` lies in the Project and gh runs in a folder that exists. openRunHistory (src/renderer/flight-recorder/
// open.ts) opens the screen through the page's `__worfyRunHistory`, which an init script defines before the
// app's scripts run: the entries of ticket 20 do not exist yet.
//
// The second test runs Autopilot for real on the fake Orchestrator (`orchestrator`: its first turn holds
// until it is interrupted), opens the live Run, appends a Journal line and sees it on the timeline, with the
// «now» line moving on.

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flight-recorder')
const NIGHT = join(FIXTURES, 'night-run')
const STAND_IN = join(FIXTURES, 'gh-night-run.mjs')
const NIGHT_ROOT = '/Users/someone/Stuff/CanvasForAI'
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
const PROJECT = 'CanvasForAI-38cb72ec'
const BLOCKED_RUN = makeRunId(new Date('2026-10-19T09:00:00.000Z'), 'b10c4e')
const CUT_RUN = makeRunId(new Date('2026-10-20T09:00:00.000Z'), 'c07c07')
const LONG_REASON = 'The owner has to choose between the two designs of the Settings window before the implementer goes on with the rest of it'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-flight-recorder-')))
})
test.afterEach(async () => {
  await removeDir(scratch)
})

/**
 * Copies a folder of the fixture, with the night Run's root replaced in every name and every file: in the
 * files, as JSON spells it (relocatedJsonText), so a Windows root's backslashes keep every line readable.
 */
function copyRelocated(from: string, to: string, root: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const source = join(from, entry)
    const target = join(to, entry.replaceAll(projectDirName(NIGHT_ROOT), projectDirName(root)))
    if (statSync(source).isDirectory()) copyRelocated(source, target, root)
    else writeFileSync(target, relocatedJsonText(readFileSync(source, 'utf8'), NIGHT_ROOT, root))
  }
}

const line = (event: Record<string, unknown>): string => formatJournalLine(event as JournalEvent)

function writeRun(dataDir: string, run: string, epic: string, events: readonly Record<string, unknown>[]): void {
  writeFileSync(join(dataDir, 'autopilot', `${run}.jsonl`), events.map((event) => line({ run, project: PROJECT, epic, ...event })).join(''))
}

/** The night Run's Project in a folder of the test, with two small Runs beside the night one. */
function prepareNight() {
  const root = join(scratch, 'CanvasForAI')
  mkdirSync(root, { recursive: true })
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude')
  const harnessHome = join(scratch, 'harness')
  copyRelocated(join(NIGHT, 'data'), dataDir, root)
  copyRelocated(join(NIGHT, 'claude'), claudeHome, root)
  copyRelocated(join(NIGHT, 'harness'), harnessHome, root)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'CanvasForAI', path: root }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))

  const at = (day: string, hhmm: string) => `2026-10-${day}T${hhmm}:00.000Z`
  writeRun(dataDir, BLOCKED_RUN, 'demo-blocks', [
    { at: at('19', '09:00'), kind: 'run-started', by: 'command' },
    { at: at('19', '09:01'), kind: 'wave-started', wave: 1, tickets: ['01', '02'] },
    { at: at('19', '09:02'), kind: 'ticket-status', ticket: '01', state: 'claimed' },
    { at: at('19', '09:02'), kind: 'ticket-status', ticket: '02', state: 'claimed' },
    { at: at('19', '09:40'), kind: 'ticket-status', ticket: '01', state: 'blocked', reason: 'Needs the owner', waits: 'an answer on the API key' },
    { at: at('19', '10:20'), kind: 'ticket-status', ticket: '02', state: 'done' },
    { at: at('19', '10:21'), kind: 'wave-finished', wave: 1, tickets: ['01', '02'] },
    { at: at('19', '10:22'), kind: 'run-stopped', reason: 'blocked-tickets', tickets: ['01'] },
  ])
  writeRun(dataDir, CUT_RUN, 'demo-cut-off', [
    { at: at('20', '09:00'), kind: 'run-started', by: 'tool' },
    { at: at('20', '09:01'), kind: 'wave-started', wave: 1, tickets: ['01', '02'] },
    { at: at('20', '09:02'), kind: 'ticket-status', ticket: '01', state: 'claimed' },
    { at: at('20', '09:02'), kind: 'ticket-status', ticket: '02', state: 'claimed' },
    { at: at('20', '09:05'), kind: 'background-tasks', tasks: [{ id: 'a1', type: 'local_agent', description: 'Implement ticket 01' }] },
    { at: at('20', '09:30'), kind: 'ticket-status', ticket: '02', state: 'blocked', reason: LONG_REASON, waits: 'the owner' },
    // The Journal ends here: the app quit in the middle of the Run.
    { at: at('20', '09:50'), kind: 'background-tasks', tasks: [{ id: 'a1', type: 'local_agent', description: 'Implement ticket 01' }] },
  ])

  const log = join(scratch, 'gh.jsonl')
  writeFileSync(log, '')
  const env = {
    WORFY_DATA_DIR: dataDir,
    WORFY_CLAUDE_HOME: claudeHome,
    WORFY_HARNESS_HOME: harnessHome,
    WORFY_GH: STAND_IN,
    FR_GH_DIR: join(NIGHT, 'gh'),
    FR_GH_LOG: log,
    FR_GH_FAIL: join(scratch, 'gh-fail'),
    FR_GH_ACCOUNT: 'owner',
    FR_GH_TOKEN: 'token',
    // No token of the developer's shell reaches the stand-in, which logs it.
    GH_TOKEN: '',
  }
  return { env }
}

/** Defines the page's hook before the app's scripts run, loads the window again, and waits for the shell. */
async function withHook(launched: LaunchedApp): Promise<void> {
  await launched.app.context().addInitScript(() => {
    ;(globalThis as unknown as { __worfyRunHistory: object }).__worfyRunHistory = {}
  })
  await launched.window.reload()
  await expect(launched.window.getByTestId('app-shell')).toBeVisible()
  await expect.poll(() => launched.window.evaluate(() => typeof (globalThis as unknown as { __worfyRunHistory?: { open?: unknown } }).__worfyRunHistory?.open)).toBe('function')
}

const openHistory = (window: Page, projectId: string, run?: string) =>
  window.evaluate(([project, id]) => (globalThis as unknown as { __worfyRunHistory: { open: (p: string, r?: string) => Promise<void> } }).__worfyRunHistory.open(project as string, id ?? undefined), [projectId, run ?? null] as const)

interface Shown {
  from: number
  to: number
  fit: boolean
}

async function shown(window: Page): Promise<Shown> {
  const timeline = window.getByTestId('run-history-timeline')
  const [from, to, fit] = await Promise.all([timeline.getAttribute('data-from'), timeline.getAttribute('data-to'), timeline.getAttribute('data-fit')])
  return { from: Number(from), to: Number(to), fit: fit === 'true' }
}

/**
 * Every label drawn on the screen: its rectangle crosses no bar of its row but its own (and, for a block's
 * label, its own Ticket's bar), measured in the window. Answers the number of labels checked.
 */
async function expectLabelsClear(window: Page): Promise<number> {
  const found = await window.evaluate(() => {
    // The page's DOM, typed only as far as this check reads it: the e2e project has no DOM library.
    type Box = { left: number; right: number; top: number; bottom: number }
    type El = { dataset: Record<string, string | undefined>; getBoundingClientRect(): Box; querySelectorAll(selector: string): Iterable<El> }
    const doc = (globalThis as unknown as { document: El }).document
    const crossings: string[] = []
    let labels = 0
    for (const row of doc.querySelectorAll('[data-testid="run-history-row"]')) {
      const bars = [...row.querySelectorAll('[data-testid="run-history-bar"]')]
      for (const label of row.querySelectorAll('[data-testid="run-history-label"]')) {
        labels += 1
        const box = label.getBoundingClientRect()
        const over = (label.dataset.over ?? '').split(' ')
        for (const bar of bars) {
          if (bar.dataset.barKey === label.dataset.labelFor || over.includes(bar.dataset.barKey ?? '')) continue
          const other = bar.getBoundingClientRect()
          if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) crossings.push(`${row.dataset.rowId}: ${label.dataset.labelFor} × ${bar.dataset.barKey}`)
        }
      }
    }
    return { crossings, labels }
  })
  expect(found.crossings).toEqual([])
  return found.labels
}

const EVIDENCE = (name: string) => test.info().outputPath(`18-${name}.png`)

/** The screen in both themes, kept with the test's output for the review. */
async function snapshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.getByTestId('run-history').screenshot({ path: EVIDENCE(`${name}-${scheme}`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('openRunHistory shows a Run over the whole main area: header, zoom, rows, labels clear of bars, another Run; Esc back to the Canvas', async () => {
  test.setTimeout(ms(180_000))
  const { env } = prepareNight()
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    await withHook(launched)
    await openHistory(window, PROJECT, NIGHT_RUN)

    // The view `history`, over the whole main area instead of the Canvas.
    const view = window.locator('.w-shell__view[data-view="history"]')
    await expect(view).toBeVisible()
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeHidden()
    const [area, main] = [await view.boundingBox(), await window.locator('main.w-shell__content').boundingBox()]
    expect(area).toEqual(main)
    await expect(window.getByTestId('run-history-epic')).toHaveText('worfy-pipeline')
    await expect(window.getByTestId('run-history-duration')).toHaveText('4h 48m')
    await expect(window.getByTestId('run-history-reason')).toHaveText('stopped: blocked-tickets')
    await expect(window.getByTestId('run-history-stage-card')).toHaveCount(3)
    // The keyboard is on the screen at once: the focus is on the Run picker.
    await expect(window.getByTestId('run-history-choose')).toBeFocused()
    // No tab of the toolbar is pressed: the view has none.
    await expect(window.locator('.w-toolbar [role="group"][aria-label="View"] [aria-pressed="true"]')).toHaveCount(0)
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await snapshots(window, 'night-run')

    // «Fit» is the whole Run; Ctrl/Cmd + wheel over the axis zooms in around the pointer.
    const whole = await shown(window)
    expect(whole.fit).toBe(true)
    const axis = (await window.getByTestId('run-history-axis').boundingBox())!
    await window.mouse.move(axis.x + axis.width / 2, axis.y + axis.height - 6)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.down(modifier)
    await window.mouse.wheel(0, -200)
    await window.keyboard.up(modifier)
    await expect.poll(async () => (await shown(window)).fit).toBe(false)
    const zoomed = await shown(window)
    expect(zoomed.to - zoomed.from).toBeLessThan(whole.to - whole.from)
    expect(zoomed.from).toBeGreaterThan(whole.from)
    expect(zoomed.to).toBeLessThan(whole.to)
    // Shift + wheel moves the stretch, its length kept.
    await window.keyboard.down('Shift')
    await window.mouse.wheel(0, 200)
    await window.keyboard.up('Shift')
    await expect.poll(async () => (await shown(window)).from).toBeGreaterThan(zoomed.from)
    const moved = await shown(window)
    expect(moved.to - moved.from).toBeCloseTo(zoomed.to - zoomed.from, -2)
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await window.getByRole('button', { name: 'Fit', exact: true }).click()
    expect(await shown(window)).toEqual(whole)

    // A drag along the mini-map: the stretch from a quarter to a half of the Run.
    const map = (await window.getByTestId('run-history-minimap').boundingBox())!
    await window.mouse.move(map.x + map.width * 0.25, map.y + map.height / 2)
    await window.mouse.down()
    await window.mouse.move(map.x + map.width * 0.4, map.y + map.height / 2, { steps: 4 })
    await window.mouse.move(map.x + map.width * 0.5, map.y + map.height / 2, { steps: 4 })
    await window.mouse.up()
    await expect.poll(async () => (await shown(window)).fit).toBe(false)
    const dragged = await shown(window)
    const length = whole.to - whole.from
    expect((dragged.from - whole.from) / length).toBeCloseTo(0.25, 1)
    expect((dragged.to - whole.from) / length).toBeCloseTo(0.5, 1)
    await window.getByRole('button', { name: 'Fit', exact: true }).click()

    // «Expand all» opens every row, «Collapse» closes the Tickets: their Stages go.
    const rows = window.getByTestId('run-history-row')
    const atFirst = await rows.count()
    await window.getByRole('button', { name: 'Expand all', exact: true }).click()
    await expect.poll(() => rows.count()).toBeGreaterThan(atFirst)
    await expect(window.locator('[data-testid="run-history-row"][data-kind="agent"]').first()).toBeVisible()
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await snapshots(window, 'night-run-expanded')
    // The retry #2 of impl-07, zoomed onto.
    const retry = window.locator('[data-testid="run-history-row"][data-kind="agent"]', { has: window.getByTestId('run-history-retry') }).first()
    await expect(retry.getByTestId('run-history-retry')).toHaveText('#2')
    await retry.locator('.w-fr-row__tree').click()
    const bar = (await retry.getByTestId('run-history-bar').first().boundingBox())!
    await window.mouse.move(bar.x + bar.width / 2, axis.y + axis.height - 6)
    for (let turn = 0; turn < 6; turn += 1) {
      await window.keyboard.down(modifier)
      await window.mouse.wheel(0, -200)
      await window.keyboard.up(modifier)
    }
    await expect(retry.getByTestId('run-history-label')).toHaveText(/^#2 /)
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await snapshots(window, 'retry')
    await window.getByRole('button', { name: 'Fit', exact: true }).click()
    // The gate runs whose logs are gone: hatched, with the label of the lost source.
    const lost = window.locator('[data-testid="run-history-row"]', { has: window.locator('.w-fr-bar--lost') }).first()
    await expect(lost).toContainText('gate logs deleted (10 runs or 8 days)')
    await lost.scrollIntoViewIfNeeded()
    await snapshots(window, 'lost-source')
    await window.getByRole('button', { name: 'Collapse', exact: true }).click()
    await expect(window.locator('[data-testid="run-history-row"][data-kind="stage"]')).toHaveCount(0)
    await expect(window.locator('[data-testid="run-history-row"][data-kind="ticket"]').first().locator('.w-fr-bar--thin').first()).toBeVisible()

    // Another Run of the Project: the one that stopped on a block.
    await window.getByTestId('run-history-choose').selectOption(BLOCKED_RUN)
    await expect(window.getByTestId('run-history-epic')).toHaveText('demo-blocks')
    await expect(window.getByTestId('run-history-by')).toHaveText('Started by a command in a chat')
    const blocked = window.locator('[data-testid="run-history-row"][data-row-id$="demo-blocks/01"]')
    await expect(blocked.getByTestId('run-history-block')).toHaveText('!')
    const reason = blocked.locator('[data-testid="run-history-label"][data-label-for="block-0"]')
    await expect(reason).toHaveText('Needs the owner · Waits: an answer on the API key')
    // The whole text shows: the chip is as wide as its text.
    expect(await reason.evaluate((label) => (label as unknown as { scrollWidth: number; clientWidth: number }).scrollWidth <= (label as unknown as { clientWidth: number }).clientWidth)).toBe(true)
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await snapshots(window, 'block')

    // The Run whose Journal ends without run-stopped: its open spans are cut off; the long reason has no room.
    await window.getByTestId('run-history-choose').selectOption(CUT_RUN)
    await expect(window.getByTestId('run-history-epic')).toHaveText('demo-cut-off')
    await expect(window.getByTestId('run-history-reason')).toHaveText('no stop in the Journal')
    await expect(window.locator('.w-fr-bar.is-cut-off').first()).toBeVisible()
    const long = window.locator('[data-testid="run-history-row"][data-row-id$="demo-cut-off/02"]')
    await expect(long.getByTestId('run-history-block')).toHaveAttribute('title', `${LONG_REASON} · Waits: the owner`)
    expect(await expectLabelsClear(window)).toBeGreaterThan(0)
    await snapshots(window, 'cut-off-long-labels')

    // Esc: the Canvas again.
    await window.getByTestId('run-history-timeline').click({ position: { x: 5, y: 5 } })
    await window.keyboard.press('Escape')
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    await expect(view).toBeHidden()
  } finally {
    await launched.close()
  }
})

// ── the live timeline ────────────────────────────────────────────────────────

const DEMO = 'demo-00000018'
const EPIC = 'demo'

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** A Project with the Epic `demo` (Ticket 01 ready) in a git repository, and an epic-status that answers it. */
function prepareLive() {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '01-ticket-1.md'), ['# 01 — Ticket 1', '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Где в коде', '', '- `src/f1.ts`', ''].join('\n'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = { epic: EPIC, num: 1, slug: 'ticket-1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticket] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  mkdirSync(join(dataDir, DEMO), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: DEMO, name: 'demo', path: repo }], activeId: DEMO }))
  writeFileSync(join(dataDir, DEMO, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  return { dataDir, env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: join(scratch, 'agent.jsonl') } }
}

type Bridge = { invoke(channel: string, input: unknown): Promise<{ ok: boolean; error?: string }> }
const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

/** Replaces Electron's powerSaveBlocker in main by one that does nothing, so the Run never keeps the Mac awake. */
async function quietPower(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ powerSaveBlocker }) => {
    powerSaveBlocker.start = () => 1
    powerSaveBlocker.stop = () => true
    powerSaveBlocker.isStarted = () => false
  })
}

test('the live timeline: a line appended to the Journal while the screen is open shows on it, and the now line moves on', async () => {
  test.setTimeout(ms(120_000))
  const { dataDir, env } = prepareLive()
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(app)
    await withHook(launched)
    // Before the first Run the Project has none to show.
    await openHistory(window, DEMO)
    await expect(window.getByTestId('run-history')).toContainText('This Project has no Autopilot Runs yet.')
    await snapshots(window, 'empty')
    expect(await bridgeCall(window, 'autopilot.start', { projectId: DEMO, epic: EPIC })).toMatchObject({ ok: true })
    const journals = join(dataDir, 'autopilot')
    await expect.poll(() => readdirSync(journals).length).toBe(1)
    const file = join(journals, readdirSync(journals)[0]!)
    const run = readdirSync(journals)[0]!.replace(/\.jsonl$/, '')
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('"wave-started"')

    await openHistory(window, DEMO, run)
    await expect(window.getByTestId('run-history-reason')).toHaveText('running')
    const now = window.getByTestId('run-history-now')
    await expect(now).toBeVisible()
    const before = Number(await now.getAttribute('data-at'))
    await expect(window.locator('[data-testid="run-history-row"][data-kind="wait"]')).toHaveCount(0)

    // The Limits refused a Session: a Wait opens on the Wait lane and stretches to now.
    appendFileSync(file, line({ at: new Date().toISOString(), run, project: DEMO, epic: EPIC, kind: 'limits-hit', window: 'five_hour', resetsAt: null }))
    await expect(window.locator('[data-testid="run-history-row"][data-kind="wait"]')).toHaveCount(1, { timeout: ms(30_000) })
    await expect.poll(async () => Number(await now.getAttribute('data-at')), { timeout: ms(30_000) }).toBeGreaterThan(before)
    await expect(window.locator('[data-testid="run-history-row"][data-kind="wait"]')).toContainText('RUNNING')
    // The fake agent writes no transcript: for work still running that is «not found yet», not «deleted».
    await expect(window.getByTestId('run-history')).toContainText('transcript not found yet')
    await snapshots(window, 'live')

    await window.keyboard.press('Escape')
    await expect(window.locator('.w-shell__view[data-view="canvas"]')).toBeVisible()
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: DEMO })).toMatchObject({ ok: true })
  } finally {
    await launched.close()
  }
})
