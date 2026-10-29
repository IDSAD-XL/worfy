import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeMarkedTranscript } from '../big-transcript'
import { launchApp } from './helpers'
import { ms } from '../time-scale'

// The Session view against the built app, on the fake agent: the script
// test/fixtures/agent-scripts/session-view.jsonl plays two turns and starts over. Turn 1 runs a
// tool and answers with markdown (a table, a task list, a link) at $0.0021; turn 2 starts to
// count and holds until it is interrupted ($0.0026 for its process). Everything goes through the
// window: a double click on the Orchestrator Node, the input field, the Interrupt button.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Bridge = { on(channel: string, handler: (payload: unknown) => void): number }
interface Envelope {
  sessionId: string
  event: { type: string; state?: string }
}

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-view-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/**
 * The transcript Claude Code writes for a turn of test/fixtures/agent-scripts/hide-tools.jsonl:
 * the prompt, Bash ✓, Edit ✗, Grep ✓ and the answer.
 */
function sessionTranscript(sessionId: string, cwd: string): void {
  let n = 0
  const record = (type: 'user' | 'assistant', content: unknown) =>
    JSON.stringify({ type, isSidechain: false, timestamp: '2026-10-23T10:00:00.000Z', cwd, sessionId, entrypoint: 'sdk-ts', uuid: `${sessionId}-${(n += 1)}`, message: { role: type, content, ...(type === 'assistant' ? { id: `msg_${n}`, model: 'claude-haiku-4-5-20251001' } : {}) } })
  const call = (id: string, name: string, input: unknown, result: string, isError: boolean) => [
    record('assistant', [{ type: 'tool_use', id, name, input }]),
    record('user', [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }]),
  ]
  const lines = [
    record('user', 'lint and fix'),
    ...call('toolu_hide_1', 'Bash', { command: 'pnpm lint' }, '0 problems', false),
    ...call('toolu_hide_2', 'Edit', { file_path: 'src/renderer/session/fold.ts' }, 'String to replace not found in file.', true),
    ...call('toolu_hide_3', 'Grep', { pattern: 'hideTools' }, 'src/renderer/session/Transcript.tsx', false),
    record('assistant', [{ type: 'text', text: 'The lint is clean; the edit missed, so the old line stays.' }]),
  ]
  const dir = join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`)
}

/** Starts recording the state events the window receives, to read back with states(). */
async function record(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = globalThis as unknown as { worfy: Bridge; recorded: unknown[] }
    store.recorded = []
    store.worfy.on('agent.event', (payload) => store.recorded.push(payload))
  })
}

async function states(window: Page): Promise<string[]> {
  const recorded = await window.evaluate(() => (globalThis as unknown as { recorded: Envelope[] }).recorded)
  return recorded.flatMap((envelope) => (envelope.event.type === 'state' && envelope.event.state ? [envelope.event.state] : []))
}

async function results(window: Page): Promise<number> {
  const recorded = await window.evaluate(() => (globalThis as unknown as { recorded: Envelope[] }).recorded)
  return recorded.filter((envelope) => envelope.event.type === 'result').length
}

/** The window's clock: the one the transcript stamps a live row with and tells today by. */
const windowNow = (window: Page): Promise<number> => window.evaluate(() => Date.now())

const two = (value: number): string => String(value).padStart(2, '0')
const clock = (at: number): string => `${two(new Date(at).getHours())}:${two(new Date(at).getMinutes())}`
const sameLocalDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The date the transcript puts before the clock of a row of another day: `Oct 4`, `Dec 31 '25` in another year. */
function dateLabel(at: number, today: number): string {
  const when = new Date(at)
  const day = `${MONTHS[when.getMonth()] ?? ''} ${when.getDate()}`
  return when.getFullYear() === new Date(today).getFullYear() ? day : `${day} '${String(when.getFullYear()).slice(-2)}`
}

/**
 * Checks the time a live row shows (ticket 14): HH:MM of the window's clock, taken between the send
 * and the check, seconds in the tooltip, and a date only when the local day has turned since the
 * row arrived. A row of today has no date; a row of yesterday, when midnight passed between the
 * send and the check, shows the date it arrived on.
 */
