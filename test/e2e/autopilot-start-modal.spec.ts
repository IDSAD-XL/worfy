import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { EPIC, messages, PROJECT, prepareWorld } from './autopilot-world'
import { startWindow } from './autopilot-start'
import { captureScreenshot } from './evidence-capture'
import { launchApp } from './helpers'

// The Start Autopilot window in the built app (worfy-autopilot-queue ticket 09) on the fake agent
// (`orchestrator`: a turn holds until it is interrupted), in a Project of a temporary folder with the
// Epic `demo` (01 and 02 ready, 03 after both). The Autopilot button of the Epic frame opens the window,
// which shows main's facts (`autopilot.prepare`); "Start Autopilot" starts the run. With the Orchestrator
// in a person's turn the window says it is busy, and "Start when free" leaves the run waiting for it.
// The window is shot in both themes as the Ticket's Evidence (captureScreenshot: with
// WORFY_EVIDENCE=worfy-autopilot-queue/09 into .scratch/worfy-autopilot-queue/evidence/, else into the
// test's output). Keys, focus and the facts in detail are the unit test's (test/unit/start-autopilot-modal.test.tsx).
// Electron's powerSaveBlocker is replaced in main before a run starts, so the test never keeps the Mac awake.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-start-modal-')))
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

/** The window open with main's facts read. */
async function openWindow(autopilot: Locator): Promise<Locator> {
  await autopilot.click()
  const dialog = startWindow(autopilot.page())
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-facts', 'read')
  await expect(dialog.getByTestId('start-autopilot-modes')).not.toContainText('…')
  return dialog
}

const journalsOf = (dataDir: string): string[] => (existsSync(join(dataDir, 'autopilot')) ? readdirSync(join(dataDir, 'autopilot')) : [])

test('the Autopilot button opens the Start Autopilot window with the facts of the start; "Start Autopilot" starts the run', async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    const frame = frameOf(window)
    const autopilot = frame.getByTestId('action-autopilot')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')

    // The click opens the window and starts nothing.
    const dialog = await openWindow(autopilot)
    expect(journalsOf(world.dataDir)).toEqual([])
    await expect(dialog.getByRole('heading', { name: 'Start Autopilot' })).toBeVisible()
    await expect(dialog.getByText('From the Autopilot button on the Canvas')).toBeVisible()
    await expect(dialog.getByTestId('start-autopilot-project')).toHaveText('demo')
    await expect(dialog.getByTestId('start-autopilot-epic')).toHaveText(EPIC)
    await expect(dialog.getByTestId('start-autopilot-tickets')).toHaveText('01, 02, 03· 2 Waves left')
    await expect(dialog.getByTestId('start-autopilot-orchestrator')).toContainText('Claude Code')
    await expect(dialog.getByTestId('start-autopilot-busy')).toHaveCount(0)
    await expect(dialog.getByTestId('start-autopilot-cancel')).toBeFocused()
    // The default Run mode of Settings → Autopilot (none set: Fastest) is chosen and marked.
    await expect(dialog.getByRole('radio', { checked: true })).toHaveText('Fastest (default)')
    const start = dialog.getByTestId('start-autopilot-start')
    await expect(start).toHaveText('Start Autopilot')
    await captureScreenshot(dialog, 'start-window-canvas-button')

    // Esc closes it; nothing started, the button is there again.
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')
    expect(journalsOf(world.dataDir)).toEqual([])

    // Opened again: "Start Autopilot" starts the run, the window closes, Wave 1 goes to the Orchestrator.
    await (await openWindow(autopilot)).getByTestId('start-autopilot-start').click()
    await expect(startWindow(window)).toHaveCount(0)
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    await expect.poll(() => messages(world.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

test('with the Orchestrator in a turn the window says it is busy, and "Start when free" leaves the run waiting for it', async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    const frame = frameOf(window)
    const autopilot = frame.getByTestId('action-autopilot')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')

    // A person's message: its turn holds, the Orchestrator is busy.
    const view = (await bridgeCall(window, 'orchestrator.open', { projectId: PROJECT })) as { ok: boolean; value?: { sessionId: string | null } }
    const sessionId = view.value?.sessionId ?? null
    expect(sessionId).not.toBeNull()
    expect(await bridgeCall(window, 'agent.send', { sessionId, text: 'how is it going?' })).toMatchObject({ ok: true })
    await expect.poll(() => messages(world.log)).toEqual(['how is it going?'])

    const dialog = await openWindow(autopilot)
    const notice = dialog.getByTestId('start-autopilot-busy')
    await expect(notice).toContainText('The Orchestrator is busy: a turn is running. Autopilot will wait and start when it is free.')
    const start = dialog.getByTestId('start-autopilot-start')
    await expect(start).toHaveText('Start when free')
    await captureScreenshot(dialog, 'start-window-orchestrator-busy')

    // ⌘↩ is the main button: the run is accepted and waits; nothing goes to the Orchestrator.
    await window.keyboard.press('ControlOrMeta+Enter')
    await expect(dialog).toHaveCount(0)
    const status = frame.getByTestId('autopilot-status')
    await expect(status).toHaveText('waiting for the Orchestrator')
    await expect(status).toHaveAttribute('data-status', 'waiting')
    await expect.poll(() => journalsOf(world.dataDir).length).toBe(1)
    expect(messages(world.log)).toEqual(['how is it going?'])
    // Stop cancels the wait; the Orchestrator is not touched.
    expect(await bridgeCall(window, 'autopilot.stop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped', reason: 'start-cancelled' } })
  } finally {
    await launched.close()
  }
})
