import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { catScript } from '../harness-node'

// The Autopilot command typed in a chat (worfy-flight-recorder ticket 22, ADR-0091) in the built app
// on the fake agent, which records every message it gets (WORFY_AGENT_LOG) and never calls the
// model. `/worfy:epic-wave tickets 01 of epic demo`, typed in the Orchestrator's Session view or in
// the chat of a Session Node on the Canvas, does not reach the agent: it starts the same run as the
// Autopilot button (its status line on the Epic frame, the Wave of the named Ticket sent to the
// Orchestrator), and a toast says so. A second command while the run goes on is refused with the
// hint, in a toast, and nothing more is sent. The Orchestrator plays `orchestrator`, whose first turn
// holds until it is interrupted: the run stays in Wave 1 until Force stop.
//
// The Project is a git repository in a temporary folder with the Epic `demo`: 01 and 02 ready, 03
// after both.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const START = `/worfy:epic-wave tickets 01 of epic ${EPIC}`
const STARTED = `Autopilot started on Epic ${EPIC}`
const RUNNING = `Autopilot is already running Epic ${EPIC}. Stop it first.`
// The Wave the run sends for the one named Ticket, in the bundled template's words.
const WAVE_OF_01 = `/epic-wave Ticket-ы 01 эпика ${EPIC}`

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS = [
  { num: 1, blocked: [] as number[] },
  { num: 2, blocked: [] as number[] },
  { num: 3, blocked: [1, 2] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function ticketFile({ num, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

/** The messages the fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/** The kinds of the lines of every run journal in the data folder, journal by journal. */
function journals(dataDir: string): string[][] {
  const dir = join(dataDir, 'autopilot')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((file) =>
      readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { kind: string }).kind),
    )
}

/**
 * The Project in a temporary folder: a git repository with the Epic, an epic-status that answers its
 * Tickets, and worfy's data folder with the Project.
 */
function prepare() {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'demo')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-ticket-${ticket.num}.md`), ticketFile(ticket))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, blocked }) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))

  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log }
  return { dataDir, log, env }
}

/** The toast, then `around` with the toast on it, in both themes; kept with the test's output for the review. */
async function snapshots(window: Page, toast: Locator, around: Locator, name: string): Promise<void> {
  // The pointer on the toast holds it past its time (toasts.ts, holdToast).
  await toast.hover()
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await toast.screenshot({ path: test.info().outputPath(`22-${name}-toast-${scheme}.png`) })
    await around.screenshot({ path: test.info().outputPath(`22-${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** Chooses Force stop under "⋯" of the frame, and waits for the run's end. */
async function forceStop(window: Page, frame: Locator): Promise<void> {
  await frame.getByTestId('action-autopilot-more').click()
  await window.getByTestId('action-force-stop-autopilot').click()
  await expect(frame.getByTestId('autopilot-status')).toHaveText('stopped: user force stop')
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-autopilot-chat-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('the command typed in the Session view starts Autopilot over the named Ticket; a second one is refused', async () => {
  const { dataDir, log, env } = prepare()
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const status = frame.getByTestId('autopilot-status')
    const toast = window.getByTestId('autopilot-chat-toast')
    await expect(frame.getByTestId('action-autopilot')).toBeVisible()
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')

    // The Orchestrator's Session view: the command goes in as any message would.
    await window.getByTestId('orchestrator-node').locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill(START)
    await field.press('Enter')
    await expect(toast).toHaveText(STARTED)
    await expect(toast).toHaveAttribute('data-kind', 'success')
    await expect(field).toHaveValue('')
    // Not the command but the Wave of the named Ticket reaches the Orchestrator: the run's own.
    await expect.poll(() => messages(log)).toEqual([WAVE_OF_01])
    await snapshots(window, toast, view, 'session-view-started')

    // A second command while the run goes on: refused with the hint; nothing more is sent, no second journal.
    await field.fill(`/worfy:epic-wave tickets 02 of epic ${EPIC}`)
    await field.press('Enter')
    await expect(toast).toHaveText(RUNNING)
    await expect(toast).toHaveAttribute('data-kind', 'error')
    await snapshots(window, toast, view, 'session-view-refused')
    expect(messages(log)).toEqual([WAVE_OF_01])
    expect(journals(dataDir)).toEqual([['run-started', 'wave-started']])

    // The status line on the Epic frame, as after the button.
    await window.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(status).toHaveText('Wave 1 · running')
    await expect(frame.getByTestId('action-stop-autopilot')).toHaveText('Stop autopilot')
    await forceStop(window, frame)
  } finally {
    await launched.close()
  }
})

test('the command typed in the chat of a Session Node starts Autopilot; a second one is refused', async () => {
  const { dataDir, log, env } = prepare()
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const status = frame.getByTestId('autopilot-status')
    const toast = window.getByTestId('autopilot-chat-toast')
    await expect(frame.getByTestId('action-autopilot')).toBeVisible()
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')

    await window.getByTestId('sidebar-new-session').click()
    const node = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(node.getByTestId('session-node-status')).toHaveText('idle')
    const input = node.getByTestId('session-node-input')
    await input.fill(START)
    await input.press('Enter')
    await expect(toast).toHaveText(STARTED)
    await expect(status).toHaveText('Wave 1 · running')
    await expect(input).toHaveValue('')
    await expect.poll(() => messages(log)).toEqual([WAVE_OF_01])
    // The Session of the Node got nothing: its status never left idle, and no answer came.
    await expect(node.getByTestId('session-node-status')).toHaveText('idle')

    await input.fill(`/worfy:epic-wave epic ${EPIC}`)
    await input.press('Enter')
    await expect(toast).toHaveText(RUNNING)
    await expect(node.getByTestId('session-node-error')).toHaveCount(0)
    expect(messages(log)).toEqual([WAVE_OF_01])
    expect(journals(dataDir)).toEqual([['run-started', 'wave-started']])
    await forceStop(window, frame)
  } finally {
    await launched.close()
  }
})
