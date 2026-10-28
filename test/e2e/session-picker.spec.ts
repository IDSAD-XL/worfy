import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Session view's choice of Session (worfy-polish ticket 44), against the built app: a temporary
// WORFY_CLAUDE_HOME stands in for ~/.claude, and two `sleep` processes play two Claude Code
// Sessions started in a terminal (as in external-session.spec.ts). The picker in the Session view's
// header switches between the Orchestrator and them; a row of the sidebar opens its Session in the
// Session view when that is shown; the Session tab comes back to the last Session of the Project.
// With WORFY_EVIDENCE_DIR set, the shots of the picker are copied there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const FIRST = 'e0000000-0000-4000-8000-00000000f001'
const SECOND = 'e0000000-0000-4000-8000-00000000f002'
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR
/** The window is vibrant on macOS: under a screenshot its backdrop is transparent, so the sidebar colour stands in. */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

const line = (record: Record<string, unknown>): string => `${JSON.stringify({ isSidechain: false, timestamp: '2026-10-27T10:00:00.000Z', cwd: projectPath, ...record })}\n`

/** A Claude Code Session started in a terminal in the Project: its transcript, a process that runs, its registry entry. */
function terminalSession(sessionId: string, name: string, text: string): void {
  mkdirSync(transcriptDir(projectPath), { recursive: true })
  writeFileSync(
    join(transcriptDir(projectPath), `${sessionId}.jsonl`),
    line({ type: 'user', uuid: `${sessionId}-u`, sessionId, message: { role: 'user', content: text } }) +
      line({ type: 'assistant', uuid: `${sessionId}-a`, sessionId, message: { id: `msg_${sessionId}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: `On it: ${text}` }] } }),
  )
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(child)
  writeFileSync(
    join(claudeHome, 'sessions', `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name }),
  )
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

/** Shots of the Session view's header, the list open or not, in both themes: <test output>/session-picker-<state>-<scheme>.png. */
async function shoot(window: Page, area: Locator, state: string): Promise<void> {
  const box = await area.boundingBox()
  if (box === null) throw new Error('the Session view is not on screen')
  // The header and, under it, room for the open list.
  const clip = { x: box.x, y: box.y, width: Math.min(box.width, 900), height: 260 }
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = test.info().outputPath(`session-picker-${state}-${scheme}.png`)
      await window.screenshot({ path, clip, animations: 'disabled', style: VIBRANCY_BACKDROP })
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `44-session-picker-${state}-${scheme}.png`))
      }
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-picker-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  await removeDir(scratch)
})

test('the Session picker switches the Session view, a sidebar row opens its Session there, and the Session tab comes back to it', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    terminalSession(FIRST, 'fix-flaky-test', 'Fix the flaky test')
    terminalSession(SECOND, 'release-notes', 'Write the release notes')
    await expect(window.locator('[data-testid="session-node"]')).toHaveCount(2, { timeout: 10_000 })

    // The Session tab shows the Orchestrator: nothing was opened in this Project yet.
    const canvasView = window.locator('.w-shell__view[data-view="canvas"]')
    const sessionView = window.locator('.w-shell__view[data-view="session"]')
    const tabs = window.getByRole('group', { name: 'View', exact: true })
    await tabs.getByRole('button', { name: 'Session' }).click()
    await expect(sessionView).toBeVisible()
    const view = sessionView.getByTestId('session-view')
    const orchestratorNode = await window.getByTestId('orchestrator-node').getAttribute('data-node-id')
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode ?? '')

    // The picker lists the Orchestrator first, then the two running Sessions, each with its status.
    const picker = view.getByTestId('session-picker')
    await expect(picker).toHaveText(/Orchestrator/)
    await shoot(window, sessionView, 'closed')
    await picker.click()
    const list = window.getByTestId('session-picker-list')
    const options = list.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('Orchestrator')
    await expect(options.filter({ hasText: 'fix-flaky-test' })).toContainText('busy')
    await expect(options.filter({ hasText: 'release-notes' })).toContainText('busy')
    await shoot(window, sessionView, 'open')

    // A pick shows that Session at once, read-only: worfy does not run it.
    await options.filter({ hasText: 'fix-flaky-test' }).click()
    await expect(list).toBeHidden()
    await expect(view).toHaveAttribute('data-session-id', FIRST)
    await expect(view.getByTestId('session-read-only')).toHaveText('Read-only: started in terminal')
    await expect(view.getByTestId('transcript-prompt').locator('.w-tr__prompt')).toHaveText('Fix the flaky test')
    await expect(picker).toHaveText(/fix-flaky-test/)

    // A row of the sidebar, with the Session view shown, opens its Session there: the Canvas stays hidden.
    await window.locator(`[data-testid="sidebar-session"][data-session-id="${SECOND}"]`).click()
    await expect(view).toHaveAttribute('data-session-id', SECOND)
    await expect(view.getByTestId('transcript-prompt').locator('.w-tr__prompt')).toHaveText('Write the release notes')
    await expect(canvasView).toBeHidden()

    // On the Canvas and back: the Session tab shows the last Session of the Project.
    await tabs.getByRole('button', { name: 'Canvas' }).click()
    await expect(canvasView).toBeVisible()
    await tabs.getByRole('button', { name: 'Session' }).click()
    await expect(view).toHaveAttribute('data-session-id', SECOND)

    // The picker goes back to the Orchestrator too.
    await picker.click()
    await options.filter({ hasText: 'Orchestrator' }).click()
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode ?? '')
  } finally {
    await launched.close()
  }
})
