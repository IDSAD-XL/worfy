import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { EPIC, journals, messages, PROJECT, prepareWorld, releaseTurn, setStatus, type World } from './autopilot-world'
import { startWindow } from './autopilot-start'
import { captureScreenshot } from './evidence-capture'
import { launchApp } from './helpers'
import { WHOLLY_IN_VIEW } from './px'

// A run over a queue of Epics in the built app (worfy-autopilot-queue ticket 17) on the fake agent
// (autopilot-queue-held: each Wave's turn holds until the test releases it), in a Project of a temporary folder
// with three accepted Epics: `demo` (01 and 02 ready, 03 after both), `checkout` and `search` (07 each). "Run all
// accepted" in "⋯" of an Epic frame opens the Start Autopilot window over them; the run starts over demo and
// checkout. The line of the Epic the run is on says its place in the queue ("Epic 1/2: demo · Wave 1 · running"),
// the frames of the Epics waiting in it have the chip "In queue 2/2". "Add to queue" on search during the Wave
// waits for its end ("applies after this Wave"), then the line says "Epic 1/3". "Remove from queue" on checkout
// during the next Wave: at its end the journal gets `queue-changed` with the removal, checkout never starts, and
// the run goes on to search. The line and the chips are shot in both themes (captureScreenshot: with
// WORFY_EVIDENCE=worfy-autopilot-queue/17 into .scratch/worfy-autopilot-queue/evidence/). Electron's powerSaveBlocker
// is replaced in main before the run starts, so the test never keeps the Mac awake.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

const SCRIPT = 'autopilot-queue-held'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-queue-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** The accepted Epics, oldest acceptance first: the fixture's Epic and two more with Ticket 07 ready. */
const ACCEPTED = [
  { epic: EPIC, accepted: '2026-11-04' },
  { epic: 'checkout', accepted: '2026-11-05' },
  { epic: 'search', accepted: '2026-11-06' },
] as const

/**
 * The stub's epic-status answer with ACCEPTED. The other Epics' Ticket is 07, a number the fixture's Epic has not:
 * setStatus changes the Tickets of that number.
 */
function acceptEpics(world: World): void {
  const answer = join(world.claudeHome, 'epic-status.json')
  const model = JSON.parse(readFileSync(answer, 'utf8')) as { epics: unknown[]; tickets: unknown[] }
  model.epics = ACCEPTED.map(({ epic, accepted }) => ({ epic, hasSpec: true, hasMap: false, specStatus: `принят владельцем ${accepted}`, acceptedAt: accepted }))
  for (const { epic } of ACCEPTED.slice(1)) {
    model.tickets.push({ epic, num: 7, slug: 'ticket-7', title: '07 — Ticket 7', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })
  }
  writeFileSync(answer, JSON.stringify(model))
}

/** keep-awake of a run goes to a stand-in: the test asks nothing of the Mac's power. */
const quietPower = (launched: Awaited<ReturnType<typeof launchApp>>): Promise<void> =>
  launched.app.evaluate(({ powerSaveBlocker }) => {
    let next = 100
    powerSaveBlocker.start = () => (next += 1)
    powerSaveBlocker.stop = () => true
    powerSaveBlocker.isStarted = () => false
  })

const frameOf = (window: Page, epic: string): Locator => window.locator(`[data-testid="epic-frame"][data-epic="${epic}"]`)

/** The header of the Epic's frame — its title, its buttons, the line above them and the chips under them — centred by the sidebar, for a screenshot. */
async function headerInView(window: Page, epic: string): Promise<Locator> {
  await window.locator(`[data-testid="sidebar-epic"][data-epic="${epic}"]`).click()
  const header = frameOf(window, epic).locator('header.w-epic__header')
  await expect(header).toBeInViewport(WHOLLY_IN_VIEW)
  return header
}

/** Chooses `item` in "⋯" of the frame. */
async function choose(frame: Locator, item: string): Promise<void> {
  await frame.getByTestId('action-autopilot-more').click()
  const entry = frame.page().getByRole('menuitem', { name: item })
  await expect(entry).toHaveAttribute('aria-disabled', 'false')
  await entry.click()
}

/** The items of "⋯" of the frame, read with the menu open, then closed again. */
async function menuOf(frame: Locator): Promise<string[]> {
  const more = frame.getByTestId('action-autopilot-more')
  await more.click()
  const items = frame.page().getByRole('menuitem')
  await expect(items.first()).toBeVisible()
  const labels = await items.allTextContents()
  await frame.page().keyboard.press('Escape')
  await expect(items).toHaveCount(0)
  return labels
}

interface QueueLine {
  kind: string
  epic?: string
  added?: string[]
  removed?: string[]
  outcome?: string
  index?: number
  of?: number
  epics?: string[]
}

/** The lines of the only run journal about its queue: run-started, epic-started, epic-finished, queue-changed. */
function queueLines(dataDir: string): QueueLine[] {
  const [text] = journals(dataDir)
  if (text === undefined) return []
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueLine)
    .filter((event) => ['run-started', 'epic-started', 'epic-finished', 'queue-changed'].includes(event.kind))
    .map(({ kind, epic, added, removed, outcome, index, of, epics }) => ({ kind, epic, added, removed, outcome, index, of, epics }))
    .map((event) => Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as unknown as QueueLine)
}

const WAVE = (tickets: string, epic: string): string => `/epic-wave Ticket-ы ${tickets} эпика ${epic}`

