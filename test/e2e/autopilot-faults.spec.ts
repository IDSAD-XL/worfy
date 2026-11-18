import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { checkRecovery, type StatusWrite } from '../autopilot-invariants'
import { EPIC, files, ghCalls, journals, kindsOf, messages, prepareWorld, releaseTurn, setStatus } from './autopilot-world'
import { endApp } from './end-app'
import { launchApp } from './helpers'
import { startAutopilot } from './autopilot-start'
import { snapshotThemes } from './snapshots'

// Fault scenarios of an Autopilot Run in the built app (worfy-faults ticket 05; the scenarios table of
// .scratch/worfy-faults/spec.md): the app killed with SIGKILL in the middle of a Wave and started
// again on the same data folder — the same Run then goes on in its own journal (worfy-continuity ticket 06), by
// itself or, cut off for the third time within the hour, after Resume — and GitHub out of reach for the whole Run. Each test injects one
// fault into a Run on the fake agent (autopilot-fault-held: each Wave's turn holds until the test
// releases it) and ends with checkRecovery, the Recovery invariants I1–I8 (test/autopilot-invariants.ts).
// Every wait is for a sign the app shows or writes (a journal line, the status line), never a pause.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WAVE_1 = `/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`
const SCRIPT = 'autopilot-fault-held'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-faults-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const frameOf = (window: Page): Locator => window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)

/** The lines of the Wave's command in what the Orchestrator got. */
const waveCommands = (log: string): string[] => messages(log).flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/**
 * The Run of Wave 1 (01, 02) whose turn holds, the Orchestrator claiming 01, and the app killed with SIGKILL: the
 * journal as the killed app left it, and the run's id.
 */
async function killedInWave1(world: ReturnType<typeof prepareWorld>, writes: StatusWrite[]): Promise<string> {
  const first = await launchApp({ env: world.env(SCRIPT) })
  const child = first.app.process()
  let killed = false
  try {
    const frame = frameOf(first.window)
    await startAutopilot(frame.getByTestId('action-autopilot'))
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1])
    writes.push(setStatus(world, 1, 'work'))
    await expect.poll(() => journals(world.dataDir).map(kindsOf)).toEqual([['run-started', 'forecast', 'wave-started 1', 'ticket-status']])
    await endApp(child, await first.app.evaluate(() => process.pid))
    killed = true
  } finally {
    // After the kill: no window and no quit, only the launch's own folders to remove.
    await first.close(killed ? { windowGone: true } : {})
  }
  const [killedRun] = journals(world.dataDir)
  return (JSON.parse(killedRun!.split('\n')[0]!) as { run: string }).run
}

/**
 * Stop autopilot while the Wave's turn holds: the Run stops with user-stop after two turns. While it stops, the line
 * counts the Wave's Tickets still in work: 01, which the Orchestrator claimed (02 stayed open). The Stop sends the
 * Orchestrator STOP_TEXT (run.ts, beginStopping), which waits in the Session's queue; when the Wave's turn ends, that
 * message starts the next turn at once, so the Session is not idle and the run stays stopping (cycle.ts, turn-ended:
 * only a turn end with the Session idle and no task stops a stopping run). SCRIPT holds every turn until it is
 * released, the turn of the stop message too: the test releases both. A release made before its turn waits is kept
 * for it (FakeReleases).
 */
async function stopRun(frame: Locator, app: ElectronApplication): Promise<void> {
  const status = frame.getByTestId('autopilot-status')
  await frame.getByTestId('action-stop-autopilot').click()
  await expect(status).toHaveText('stopping · 1 ticket in work')
  await releaseTurn(app)
  await releaseTurn(app)
  await expect(status).toHaveText('stopped: user stop')
}

