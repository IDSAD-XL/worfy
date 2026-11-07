import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { EPIC, git, journals, kindsOf, messages, PROJECT, prepareWorld, type World } from './autopilot-world'
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
//
// An agent's `autopilot_start` (worfy-autopilot-queue ticket 11) opens the same window in its "Agent asks"
// view. The fake agent calls no MCP tool, so the test calls the tool as the Orchestrator's canvas server
// answers it, in main (`globalThis.worfyCanvasTool` under WORFY_AGENT=fake, src/main/ipc/autopilot-confirm.ts);
// the call waits for the person's answer in the window, as Claude Code's would.
//
// "Run all accepted" of the Command palette (worfy-autopilot-queue ticket 16) opens the window in its
// "Queue" view over the Project's accepted Epics: here the stub's epic-status answer says three Epics are
// accepted, each with a ready Ticket. The person unticks one and drags another to the top; the run starts
// over the ticked Epics in that order (`epics` of `run-started` in the run journal). An agent's
// `autopilot_start` with the same three Epics opens that view under "Asked by …": the person changes the
// queue there too, and the run starts over exactly the Epics the window answered.
//
// worfy-autopilot-queue ticket 21: a second Project of the same repository (a clone with the same origin) runs
// Epic checkout; "Run all accepted" over demo and checkout is refused, the window keeps main's reason and
// "Start anyway", which starts the same queue past the check. A queue whose last Epic has only Tickets for the
// owner stops with `waits-owner`: the line of that Epic says so, with the chip "Waits for owner". The window and
// the frame are shot in both themes (WORFY_EVIDENCE=worfy-autopilot-queue/21).

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

type ToolAnswer = { content: { type: string; text: string }[]; isError?: boolean }

/** Session `sessionId` calls `autopilot_start` with `args`; resolves once the person has answered (or main stopped waiting). */
const agentCalls = (launched: Awaited<ReturnType<typeof launchApp>>, sessionId: string, args: Record<string, unknown>): Promise<ToolAnswer> =>
  launched.app.evaluate(
    (_electron, [project, session, input]) =>
      (globalThis as unknown as { worfyCanvasTool: (p: string, s: string, n: string, a: unknown) => Promise<ToolAnswer> }).worfyCanvasTool(project, session, 'autopilot_start', input),
    [PROJECT, sessionId, args] as const,
  )

