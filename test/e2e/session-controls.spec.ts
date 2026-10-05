import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The input field's pickers and message queue (ticket 19) against the built app, on the fake agent
// with the script test/fixtures/agent-scripts/session-view.jsonl: turn 1 answers at once, turn 2
// holds until it is interrupted, then the script starts over. WORFY_AGENT_LOG makes the fake agent
// write down what it was asked to do: the settings each Claude Code process started with, the
// control calls, and each user message at the moment it reached Claude Code.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Call = { kind: string; text?: string; model?: string | null; mode?: string; settings?: Record<string, unknown>; resume?: string | null }

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-controls-')))
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

const calls = (): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
    : []
const messages = () => calls().flatMap((call) => (call.kind === 'message' ? [call.text] : []))
const controls = () => calls().filter((call) => call.kind !== 'message' && call.kind !== 'start')

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

test('the pickers change the live Session and survive a restart; the queue sends one message per turn', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: log }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const model = view.getByTestId('picker-model')
    const effort = view.getByTestId('picker-effort')
    const mode = view.getByTestId('picker-permissions')
    await expect(model.locator('option')).toHaveText(['Default (recommended)', 'Opus', 'Sonnet', 'Haiku'])
    await expect(mode).toHaveValue('bypassPermissions')
    await expect(view.getByTestId('session-effort')).toHaveText('—')

    // The picks reach the live Claude Code as control calls, without a restart.
    await model.selectOption({ label: 'Sonnet' })
    await expect(model).toHaveValue('sonnet')
    await expect(effort.locator('option')).toHaveText(['effort default', 'effort low', 'effort medium', 'effort high', 'effort max'])
    await effort.selectOption('low')
    await mode.selectOption({ label: 'Plan only' })
    await expect(mode).toHaveValue('plan')
    await expect(view.getByTestId('session-effort')).toHaveText('low')
    await expect.poll(controls).toEqual([
      { kind: 'setModel', model: 'sonnet' },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'low' } },
      { kind: 'setPermissionMode', mode: 'plan' },
    ])
    expect(calls().filter((call) => call.kind === 'start')).toHaveLength(1)

    // The next turn runs with them: its system/init reports the model and the mode.
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-model')).toHaveText('sonnet')
    await expect(view.getByTestId('session-permissions')).toHaveText('plan')

    // Turn 2 holds; three messages written meanwhile wait in the queue, not in Claude Code.
    await field.fill('hold')
    await field.press('Enter')
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByText('Return to queue')).toBeVisible()
    for (const text of ['queued one', 'queued two', 'queued three']) {
      await field.fill(text)
      await field.press('Enter')
    }
    await expect(view.getByTestId('queue-chip')).toHaveText('3 queued')
    await expect.poll(messages).toEqual(['first', 'hold'])
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    // One is removed before it is sent.
    await view.getByTestId('queue-chip').click()
    await expect(view.getByTestId('queue-item')).toHaveCount(3)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-queue-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await view.getByRole('button', { name: 'Remove queued message 2' }).click()
    await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')

    // Interrupt stops the turn and holds the queue: nothing goes by itself.
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('queue-send')).toBeVisible()
    await window.waitForTimeout(500)
    expect(messages()).toEqual(['first', 'hold'])
    await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')

    // Send queued: the first goes now (the script's turn 1 answers), the next after its result.
    await view.getByTestId('queue-send').click()
    await expect.poll(messages).toEqual(['first', 'hold', 'queued one', 'queued three'])
    await expect(view.getByTestId('queue-chip')).toHaveCount(0)
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByTestId('transcript-prompt')).toHaveText([/first$/, /hold$/, /queued one$/, /queued three$/])
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    expect(messages()).not.toContain('queued two')
  } finally {
    await first.close()
  }

  // After a restart the Orchestrator starts with the same picks. The fake agent writes no
  // transcript, so the Orchestrator starts a new session here rather than resuming (ADR 0010);
  // that a resume gets the picks too is test/contract/orchestrator.test.ts.
  const second = await launchApp({ env })
  try {
    const view = await openSession(second.window)
    await expect(view.getByTestId('picker-model')).toHaveValue('sonnet')
    await expect(view.getByTestId('picker-effort')).toHaveValue('low')
    await expect(view.getByTestId('picker-permissions')).toHaveValue('plan')
    const starts = calls().filter((call) => call.kind === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ kind: 'start', settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' } })
  } finally {
    await second.close()
  }
})