async function expectLiveRowTime(window: Page, row: Locator, sentFrom: number): Promise<void> {
  const shown = await row.getByTestId('transcript-clock').textContent()
  // The date as the row shows it, read before the clock it is checked against.
  const dates = await row.getByTestId('transcript-date').count()
  const checkedAt = await windowNow(window)
  const at = Date.parse((await row.getByTestId('transcript-time').getAttribute('datetime')) ?? '')
  expect(at).toBeGreaterThanOrEqual(sentFrom)
  expect(at).toBeLessThanOrEqual(checkedAt)
  expect([clock(sentFrom), clock(checkedAt)]).toContain(shown)
  if (sameLocalDay(at, checkedAt)) expect(dates).toBe(0)
  // The transcript dates the row on its own timer for midnight, which may fire a moment after the check.
  else await expect(row.getByTestId('transcript-date')).toHaveText(dateLabel(at, checkedAt))
  await expect(row.getByTestId('transcript-time')).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
}

test('the Session view: opened from the Orchestrator Node, a turn, an interrupted turn, and the prompt history', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { window } = launched
    await record(window)
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')

    // A double click on the Node opens its Session in the Session view.
    const canvasView = window.locator('.w-shell__view[data-view="canvas"]')
    const sessionView = window.locator('.w-shell__view[data-view="session"]')
    await expect(sessionView).toBeHidden()
    await node.locator('.w-orchestrator__header').dblclick()
    await expect(sessionView).toBeVisible()
    await expect(canvasView).toBeHidden()
    const view = sessionView.getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('session-cost')).toHaveText('$0.00')
    const nodeId = await node.getAttribute('data-node-id')
    await expect(view).toHaveAttribute('data-node-id', nodeId ?? '')

    // Turn 1: Return sends; busy, then the answer as markdown, then idle with the cost in the header.
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first prompt')
    const sentFrom = await windowNow(window)
    await field.press('Enter')
    await expect(field).toHaveValue('')
    const firstPrompt = view.getByTestId('transcript-prompt').first()
    await expect(firstPrompt).toContainText('first prompt')
    // A live row shows when it arrived.
    await expectLiveRowTime(window, firstPrompt, sentFrom)
    const answer = view.getByTestId('transcript-text').first()
    await expect(answer.locator('table td').first()).toHaveText('33')
    // The answer keeps its time in the tooltip of its label, as the F mockups draw it.
    await expect(answer.getByTestId('transcript-time')).toHaveCount(0)
    await expect(answer.locator('.w-tr__who')).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    await expect(answer.locator('strong')).toHaveText('Wave 6')
    await expect(answer.locator('input[type="checkbox"]')).toHaveCount(2)
    await expect(view.getByTestId('tool-call')).toHaveCount(1)
    await expect(view.getByTestId('tool-call')).toContainText('epic-status worfy-mvp --json')
    await expect(view.getByTestId('tool-ok')).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-cost')).toHaveText('$0.0021')
    await expect(view.getByTestId('session-model')).toHaveText('claude-haiku-4-5-20251001')
    await expect(view.getByTestId('session-permissions')).toHaveText('bypass')
    // main sends `orchestrator.changed` (the header) before the `agent.event` of the same change.
    await expect.poll(async () => (await states(window)).slice(-2)).toEqual(['busy', 'idle'])

    // Turn 2 holds while running: Interrupt appears and the send button queues; Interrupt stops the turn.
    await field.fill('second prompt')
    await field.press('Enter')
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByTestId('input-send')).toHaveAttribute('aria-label', 'Queue message')
    await expect(view.getByTestId('transcript-text').last()).toContainText('1 2')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-view-busy-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('transcript-interrupted')).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('input-send')).toHaveAttribute('aria-label', 'Send message')
    await expect(view.getByTestId('session-cost')).toHaveText('$0.0026')
    // The interruption is a marker, not a message from the user.
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    // ↑/↓ in the empty field step through this Session's prompts.
    await field.click()
    await field.press('ArrowUp')
    await expect(field).toHaveValue('second prompt')
    await field.press('ArrowUp')
    await expect(field).toHaveValue('first prompt')
    await field.press('ArrowDown')
    await expect(field).toHaveValue('second prompt')
    await field.press('ArrowDown')
    await expect(field).toHaveValue('')

    // Shift+Return is a new line, not a send; the field grows with it.
    const before = (await field.boundingBox())?.height ?? 0
    await field.fill('line 1')
    await field.press('Shift+Enter')
    await field.pressSequentially('line 2')
    await expect(field).toHaveValue('line 1\nline 2')
    expect((await field.boundingBox())?.height ?? 0).toBeGreaterThan(before)
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-view-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // A window low enough that the transcript scrolls; the reader is at its bottom.
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(800, 520))
    const transcript = view.getByTestId('transcript')
    await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    await transcript.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    // The toolbar switch goes back to the Canvas.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(canvasView).toBeVisible()
    await expect(sessionView).toBeHidden()

    // A whole turn arrives while the Canvas is on screen (sent through the bridge, as the Session
    // view would); back on the Session view, the transcript shows its end.
    const sessionId = await view.getAttribute('data-session-id')
    expect(sessionId).not.toBeNull()
    await window.evaluate((id) => (globalThis as unknown as { worfy: { invoke(channel: string, input: unknown): Promise<unknown> } }).worfy.invoke('agent.send', { sessionId: id, text: 'third prompt' }), sessionId)
    await expect.poll(() => results(window)).toBe(3)
    await window.getByRole('button', { name: 'Session', exact: true }).click()
    await expect(sessionView).toBeVisible()
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(2)
    await expect(view.getByTestId('transcript-turn-done').last()).toBeInViewport()
    await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(24)
  } finally {
    await launched.close()
  }
})

