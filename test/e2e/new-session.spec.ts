import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// Sessions started from worfy (ticket 18), against the built app on the fake agent: "New session"
// makes a new live Node and two of them answer side by side; "New conversation" sends the
// Orchestrator's Session to the history; the history offers Resume only for a finished Session
// whose folder still exists, and a resumed Session goes on under its own id (the fake agent answers
// with the session id and cwd it was started with, as Claude Code does) in the cwd its transcript
// records. A temporary WORFY_CLAUDE_HOME stands in for ~/.claude; the test writes there what
// Claude Code would, and checks at the end that worfy wrote nothing.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const FINISHED = 'f0000000-0000-4000-8000-0000000000f1'
const RUNNING = 'f0000000-0000-4000-8000-0000000000f2'
const IN_WORKTREE = 'f0000000-0000-4000-8000-0000000000f3'
const GONE = 'f0000000-0000-4000-8000-0000000000f4'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type SavedNode = { id: string; kind: string; data: { sessionId?: string | null; origin?: string } }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

/** A transcript as Claude Code writes it: a prompt and an answer, started in `cwd` from `entrypoint`. */
function transcript(sessionId: string, cwd: string, title: string, entrypoint = 'cli'): void {
  const record = (extra: Record<string, unknown>) =>
    JSON.stringify({ isSidechain: false, timestamp: '2026-10-05T10:00:00.000Z', cwd, sessionId, entrypoint, gitBranch: 'main', ...extra })
  const dir = transcriptDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    `${record({ type: 'user', uuid: `${sessionId}-u`, message: { role: 'user', content: title } })}\n` +
      `${record({ type: 'assistant', uuid: `${sessionId}-a`, message: { id: `msg_${sessionId}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } })}\n`,
  )
}

/** A process that stands for a running Claude Code: the registry checks that its pid runs. */
function claudeProcess(): ChildProcess {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(child)
  return child
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

/** Every file under the Claude home with its size and modification time. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(claudeHome)
  return out
}

async function nodes(window: Page): Promise<SavedNode[]> {
  return window.evaluate(async (projectId) => {
    const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
    const result = await bridge.invoke('layout.get', { projectId })
    return (result.value as { layout: { nodes: SavedNode[] } } | undefined)?.layout.nodes ?? []
  }, PROJECT)
}

const orchestratorSessionId = async (window: Page): Promise<string | null | undefined> => (await nodes(window)).find((node) => node.kind === 'orchestrator')?.data.sessionId

/** Sends a message to the Orchestrator's live Session through the bridge, as its Session view does. */
async function messageOrchestrator(window: Page, text: string): Promise<void> {
  await window.evaluate(
    async ({ projectId, message }) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const view = (await bridge.invoke('orchestrator.open', { projectId })).value as { sessionId: string }
      const sent = await bridge.invoke('agent.send', { sessionId: view.sessionId, text: message })
      if (!sent.ok) throw new Error(sent.error)
    },
    { projectId: PROJECT, message: text },
  )
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-new-session-')))
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

test('New session, New conversation, the history and Resume', async () => {
  const worktree = join(projectPath, '.claude', 'worktrees', '07')
  mkdirSync(worktree, { recursive: true })
  // What Claude Code left before worfy starts: a finished terminal Session, one still running, one
  // started in a worktree, and one whose worktree was removed since.
  transcript(FINISHED, projectPath, 'Fix the flaky test')
  transcript(RUNNING, projectPath, 'Still at it')
  transcript(IN_WORKTREE, worktree, 'Ship ticket 07')
  transcript(GONE, join(projectPath, '.claude', 'worktrees', '09'), 'Ship ticket 09')
  const running = claudeProcess()
  writeFileSync(
    join(claudeHome, 'sessions', `${running.pid}.json`),
    JSON.stringify({ pid: running.pid, sessionId: RUNNING, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289' }),
  )
  const expected = snapshot()

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')

    // ── New session, twice: two live Nodes, two Sessions answering side by side.
    await window.getByTestId('sidebar-new-session').click()
    await expect(live).toHaveCount(1)
    await window.getByTestId('sidebar-new-session').click()
    await expect(live).toHaveCount(2)
    const [first, second] = [live.nth(0), live.nth(1)]
    await expect(first.getByTestId('session-node-title')).toHaveText('New session')
    await expect(first.getByTestId('session-node-source')).toHaveText(`worfy · ${projectPath}`)
    await expect(first.getByTestId('session-node-status')).toHaveText('idle')
    await expect(second.getByTestId('session-node-status')).toHaveText('idle')
    await first.getByTestId('session-node-input').fill('first')
    await first.getByTestId('session-node-input').press('Enter')
    await second.getByTestId('session-node-input').fill('second')
    await second.getByTestId('session-node-input').press('Enter')
    await expect(first.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    await expect(second.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    await expect(first.getByTestId('session-node-status')).toHaveText('idle')
    await expect(second.getByTestId('session-node-status')).toHaveText('idle')
    const ids = [await first.getAttribute('data-session-id'), await second.getAttribute('data-session-id')]
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[0]).not.toBe(ids[1])
    // The Layout keeps identifiers only (ADR-0010).
    // (The running terminal Session has its read-only Node of ticket 14 next to them.)
    const saved = (await nodes(window)).filter((node) => node.kind === 'session' && node.data.origin === 'worfy').map((node) => node.data)
    expect(saved.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)))).toEqual(
      ids
        .map((sessionId) => ({ origin: 'worfy', sessionId }))
        .sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId))),
    )
    await window.screenshot({ path: test.info().outputPath('new-sessions.png') })

    // Close: the Session ends, the Node stays and offers Resume. The Canvas is centered on the
    // second Node: on a smaller screen (CI) the first one's header is under the toolbar.
    await first.getByTestId('session-node-close').dispatchEvent('click')
    await expect(first.getByTestId('session-node-status')).toHaveText('finished')
    await expect(first.getByTestId('session-node-resume')).toBeVisible()

    // ── New conversation of the Orchestrator: its Session goes to the history, a new one takes its place.
    // The Canvas is centered on the last new Session; wheel up (the Canvas pans on scroll) to the Orchestrator.
    const pane = await window.locator('.react-flow__pane').boundingBox()
    if (!pane) throw new Error('no Canvas pane')
    // Over empty Canvas at the left edge: a Node's own scrolling text would take the wheel. Pan in
    // small steps until the button is inside the pane, whatever the size of the screen.
    await window.mouse.move(pane.x + 20, pane.y + pane.height / 2)
    const button = window.getByTestId('orchestrator-new-conversation')
    for (let step = 0; step < 40; step += 1) {
      const box = (await button.count()) > 0 ? await button.boundingBox() : null
      if (box && box.y >= pane.y + 8 && box.y + box.height <= pane.y + pane.height - 8) break
      await window.mouse.wheel(0, box && box.y > pane.y ? 120 : -120)
      await window.waitForTimeout(30)
    }
    await expect(button).toBeInViewport()
    await messageOrchestrator(window, 'hello')
    await expect.poll(() => orchestratorSessionId(window), { timeout: 10_000 }).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
    await expect(window.getByTestId('orchestrator-state')).toHaveText('idle')
    const oldOrchestrator = (await orchestratorSessionId(window)) ?? ''
    // Claude Code wrote the transcript of that Session (the fake agent writes none).
    expect(snapshot()).toEqual(expected)
    transcript(oldOrchestrator, projectPath, 'hello', 'sdk-ts')
    const written = join(transcriptDir(projectPath), `${oldOrchestrator}.jsonl`)
    expected[relative(claudeHome, written)] = `${statSync(written).size}:${statSync(written).mtimeMs}`
    await window.getByTestId('orchestrator-new-conversation').click()
    await expect.poll(() => orchestratorSessionId(window)).toBeNull()
    await expect(window.getByTestId('orchestrator-state')).toHaveText('idle')
    await messageOrchestrator(window, 'again')
    await expect.poll(() => orchestratorSessionId(window), { timeout: 10_000 }).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
    expect(await orchestratorSessionId(window)).not.toBe(oldOrchestrator)

    // ── The history: every Session of the Project, with Resume where the rule allows it.
    await window.getByTestId('sidebar-history').click()
    const popover = window.getByTestId('history-popover')
    await expect(popover).toBeVisible()
    const row = (sessionId: string) => popover.locator(`[data-testid="history-session"][data-session-id="${sessionId}"]`)
    await expect(row(oldOrchestrator)).toBeVisible()
    await expect(row(oldOrchestrator).getByTestId('history-source')).toHaveText('worfy')
    await expect(row(FINISHED)).toContainText('Fix the flaky test')
    await expect(row(FINISHED).getByTestId('history-source')).toHaveText('terminal')
    await expect(row(FINISHED).getByTestId('history-branch')).toHaveText('main')
    await expect(row(FINISHED).getByTestId('history-resume')).toBeEnabled()
    await expect(row(RUNNING).getByTestId('history-resume')).toBeDisabled()
    await expect(row(RUNNING).getByTestId('history-resume-why')).toHaveText('Still running in terminal')
    await expect(row(GONE).getByTestId('history-resume')).toBeDisabled()
    await expect(row(GONE).getByTestId('history-resume-why')).toHaveText('Folder no longer exists')
    await expect(row(IN_WORKTREE).getByTestId('history-resume')).toBeEnabled()
    await window.screenshot({ path: test.info().outputPath('history.png') })

    // Show: a read-only Node of the finished Session.
    await row(FINISHED).getByTestId('history-show').click()
    const finishedNode = window.locator(`[data-testid="session-node"][data-session-id="${FINISHED}"]`)
    await expect(finishedNode.getByTestId('session-node-read-only')).toHaveText('read-only')

    // Resume: the same Node turns live and goes on under the same session id, in the Project root.
    await window.getByTestId('sidebar-history').click()
    await row(FINISHED).getByTestId('history-resume').click()
    await expect(popover).toBeHidden()
    await expect(finishedNode).toHaveAttribute('data-live', 'true')
    await expect(finishedNode.getByTestId('session-node-status')).toHaveText('idle')
    await finishedNode.getByTestId('session-node-input').fill('go on')
    await finishedNode.getByTestId('session-node-input').press('Enter')
    await expect(finishedNode.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    await expect(finishedNode).toHaveAttribute('data-session-id', FINISHED)
    await expect(finishedNode).toHaveAttribute('data-cwd', projectPath)
    expect((await nodes(window)).find((node) => node.id === `session:${FINISHED}`)?.data).toEqual({ origin: 'worfy', sessionId: FINISHED })

    // Resume of a Session started in a worktree: it goes on in that worktree.
    await window.getByTestId('sidebar-history').click()
    await row(IN_WORKTREE).getByTestId('history-resume').click()
    const worktreeNode = window.locator(`[data-testid="session-node"][data-live="true"][data-session-id="${IN_WORKTREE}"]`)
    await expect(worktreeNode).toBeVisible()
    await expect(worktreeNode).toHaveAttribute('data-cwd', worktree)
    await worktreeNode.getByTestId('session-node-input').fill('next')
    await worktreeNode.getByTestId('session-node-input').press('Enter')
    await expect(worktreeNode.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    await expect(worktreeNode).toHaveAttribute('data-session-id', IN_WORKTREE)
    // The cwd Claude Code reported in system/init: the fake agent answers with the one it was started in.
    await expect(worktreeNode).toHaveAttribute('data-cwd', worktree)
    await expect(worktreeNode.getByTestId('session-node-source')).toHaveText(`worfy · ${worktree}`)
    await window.screenshot({ path: test.info().outputPath('resumed.png') })

    // A double click opens the live Session in the Session view, with its input field.
    await worktreeNode.getByTestId('session-node-title').dblclick()
    const sessionView = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(sessionView).toHaveAttribute('data-session-id', IN_WORKTREE)
    await expect(sessionView.locator('.w-session__title')).toHaveText('Session · alpha')
    await expect(sessionView.getByTestId('session-state')).toHaveText('idle')
    await expect(sessionView.getByRole('textbox')).toHaveCount(1)
    await window.getByRole('button', { name: /Canvas/ }).click()

    // A running Session is refused by main too, not only by the disabled button.
    const refused = await window.evaluate(
      async ({ projectId, sessionId }) => {
        const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
        return bridge.invoke('sessions.resume', { projectId, sessionId })
      },
      { projectId: PROJECT, sessionId: RUNNING },
    )
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('Still running in terminal') as unknown })

    // worfy wrote nothing under the Claude home.
    expect(snapshot()).toEqual(expected)
  } finally {
    await launched.close()
  }
})
