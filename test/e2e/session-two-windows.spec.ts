import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, type LaunchedApp } from './helpers'

// worfy-link ticket 04 against the built app on the fake agent: a Session belongs to the app, not
// to the window it was started in (ADR-0053, point 4). Two windows of one worfy are two clients of
// main: a Session started in window 1 answers in both, outlives window 1, takes messages from
// window 2, shows its past turns (from the transcript) and its live turns once each in a window
// opened later, and queues the messages both windows send during a turn in the order they came.
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude; the fake agent writes no transcript, so
// the test writes what Claude Code would.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const PAST = 'f0000000-0000-4000-8000-0000000000b1'
/** What the fake agent answers every turn of test/fixtures/agent-scripts/turn.jsonl, and the message id it gives that answer. */
const FAKE_ANSWER = 'Hello from the fake agent'
const FAKE_MESSAGE_ID = 'msg_fake_turn'
const SIZE = { width: 1400, height: 900 }

type Turn = { prompt: string; answer: string; messageId: string }
type Call = { kind: string; text?: string }
type Bridge = {
  invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }>
  on(channel: string, handler: (payload: unknown) => void): number
}
type Envelope = { sessionId: string; event: { type: string } }
type Heard = { __agentEvents?: Envelope[] }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
let log: string

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
const transcriptFile = (sessionId: string): string => join(transcriptDir(projectPath), `${sessionId}.jsonl`)

/** Transcript lines as Claude Code writes them: for each turn the user's prompt, then the answer. */
function turnLines(sessionId: string, turns: readonly Turn[], entrypoint: string): string {
  const record = (extra: Record<string, unknown>) =>
    JSON.stringify({ isSidechain: false, timestamp: '2026-10-08T10:00:00.000Z', cwd: projectPath, sessionId, entrypoint, gitBranch: 'main', ...extra })
  return turns
    .map(
      ({ prompt, answer, messageId }, at) =>
        `${record({ type: 'user', uuid: `${sessionId}-u${at}-${messageId}`, message: { role: 'user', content: prompt } })}\n` +
        `${record({ type: 'assistant', uuid: `${sessionId}-a${at}-${messageId}`, message: { id: messageId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: answer }] } })}\n`,
    )
    .join('')
}

/** The user messages that reached the fake Claude Code, in order (WORFY_AGENT_LOG). */
const messages = (): string[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .flatMap((call) => (call.kind === 'message' && call.text !== undefined ? [call.text] : []))
    : []

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-two-windows-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  log = join(scratch, 'agent.log')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (script: string): Promise<LaunchedApp> =>
  launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: script, WORFY_AGENT_LOG: log } })

/** Window 1 at rest, then window 2 opened by the helper of ticket 03 and at rest too. */
async function twoWindows(launched: LaunchedApp): Promise<Page> {
  const two = await openSecondWindow(launched)
  await expect(two.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
  await canvasReady({ window: two })
  return two
}

/** The live Session Node `nodeId` in a window (a new Session has its SDK id only after its first turn). */
const liveNode = (window: Page, nodeId: string): Locator => window.locator(`[data-testid="session-node"][data-live="true"][data-node-id="${nodeId}"]`)

/** "New session" in the sidebar of `window`: the Node id of the new live Session Node once it is idle. */
async function newSession(window: Page): Promise<string> {
  const live = window.locator('[data-testid="session-node"][data-live="true"]')
  await window.getByTestId('sidebar-new-session').click()
  await expect(live).toHaveCount(1)
  await expect(live.getByTestId('session-node-status')).toHaveText('idle')
  const id = await live.getAttribute('data-node-id')
  if (id === null) throw new Error('the new Session Node has no Node id')
  return id
}

/** Opens the Session view of a live Session Node with a double click on it. */
async function openView(window: Page, node: Locator): Promise<Locator> {
  await node.dispatchEvent('dblclick')
  const view = window.locator('[data-testid="session-view"]:not([data-read-only])')
  await expect(view).toBeVisible()
  return view
}

/** Writes a message into a Session view and sends it with Enter. */
async function write(view: Locator, text: string): Promise<void> {
  const field = view.getByTestId('message-input-box').locator('textarea')
  await field.fill(text)
  await field.press('Enter')
}

/** The prompts and answers a Session view shows, in order. */
async function shown(view: Locator): Promise<{ prompts: string[]; answers: string[] }> {
  return {
    // The body of each row: the label column also holds the row's time (worfy-daily ticket 14).
    prompts: (await view.getByTestId('transcript-prompt').locator('.w-tr__body').allInnerTexts()).map((text) => text.trim()),
    answers: (await view.getByTestId('transcript-text').locator('.w-tr__body').allInnerTexts()).map((text) => text.trim()),
  }
}

/** Closes the window the app opened first, as a person closes it; resolves once one window is left. */
async function closeFirstWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    windows.find((each) => each.id === Math.min(...windows.map((window) => window.id)))?.close()
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
}

