import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { EPIC, messages, PROJECT, prepareWorld } from './autopilot-world'
import { startWindow } from './autopilot-start'
import { captureScreenshot } from './evidence-capture'
import { launchApp } from './helpers'

// The Autopilot line of a run that waits for its Orchestrator, in the built app (worfy-autopilot-queue
// ticket 10), on the fake agent (`orchestrator`: a turn holds until it is interrupted) in a Project of a
// temporary folder with the Epic `demo` (01 and 02 ready, 03 after both). A person's message keeps the
// Orchestrator in a turn; "Start when free" in the Start Autopilot window leaves the run waiting, and the
// line says "waiting for the Orchestrator · 4 min" with "Start now" and "Cancel" beside it. The minutes
// count on the window's clock, which the test sets four minutes ahead (Date.now of the page): the wait
// itself is real and short. "Start now" opens the "Start now?" window with what it stops; "Interrupt and
// start" interrupts the turn and Wave 1 goes. "Cancel" in the line stops the run `start-cancelled`, and
// the person's turn goes on. The line and the window are shot in both themes as the Ticket's Evidence
// (captureScreenshot: with WORFY_EVIDENCE=worfy-autopilot-queue/10 into .scratch/worfy-autopilot-queue/evidence/,
// else into the test's output). The rows of the window for each `busy` and its keys are the unit
// test's (test/unit/start-now-modal.test.tsx). Electron's powerSaveBlocker is replaced in main before a
// run starts, so the test never keeps the Mac awake.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-autopilot-wait-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const frameOf = (window: Page): Locator => window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)

/** keep-awake of a run goes to a stand-in: the test asks nothing of the Mac's power. */
const quietPower = (launched: Awaited<ReturnType<typeof launchApp>>): Promise<void> =>
  launched.app.evaluate(({ powerSaveBlocker }) => {
    let next = 100
    powerSaveBlocker.start = () => (next += 1)
    powerSaveBlocker.stop = () => true
    powerSaveBlocker.isStarted = () => false
  })

const journalsOf = (dataDir: string): string[] => (existsSync(join(dataDir, 'autopilot')) ? readdirSync(join(dataDir, 'autopilot')) : [])

/** How far ahead the page's clock goes: the line counts the wait in whole minutes. */
const AHEAD_MS = 4 * 60_000 + 10_000

/**
 * A person's message keeps the Orchestrator in a turn; the Autopilot button and "Start when free" leave the
 * run waiting for it. Resolves with the Epic frame once the line says how long the run has waited.
 */
async function waitingRun(launched: Awaited<ReturnType<typeof launchApp>>, log: string): Promise<Locator> {
  const { window, app } = launched
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
  await quietPower(launched)
  const frame = frameOf(window)
  const autopilot = frame.getByTestId('action-autopilot')
  await expect(window.getByTestId('orchestrator-node')).toBeVisible()
  await expect(autopilot).toHaveAttribute('aria-disabled', 'false')

  const view = (await bridgeCall(window, 'orchestrator.open', { projectId: PROJECT })) as { ok: boolean; value?: { sessionId: string | null } }
  const sessionId = view.value?.sessionId ?? null
  expect(sessionId).not.toBeNull()
  expect(await bridgeCall(window, 'agent.send', { sessionId, text: 'how is it going?' })).toMatchObject({ ok: true })
  await expect.poll(() => messages(log)).toEqual(['how is it going?'])

  // The page's clock four minutes ahead of main's: the run waits "4 min" as soon as it is accepted.
  await window.evaluate((ahead) => {
    const real = Date.now.bind(Date)
    Date.now = () => real() + ahead
  }, AHEAD_MS)

  await autopilot.click()
  const dialog = startWindow(window)
  await expect(dialog).toHaveAttribute('data-facts', 'read')
  const start = dialog.getByTestId('start-autopilot-start')
  await expect(start).toHaveText('Start when free')
  await start.click()
  await expect(dialog).toHaveCount(0)

  const status = frame.getByTestId('autopilot-status')
  await expect(status).toHaveAttribute('data-status', 'waiting')
  await expect(status).toHaveText('waiting for the Orchestrator · 4 min')
  await expect(frame.getByTestId('autopilot-start-now')).toHaveText('Start now')
  await expect(frame.getByTestId('autopilot-cancel-wait')).toHaveText('Cancel')
  return frame
}

test('"Start now" in the line of a waiting run lists what it stops; "Interrupt and start" interrupts the turn and the Wave goes', async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window } = launched
    const frame = await waitingRun(launched, world.log)
    expect(journalsOf(world.dataDir)).toHaveLength(1)
    expect(messages(world.log)).toEqual(['how is it going?'])
    await captureScreenshot(frame, 'waiting-line')

    await frame.getByTestId('autopilot-start-now').click()
    const dialog = window.getByTestId('start-now')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Start now?' })).toBeVisible()
    await expect(dialog).toContainText(`Autopilot ${EPIC} starts right away. This stops:`)
    await expect(dialog.getByTestId('start-now-list').getByRole('listitem')).toHaveText(['✕the running turn'])
    await expect(dialog.getByTestId('start-now-cancel')).toBeFocused()
    await captureScreenshot(dialog, 'start-now-window')

    // Esc is Cancel: the run still waits, nothing went to the Orchestrator.
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(frame.getByTestId('autopilot-status')).toHaveAttribute('data-status', 'waiting')

    await frame.getByTestId('autopilot-start-now').click()
    await window.getByTestId('start-now-start').click()
    await expect(window.getByTestId('start-now')).toHaveCount(0)
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    await expect(window.getByTestId('autopilot-wait')).toHaveText('Turn interrupted · Autopilot started')
    await expect.poll(() => messages(world.log)).toContain(`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`)
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

test('"Cancel" in the line of a waiting run stops it start-cancelled; the turn of the Orchestrator goes on', async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window } = launched
    const frame = await waitingRun(launched, world.log)

    await frame.getByTestId('autopilot-cancel-wait').click()
    await expect(window.getByTestId('start-now')).toHaveCount(0)
    const status = frame.getByTestId('autopilot-status')
    await expect(status).toHaveText('stopped: start cancelled')
    await expect(window.getByTestId('autopilot-wait')).toHaveText('Autopilot cancelled; the Orchestrator was not touched')
    expect(await bridgeCall(window, 'autopilot.state', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped', reason: 'start-cancelled' } })
    // The person's turn still runs: main still sees the Orchestrator busy with it, and it got nothing more.
    expect(await bridgeCall(window, 'autopilot.prepare', { projectId: PROJECT, epics: [EPIC] })).toMatchObject({ ok: true, value: { busy: { turn: true } } })
    expect(messages(world.log)).toEqual(['how is it going?'])
  } finally {
    await launched.close()
  }
})
