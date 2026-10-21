import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'

// The way back from a Subagent's window, and "Go to Orchestrator" in the palette (worfy-polish
// ticket 25), against the built app. The Orchestrator on the fake agent
// (test/fixtures/agent-scripts/subagents.jsonl) starts impl-09, which starts a nested scout; the
// test writes their transcript files under a temporary WORFY_CLAUDE_HOME the way Claude Code does,
// so their rows in the rail and their Nodes on the Canvas can be opened. Then: the rail → impl-09 →
// the arrow → the Orchestrator's Session view; the rail → the scout → the arrow → impl-09; the
// Canvas → impl-09 → ⌘[ → the Orchestrator; and the palette's "Go to Orchestrator" from a
// Subagent's window. Screenshots of the header and of the palette in both themes; with
// WORFY_EVIDENCE_DIR they are copied there as the ticket's evidence.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const IMPL = 'afake00000000impl'
const SCOUT = 'afake0000000scout'
/** Where the screenshots go when the run asks for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

/** The transcript and meta files of one Subagent of `sessionId`, as Claude Code writes them. */
function writeSubagent(sessionId: string, agentId: string, meta: Record<string, unknown>, text: string): void {
  const dir = join(transcriptDir(projectPath), sessionId, 'subagents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta))
  const record = {
    type: 'assistant',
    isSidechain: true,
    agentId,
    sessionId,
    cwd: projectPath,
    version: '2.1.289',
    timestamp: '2026-10-15T10:00:00.000Z',
    message: { model: 'claude-sonnet-5', content: [{ type: 'text', text }], stop_reason: 'tool_use' },
  }
  writeFileSync(join(dir, `agent-${agentId}.jsonl`), `${JSON.stringify(record)}\n`)
}

/**
 * What Claude Code writes for the Orchestrator's Session: its transcript, and its process in the
 * registry (`sessions/<pid>.json`), a `sleep` standing in for the process. Without the registry
 * entry main reads the Session as closed, and its running Subagents as cut off.
 */
function writeSession(sessionId: string): void {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(child)
  writeFileSync(
    join(claudeHome, 'sessions', `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'sdk-ts', status: 'busy', version: '2.1.289' }),
  )
  const record = { type: 'user', isSidechain: false, sessionId, cwd: projectPath, version: '2.1.289', timestamp: '2026-10-15T10:00:00.000Z', message: { role: 'user', content: 'run wave 3' } }
  writeFileSync(join(transcriptDir(projectPath), `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`)
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

async function sendToOrchestrator(window: Page, text: string): Promise<void> {
  await window.evaluate(async (message) => {
    const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
    const listed = await bridge.invoke('agent.list')
    const [session] = (listed.value as { sessionId: string }[] | undefined) ?? []
    if (!session) throw new Error('no Session runs')
    const sent = await bridge.invoke('agent.send', { sessionId: session.sessionId, text: message })
    if (!sent.ok) throw new Error(sent.error)
  }, text)
}

/** Both themes of the window under test-results/e2e; with WORFY_EVIDENCE_DIR also as `25-<name>-<theme>.png` there. */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `25-${name}`)
  if (EVIDENCE_DIR === undefined) return
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  copyFileSync(shots.light, join(EVIDENCE_DIR, `25-${name}-light.png`))
  copyFileSync(shots.dark, join(EVIDENCE_DIR, `25-${name}-dark.png`))
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-back-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  await removeDir(scratch)
})

test('a Subagent window leads back to its parent, and the palette goes to the Orchestrator', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'subagents' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await expect.poll(() => window.evaluate(async () => ((await (globalThis as unknown as { worfy: Bridge }).worfy.invoke('agent.list')).value as unknown[]).length)).toBe(1)
    await sendToOrchestrator(window, 'run wave 3')
    await expect(window.locator(`[data-testid="subagent-node"][data-subagent-id="${IMPL}"]`)).toHaveAttribute('data-status', 'running')

    // The Orchestrator's Session view: its Node and the SDK session its Subagents belong to.
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Session' }).click()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toHaveAttribute('data-session-id', /.+/)
    const orchestratorNode = await view.getAttribute('data-node-id')
    const sessionId = await view.getAttribute('data-session-id')
    expect(orchestratorNode).not.toBeNull()
    writeSubagent(sessionId!, IMPL, { agentType: 'implementer', name: 'impl-09', toolUseId: 'toolu_fake_impl', spawnDepth: 1, requestShape: 'background' }, 'Implementing 09.')
    writeSubagent(sessionId!, SCOUT, { agentType: 'scout', toolUseId: 'toolu_fake_scout', parentAgentId: IMPL, spawnDepth: 2, requestShape: 'background' }, 'Scouting.')
    writeSession(sessionId!)

    const rail = view.getByTestId('subagents-rail')
    const row = (agentId: string) => rail.locator(`[data-testid="subagents-rail-row"][data-subagent-id="${agentId}"]`)
    await expect(row(IMPL)).toBeEnabled({ timeout: 10_000 })
    await expect(row(SCOUT)).toBeEnabled({ timeout: 10_000 })

    // Orchestrator → impl-09 from the rail → the arrow → the Orchestrator's Session view.
    await row(IMPL).click()
    await expect(view).toHaveAttribute('data-agent-id', IMPL)
    const back = view.getByTestId('session-back')
    await expect(back).toHaveAttribute('aria-label', /^Back to /)
    await expect(back).not.toHaveAttribute('aria-label', /Subagent/)
    await expect(view.getByTestId('session-source-session')).toBeVisible()
    await evidence(window, 'subagent-from-rail')
    await back.click()
    await expect(view).not.toHaveAttribute('data-agent-id', /.*/)
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode!)
    await expect(view.getByRole('heading', { level: 1 })).toHaveText(/^Orchestrator/)
    await expect(view.getByRole('textbox')).toHaveCount(1)

    // The nested scout → the arrow → impl-09's window; its "of <Session>" link → the Orchestrator.
    await row(SCOUT).click()
    await expect(view).toHaveAttribute('data-agent-id', SCOUT)
    await expect(view.getByTestId('session-back')).toHaveAttribute('aria-label', 'Back to Subagent impl-09')
    await view.getByTestId('session-back').click()
    await expect(view).toHaveAttribute('data-agent-id', IMPL)
    await view.getByTestId('session-source-session').click()
    await expect(view).not.toHaveAttribute('data-agent-id', /.*/)
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode!)

    // From the Canvas: the Subagent's Node opens its window; ⌘[ leads to its parent, not to the Canvas.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await window.locator(`[data-testid="subagent-node"][data-subagent-id="${IMPL}"]`).getByTestId('subagent-open').click()
    await expect(view).toBeVisible()
    await expect(view).toHaveAttribute('data-agent-id', IMPL)
    await evidence(window, 'subagent-from-canvas')
    await window.keyboard.press('ControlOrMeta+BracketLeft')
    await expect(view).not.toHaveAttribute('data-agent-id', /.*/)
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode!)

    // The palette's "Go to Orchestrator" from a Subagent's window.
    await row(SCOUT).click()
    await expect(view).toHaveAttribute('data-agent-id', SCOUT)
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await window.getByTestId('palette-input').fill('go to orchestrator')
    const option = palette.locator('[data-testid="palette-option"][data-command="go-to:orchestrator"]')
    await expect(option).toHaveAttribute('data-active', 'true')
    await expect(option).toContainText('Orchestrator')
    await expect(option).toContainText('Session view')
    await evidence(window, 'palette-go-to-orchestrator')
    await window.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(view).not.toHaveAttribute('data-agent-id', /.*/)
    await expect(view).toHaveAttribute('data-node-id', orchestratorNode!)
  } finally {
    await launched.close()
  }
})