const invoke = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(({ channel, input }) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(channel, input), { channel, input })

/** Starts recording the `agent.event` envelopes the window hears. */
const listen = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const page = globalThis as unknown as Heard & { worfy: Bridge }
    page.__agentEvents = []
    page.worfy.on('agent.event', (payload) => page.__agentEvents?.push(payload as Envelope))
  })

/** The types of the events of Session `id` the window heard since `listen`. */
const heard = (window: Page, id: string): Promise<string[]> =>
  window.evaluate((sessionId) => ((globalThis as unknown as Heard).__agentEvents ?? []).filter((each) => each.sessionId === sessionId).map((each) => each.event.type), id)

test('a Session of agent.start sends its events to every window and outlives the window that started it', async () => {
  const launched = await launch('turn')
  try {
    const { app, window: one } = launched
    await canvasReady(launched, { size: SIZE })
    const two = await twoWindows(launched)
    for (const window of [one, two]) await listen(window)

    const started = await invoke(one, 'agent.start', { cwd: projectPath })
    if (!started.ok) throw new Error(started.error)
    const id = (started.value as { sessionId: string }).sessionId
    expect(await invoke(one, 'agent.send', { sessionId: id, text: 'from window one' })).toMatchObject({ ok: true })
    for (const window of [one, two]) await expect.poll(() => heard(window, id)).toContain('result')

    // Window 1 closes: the Session stays listed and answers a message from window 2.
    await closeFirstWindow(app)
    const listed = (await invoke(two, 'agent.list')).value as { sessionId: string; state: string }[]
    expect(listed.find((each) => each.sessionId === id)).toMatchObject({ state: 'idle' })
    expect(await invoke(two, 'agent.send', { sessionId: id, text: 'from window two' })).toMatchObject({ ok: true })
    await expect.poll(async () => (await heard(two, id)).filter((type) => type === 'result')).toHaveLength(2)
    expect(messages()).toEqual(['from window one', 'from window two'])
    expect(await invoke(two, 'agent.close', { sessionId: id })).toMatchObject({ ok: true })
  } finally {
    await launched.close()
  }
})

test('a Session started in window 1 answers in both windows, outlives window 1 and takes messages from window 2', async () => {
  const launched = await launch('turn')
  try {
    const { app, window: one } = launched
    await canvasReady(launched, { size: SIZE })
    const id = await newSession(one)
    const two = await twoWindows(launched)
    await expect(liveNode(two, id).getByTestId('session-node-status')).toHaveText('idle')

    // A message from window 1: its answer shows in the Session Node of both windows.
    await liveNode(one, id).getByTestId('session-node-input').fill('from window one')
    await liveNode(one, id).getByTestId('session-node-input').press('Enter')
    await expect(liveNode(one, id).getByTestId('session-node-answer')).toHaveText(FAKE_ANSWER)
    await expect(liveNode(two, id).getByTestId('session-node-answer')).toHaveText(FAKE_ANSWER)
    await expect(liveNode(two, id).getByTestId('session-node-status')).toHaveText('idle')

    // Window 1 closes: the Session is not finished in window 2, and a message from there is answered.
    await closeFirstWindow(app)
    await expect(liveNode(two, id).getByTestId('session-node-status')).toHaveText('idle')
    await expect(liveNode(two, id).getByTestId('session-node-resume')).toHaveCount(0)
    const view = await openView(two, liveNode(two, id))
    await write(view, 'from window two')
    // Window 2 heard the turn from window 1 live as well: both turns, each once.
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(2)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    expect(await shown(view)).toEqual({ prompts: ['from window one', 'from window two'], answers: [FAKE_ANSWER, FAKE_ANSWER] })
    expect(messages()).toEqual(['from window one', 'from window two'])
    await expect(liveNode(two, id).getByTestId('session-node-status')).not.toHaveText('finished')
  } finally {
    await launched.close()
  }
})

