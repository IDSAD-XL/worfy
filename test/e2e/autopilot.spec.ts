import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { AUTOPILOT_RUNNING_HINT } from '../../src/main/actions/launch'
import { SELF_PROJECT_MESSAGE } from '../../src/main/autopilot/run'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { autopilotStatusLine } from '../../src/shared/ipc/autopilot'
import { launchApp, repoRoot } from './helpers'

// The hints' phrase (DISPLAY_STAYS_ON in src/renderer/canvas/actions/AutopilotAction.tsx), written
// out: the renderer module is not loaded into the Playwright process.
const DISPLAY_STAYS_ON = 'The display stays on until the run ends'

// Autopilot on an Epic frame (worfy-daily tickets 04, 05 and 32, ADR-0024, ADR-0034: the run's
// keep-awake is one 'prevent-display-sleep' blocker, and the hints say so) in the built app on the fake
// agent, which records every message it gets (WORFY_AGENT_LOG) and never calls the model. The first
// test plays `orchestrator`: its first turn holds until it is interrupted, so the run stays in Wave 1
// until the test stops it. The second plays `autopilot-limits`, whose Wave turn the Limits refuse,
// so the run waits for their reset. Electron's powerSaveBlocker is replaced in main before the run
// starts, so the test never keeps the Mac awake; the replacement records what the run asked for.
//
// The Project is a git repository in a temporary folder with the Epic `demo`: 01 and 02 ready, 03
// after both. A second Project points at this worktree, worfy's own repository: on this
// development build Autopilot refuses it.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** Every file under `dir` with its bytes (base64), by path; for "nothing was written there". */
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path.slice(dir.length + 1)] = readFileSync(path).toString('base64')
  }
  return out
}