test('the app killed with SIGKILL in the middle of a Wave and started again: the same Run goes on in its own journal, with run-continued after crash and one new Wave command — 01 continued and 02', async () => {
  const world = prepareWorld(scratch)
  const writes: StatusWrite[] = []
  const run = await killedInWave1(world, writes)

  // Started again on the same data folder and Project: the Run cut off a moment ago goes on by itself (worfy-continuity ticket 06).
  const second = await launchApp({ env: world.env(SCRIPT) })
  try {
    const { window, app } = second
    const frame = frameOf(window)
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 2 · running')
    // One journal, the killed Run's: run-continued after crash and Wave 2, numbered after the cut-off one.
    await expect.poll(() => journals(world.dataDir).map(kindsOf)).toEqual([['run-started', 'forecast', 'wave-started 1', 'ticket-status', 'run-continued', 'wave-started 2']])
    const lines = journals(world.dataDir)[0]!.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { kind: string; run: string; after?: string; tickets?: string[] })
    expect(lines.find((event) => event.kind === 'run-continued')).toMatchObject({ run, after: 'crash' })
    expect(lines.at(-1)).toMatchObject({ kind: 'wave-started', run, tickets: ['01', '02'] })
    // Exactly one new Wave command: 01 continued and 02. The world's Harness is the old one (an epic-status in
    // WORFY_CLAUDE_HOME/bin, autopilot-world.ts), which has no wave-brief: the Wave goes to the Orchestrator's Session as
    // it is, without the line of a new session (run.ts, a new session per Wave only with a Harness that has wave-brief).
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1, WAVE_1])
    await stopRun(frame, app)
  } finally {
    await second.close()
  }

  expect(
    checkRecovery({
      journals: journals(world.dataDir),
      messages: messages(world.log),
      gh: ghCalls(world),
      statusWrites: writes,
      projectBefore: world.projectBefore,
      projectAfter: files(world.repo),
      restart: null,
      expect: { stop: 'user-stop', continued: 'crash', waves: 2, tornLastLine: true },
    }),
  ).toEqual([])
})