test('«Hide tools» folds the ordinary tool calls around an error, per Session: kept after a restart, not for a new conversation (worfy-ui ticket 25)', async () => {
  // test/fixtures/agent-scripts/hide-tools.jsonl: one turn of Bash ✓, Edit ✗, Grep ✓, then the answer.
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'hide-tools' }
  const sessionViewOf = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  /** Opens the Orchestrator's Session view from its Node. */
  const open = async (window: Page): Promise<Locator> => {
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = sessionViewOf(window)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    return view
  }
  /** Plays the turn and waits for its end. */
  const turn = async (view: Locator, turns: number): Promise<void> => {
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('lint and fix')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(turns)
    await expect(view.getByTestId('transcript-text').last()).toContainText('the edit missed')
  }
  /** The run top to bottom: «N tools» lines by their label, other calls by their tool. */
  const runOrder = (view: Locator): Promise<string[]> =>
    view.locator('[data-testid="tools-folded"] > button, [data-testid="tool-call"]').evaluateAll((elements) =>
      elements.map((element) => (element.closest('[data-testid="tool-call"]') ? (element.getAttribute('data-tool') ?? '') : (element.textContent ?? '').trim())),
    )
  const shots = async (window: Page, name: string): Promise<void> => {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
  }

  // The Session of the first start, as the window names it.
  const seen = { session: '' }
  const first = await launchApp({ env })
  try {
    const { app, window } = first
    // The default window, 1280 px wide (src/shared/window/bounds.ts). Its content is set to that width:
    // on Windows the 1280 px are the outer width and the frame takes some of them.
    await app.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows()
      win?.setContentSize(1280, win.getContentSize()[1] ?? 800)
    })
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(1280)
    const view = await open(window)
    await turn(view, 1)
    seen.session = (await view.getAttribute('data-session-id')) ?? ''
    expect(seen.session).toMatch(/^[0-9a-f-]{36}$/)
    const toggle = view.getByRole('button', { name: 'Hide tools' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveAttribute('title', /Remembered for this Session/)
    expect(await runOrder(view)).toEqual(['Bash', 'Edit', 'Grep'])

    // On: the ordinary calls fold at their places, the call with an error stays as it is; the answer stays.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => runOrder(view)).toEqual(['1 tool', 'Edit', '1 tool'])
    await expect(view.getByTestId('tool-error')).toHaveCount(1)
    await expect(view.getByTestId('tool-ok')).toHaveCount(0)
    await expect(view.getByTestId('transcript-text').last()).toContainText('the edit missed')
    // At 1280 px the header keeps the title whole and Interrupt inside it; the model's name gives way.
    const title = view.locator('.w-session__title')
    await expect(title).toHaveText('Orchestrator · alpha')
    expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const header = await view.locator('.w-session__header').boundingBox()
    const interrupt = await view.getByTestId('session-interrupt').boundingBox()
    if (header === null || interrupt === null) throw new Error('the header or Interrupt has no box')
    expect(interrupt.x + interrupt.width).toBeLessThanOrEqual(header.x + header.width)
    await shots(window, 'hide-tools-folded')

    // A click opens a line into its call, with its status, at its place.
    await view.locator('[data-testid="tools-folded"]').first().getByRole('button', { name: '1 tool' }).click()
    await expect.poll(() => runOrder(view)).toEqual(['1 tool', 'Bash', 'Edit', '1 tool'])
    await expect(view.getByTestId('tool-ok')).toHaveCount(1)
    await shots(window, 'hide-tools-opened')
  } finally {
    await first.close()
  }

  // Claude Code would have written the Session's transcript (the fake agent writes none): without it
  // the Orchestrator starts a new Session instead of resuming this one.
  sessionTranscript(seen.session, join(scratch, 'alpha'))

  // worfy starts again over the same data folder: the Orchestrator resumes the same Session, whose
  // turn read from its transcript still folds its tools.
  const second = await launchApp({ env })
  try {
    const { window } = second
    const view = await open(window)
    await expect(view.getByTestId('transcript-text').last()).toContainText('the edit missed')
    await expect(view.getByRole('button', { name: 'Hide tools' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => runOrder(view)).toEqual(['1 tool', 'Edit', '1 tool'])

    // New conversation on the same Node: another Session, which shows its tools.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await window.getByTestId('orchestrator-new-conversation').click()
    await expect(window.getByTestId('orchestrator-state')).toHaveText('idle')
    const renewed = await open(window)
    await expect(renewed.getByRole('button', { name: 'Hide tools' })).toHaveAttribute('aria-pressed', 'false')
    await turn(renewed, 1)
    await expect.poll(() => renewed.getAttribute('data-session-id')).not.toBe(seen.session)
    expect(await runOrder(renewed)).toEqual(['Bash', 'Edit', 'Grep'])
    await expect(renewed.getByRole('button', { name: 'Hide tools' })).toHaveAttribute('aria-pressed', 'false')
  } finally {
    await second.close()
  }
})

test('a prompt sent just before local midnight shows its date once the day has turned', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { window } = launched
    // The window's clock a minute before the coming local midnight. The transcript is mounted with
    // the window, so the window reloads on that clock: its timer for midnight runs on it too.
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    await window.clock.install({ time: midnight.getTime() - 60_000 })
    await window.reload()
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')

    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first prompt')
    const sentFrom = await windowNow(window)
    await field.press('Enter')
    const firstPrompt = view.getByTestId('transcript-prompt').first()
    await expect(firstPrompt).toContainText('first prompt')
    await expect(firstPrompt.getByTestId('transcript-clock')).toHaveText('23:59')
    // Midnight passes between the send and the check.
    await window.clock.fastForward(60_000)
    expect(sameLocalDay(sentFrom, await windowNow(window))).toBe(false)
    await expectLiveRowTime(window, firstPrompt, sentFrom)
    await expect(firstPrompt.getByTestId('transcript-date')).toHaveCount(1)
  } finally {
    await launched.close()
  }
})