const PROJECT = 'demo-000000a4'
const SELF = 'worfy-5e1f0000'
const EPIC = 'demo'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS = [
  { num: 1, blocked: [] as number[] },
  { num: 2, blocked: [] as number[] },
  { num: 3, blocked: [1, 2] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function ticketFile({ num, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

/** The messages the fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/** The kinds of the lines of the only run journal in the data folder. */
function journalKinds(dataDir: string): string[] {
  const dir = join(dataDir, 'autopilot')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
  if (files.length !== 1) return [`${files.length} journals`]
  return readFileSync(join(dir, files[0]!), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const event = JSON.parse(line) as { kind: string; reason?: string; wave?: number }
      return [event.kind, event.wave ?? event.reason].filter((part) => part !== undefined).join(' ')
    })
}

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

/** The Epic frame's header in both themes, kept with the test's output for the F-SPEC review. */
async function snapshots(window: Page, header: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await header.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

type Box = { x: number; y: number; width: number; height: number }

const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * The status line lies inside the Epic's header and over nothing: not over the header's buttons or
 * the Epic's title, and not over the Orchestrator Node, which this layout places over the frame.
 */
async function expectStatusClear(window: Page, header: Locator, status: Locator): Promise<void> {
  const line = (await status.boundingBox())!
  const room = (await header.boundingBox())!
  expect(line.y, 'the status line starts inside the header').toBeGreaterThanOrEqual(room.y)
  expect(line.y + line.height, 'the status line ends inside the header').toBeLessThanOrEqual(room.y + room.height)
  const others: [string, Locator][] = [
    ['the Orchestrator Node', window.getByTestId('orchestrator-node')],
    ['the Epic title', header.locator('h2')],
    ...(await header.locator('button').all()).map((button, i): [string, Locator] => [`header button ${i}`, button]),
  ]
  for (const [name, locator] of others) {
    const box = await locator.boundingBox()
    if (box !== null) expect(intersects(line, box), `the status line is clear of ${name}`).toBe(false)
  }
}

/**
 * The Project in a temporary folder: a git repository with the Epic, an epic-status that answers its
 * Tickets, and worfy's data folder with the Project (and worfy's own repository as a second one).
 */
function prepare() {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'demo')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-ticket-${ticket.num}.md`), ticketFile(ticket))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, blocked }) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        { id: PROJECT, name: 'demo', path: repo },
        { id: SELF, name: 'worfy', path: repoRoot },
      ],
      activeId: PROJECT,
    }),
  )
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))

  return { dataDir, claudeHome, log, repo, statusBefore: git(repo, 'status', '--porcelain'), claudeHomeBefore: files(claudeHome) }
}

/** Replaces Electron's powerSaveBlocker in main by one that records the calls, so the test never keeps the Mac awake; answers the reader of the record. */
async function recordPower(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ powerSaveBlocker }) => {
    const calls: string[] = []
    const started = new Set<number>()
    let next = 100
    ;(globalThis as unknown as { power: string[] }).power = calls
    powerSaveBlocker.start = (type) => {
      next += 1
      started.add(next)
      calls.push(`start ${type}`)
      return next
    }
    powerSaveBlocker.stop = (id) => {
      started.delete(id)
      calls.push('stop')
      return true
    }
    powerSaveBlocker.isStarted = (id) => started.has(id)
  })
  return () => app.evaluate(() => [...(globalThis as unknown as { power: string[] }).power])
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-autopilot-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Autopilot on an Epic: starts Wave 1, shows its state, refuses Run wave meanwhile, and stops on Stop', async () => {
  const { dataDir, claudeHome, log, repo, statusBefore, claudeHomeBefore } = prepare()
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    const power = await recordPower(app)

    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const header = frame.locator('header')
    const autopilot = frame.getByTestId('action-autopilot')
    const stop = frame.getByTestId('action-stop-autopilot')
    const status = frame.getByTestId('autopilot-status')
    const runWave = frame.getByTestId('action-run-wave')
    await expect(autopilot).toBeVisible()
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // Before a run: active, no status line.
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')
    await expect(autopilot).toHaveText('Autopilot')
    await expect(autopilot).toHaveAttribute('title', `Run the Waves of ${EPIC} one after another, without a person. ${DISPLAY_STAYS_ON}`)
    await expect(status).toHaveCount(0)
    await snapshots(window, header, 'autopilot-idle')

    // On worfy's own repository this development build refuses, with the reason.
    const self = await bridgeCall(window, 'autopilot.start', { projectId: SELF, epic: 'worfy-daily' })
    expect(self).toEqual({ ok: false, error: `autopilot.start failed: ${SELF_PROJECT_MESSAGE}` })

    // Start: Wave 1 goes to the Orchestrator, now unattended.
    await autopilot.click()
    await expect(status).toHaveText('Wave 1 · running')
    await expect(status).toHaveAttribute('title', `Wave 1 · running. ${DISPLAY_STAYS_ON}`)
    await expectStatusClear(window, header, status)
    await expect(stop).toHaveText('Stop autopilot')
    await expect(autopilot).toHaveCount(0)
    await expect.poll(() => messages(log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(await power()).toEqual(['start prevent-display-sleep'])
    await snapshots(window, header, 'autopilot-running')

    // A second start, and "Run wave" by hand, are refused while the run goes on.
    const twice = await bridgeCall(window, 'autopilot.start', { projectId: PROJECT, epic: EPIC })
    expect(twice).toMatchObject({ ok: false, error: expect.stringContaining('Autopilot is already running') as unknown as string })
    await runWave.click()
    await expect(runWave).toHaveAttribute('data-error', AUTOPILOT_RUNNING_HINT)
    expect(messages(log)).toHaveLength(1)

    // Stop: the run ends with user-stop. It interrupts the Wave's turn and gives the Orchestrator
    // back before it answers (worfy-week ticket 17): keep-awake is released with it.
    await expect(stop).toHaveAttribute('title', `Stop Autopilot over ${EPIC}: interrupts the Orchestrator and its background tasks; worktrees stay`)
    await stop.click()
    await expect(status).toHaveText('stopped: user stop')
    await expect(status).toHaveAttribute('title', 'stopped: user stop')
    await expect(autopilot).toHaveText('Autopilot')
    expect(journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'run-stopped user-stop', 'orchestrator-returned'])
    expect(await power()).toEqual(['start prevent-display-sleep', 'stop'])
    await expectStatusClear(window, header, status)
    await snapshots(window, header, 'autopilot-stopped')
    // The interrupted turn left nothing to send: the Orchestrator got only the Wave.
    expect(messages(log)).toHaveLength(1)

    // worfy wrote nothing into the repository, and nothing into the Claude home the run read.
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(files(claudeHome)).toEqual(claudeHomeBefore)
  } finally {
    await launched.close()
  }
})

test('Autopilot waits for the Limits after a refusal: the status line says until when, and Stop cancels the wait', async () => {
  const { dataDir, claudeHome, log, repo, statusBefore, claudeHomeBefore } = prepare()
  // The fake agent's script refuses the Wave's turn by the Limits, with a reset two hours from now
  // (the fixture's reset time is a fixed one in the past).
  const reset = Math.floor(Date.now() / 1000) + 2 * 3600
  const scripts = join(scratch, 'scripts')
  mkdirSync(scripts, { recursive: true })
  const fixture = readFileSync(join(repoRoot, 'test', 'fixtures', 'agent-scripts', 'autopilot-limits.jsonl'), 'utf8')
  const lines = fixture.split('\n').filter(Boolean).map((line) => {
    const value = JSON.parse(line) as { type?: string; rate_limit_info?: { status?: string; resetsAt?: number } }
    if (value.type === 'rate_limit_event' && value.rate_limit_info?.status === 'rejected') value.rate_limit_info.resetsAt = reset
    return JSON.stringify(value)
  })
  writeFileSync(join(scripts, 'autopilot-limits.jsonl'), `${lines.join('\n')}\n`)

  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'autopilot-limits', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    const power = await recordPower(app)

    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const header = frame.locator('header')
    const status = frame.getByTestId('autopilot-status')
    const stop = frame.getByTestId('action-stop-autopilot')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    await frame.getByTestId('action-autopilot').click()
    const resumesAt = reset * 1000 + RESUME_MARGIN_MS
    const line = autopilotStatusLine({ status: 'waiting', wave: 1, reason: null, resumesAt })
    expect(line).toMatch(/^waiting for limits · resumes \d{2}:\d{2}$/)
    await expect(status).toHaveText(line!)
    await expect(status).toHaveAttribute('title', `${line!}. ${DISPLAY_STAYS_ON}`)
    await expect(status).toHaveAttribute('data-status', 'waiting')
    // The line is shown whole: the time is not cut off.
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    // ...and covers nothing: it stays in the header, clear of its buttons and of the Orchestrator Node.
    await expectStatusClear(window, header, status)
    // Still a run: Stop is offered, keep-awake is held, and the Orchestrator got only the Wave.
    await expect(stop).toHaveText('Stop autopilot')
    expect(await power()).toEqual(['start prevent-display-sleep'])
    expect(messages(log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'limits-hit', 'waiting-until'])
    await snapshots(window, header, 'autopilot-waiting')

    // Stop during the wait: no continuation goes out.
    await stop.click()
    await expect(status).toHaveText('stopped: user stop')
    expect(await power()).toEqual(['start prevent-display-sleep', 'stop'])
    await expect.poll(() => journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'limits-hit', 'waiting-until', 'run-stopped user-stop', 'orchestrator-returned'])
    expect(messages(log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    // worfy wrote nothing into the repository, and nothing into the Claude home the run read.
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(files(claudeHome)).toEqual(claudeHomeBefore)
  } finally {
    await launched.close()
  }
})

/** What the fake agent was asked besides messages: here, a close() while background tasks lived. */
function closes(log: string): unknown[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string })
    .filter((call) => call.kind === 'close')
}

test('Autopilot waits for the background tasks of the Wave; Stop kills them with the Orchestrator\'s process and gives the Orchestrator back at once', async () => {
  // The fake agent plays autopilot-background: the Wave's turn starts two background tasks and ends
  // while the Tickets are open, as /epic-wave does (worfy-daily ticket 29, ADR-0029). The test lets
  // each task end with globalThis.worfyFakeRelease in main (src/main/agent/fake-query.ts).
  const { dataDir, claudeHome, log, repo, statusBefore, claudeHomeBefore } = prepare()
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'autopilot-background', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    const power = await recordPower(app)

    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const header = frame.locator('header')
    const status = frame.getByTestId('autopilot-status')
    const stop = frame.getByTestId('action-stop-autopilot')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // The Wave's turn ends with two tasks alive: the run waits, and says so.
    await frame.getByTestId('action-autopilot').click()
    await expect(status).toHaveText('Wave 1 · 2 background tasks')
    await expect(status).toHaveAttribute('data-status', 'running')
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expectStatusClear(window, header, status)
    await expect.poll(() => journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'background-tasks', 'background-tasks'])
    await snapshots(window, header, 'autopilot-background-tasks')

    // Stop with live tasks (worfy-week ticket 17): no release of the tasks is needed. Closing the
    // unattended Session's process kills both, and the Orchestrator is a person's Session again.
    await stop.click()
    await expect(status).toHaveText('stopped: user stop')
    await expect.poll(() => journalKinds(dataDir)).toEqual([
      'run-started',
      'wave-started 1',
      'background-tasks',
      'background-tasks',
      'run-stopped user-stop',
      'tasks-killed user-stop',
      'orchestrator-returned',
    ])
    expect(await power()).toEqual(['start prevent-display-sleep', 'stop'])
    expect(closes(log)).toMatchObject([{ kind: 'close', backgroundTasks: ['task_impl_0001', 'task_impl_0002'] }])
    expect(messages(log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    await snapshots(window, header, 'autopilot-stopped-tasks')

    // Nothing waits to be given back: a new run is taken at once.
    const again = await bridgeCall(window, 'autopilot.start', { projectId: PROJECT, epic: EPIC })
    expect(again).toMatchObject({ ok: true, value: { status: 'running' } })
    await expect(status).toHaveText(/^Wave 1/)

    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(files(claudeHome)).toEqual(claudeHomeBefore)
  } finally {
    await launched.close()
  }
})

test('Stop during the Wave\'s turn: the button says Stopping… until the turn is interrupted, then the tasks it started are killed', async () => {
  // The Wave's turn holds right after it started both tasks (wait_release "turn"), and the fake
  // agent's wait does not end on interrupt(): Stop waits HALT_TURN_MS for the turn, then closes the
  // process (worfy-week ticket 17).
  const { dataDir, log } = prepare()
  const scripts = join(scratch, 'scripts')
  mkdirSync(scripts, { recursive: true })
  const fixture = readFileSync(join(repoRoot, 'test', 'fixtures', 'agent-scripts', 'autopilot-background.jsonl'), 'utf8').split('\n').filter(Boolean)
  writeFileSync(join(scripts, 'autopilot-stop-in-turn.jsonl'), `${[...fixture.slice(0, 6), '{"fake":"wait_release","name":"turn"}', ...fixture.slice(6)].join('\n')}\n`)
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: join(scratch, 'claude-home'), WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'autopilot-stop-in-turn', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    const power = await recordPower(app)
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const header = frame.locator('header')
    const status = frame.getByTestId('autopilot-status')
    const stop = frame.getByTestId('action-stop-autopilot')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    await frame.getByTestId('action-autopilot').click()
    await expect.poll(() => journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'background-tasks', 'background-tasks'])
    await expect(status).toHaveText('Wave 1 · 2 background tasks')
    await snapshots(window, header, 'stop-before')

    await stop.click()
    await expect(stop).toHaveText('Stopping…')
    await expect(stop).toHaveAttribute('aria-disabled', 'true')
    await snapshots(window, header, 'stop-stopping')
    // A second click while it stops changes nothing. Dispatched at once: Playwright's click would wait
    // for the inactive button to turn active, and click "Autopilot" once Stop is over.
    await stop.dispatchEvent('click')
    await expect(stop).toHaveText('Stopping…')
    await expect(status).toHaveText('stopped: user stop', { timeout: 30_000 })
    await expect(frame.getByTestId('action-autopilot')).toHaveText('Autopilot')
    await expect.poll(() => journalKinds(dataDir)).toEqual([
      'run-started',
      'wave-started 1',
      'background-tasks',
      'background-tasks',
      'run-stopped user-stop',
      'tasks-killed user-stop',
      'orchestrator-returned',
    ])
    expect(closes(log)).toMatchObject([{ kind: 'close', backgroundTasks: ['task_impl_0001', 'task_impl_0002'] }])
    expect(await power()).toEqual(['start prevent-display-sleep', 'stop'])
    expect(messages(log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    await snapshots(window, header, 'stop-stopped')
  } finally {
    await launched.close()
  }
})
