import { mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { checkRecovery } from '../autopilot-invariants'
import { EPIC, files, ghCalls, journals, kindsOf, messages, prepareWorld } from './autopilot-world'
import { launchApp } from './helpers'
import { startAutopilot } from './autopilot-start'

// The quit of worfy during an Autopilot Run in the built app (worfy-continuity ticket 04): the Wave's turn of the fake
// Orchestrator calls `git push` and holds it without a result (autopilot-quit-push.jsonl), and the app is asked to
// quit. The quit's coordinator (src/main/quit-grace.ts) waits for that command: the window «Quitting worfy» names it
// with the time left, and Quit now quits at once. The Run is suspended, not stopped: run-suspended is the last line of
// its journal. Every wait is for a sign the app shows or writes, never a pause.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WAVE_1 = `/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`
const PUSH = 'git push origin demo/01'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-quit-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const frameOf = (window: Page): Locator => window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)

test('quitting while the Wave runs git push: «Quitting worfy» names the command with the time left, Quit now quits at once, and the Run is suspended', async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('autopilot-quit-push') })
  const child = launched.app.process()
  let quit = false
  try {
    const { app, window } = launched
    const frame = frameOf(window)
    await startAutopilot(frame.getByTestId('action-autopilot'))
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    // The fake agent logs the Wave's command when its turn starts, and calls git push in the same turn at once.
    await expect.poll(() => messages(world.log)).toEqual([WAVE_1])

    await app.evaluate(({ app: electronApp }) => electronApp.quit())
    const dialog = window.getByTestId('quitting-worfy')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Quitting worfy' })).toBeVisible()
    await expect(dialog.getByTestId('quitting-worfy-calls')).toHaveText(PUSH)
    await expect(dialog.getByTestId('quitting-worfy-left')).toContainText(/worfy quits in (1:00|0:[0-5]\d) at the latest/u)
    await window.emulateMedia({ colorScheme: 'light' })
    await dialog.screenshot({ path: test.info().outputPath('04-quitting-worfy-light.png') })
    await window.emulateMedia({ colorScheme: 'dark' })
    await dialog.screenshot({ path: test.info().outputPath('04-quitting-worfy-dark.png') })
    // Nothing is suspended while the quit waits.
    expect(journals(world.dataDir).map(kindsOf).flat().filter((kind) => kind.startsWith('run-suspended'))).toEqual([])

    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((done) => child.once('exit', () => done()))
    await dialog.getByTestId('quitting-worfy-quit-now').click()
    await exited
    quit = true
  } finally {
    await launched.close(quit ? { windowGone: true } : {})
  }

  const [journal] = journals(world.dataDir)
  const last = JSON.parse(journal!.trim().split('\n').at(-1)!) as Record<string, unknown>
  expect(last).toMatchObject({ kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01', '02'], wait: null })
  expect(kindsOf(journal!).filter((kind) => kind.startsWith('run-stopped'))).toEqual([])
  expect(
    checkRecovery({
      journals: journals(world.dataDir),
      messages: messages(world.log),
      gh: ghCalls(world),
      statusWrites: [],
      projectBefore: world.projectBefore,
      projectAfter: files(world.repo),
      restart: null,
      expect: { stop: null, suspended: 'quit', waves: 1 },
    }),
  ).toEqual([])
})
