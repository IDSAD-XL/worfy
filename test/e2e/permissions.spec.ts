import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// Permission requests (ticket 21) against the built app, on the fake agent: the Orchestrator's
// Session is switched to "Ask before tools" (permissionMode `default`), and the scripts
// test/fixtures/agent-scripts/permission.jsonl (two Bash calls per turn) and
// permission-interrupt.jsonl (one Bash call, then the turn waits for Interrupt) ask before each
// Bash call. WORFY_AGENT_LOG records what canUseTool answered.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Call = { kind: string; toolName?: string; input?: Record<string, unknown>; result?: { behavior: string; message?: string; interrupt?: boolean } }

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-permissions-')))
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

const answers = (): Call['result'][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'permission')
        .map((call) => call.result)
    : []

/** Opens the Orchestrator's Session view and switches it to "Ask before tools". */
async function openAsking(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  await view.getByTestId('picker-permissions').selectOption({ label: 'Ask before tools' })
  await expect(view.getByTestId('picker-permissions')).toHaveValue('default')
  return view
}

async function send(view: Locator, text: string): Promise<void> {
  const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
  await field.fill(text)
  await field.press('Enter')
}

test('a card asks before Bash: Allow lets the call run, Deny tells the model, Always allow covers Bash for the rest of the Session', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'permission', WORFY_AGENT_LOG: log } })
  try {
    const { window } = app
    const view = await openAsking(window)

    await send(view, 'build it')
    const cards = view.getByTestId('permission-card')
    await expect(cards).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('needs permission')
    const first = cards.nth(0)
    await expect(first.getByTestId('permission-tool')).toHaveText('Bash')
    await expect(first.getByTestId('permission-input')).toHaveText('mkdir -p build/one')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`permission-card-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    await first.getByTestId('permission-allow').click()
    await expect(first).toHaveAttribute('data-resolution', 'allow')
    await expect(cards).toHaveCount(2)
    const second = cards.nth(1)
    await expect(second.getByTestId('permission-input')).toHaveText('ls -la build')
    await second.getByTestId('permission-deny').click()
    await expect(second).toHaveAttribute('data-resolution', 'deny')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    expect(answers()).toEqual([
      { behavior: 'allow', updatedInput: { command: 'mkdir -p build/one', description: 'Create the build folder' } },
      { behavior: 'deny', message: 'The user denied this tool call in worfy.' },
    ])

    // "Always allow" on the next turn's first Bash call: its second call, another command, asks nothing.
    await send(view, 'again')
    await expect(cards).toHaveCount(3)
    await cards.nth(2).getByTestId('permission-always-allow').click()
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(2)
    await expect(cards).toHaveCount(3)
    // Nor does the turn after it.
    await send(view, 'third')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(3)
    await expect(cards).toHaveCount(3)
    expect(answers().slice(2).map((answer) => answer?.behavior)).toEqual(['allow', 'allow', 'allow', 'allow'])
  } finally {
    await app.close()
  }
})

test('Interrupt refuses an open request, and the Session goes idle', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'permission-interrupt', WORFY_AGENT_LOG: log } })
  try {
    const { window } = app
    const view = await openAsking(window)
    await send(view, 'clean up')
    const card = view.getByTestId('permission-card')
    await expect(card).toHaveAttribute('data-resolution', 'open')
    await expect(view.getByTestId('session-state')).toHaveText('needs permission')

    await view.getByTestId('session-interrupt').click()
    await expect(card).toHaveAttribute('data-resolution', 'cancelled')
    await expect(card.getByTestId('permission-allow')).toHaveCount(0)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    expect(answers()).toEqual([{ behavior: 'deny', message: expect.stringContaining('cancelled') as unknown as string, interrupt: true }])
  } finally {
    await app.close()
  }
})
