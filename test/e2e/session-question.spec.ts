import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// Questions with answer options (worfy-ui ticket 17) against the built app, on the fake agent:
// test/fixtures/agent-scripts/question.jsonl asks one simple question in its first turn and two
// questions (one with previews, one multiSelect) in its second, through the fake agent's `question`
// line — Claude Code's AskUserQuestion, asked in bypassPermissions as the real one does
// (test/contract/ask-user-question-sdk.test.ts). WORFY_AGENT_LOG records what canUseTool answered.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const DATABASE = 'Which database should the cache use?'
const LAYOUT = 'Which layout should the report use?'
const CHECKS = 'Which checks should run first?'

type Call = { kind: string; toolName?: string; result?: { behavior: string; message?: string; updatedInput?: { answers?: Record<string, string> } } }

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-question-')))
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

/** What canUseTool answered for each question, in order. */
const answers = (): Call['result'][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'permission' && call.toolName === 'AskUserQuestion')
        .map((call) => call.result)
    : []

const launch = () => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'question', WORFY_AGENT_LOG: log } })

async function snapshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

async function send(field: Locator, text: string): Promise<void> {
  await field.fill(text)
  await field.press('Enter')
}

test('the Session view asks with a card: keys, Back / Next, previews, multiSelect, Other; the answers reach Claude Code and the transcript', async () => {
  const app = await launch()
  try {
    const { window } = app
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })

    // ── A simple question, answered from the keyboard; no toast for the Session on screen.
    await send(field, 'set up the cache')
    const cards = view.getByTestId('question-card')
    await expect(cards).toHaveCount(1)
    const first = cards.nth(0)
    await expect(first.getByTestId('question-text')).toHaveText(DATABASE)
    await expect(view.getByTestId('permission-card')).toHaveCount(0)
    await expect(window.getByTestId('question-toast')).toHaveCount(0)
    await first.getByTestId('question-option').nth(0).focus()
    await window.keyboard.press('2')
    await expect(first.getByTestId('question-option').nth(1)).toHaveAttribute('aria-checked', 'true')
    await window.keyboard.press('Enter')
    await expect(first).toHaveAttribute('data-resolution', 'answered')
    await expect(first.getByTestId('question-answer-text')).toHaveText('SQLite')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByText('Going with your answer').first()).toBeVisible()
    await expect(view.getByTestId('session-state')).toHaveText('idle')

    // ── Two questions: a preview, then multiSelect with "Other".
    await send(field, 'and the report')
    await expect(cards).toHaveCount(2)
    const second = cards.nth(1)
    await expect(second.getByTestId('question-text')).toHaveText(LAYOUT)
    await second.getByTestId('question-option').nth(0).click()
    await expect(second.getByTestId('question-preview').locator('table')).toBeVisible()
    await second.getByTestId('question-option').nth(0).hover()
    await snapshots(window, 'question-card')
    await expect(second.getByTestId('question-submit')).toBeDisabled()
    await second.getByTestId('question-next').click()
    await expect(second.getByTestId('question-text')).toHaveText(CHECKS)
    await second.getByTestId('question-option').nth(2).click()
    await second.getByTestId('question-option').nth(0).click()
    await second.getByTestId('question-other').fill('Format check')
    await second.getByTestId('question-back').click()
    await expect(second.getByTestId('question-option').nth(0)).toHaveAttribute('aria-checked', 'true')
    await second.getByTestId('question-submit').click()
    await expect(second).toHaveAttribute('data-resolution', 'answered')
    await expect(second.getByTestId('question-answer-text')).toHaveText(['Table', 'Lint, Unit tests, Format check'])
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(2)
    await snapshots(window, 'question-card-answered')

    expect(answers().map((answer) => answer?.updatedInput?.answers)).toEqual([{ [DATABASE]: 'SQLite' }, { [LAYOUT]: 'Table', [CHECKS]: 'Lint, Unit tests, Format check' }])
  } finally {
    await app.close()
  }
})

test('a Session in the background: "Waits for answer" on its Node, a toast answers the question, both go', async () => {
  const app = await launch()
  try {
    const { window } = app
    await canvasReady(app, { size: { width: 1400, height: 900 } })
    await window.getByTestId('sidebar-new-session').click()
    const session = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(session).toHaveCount(1)
    await expect(session.getByTestId('session-node-status')).toHaveText('idle')
    await send(session.getByTestId('session-node-input'), 'set up the cache')

    const badge = session.getByTestId('badge-waits-for-answer')
    await expect(badge).toBeVisible()
    await expect(session.getByTestId('badge-needs-permission')).toHaveCount(0)
    const toast = window.getByTestId('question-toast')
    await expect(toast).toContainText(`Asks: ${DATABASE}`)
    await expect(toast.getByRole('button', { name: 'Postgres' })).toBeVisible()
    await expect(toast.getByRole('button', { name: 'Open' })).toBeVisible()
    await snapshots(window, 'question-toast')

    await toast.getByRole('button', { name: 'SQLite' }).click()
    await expect(toast).toHaveCount(0)
    await expect(badge).toHaveCount(0)
    await expect(session.getByTestId('session-node-answer')).toHaveText('Going with your answer')
    expect(answers().map((answer) => answer?.updatedInput?.answers)).toEqual([{ [DATABASE]: 'SQLite' }])
  } finally {
    await app.close()
  }
})
