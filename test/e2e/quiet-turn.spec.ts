import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// A quiet turn of the Orchestrator's Session (worfy-stuck-agents ticket 06) against the built app, on the fake agent
// with test/fixtures/agent-scripts/interrupt.jsonl: each turn says «1 2 » and then stands, sending nothing, until it is
// interrupted. WORFY_QUIET_MARK_MS (src/main/agent/app-registry.ts, quietMarkSeam) puts main's mark at two seconds
// instead of ten minutes, so the turn goes quiet while the test waits: the header's chip reads `busy · quiet N min`
// and the hint line says `No sign of life for N min: …` with Interrupt and Restart. Interrupt ends the turn; on the
// next quiet turn Restart ends it too, the old process is closed, and one new process resumes the same conversation
// (the fake agent's starts in WORFY_AGENT_LOG): the Session stays one, under its id. With WORFY_EVIDENCE_DIR set, the
// shot of the quiet Session view is copied there.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-quiet-turn-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** What each process of the fake agent was started to resume, in start order (src/main/agent/fake-query.ts, FakeCall). */
const starts = (): (string | null)[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { kind: string; resume?: string | null })
        .filter((call) => call.kind === 'start')
        .map((call) => call.resume ?? null)
    : []

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** The live Sessions main runs, as `agent.list` answers. */
async function liveSessions(window: Page): Promise<{ sessionId: string; state: string }[]> {
  const result = (await window.evaluate(() => (globalThis as unknown as { worfy: Bridge }).worfy.invoke('agent.list'))) as { ok: boolean; value?: { sessionId: string; state: string }[] }
  expect(result.ok).toBe(true)
  return result.value ?? []
}

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

async function send(view: Locator, text: string): Promise<void> {
  const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
  await field.fill(text)
  await field.press('Enter')
}

/** The Session view, quiet, as <test output>/quiet-turn/quiet-turn.png; copied to the evidence folder when one is set. */
async function shoot(window: Page): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', 'quiet-turn')
  mkdirSync(folder, { recursive: true })
  const path = join(folder, 'quiet-turn.png')
  await window.screenshot({ path, animations: 'disabled' })
  if (EVIDENCE_DIR !== undefined) {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    copyFileSync(path, join(EVIDENCE_DIR, '06-quiet-turn.png'))
  }
}

const QUIET_CHIP = /^busy · quiet \d+ min$/u
const QUIET_LINE = /^No sign of life for \d+ min: no events, no hook, no output\.$/u

test('a quiet turn shows `busy · quiet N min` and the hint line; Interrupt ends the turn, Restart resumes the same conversation in one new process', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'interrupt', WORFY_AGENT_LOG: log, WORFY_QUIET_MARK_MS: '2000' } })
  try {
    const { window } = app
    const view = await openSession(window)
    const state = view.getByTestId('session-state')
    const line = view.getByTestId('quiet-turn')

    await send(view, 'count')
    await expect(state).toHaveText('busy')
    // No line before the mark.
    await expect(line).toHaveCount(0)
    await expect(state).toHaveText(QUIET_CHIP)
    await expect(line.getByTestId('quiet-turn-text')).toHaveText(QUIET_LINE)
    await expect(line.getByRole('button')).toHaveText(['Interrupt', 'Restart'])
    await shoot(window)

    // Interrupt: the turn ends, the line goes; the process stays.
    await line.getByRole('button', { name: 'Interrupt' }).click()
    await expect(state).toHaveText('idle')
    await expect(line).toHaveCount(0)
    expect(starts()).toEqual([null])
    const [session] = await liveSessions(window)
    expect(session).toBeDefined()

    // The next turn goes quiet too; Restart ends it and resumes the same conversation in one new process.
    await send(view, 'count again')
    await expect(state).toHaveText(QUIET_CHIP)
    await line.getByRole('button', { name: 'Restart' }).click()
    await expect(line).toHaveCount(0)
    await expect.poll(starts).toHaveLength(2)
    await expect(state).toHaveText('idle')
    expect(starts()).toEqual([null, session!.sessionId])
    // One Session on the conversation, under the same id: no second process beside the new one.
    expect(await liveSessions(window)).toEqual([expect.objectContaining({ sessionId: session!.sessionId, state: 'idle' })])
    expect(starts()).toHaveLength(2)
  } finally {
    await app.close()
  }
})
