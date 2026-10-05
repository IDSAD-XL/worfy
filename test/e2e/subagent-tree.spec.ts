import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// The Subagent tree of a Session (ticket 15), against the built app:
// - the Orchestrator on the fake agent (test/fixtures/agent-scripts/subagents.jsonl) starts a
//   background Subagent that starts a nested one, and a later turn brings their task-notifications;
// - a Session started in a terminal, whose transcript and subagents/ folder the test writes the way
//   Claude Code does, from the synthetic Session 7777 (test/fixtures/claude-home/README.md).
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude; worfy must not write there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const S7 = '77777777-7777-4777-8777-777777777777'
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'claude-home', 'projects', '-Users-test-projects-agents')

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

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

/** The Claude home as the test left it; anything else that differs was written by worfy. */
let expected: Record<string, string> = {}

function expectUntouched(): void {
  expect(snapshot(), 'files under WORFY_CLAUDE_HOME that the test did not write').toEqual(expected)
}

function write(path: string, text: string, mode: 'create' | 'append' = 'create'): void {
  expectUntouched()
  mkdirSync(join(path, '..'), { recursive: true })
  if (mode === 'append') appendFileSync(path, text)
  else writeFileSync(path, text)
  const stats = statSync(path)
  expected[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
}

/** A fixture file of Session 7777 as if it had been written in this Project. */
const fixture = (path: string): string => readFileSync(join(FIXTURE, path), 'utf8').replaceAll('/Users/test/projects/agents', projectPath)
const fixtureLines = (path: string): string[] => fixture(path).split('\n').filter((line) => line !== '')

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

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-subagents-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  // Zoomed out: the tree reaches far to the right, and a CI display may be narrower than the window
  // asked for. A Node off the screen is not rendered (onlyRenderVisibleElements) and cannot be clicked.
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.45 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  await removeDir(scratch)
})

test('the Orchestrator starts Subagents: their Nodes appear, run with a ticking time, end, and fold', async () => {
  expected = snapshot()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'subagents' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 900))
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect.poll(() => window.evaluate(async () => ((await (globalThis as unknown as { worfy: Bridge }).worfy.invoke('agent.list')).value as unknown[]).length)).toBe(1)

    // The turn's `task_started` follows the message at once: the Node must be there within 500 ms.
    const impl = window.locator('[data-testid="subagent-node"][data-subagent-id="afake00000000impl"]')
    const sent = Date.now()
    await sendToOrchestrator(window, 'run wave 3')
    await impl.waitFor({ state: 'visible', timeout: 5000 })
    const appeared = Date.now() - sent
    console.info(`[subagent-tree] the Subagent Node appeared ${appeared} ms after the message that starts it`)
    expect(appeared, `the Subagent Node appeared ${appeared} ms after the event`).toBeLessThanOrEqual(500)

    await expect(impl).toHaveAttribute('data-status', 'running')
    await expect(impl.getByTestId('subagent-name')).toHaveText('impl-09')
    await expect(impl.getByTestId('subagent-kind')).toHaveText('implementer · sonnet')
    // The nested Subagent hangs from its parent, to the right of it.
    const scout = window.locator('[data-testid="subagent-node"][data-subagent-id="afake0000000scout"]')
    await expect(scout).toHaveAttribute('data-status', 'running')
    const [implBox, scoutBox, orchestratorBox] = await Promise.all([impl.boundingBox(), scout.boundingBox(), window.getByTestId('orchestrator-node').boundingBox()])
    expect(implBox!.x).toBeGreaterThan(orchestratorBox!.x + orchestratorBox!.width)
    expect(scoutBox!.x).toBeGreaterThan(implBox!.x + implBox!.width)
    await expect(window.locator('.react-flow__edge.w-edge-subagent')).toHaveCount(2)

    // The running time goes on.
    const first = await impl.getByTestId('subagent-status').textContent()
    expect(first).toMatch(/^running \d+s$/)
    await expect(impl.getByTestId('subagent-status')).not.toHaveText(first ?? '', { timeout: 3000 })
    await window.screenshot({ path: test.info().outputPath('subagent-tree-running.png') })

    // The next turn brings both task-notifications: done, and folded into one row under the Orchestrator.
    await sendToOrchestrator(window, 'and now?')
    await expect(impl).toHaveCount(0)
    const fold = window.getByTestId('subagent-fold')
    await expect(fold).toHaveText('1 done')
    await fold.click()
    await expect(impl).toHaveAttribute('data-status', 'done')
    await expect(impl.getByTestId('subagent-status')).toHaveText(/^done \d+s$/)
    // The scout is done too, folded under impl-09.
    await expect(scout).toHaveCount(0)
    await expect(window.getByTestId('subagent-fold')).toHaveCount(2)
    await window.screenshot({ path: test.info().outputPath('subagent-tree-done.png') })

    // The Session rail lists the same tree.
    await window.getByRole('button', { name: /Session/ }).first().click()
    const rail = window.getByTestId('subagents-rail')
    await expect(rail.getByTestId('subagents-rail-row')).toHaveCount(2)
    await expect(rail.locator('[data-subagent-id="afake00000000impl"]')).toHaveAttribute('data-status', 'done')
    await expect(rail.locator('[data-subagent-id="afake0000000scout"]')).toHaveAttribute('data-status', 'done')
    expectUntouched()
  } finally {
    await launched.close()
  }
})

