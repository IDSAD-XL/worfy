import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// The turns a Session had before worfy resumed it (worfy-daily ticket 22), against the built app on
// the fake agent: a Session Node resumed over a transcript of two turns shows their last answer at
// once, and its Session view shows both turns, then the new one; once Claude Code has written the
// new turn into the transcript as well, every turn is still there exactly once. The Orchestrator
// shows the turns of its saved Session after a restart of worfy. A temporary WORFY_CLAUDE_HOME
// stands in for ~/.claude; the test writes there what Claude Code would, and checks at the end that
// worfy wrote nothing.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const PAST = 'f0000000-0000-4000-8000-0000000000a1'
/** What the fake agent answers every turn (test/fixtures/agent-scripts/turn.jsonl), and the message id it gives that answer. */
const FAKE_ANSWER = 'Hello from the fake agent'
const FAKE_MESSAGE_ID = 'msg_fake_turn'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type SavedNode = { id: string; kind: string; data: { sessionId?: string | null } }
type Turn = { prompt: string; answer: string; messageId: string }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
const transcriptFile = (sessionId: string): string => join(transcriptDir(projectPath), `${sessionId}.jsonl`)

/** Transcript lines as Claude Code writes them: for each turn the user's prompt, then the answer. */
function turnLines(sessionId: string, turns: readonly Turn[], entrypoint: string): string {
  const record = (extra: Record<string, unknown>) =>
    JSON.stringify({ isSidechain: false, timestamp: '2026-10-05T10:00:00.000Z', cwd: projectPath, sessionId, entrypoint, gitBranch: 'main', ...extra })
  return turns
    .map(
      ({ prompt, answer, messageId }, at) =>
        `${record({ type: 'user', uuid: `${sessionId}-u${at}-${messageId}`, message: { role: 'user', content: prompt } })}\n` +
        `${record({ type: 'assistant', uuid: `${sessionId}-a${at}-${messageId}`, message: { id: messageId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: answer }] } })}\n`,
    )
    .join('')
}

function writeTranscript(sessionId: string, turns: readonly Turn[], entrypoint: string): void {
  mkdirSync(transcriptDir(projectPath), { recursive: true })
  writeFileSync(transcriptFile(sessionId), turnLines(sessionId, turns, entrypoint))
}