test('a Run the restart cut off for the third time within the hour: the line says cut off by restart with Resume and Discard, nothing goes to the Orchestrator, and Resume continues it', async () => {
  const world = prepareWorld(scratch)
  const writes: StatusWrite[] = []
  const run = await killedInWave1(world, writes)
  // Two continuations by itself within the hour already, each cut off again by a quit: the next start leaves the Run to a person.
  const file = join(world.dataDir, 'autopilot', `${run}.jsonl`)
  const head = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!) as { project: string; epic: string }
  const line = (fields: Record<string, unknown>): string => `${JSON.stringify({ at: new Date().toISOString(), run, project: head.project, epic: head.epic, ...fields })}\n`
  const text = readFileSync(file, 'utf8')
  const ended = text.endsWith('\n') ? text : `${text}\n`
  const twice = [0, 1].map((round) => line({ kind: 'run-continued', after: round === 0 ? 'crash' : 'quit' }) + line({ kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01'], wait: null }))
  writeFileSync(file, ended + twice.join(''))

  const second = await launchApp({ env: world.env(SCRIPT) })
  try {
    const { window, app } = second
    const frame = frameOf(window)
    const status = frame.getByTestId('autopilot-status')
    const autopilot = frame.getByTestId('action-autopilot')
    await expect(status).toHaveText(/^cut off by restart · \d\d:\d\d$/u)
    await expect(frame.getByTestId('autopilot-resume')).toHaveText('Resume')
    await expect(frame.getByTestId('autopilot-discard')).toHaveText('Discard')
    await expect(window.getByTestId('autopilot-cut-off')).toBeVisible()
    await expect(autopilot).toHaveAttribute('aria-disabled', 'true')
    // Nothing went to the Orchestrator while the Run waits for a person.
    expect(messages(world.log)).toEqual([WAVE_1])
    await snapshotThemes(window, 'autopilot-cut-off-by-restart')

    await frame.getByTestId('autopilot-resume').click()
    await expect(status).toHaveText('Wave 2 · running')
    await expect.poll(() => waveCommands(world.log)).toEqual([WAVE_1, WAVE_1])
    await expect.poll(() => journals(world.dataDir).map(kindsOf).flat().slice(-2)).toEqual(['run-continued', 'wave-started 2'])
    expect(journals(world.dataDir)).toHaveLength(1)
    await stopRun(frame, app)
  } finally {
    await second.close()
  }

  expect(
    checkRecovery({
      journals: journals(world.dataDir),
      messages: messages(world.log),
      gh: ghCalls(world),
      statusWrites: writes,
      projectBefore: world.projectBefore,
      projectAfter: files(world.repo),
      restart: null,
      expect: { stop: 'user-stop', continued: 'crash', waves: 2, tornLastLine: true },
    }),
  ).toEqual([])
})

test('GitHub out of reach for the whole Run: the Run goes through both Waves, the button and the status line work, and gh was only read', async () => {
  const world = prepareWorld(scratch)
  // Every gh call fails as gh does without a network (gh-stub.mjs, GH_STUB_DIR/fail).
  writeFileSync(join(world.gh, 'fail'), 'error connecting to api.github.com\n')
  const writes: StatusWrite[] = []
  const launched = await launchApp({ env: world.env(SCRIPT) })
  try {
    const { window, app } = launched
    const frame = frameOf(window)
    const autopilot = frame.getByTestId('action-autopilot')
    const status = frame.getByTestId('autopilot-status')
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')

    await startAutopilot(autopilot)
    await expect(status).toHaveText('Wave 1 · running')
    await expect(frame.getByTestId('action-stop-autopilot')).toHaveText('Stop autopilot')
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1])

    // The Orchestrator merges 01 and 02 and ends its turn: Wave 2 is 03.
    writes.push(setStatus(world, 1, 'done'), setStatus(world, 2, 'done'))
    await releaseTurn(app)
    await expect(status).toHaveText('Wave 2 · running')
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1, `/epic-wave Ticket-ы 03 эпика ${EPIC}`])

    // 03 is merged too: every Ticket is done, so the frame leaves the strip for a chip on the done
    // shelf (ADR-0075, point 5) as soon as the screen reads 03's Status — with its status line, which
    // can no longer show the stop. The screen and the Run's stop race for that, and on Windows CI the
    // screen came first; the test lets the screen go first on every machine: the turn ends only after
    // the chip is there.
    writes.push(setStatus(world, 3, 'done'))
    await expect(window.locator(`[data-testid="done-shelf-chip"][data-epic="${EPIC}"]`)).toBeVisible()
    await expect(frame).toHaveCount(0)
    // Nothing is left, and the Run stops by itself: its toast and its Journal say why.
    await releaseTurn(app)
    await expect(window.getByTestId('run-stopped-toast')).toContainText('Run stopped: no-ready-wave · 3 done, 0 blocked')
    await expect.poll(() => journals(world.dataDir).map(kindsOf).flat().at(-1)).toBe('run-stopped no-ready-wave')
    // The frame opened from the shelf: the status line keeps the stop, the button is back with nothing to start.
    await window.getByRole('button', { name: `Expand ${EPIC}, 3 of 3 done` }).click()
    await expect(status).toHaveText('stopped: no ready wave')
    await expect(autopilot).toHaveText('Autopilot')
    await expect(autopilot).toHaveAttribute('aria-disabled', 'true')
  } finally {
    await launched.close()
  }

  // The app did ask GitHub during the Run, and got the failure.
  expect(ghCalls(world).length).toBeGreaterThan(0)
  expect(
    checkRecovery({
      journals: journals(world.dataDir),
      messages: messages(world.log),
      gh: ghCalls(world),
      statusWrites: writes,
      projectBefore: world.projectBefore,
      projectAfter: files(world.repo),
      restart: null,
      expect: { stop: 'no-ready-wave', waves: 2 },
    }),
  ).toEqual([])
})
