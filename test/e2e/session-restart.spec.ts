import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { endApp } from './end-app'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// A Session Node a restart of worfy cut off in a turn (worfy-continuity ticket 05, src/main/agent/continuity.ts),
// against the built app on the fake agent: worfy is killed with SIGKILL while the Session's turn runs (the fake
// agent's `interrupt` script holds it), and started again on the same data folder. Within the hour the Session goes
// on by itself: the agent gets one continuation message, never the original one again, and the Session view shows
// the notice line. When the start comes more than an hour later (the test's clock, WORFY_NOW), the Node shows
// «Interrupted by restart» and Continue, which resumes it with the same message. A temporary WORFY_CLAUDE_HOME
// stands in for ~/.claude: the test writes there the transcript Claude Code would have written.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const FIRST = 'build the feature'
const RESTART = /^worfy restarted at /u

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type LiveRecord = { nodeId: string; state: string; vendorSessionId: string | null }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-restart-')))
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

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  WORFY_DATA_DIR: dataDir,
  WORFY_CLAUDE_HOME: claudeHome,
  WORFY_AGENT_SCRIPT: 'interrupt',
  WORFY_AGENT_LOG: log,
  ...extra,
})

/** The messages the fake agent got, in order. */
const messages = (): string[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { kind: string; text?: string })
        .filter((call) => call.kind === 'message')
        .map((call) => call.text ?? '')
    : []

/** The records of live-sessions.json of the Project (ticket 03). */
function records(): LiveRecord[] {
  const file = join(dataDir, PROJECT, 'live-sessions.json')
  if (!existsSync(file)) return []
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { sessions: LiveRecord[] }).sessions
  } catch {
    return []
  }
}

/** The transcript Claude Code would have written of the cut-off turn: the person's message and the start of an answer. */
function writeTranscript(sessionId: string): void {
  const dir = join(claudeHome, 'projects', projectPath.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const record = (extra: object) => JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), cwd: projectPath, sessionId, entrypoint: 'sdk-ts', gitBranch: 'main', ...extra })
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    `${record({ type: 'user', uuid: `${sessionId}-u0`, message: { role: 'user', content: FIRST } })}\n${record({ type: 'assistant', uuid: `${sessionId}-a0`, message: { id: 'msg_cut', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: '1 2 ' }] } })}\n`,
  )
}

/** The first run: a Session Node whose turn runs, then worfy killed with SIGKILL. Answers the Session's Node and SDK session. */
async function killedInATurn(): Promise<{ nodeId: string; sdk: string }> {
  const first = await launchApp({ env: env() })
  const child = first.app.process()
  let killed = false
  try {
    await canvasReady(first)
    await first.window.evaluate(
      async ({ projectId, text }) => {
        const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
        const made = await bridge.invoke('sessions.new', { projectId })
        if (!made.ok) throw new Error(made.error)
        const sent = await bridge.invoke('agent.send', { sessionId: (made.value as { sessionId: string }).sessionId, text })
        if (!sent.ok) throw new Error(sent.error)
      },
      { projectId: PROJECT, text: FIRST },
    )
    await expect.poll(() => messages(), { timeout: ms(10_000) }).toEqual([FIRST])
    // The record of ticket 03 names the Session in its turn: what the start after the kill reads.
    await expect.poll(() => records().map(({ state, vendorSessionId }) => ({ state, named: vendorSessionId !== null })), { timeout: ms(10_000) }).toEqual([{ state: 'busy', named: true }])
    await endApp(child, await first.app.evaluate(() => process.pid))
    killed = true
  } finally {
    await first.close(killed ? { windowGone: true } : {})
  }
  const [cut] = records()
  return { nodeId: cut?.nodeId ?? '', sdk: cut?.vendorSessionId ?? '' }
}

const nodeOf = (window: Page, sdk: string) => window.locator(`[data-testid="session-node"][data-session-id="${sdk}"]`)

test('a Session Node killed with worfy in a turn goes on after the start with one continuation message', async () => {
  const { sdk } = await killedInATurn()
  writeTranscript(sdk)

  const second = await launchApp({ env: env() })
  try {
    const { window } = second
    await canvasReady(second, { size: { width: 1400, height: 900 } })
    // One continuation message, never the original one again.
    await expect.poll(() => messages(), { timeout: ms(10_000) }).toEqual([FIRST, expect.stringMatching(RESTART)])
    const node = nodeOf(window, sdk)
    await expect(node.getByTestId('session-node-status')).toHaveText('busy')
    await node.dispatchEvent('dblclick')
    const view = window.locator('[data-testid="session-view"]:not([data-read-only])')
    await expect(view.getByTestId('transcript-notice').filter({ hasText: /worfy: restarted at \d{2}:\d{2}, sent "continue"/u })).toHaveCount(1)
    await snapshotThemes(window, 'session-restart-continued')
  } finally {
    await second.close()
  }
  expect(messages().filter((text) => RESTART.test(text))).toHaveLength(1)
})

test('started more than an hour after the kill: «Interrupted by restart», and Continue sends the continuation', async () => {
  const { sdk } = await killedInATurn()
  writeTranscript(sdk)

  // The test's clock: worfy starts again two hours later.
  const second = await launchApp({ env: env({ WORFY_NOW: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }) })
  try {
    const { window } = second
    await canvasReady(second, { size: { width: 1400, height: 900 } })
    const node = nodeOf(window, sdk)
    await expect(node.getByTestId('session-node-status')).toHaveText('Interrupted by restart')
    await expect(node.getByTestId('session-node-status')).toHaveAttribute('title', 'Not continued: it was cut off more than an hour before worfy started again')
    await expect(node.getByTestId('session-node-continue')).toBeVisible()
    expect(messages()).toEqual([FIRST])
    await snapshotThemes(window, 'session-restart-interrupted')

    await node.getByTestId('session-node-continue').click()
    await expect.poll(() => messages(), { timeout: ms(10_000) }).toEqual([FIRST, expect.stringMatching(RESTART)])
    await expect(node.getByTestId('session-node-status')).toHaveText('busy')
    await expect(node.getByTestId('session-node-continue')).toHaveCount(0)
  } finally {
    await second.close()
  }
})