test('⌘F finds in the whole history of a resumed Session: «N of M», Enter and Shift+Enter, a match behind «Load earlier» loaded and scrolled to, Esc (worfy-ui ticket 26)', async () => {
  test.setTimeout(ms(180_000))
  // The Orchestrator saved the Session SAVED; its transcript is 10 MB, the view opens on the last 4 MiB.
  const SAVED = 'f1d00000-0000-4000-8000-0000000000e2'
  const cwd = join(scratch, 'alpha')
  const dir = join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeMarkedTranscript(join(dir, `${SAVED}.jsonl`), SAVED, cwd, 10 * 1024 * 1024)
  const orchestrator = { id: 'orch', kind: 'orchestrator', x: 10, y: 20, w: 360, h: 200, hidden: false, locked: true, pinned: false, tags: [], data: { sessionId: SAVED } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [orchestrator], viewport: { x: 0, y: 0, zoom: 1 } }))

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { app, window } = launched
    // The default window, 1280 px wide: its content is set to that width (on Windows the frame takes some of the outer width).
    await app.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows()
      win?.setContentSize(1280, 800)
    })
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(1280)
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('transcript-text').last()).toContainText('in the garden')
    await expect(view.getByTestId('transcript-load-earlier')).toBeVisible()
    await expect(view.getByText('Answer number 2: the')).toHaveCount(0)

    const bar = view.getByTestId('session-find')
    const field = view.getByTestId('session-find-input')
    const count = view.getByTestId('session-find-count')
    type Box = { top: number; bottom: number; height: number }
    type Painted = { toString(): string; getBoundingClientRect(): Box }
    type InPage = { CSS: { highlights: Map<string, Iterable<Painted>> }; document: { querySelector(selector: string): { getBoundingClientRect(): Box } | null } }
    /** The text of each painted match, and of the current one (the CSS Custom Highlight API). */
    const painted = (name: string): Promise<string[]> =>
      window.evaluate((which) => {
        const registry = (globalThis as unknown as InPage).CSS.highlights
        return [...(registry.get(which) ?? [])].map((range) => range.toString())
      }, name)
    /** Whether the current match is inside the visible part of the transcript. */
    const currentInSight = (): Promise<boolean> =>
      window.evaluate(() => {
        const page = globalThis as unknown as InPage
        const [range] = [...(page.CSS.highlights.get('worfy-find-current') ?? [])]
        const log = page.document.querySelector('.w-shell__view[data-view="session"] [data-testid="transcript"]')
        if (range === undefined || log === null) return false
        const box = range.getBoundingClientRect()
        const sight = log.getBoundingClientRect()
        return box.height > 0 && box.top >= sight.top && box.bottom <= sight.bottom
      })

    await window.keyboard.press('ControlOrMeta+f')
    await expect(bar).toBeVisible()
    await expect(field).toBeFocused()
    await field.fill('ЗЕБРА')
    // Two matches in the rows, the newest current; main counts the one before them.
    await expect(count).toHaveText('3 of 3')
    expect(await painted('worfy-find')).toEqual(['Зебра', 'зебра'])
    expect(await painted('worfy-find-current')).toEqual(['зебра'])
    await shots(window, 'session-find')

    await field.press('Shift+Enter')
    await expect(count).toHaveText('2 of 3')
    expect(await painted('worfy-find-current')).toEqual(['Зебра'])
    // Back past the first row: windows are loaded until the line of turn 2, and the log scrolls to it.
    await field.press('Shift+Enter')
    await expect(count).toHaveText('1 of 3', { timeout: ms(30_000) })
    await expect(view.getByText('Answer number 2: the')).toBeVisible()
    await expect.poll(() => painted('worfy-find-current')).toEqual(['зебра'])
    await expect.poll(currentInSight).toBe(true)
    await expect(view.getByTestId('transcript-load-earlier')).toHaveCount(0)
    // Around the end: Enter from the oldest goes to the newest.
    await field.press('Enter')
    await expect(count).toHaveText('2 of 3')
    await field.press('Enter')
    await expect(count).toHaveText('3 of 3')
    await field.press('Enter')
    await expect(count).toHaveText('1 of 3')

    await field.press('Escape')
    await expect(bar).toHaveCount(0)
    expect(await painted('worfy-find')).toEqual([])
    expect(await painted('worfy-find-current')).toEqual([])
  } finally {
    await launched.close()
  }
})

/** Screenshots of the window in both themes, in the test's output folder. */
async function shots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}