/** Every folder and file under the Claude home, each file with its size and modification time. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        out[relative(claudeHome, path)] = 'dir'
        walk(path)
      } else {
        const stats = statSync(path)
        out[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(claudeHome)
  return out
}

/** Records in `expected` a file the test wrote, as Claude Code would have. */
function wrote(expected: Record<string, string>, path: string): void {
  const stats = statSync(path)
  expected[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
}

async function nodes(window: Page): Promise<SavedNode[]> {
  return window.evaluate(async (projectId) => {
    const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
    const result = await bridge.invoke('layout.get', { projectId })
    return (result.value as { layout: { nodes: SavedNode[] } } | undefined)?.layout.nodes ?? []
  }, PROJECT)
}

const orchestratorSessionId = async (window: Page): Promise<string | null | undefined> => (await nodes(window)).find((node) => node.kind === 'orchestrator')?.data.sessionId

/** The prompts and answers the Session view shows, in order. */
async function shown(view: Locator): Promise<{ prompts: string[]; answers: string[] }> {
  return {
    // The body of each row: the label column also holds the row's time (worfy-daily ticket 14).
    prompts: (await view.getByTestId('transcript-prompt').locator('.w-tr__body').allInnerTexts()).map((text) => text.trim()),
    answers: (await view.getByTestId('transcript-text').locator('.w-tr__body').allInnerTexts()).map((text) => text.trim()),
  }
}

async function bothThemes(window: Page, name: string): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme })
    await window.screenshot({ path: test.info().outputPath(`${name}-${colorScheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-resume-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('a resumed Session Node shows its last answer, and its Session view the turns before Resume, each once', async () => {
  const past: Turn[] = [
    { prompt: 'First question', answer: 'First answer', messageId: 'msg_past_1' },
    { prompt: 'Second question', answer: 'Second answer', messageId: 'msg_past_2' },
  ]
  writeTranscript(PAST, past, 'cli')
  const expected = snapshot()

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1400, height: 900 } })

    // Resume from the history: the Node turns live and shows the last answer of the transcript.
    await window.getByTestId('sidebar-history').click()
    const row = window.getByTestId('history-popover').locator(`[data-testid="history-session"][data-session-id="${PAST}"]`)
    await row.getByTestId('history-resume').click()
    const node = window.locator(`[data-testid="session-node"][data-live="true"][data-session-id="${PAST}"]`)
    await expect(node.getByTestId('session-node-status')).toHaveText('idle')
    await expect(node.getByTestId('session-node-answer')).toHaveText('Second answer')

    // The Session view: both turns from before Resume.
    await node.dispatchEvent('dblclick')
    const view = window.locator('[data-testid="session-view"]:not([data-read-only])')
    await expect(view).toBeVisible()
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)
    expect(await shown(view)).toEqual({ prompts: ['First question', 'Second question'], answers: ['First answer', 'Second answer'] })
    await bothThemes(window, 'session-view-after-resume')

    // A new turn: after the turns before Resume.
    await view.getByTestId('message-input-box').locator('textarea').fill('go on')
    await view.getByTestId('message-input-box').locator('textarea').press('Enter')
    await expect(view.getByTestId('transcript-text')).toHaveCount(3)
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    expect(await shown(view)).toEqual({ prompts: ['First question', 'Second question', 'go on'], answers: ['First answer', 'Second answer', FAKE_ANSWER] })
    await expect(node.getByTestId('session-node-answer')).toHaveText(FAKE_ANSWER)

    // Claude Code writes the new turn into the transcript too (the fake agent writes none): the
    // Session view reads it, and still shows the turn once.
    appendFileSync(transcriptFile(PAST), turnLines(PAST, [{ prompt: 'go on', answer: FAKE_ANSWER, messageId: FAKE_MESSAGE_ID }], 'sdk-ts'))
    wrote(expected, transcriptFile(PAST))
    await expect(view).toHaveAttribute('data-transcript-events', '6')
    expect(await shown(view)).toEqual({ prompts: ['First question', 'Second question', 'go on'], answers: ['First answer', 'Second answer', FAKE_ANSWER] })
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
  } finally {
    await launched.close()
  }
  expect(snapshot()).toEqual(expected)
})

test('the Orchestrator shows the turns of its saved Session after a restart of worfy', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' }
  const first = await launchApp({ env })
  let saved: string
  try {
    await canvasReady(first)
    await first.window.evaluate(async (projectId) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const view = (await bridge.invoke('orchestrator.open', { projectId })).value as { sessionId: string }
      const sent = await bridge.invoke('agent.send', { sessionId: view.sessionId, text: 'hello' })
      if (!sent.ok) throw new Error(sent.error)
    }, PROJECT)
    await expect.poll(() => orchestratorSessionId(first.window), { timeout: 10_000 }).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
    saved = (await orchestratorSessionId(first.window)) ?? ''
  } finally {
    await first.close()
  }

  // What Claude Code wrote for that Session, and one more turn after it (e.g. from a terminal).
  writeTranscript(
    saved,
    [
      { prompt: 'hello', answer: FAKE_ANSWER, messageId: 'msg_orchestrator_1' },
      { prompt: 'What is next?', answer: 'Ticket 23', messageId: 'msg_orchestrator_2' },
    ],
    'sdk-ts',
  )
  const expected = snapshot()

  const second = await launchApp({ env })
  try {
    const { window } = second
    await canvasReady(second)
    expect(await orchestratorSessionId(window)).toBe(saved)
    await window.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Session' }).click()
    const view = window.getByTestId('session-view')
    await expect(view).toBeVisible()
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)
    expect(await shown(view)).toEqual({ prompts: ['hello', 'What is next?'], answers: [FAKE_ANSWER, 'Ticket 23'] })
    await bothThemes(window, 'orchestrator-after-restart')
  } finally {
    await second.close()
  }
  expect(snapshot()).toEqual(expected)
})