test("an agent's autopilot_start asks in the window with the Session that asks: Esc gives the Session a refusal, \"Start Autopilot\" starts the run", async () => {
  const world = prepareWorld(scratch)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    const frame = frameOf(window)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect.poll(() => app.evaluate(() => typeof (globalThis as { worfyCanvasTool?: unknown }).worfyCanvasTool)).toBe('function')
    const view = (await bridgeCall(window, 'orchestrator.open', { projectId: PROJECT })) as { ok: boolean; value?: { sessionId: string | null } }
    const sessionId = view.value?.sessionId ?? null
    expect(sessionId).not.toBeNull()
    const asked = `Asked by Session "${sessionId!.slice(0, 8)}" in a chat · answer within`

    // The first ask: the window names the Session and counts down; Esc is Cancel, and the Session hears it.
    const refused = agentCalls(launched, sessionId!, { epic: EPIC })
    const dialog = startWindow(window)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-from', 'agent')
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-asked')).toContainText(asked)
    await expect(dialog.getByTestId('start-autopilot-countdown')).toHaveText(/^(10:00|9:[0-5]\d)$/u)
    await expect(dialog.getByTestId('start-autopilot-cancel')).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const refusal = await refused
    expect(refusal.isError).toBe(true)
    expect(refusal.content[0]?.text).toBe('The user chose Cancel in the Start Autopilot window: Autopilot did not start.')
    expect(journalsOf(world.dataDir)).toEqual([])
    expect(messages(world.log)).toEqual([])

    // The second ask: "Start Autopilot" starts the run, the Session hears it started, Wave 1 goes to the Orchestrator.
    const started = agentCalls(launched, sessionId!, { epic: EPIC })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-modes')).not.toContainText('…')
    await expect(dialog.getByTestId('start-autopilot-asked')).toContainText(asked)
    await expect(dialog.getByTestId('start-autopilot-project')).toHaveText('demo')
    await expect(dialog.getByTestId('start-autopilot-epic')).toHaveText(EPIC)
    await captureScreenshot(dialog, 'start-window-agent-asks')
    await dialog.getByTestId('start-autopilot-start').click()
    await expect(dialog).toHaveCount(0)
    const answer = await started
    expect(answer.isError ?? false).toBe(false)
    expect(answer.content[0]?.text).toBe(`Autopilot started Epic ${EPIC}.`)
    await expect(frame.getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    await expect.poll(() => messages(world.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

/** The accepted Epics of the queue test, oldest acceptance first: the fixture's Epic and two more with one ready Ticket each. */
const ACCEPTED = [
  { epic: EPIC, accepted: '2026-11-04' },
  { epic: 'checkout', accepted: '2026-11-05' },
  { epic: 'search', accepted: '2026-11-06' },
] as const

/** The stub's epic-status answer with ACCEPTED: each Epic's spec accepted by the owner on its day. */
function acceptEpics(world: World): void {
  const answer = join(world.claudeHome, 'epic-status.json')
  const model = JSON.parse(readFileSync(answer, 'utf8')) as { epics: unknown[]; tickets: unknown[] }
  model.epics = ACCEPTED.map(({ epic, accepted }) => ({ epic, hasSpec: true, hasMap: false, specStatus: `принят владельцем ${accepted}`, acceptedAt: accepted }))
  for (const { epic } of ACCEPTED.slice(1)) {
    model.tickets.push({ epic, num: 1, slug: 'ticket-1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })
  }
  writeFileSync(answer, JSON.stringify(model))
}

/** The `epics` of the `run-started` line of the only run journal; undefined before there is one. */
function startedEpics(dataDir: string): string[] | undefined {
  const [text] = journals(dataDir)
  if (text === undefined) return undefined
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; epics?: string[] })
  return events.find((event) => event.kind === 'run-started')?.epics
}

test('"Run all accepted" opens the window over the accepted Epics; the run starts over the ticked ones in the order left there', async () => {
  const world = prepareWorld(scratch)
  acceptEpics(world)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect(window.locator('[data-testid="epic-frame"][data-epic="search"]')).toBeVisible()

    // The Command palette: "Run all accepted".
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await window.getByTestId('palette-input').fill('run all accepted')
    const option = palette.locator('[data-testid="palette-option"][data-command="run-all-accepted"]')
    await expect(option).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    await expect(palette).toBeHidden()

    // The window in its Queue view: the three Epics, oldest acceptance first.
    const dialog = startWindow(window)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-from', 'accepted')
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-modes')).not.toContainText('…')
    const heading = dialog.getByRole('heading', { level: 2 })
    await expect(heading).toHaveText('Start Autopilot · 3 Epics, 4 Waves')
    await expect(dialog.getByTestId('start-autopilot-accepted')).toHaveText('3 Epics are accepted and waiting. Autopilot runs them one after another.')
    const rows = dialog.getByTestId('start-autopilot-queue-row')
    const order = () => rows.evaluateAll((each) => each.map((row) => row.getAttribute('data-epic')))
    expect(await order()).toEqual(ACCEPTED.map(({ epic }) => epic))
    await expect(rows.nth(0)).toContainText('2 Waves')
    await expect(rows.nth(0)).toContainText('accepted Nov 4')
    await expect(rows.nth(2)).toContainText('accepted Nov 6')
    await captureScreenshot(dialog, 'start-window-queue')

    // Untick the second; swap the first and the third — the third dragged to the top with the mouse, then
    // the first moved down with ⌥↓: the queue is search, then demo.
    await dialog.getByRole('checkbox', { name: 'Include checkout' }).uncheck()
    await expect(rows.nth(1)).toHaveAttribute('data-on', 'false')
    await expect(heading).toHaveText('Start Autopilot · 2 Epics, 3 Waves')
    await rows.nth(2).dragTo(rows.nth(0))
    await expect.poll(order).toEqual(['search', EPIC, 'checkout'])
    const grip = dialog.getByRole('button', { name: `Reorder ${EPIC}` })
    await grip.focus()
    await window.keyboard.press('Alt+ArrowDown')
    await expect.poll(order).toEqual(['search', 'checkout', EPIC])
    await expect(grip).toBeFocused()
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    expect(journalsOf(world.dataDir)).toEqual([])

    // The start: run-started names the ticked Epics in the new order, without the unticked one.
    await dialog.getByTestId('start-autopilot-start').click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => startedEpics(world.dataDir)).toEqual(['search', EPIC])
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

test("an agent's ask for a queue: the person unticks and reorders it in the window, and the run starts over exactly those Epics", async () => {
  const world = prepareWorld(scratch)
  acceptEpics(world)
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect.poll(() => app.evaluate(() => typeof (globalThis as { worfyCanvasTool?: unknown }).worfyCanvasTool)).toBe('function')
    const view = (await bridgeCall(window, 'orchestrator.open', { projectId: PROJECT })) as { ok: boolean; value?: { sessionId: string | null } }
    const sessionId = view.value?.sessionId ?? null
    expect(sessionId).not.toBeNull()

    const started = agentCalls(launched, sessionId!, { epics: ACCEPTED.map(({ epic }) => epic) })
    const dialog = startWindow(window)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-from', 'agent')
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-asked')).toContainText(`Asked by Session "${sessionId!.slice(0, 8)}" in a chat`)
    const rows = dialog.getByTestId('start-autopilot-queue-row')
    const order = () => rows.evaluateAll((each) => each.map((row) => row.getAttribute('data-epic')))
    expect(await order()).toEqual(ACCEPTED.map(({ epic }) => epic))

    // Untick checkout; search up two places with ⌥↑: the queue is search, then demo.
    await dialog.getByRole('checkbox', { name: 'Include checkout' }).uncheck()
    const grip = dialog.getByRole('button', { name: 'Reorder search' })
    await grip.focus()
    await window.keyboard.press('Alt+ArrowUp')
    await window.keyboard.press('Alt+ArrowUp')
    await expect.poll(order).toEqual(['search', EPIC, 'checkout'])
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Start Autopilot · 2 Epics, 3 Waves')

    // The answer carries the ticked Epics in their order; main starts over exactly those.
    await dialog.getByTestId('start-autopilot-start').click()
    await expect(dialog).toHaveCount(0)
    const answer = await started
    expect(answer.isError ?? false).toBe(false)
    expect(answer.content[0]?.text).toBe(`Autopilot started a queue of 2 Epics: search, ${EPIC}.`)
    await expect.poll(() => startedEpics(world.dataDir)).toEqual(['search', EPIC])
    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

/** The other Project of the "Start anyway" test: a clone of the fixture with the same origin. */
const OTHER = 'other-000000a5'
const ORIGIN = 'https://example.invalid/demo.git'

/** The `run-started` line of `projectId`'s run journal; undefined before there is one. */
function runStarted(dataDir: string, projectId: string): { epics?: string[]; override?: boolean } | undefined {
  for (const text of journals(dataDir)) {
    const [first] = text.split('\n')
    const event = JSON.parse(first ?? '{}') as { kind?: string; project?: string; epics?: string[]; override?: boolean }
    if (event.kind === 'run-started' && event.project === projectId) return event
  }
  return undefined
}

test('"Run all accepted" refused because an Epic of the queue runs in another Project: the window offers "Start anyway", which starts the same queue past the check (ticket 21)', async () => {
  const world = prepareWorld(scratch)
  acceptEpics(world)
  // A second Project of the same repository: a clone with the same origin, its Epic checkout run first.
  git(world.repo, 'remote', 'add', 'origin', ORIGIN)
  const other = join(scratch, 'other')
  git(scratch, 'clone', '-q', world.repo, other)
  git(other, 'remote', 'set-url', 'origin', ORIGIN)
  mkdirSync(join(world.dataDir, OTHER), { recursive: true })
  writeFileSync(join(world.dataDir, OTHER, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  const projects = JSON.parse(readFileSync(join(world.dataDir, 'projects.json'), 'utf8')) as { projects: unknown[]; activeId: string }
  projects.projects.push({ id: OTHER, name: 'other', path: other })
  writeFileSync(join(world.dataDir, 'projects.json'), JSON.stringify(projects))
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect(window.locator('[data-testid="epic-frame"][data-epic="search"]')).toBeVisible()
    expect(await bridgeCall(window, 'autopilot.start', { projectId: OTHER, epic: 'checkout' })).toMatchObject({ ok: true, value: { epic: 'checkout' } })

    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('run all accepted')
    await expect(window.getByTestId('command-palette').locator('[data-testid="palette-option"][data-command="run-all-accepted"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const dialog = startWindow(window)
    await expect(dialog).toHaveAttribute('data-facts', 'read')
    await expect(dialog.getByTestId('start-autopilot-modes')).not.toContainText('…')
    await dialog.getByRole('checkbox', { name: 'Include search' }).uncheck()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Start Autopilot · 2 Epics, 3 Waves')

    // The start is refused: the window stays with main's reason and "Start anyway"; no toast, no run.
    await dialog.getByTestId('start-autopilot-start').click()
    const notice = dialog.getByTestId('start-autopilot-elsewhere')
    await expect(notice).toContainText(`Autopilot is already running Epic checkout of this repository on this Machine (Project ${OTHER})`)
    const anyway = dialog.getByTestId('start-autopilot-anyway')
    await expect(anyway).toHaveText('Start anyway')
    await expect(window.getByTestId('autopilot-start-refused')).toHaveCount(0)
    expect(runStarted(world.dataDir, PROJECT)).toBeUndefined()
    await captureScreenshot(dialog, 'queue-start-anyway')

    // "Start anyway": the same queue, in the same order, past the check; the line says Epic 1/2.
    await anyway.click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => runStarted(world.dataDir, PROJECT)).toMatchObject({ epics: [EPIC, 'checkout'], override: true })
    await expect(frameOf(window).getByTestId('autopilot-status')).toContainText('Epic 1/2: demo')
    for (const projectId of [PROJECT, OTHER]) expect(await bridgeCall(window, 'autopilot.forceStop', { projectId })).toMatchObject({ ok: true, value: { status: 'stopped' } })
  } finally {
    await launched.close()
  }
})

test('the last Epic of a queue where only Tickets for the owner are left: "stopped: waits for owner" and the chip "Waits for owner" on its frame (ticket 21)', async () => {
  const world = prepareWorld(scratch)
  acceptEpics(world)
  // Every Ticket of demo and checkout is blocked and waits for the owner: the run sends no Wave.
  const answer = join(world.claudeHome, 'epic-status.json')
  const model = JSON.parse(readFileSync(answer, 'utf8')) as { tickets: { epic: string; state: string; statusRaw: string; waits?: string }[] }
  for (const ticket of model.tickets) if (ticket.epic === EPIC || ticket.epic === 'checkout') Object.assign(ticket, { state: 'blocked', statusRaw: 'blocked — 2026-11-07', waits: 'owner' })
  writeFileSync(answer, JSON.stringify(model))
  const launched = await launchApp({ env: world.env('orchestrator') })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await quietPower(launched)
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    const frame = window.locator('[data-testid="epic-frame"][data-epic="checkout"]')
    await expect(frame).toBeVisible()
    expect(await bridgeCall(window, 'autopilot.start', { projectId: PROJECT, epic: EPIC, epics: [EPIC, 'checkout'] })).toMatchObject({ ok: true })

    await expect(frame.getByTestId('autopilot-status')).toHaveText('Epic 2/2: checkout · stopped: waits for owner')
    const chip = frame.getByTestId('autopilot-queue-chip')
    await expect(chip).toHaveText('Waits for owner')
    await expect(chip).toHaveAttribute('title', 'Autopilot stopped on checkout: only Tickets for the owner are left')
    const [text] = journals(world.dataDir)
    expect(kindsOf(text ?? '').filter((kind) => kind.startsWith('epic-') || kind.startsWith('run-'))).toEqual(['run-started', 'epic-finished', 'epic-started', 'epic-finished', 'run-stopped waits-owner'])
    // The stop's toast says the reason too; it goes before the shot, which is of the frame alone.
    const toast = window.getByTestId('run-stopped-toast')
    await expect(toast).toContainText('Run stopped: waits-owner')
    await toast.getByRole('button', { name: 'Dismiss' }).click()
    await expect(toast).toHaveCount(0)
    await captureScreenshot(frame, 'last-epic-waits-owner')
  } finally {
    await launched.close()
  }
})