test('a run over two Epics: "Epic 1/2" in the line, "Add to queue" on a third applies after the Wave ("Epic 1/3"), "Remove from queue" leaves the second unstarted with queue-changed in the journal', async () => {
  const world = prepareWorld(scratch)
  acceptEpics(world)
  const launched = await launchApp({ env: world.env(SCRIPT) })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    const demo = frameOf(window, EPIC)
    const checkout = frameOf(window, 'checkout')
    const search = frameOf(window, 'search')
    for (const frame of [demo, checkout, search]) await expect(frame).toBeVisible()

    // No run: "⋯" of a frame has "Run all accepted", which opens the Start Autopilot window over the three.
    expect(await menuOf(demo)).toEqual(['Run all accepted', 'Run history'])
    await choose(demo, 'Run all accepted')
    const dialog = startWindow(window)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-from', 'accepted')
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-modes')).not.toContainText('…')
    const rows = dialog.getByTestId('start-autopilot-queue-row')
    expect(await rows.evaluateAll((each) => each.map((row) => row.getAttribute('data-epic')))).toEqual(ACCEPTED.map(({ epic }) => epic))
    // A queue of two: search unticked.
    await dialog.getByRole('checkbox', { name: 'Include search' }).uncheck()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Start Autopilot · 2 Epics, 3 Waves')
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await dialog.getByTestId('start-autopilot-start').click()
    await expect(dialog).toHaveCount(0)

    // The run is on demo, the first of two; checkout waits in the queue, search is not in it.
    const line = demo.getByTestId('autopilot-status')
    await expect(line).toHaveText('Epic 1/2: demo · Wave 1 · running')
    await expect(line).toHaveAttribute('title', /Queue of this run:\n1\. demo — running\n2\. checkout — next/)
    await expect(checkout.getByTestId('autopilot-queue-chip')).toHaveText('In queue 2/2')
    await expect(search.getByTestId('autopilot-queue-chip')).toHaveCount(0)
    await expect.poll(() => messages(world.log)).toEqual([WAVE('01, 02', EPIC)])
    expect(await menuOf(demo)).toEqual(['Force stop', 'Run history'])
    expect(await menuOf(checkout)).toEqual(['Remove from queue', 'Run history'])

    // "Add to queue" on search during the Wave: it joins at the Wave's end.
    expect(await menuOf(search)).toEqual(['Add to queue', 'Run history'])
    await choose(search, 'Add to queue')
    await expect(window.getByTestId('autopilot-queue')).toHaveText('Added search to the queue · applies after this Wave')
    await expect(search.getByTestId('autopilot-queue-chip')).toHaveText('Joins after this Wave')
    await expect(line).toHaveText('Epic 1/2: demo · Wave 1 · running')
    expect(queueLines(world.dataDir).filter((event) => event.kind === 'queue-changed')).toEqual([])
    await captureScreenshot(await headerInView(window, 'search'), 'queue-chip-joins')

    // The Orchestrator merges 01 and 02 and ends its turn: the queue has three Epics, the run sends Wave 2 (03).
    setStatus(world, 1, 'done')
    setStatus(world, 2, 'done')
    await releaseTurn(app)
    await expect(line).toHaveText('Epic 1/3: demo · Wave 2 · running')
    await expect(checkout.getByTestId('autopilot-queue-chip')).toHaveText('In queue 2/3')
    await expect(search.getByTestId('autopilot-queue-chip')).toHaveText('In queue 3/3')
    await expect.poll(() => messages(world.log)).toEqual([WAVE('01, 02', EPIC), WAVE('03', EPIC)])
    expect(queueLines(world.dataDir).filter((event) => event.kind === 'queue-changed')).toEqual([{ kind: 'queue-changed', epic: EPIC, added: ['search'] }])
    await captureScreenshot(await headerInView(window, EPIC), 'queue-line')
    await captureScreenshot(await headerInView(window, 'checkout'), 'queue-chip')

    // "Remove from queue" on checkout during Wave 2: it waits for the Wave's end.
    await choose(checkout, 'Remove from queue')
    await expect(window.getByTestId('autopilot-queue')).toHaveText('Removed checkout from the queue · applies after this Wave')
    await expect(checkout.getByTestId('autopilot-queue-chip')).toHaveText('Leaves after this Wave')
    await captureScreenshot(await headerInView(window, 'checkout'), 'queue-chip-leaves')

    // 03 is merged and the turn ends: checkout leaves the queue unstarted, demo is done, the run goes on to search.
    setStatus(world, 3, 'done')
    await releaseTurn(app)
    const searchLine = search.getByTestId('autopilot-status')
    await expect(searchLine).toHaveText('Epic 2/2: search · Wave 1 · running')
    await expect(checkout.getByTestId('autopilot-queue-chip')).toHaveCount(0)
    await expect.poll(() => messages(world.log)).toEqual([WAVE('01, 02', EPIC), WAVE('03', EPIC), WAVE('07', 'search')])
    await expect
      .poll(() => queueLines(world.dataDir))
      .toEqual([
        { kind: 'run-started', epic: EPIC, epics: [EPIC, 'checkout'] },
        { kind: 'queue-changed', epic: EPIC, added: ['search'] },
        { kind: 'queue-changed', epic: EPIC, removed: ['checkout'] },
        { kind: 'epic-finished', epic: 'checkout', outcome: 'removed' },
        { kind: 'epic-finished', epic: EPIC, outcome: 'done' },
        { kind: 'epic-started', epic: 'search', index: 2, of: 2 },
      ])
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})