test('a terminal Session with three Subagents: the tree from its files, REJECTED on the reviewer, the transcript read-only', async () => {
  // Session 7777 at 10:02:00: the implementer still runs; its scout and the reviewer are done.
  const dir = transcriptDir(projectPath)
  const main = fixtureLines(`${S7}.jsonl`)
  const notification = main.findIndex((line) => line.includes('<task-notification>'))
  mkdirSync(join(claudeHome, 'projects'), { recursive: true })
  expected = snapshot()
  write(join(dir, `${S7}.jsonl`), `${main.slice(0, notification).join('\n')}\n`)
  const subagents = join(dir, S7, 'subagents')
  for (const name of readdirSync(join(FIXTURE, S7, 'subagents'))) {
    const lines = fixtureLines(join(S7, 'subagents', name))
    // The implementer has not answered yet: its last record comes later.
    const kept = name === 'agent-a3000000000000286.jsonl' ? lines.slice(0, -1) : lines
    write(join(subagents, name), `${kept.join('\n')}\n`)
  }

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 900))
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    const claude = claudeProcess()
    write(
      join(claudeHome, 'sessions', `${claude.pid}.json`),
      JSON.stringify({ pid: claude.pid, sessionId: S7, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave-08' }),
    )
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${S7}"]`)).toBeVisible()

    const impl = window.locator('[data-testid="subagent-node"][data-subagent-id="a3000000000000286"]')
    await expect(impl).toHaveAttribute('data-status', 'running')
    await expect(impl.getByTestId('subagent-name')).toHaveText('impl-08')
    await expect(impl.getByTestId('subagent-kind')).toHaveText('implementer · claude-sonnet-5')
    // The scout is done (folded under impl-08), the reviewer too (folded under the Session).
    await expect(window.getByTestId('subagent-fold')).toHaveCount(2)
    const sessionFold = window.locator('[data-testid="subagent-fold"][data-node-id$="/done:session"]')
    await expect(sessionFold).toHaveText('1 done')
    await expect(window.locator('[data-testid="subagent-fold"][data-node-id$="/done:toolu_01S7AGENT1XXXXXXXXXXXXXX"]')).toHaveText('1 done')
    await sessionFold.click()
    const reviewer = window.locator('[data-testid="subagent-node"][data-subagent-id="a5000000000000286"]')
    await expect(reviewer).toHaveAttribute('data-status', 'done')
    await expect(reviewer.getByTestId('subagent-verdict')).toHaveText('REJECTED')
    await expect(reviewer.getByTestId('subagent-kind')).toHaveText('reviewer · claude-opus-5-5')
    await window.screenshot({ path: test.info().outputPath('subagent-tree-files.png') })

    // A Node moved by hand keeps its place: the offset goes into the Session's subagent-tree Node.
    const before = (await reviewer.boundingBox())!
    await window.mouse.move(before.x + 40, before.y + 12)
    await window.mouse.down()
    await window.mouse.move(before.x + 40, before.y + 212, { steps: 8 })
    await window.mouse.up()
    const offset = () =>
      window.evaluate(
        async ({ projectId, id }) => {
          const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
          const result = await bridge.invoke('layout.get', { projectId })
          const nodes = (result.value as { layout: { nodes: { id: string; kind: string; data: Record<string, unknown> }[] } }).layout.nodes
          const saved = nodes.find((node) => node.id === id)
          return saved ? { kind: saved.kind, offset: saved.data['offset:toolu_01S7AGENT3XXXXXXXXXXXXXX'] ?? null } : null
        },
        { projectId: PROJECT, id: `subagents:${S7}` },
      )
    // React Flow's drag threshold and the zoom make the exact numbers vary; the direction does not.
    await expect.poll(async () => ((await offset())?.offset as { dy?: number } | null)?.dy ?? 0).toBeGreaterThan(200)
    expect((await offset())?.kind).toBe('subagent-tree')
    // After the Layout came back from main the Node stays where it was dropped.
    await window.waitForTimeout(300)
    expect((await reviewer.boundingBox())!.y).toBeGreaterThan(before.y + 100)

    // A click opens the reviewer's own transcript, read-only.
    await reviewer.getByTestId('subagent-open').click()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toHaveAttribute('data-agent-id', 'a5000000000000286')
    await expect(view.getByTestId('session-read-only')).toHaveText('Read-only: Subagent transcript')
    await expect(view.getByTestId('transcript-text').locator('strong')).toHaveText('REJECTED')
    await expect(view.getByRole('textbox')).toHaveCount(0)
    await window.screenshot({ path: test.info().outputPath('subagent-transcript.png') })

    // The implementer answers and its task-notification arrives: done, and it folds with the reviewer.
    await window.getByRole('button', { name: /Canvas/ }).click()
    write(join(subagents, 'agent-a3000000000000286.jsonl'), `${fixtureLines(join(S7, 'subagents', 'agent-a3000000000000286.jsonl')).at(-1)!}\n`, 'append')
    write(join(dir, `${S7}.jsonl`), `${main.slice(notification).join('\n')}\n`, 'append')
    await expect(impl).toHaveAttribute('data-status', 'done', { timeout: 5000 })
    await sessionFold.click()
    await expect(impl).toHaveCount(0)
    await expect(sessionFold).toHaveText('2 done')
    expectUntouched()
  } finally {
    await launched.close()
  }
})