test('a Session resumed in window 1 shows window 2 its past turns, then the live turn from window 1, each once', async () => {
  const past: Turn[] = [
    { prompt: 'First question', answer: 'First answer', messageId: 'msg_past_1' },
    { prompt: 'Second question', answer: 'Second answer', messageId: 'msg_past_2' },
  ]
  mkdirSync(transcriptDir(projectPath), { recursive: true })
  writeFileSync(transcriptFile(PAST), turnLines(PAST, past, 'cli'))

  /** The live Session Node of the resumed Session: its SDK id is the transcript's from the start. */
  const resumed = (window: Page): Locator => window.locator(`[data-testid="session-node"][data-live="true"][data-session-id="${PAST}"]`)
  const launched = await launch('turn')
  try {
    const { window: one } = launched
    await canvasReady(launched, { size: SIZE })

    // Resume from the history of window 1.
    await one.getByTestId('sidebar-history').click()
    const row = one.getByTestId('history-popover').locator(`[data-testid="history-session"][data-session-id="${PAST}"]`)
    await row.getByTestId('history-resume').click()
    await expect(resumed(one).getByTestId('session-node-status')).toHaveText('idle')

    // Window 2, opened afterwards: the turns before Resume, from the transcript, once.
    const two = await twoWindows(launched)
    await expect(resumed(two).getByTestId('session-node-answer')).toHaveText('Second answer')
    const seen = await openView(two, resumed(two))
    await expect(seen.getByTestId('transcript-prompt')).toHaveCount(2)
    expect(await shown(seen)).toEqual({ prompts: ['First question', 'Second question'], answers: ['First answer', 'Second answer'] })

    // A turn written in window 1 reaches window 2 live, after the past turns and once.
    const mine = await openView(one, resumed(one))
    await write(mine, 'go on')
    await expect(seen.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(seen.getByTestId('transcript-text')).toHaveCount(3)
    const expected = { prompts: ['First question', 'Second question', 'go on'], answers: ['First answer', 'Second answer', FAKE_ANSWER] }
    expect(await shown(seen)).toEqual(expected)
    expect(await shown(mine)).toEqual(expected)

    // Claude Code writes the new turn into the transcript too: window 2 reads it and still shows it once.
    appendFileSync(transcriptFile(PAST), turnLines(PAST, [{ prompt: 'go on', answer: FAKE_ANSWER, messageId: FAKE_MESSAGE_ID }], 'sdk-ts'))
    await expect(seen).toHaveAttribute('data-transcript-events', '6')
    expect(await shown(seen)).toEqual(expected)
    await expect(seen.getByTestId('transcript-turn-done')).toHaveCount(1)
  } finally {
    await launched.close()
  }
})

/** Lets one held turn of test/fixtures/agent-scripts/long-turn.jsonl end (FakeReleases in src/main/agent/fake-query.ts). */
const releaseTurn = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('turn'))

test('messages from two windows during a turn wait in one queue, in the order they came, and go by themselves in that order', async () => {
  // test/fixtures/agent-scripts/long-turn.jsonl: every turn holds until the test releases it,
  // then ends with its result.
  const launched = await launch('long-turn')
  try {
    const { app, window: one } = launched
    await canvasReady(launched, { size: SIZE })
    const id = await newSession(one)
    const two = await twoWindows(launched)
    const views = [await openView(one, liveNode(one, id)), await openView(two, liveNode(two, id))] as const
    const [inOne, inTwo] = views

    // The turn holds; window 1, then window 2 write meanwhile.
    await write(inOne, 'hold')
    for (const view of views) await expect(view.getByTestId('session-state')).toHaveText('busy')
    await write(inOne, 'queued from window one')
    await expect(inTwo.getByTestId('queue-chip')).toHaveText('1 queued')
    await write(inTwo, 'queued from window two')

    // Both windows show one queue, in the order the messages came; none of them reached Claude Code.
    for (const view of views) {
      await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')
      await view.getByTestId('queue-chip').click()
      await expect(view.getByTestId('queue-item')).toHaveCount(2)
      await expect(view.getByTestId('queue-item').nth(0)).toContainText('queued from window one')
      await expect(view.getByTestId('queue-item').nth(1)).toContainText('queued from window two')
    }
    expect(messages()).toEqual(['hold'])

    // The turn ends: main takes the next queued message after its result by itself, one per turn.
    await releaseTurn(app)
    await expect.poll(messages).toEqual(['hold', 'queued from window one'])
    for (const view of views) await expect(view.getByTestId('queue-chip')).toHaveText('1 queued')
    await releaseTurn(app)
    const sent = ['hold', 'queued from window one', 'queued from window two']
    await expect.poll(messages).toEqual(sent)
    for (const view of views) await expect(view.getByTestId('queue-chip')).toHaveCount(0)
    await releaseTurn(app)
    for (const view of views) {
      await expect(view.getByTestId('session-state')).toHaveText('idle')
      await expect(view.getByTestId('transcript-turn-done')).toHaveCount(3)
      // Each prompt once, in the order sent, the text of one never mixed into another.
      expect(await shown(view)).toEqual({ prompts: sent, answers: [FAKE_ANSWER, FAKE_ANSWER, FAKE_ANSWER] })
    }
  } finally {
    await launched.close()
  }
})
