import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { checkRecovery, type StatusWrite } from '../autopilot-invariants'
import { EPIC, files, ghCalls, journals, kindsOf, messages, prepareWorld, releaseTurn, setStatus } from './autopilot-world'
import { endApp } from './end-app'
import { launchApp } from './helpers'

// Fault scenarios of an Autopilot Run in the built app (worfy-faults ticket 05; the scenarios table of
// .scratch/worfy-faults/spec.md): the app killed with SIGKILL in the middle of a Wave and started
// again on the same data folder, and GitHub out of reach for the whole Run. Each test injects one
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

test('the app killed with SIGKILL in the middle of a Wave and started again: nothing goes to the Orchestrator at the start, Run history shows the old Run cut off, and the button starts a new Run that sends its Wave once', async () => {
  const world = prepareWorld(scratch)
  const env = world.env(SCRIPT)
  const writes: StatusWrite[] = []

  // The Run: Wave 1 (01, 02) goes and its turn holds; the Orchestrator claims 01; the app is killed.
  const first = await launchApp({ env })
  const child = first.app.process()
  let killed = false
  try {
    const frame = frameOf(first.window)
    await frame.getByTestId('action-autopilot').click()
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
  const oldRun = (JSON.parse(killedRun!.split('\n')[0]!) as { run: string }).run

  // Started again on the same data folder and Project: the Run lived in memory and is gone.
  const second = await launchApp({ env })
  let refusal: string | null
  try {
    const { window } = second
    const frame = frameOf(window)
    const autopilot = frame.getByTestId('action-autopilot')
    const status = frame.getByTestId('autopilot-status')
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')
    await expect(autopilot).toHaveText('Autopilot')
    await expect(status).toHaveCount(0)

    // Run history (the palette opens the newest Run of the Project): the killed Run, with no stop.
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('Open Run history')
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('run-history-choose')).toHaveValue(oldRun)
    await expect(window.getByTestId('run-history-epic')).toHaveText(EPIC)
    await expect(window.getByTestId('run-history-reason')).toHaveText('no stop in the Journal')
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('run-history')).toBeHidden()
    // Nothing went to the Orchestrator while the app started and the screen was read.
    expect(messages(world.log)).toEqual([WAVE_1])

    // The button starts a new Run, without a refusal; 01 is in work, so its Wave is 02 alone.
    await autopilot.click()
    await expect(status).toHaveText('Wave 1 · running')
    await expect.poll(() => journals(world.dataDir).map(kindsOf)).toEqual([
      ['run-started', 'forecast', 'wave-started 1', 'ticket-status'],
      ['run-started', 'forecast', 'wave-started 1'],
    ])
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1, `/epic-wave Ticket-ы 02 эпика ${EPIC}`])
    const refused = window.getByTestId('autopilot-start-refused')
    refusal = (await refused.count()) > 0 ? await refused.innerText() : null
  } finally {
    await second.close()
  }

  // The Recovery invariants over both Runs: the killed one ends without run-stopped, the new one
  // with the quit above; one Wave command each; 01's claim is journaled once, by the Run it happened in.
  expect(messages(world.log)).toEqual([WAVE_1, `/epic-wave Ticket-ы 02 эпика ${EPIC}`])
  expect(
    checkRecovery({
      journals: journals(world.dataDir),
      messages: messages(world.log),
      gh: ghCalls(world),
      statusWrites: writes,
      projectBefore: world.projectBefore,
      projectAfter: files(world.repo),
      restart: { refusal },
      expect: { stop: null, waves: 2, tornLastLine: true },
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

    await autopilot.click()
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