test('a Session with 24 Subagents: the tree is shown within a second of opening the Session', async () => {
  const sessionId = '88888888-8888-4888-8888-888888888888'
  const dir = transcriptDir(projectPath)
  const record = (fields: Record<string, unknown>) => JSON.stringify({ cwd: projectPath, sessionId, version: '2.1.289', timestamp: '2026-10-05T10:00:00.000Z', ...fields })
  const main = [record({ type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the audit.' } })]
  mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true })
  const filler = 'Synthetic subagent output. '.repeat(80)
  for (let n = 0; n < 24; n += 1) {
    const agentId = `a${String(n).padStart(16, '0')}`
    const toolUseId = `toolu_audit_${n}`
    main.push(record({ type: 'assistant', isSidechain: false, message: { id: `m${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'auditor', name: `audit-${n}`, run_in_background: true } }] } }))
    main.push(record({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId } }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'auditor', name: `audit-${n}`, toolUseId, spawnDepth: 1, requestShape: 'background' }))
    const body = Array.from({ length: 200 }, () => record({ type: 'assistant', isSidechain: true, agentId, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: filler }], stop_reason: 'tool_use' } }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`), `${body.join('\n')}\n`)
  }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${main.join('\n')}\n`)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 900))
    const claude = claudeProcess()
    writeFileSync(join(claudeHome, 'sessions', `${claude.pid}.json`), JSON.stringify({ pid: claude.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'audit' }))
    const node = window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)
    await node.waitFor({ state: 'visible', timeout: 5000 })
    // The Canvas reads the tree as soon as the Session has a Node.
    const nodeShown = Date.now()
    await window.locator('[data-testid="subagent-node"]').first().waitFor({ state: 'visible', timeout: 5000 })
    const treeShown = Date.now() - nodeShown
    console.info(`[subagent-tree] the tree of 24 Subagents was on the Canvas ${treeShown} ms after the Session Node`)
    expect(treeShown).toBeLessThanOrEqual(1000)
    const opened = Date.now()
    await node.getByTestId('session-node-title').dblclick()
    const rows = window.locator('.w-shell__view[data-view="session"]').getByTestId('subagents-rail-row')
    await expect(rows).toHaveCount(24, { timeout: 5000 })
    const shown = Date.now() - opened
    console.info(`[subagent-tree] 24 Subagents (24 files of ${Math.round((200 * filler.length) / 1024)} KB) shown ${shown} ms after opening the Session`)
    expect(shown).toBeLessThanOrEqual(1000)
  } finally {
    await launched.close()
  }
})
