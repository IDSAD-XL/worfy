import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, inJson, launchApp, marksOf, repoRoot, startTimeline } from './helpers'
import { snapshotThemes } from './snapshots'
import { settled } from './wait'
import { catScript } from '../harness-node'

// The Subagent tree of a Session (ticket 15), against the built app:
// - the Orchestrator on the fake agent (test/fixtures/agent-scripts/subagents.jsonl) starts a
//   background Subagent that starts a nested one, and a later turn brings their task-notifications;
// - a Session started in a terminal, whose transcript and subagents/ folder the test writes the way
//   Claude Code does, from the synthetic Session 7777 (test/fixtures/claude-home/README.md).
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude; worfy must not write there.
// With WORFY_EVIDENCE_DIR set, the light and dark screenshots of the Session rail are copied there.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

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
const fixture = (path: string): string => readFileSync(join(FIXTURE, path), 'utf8').replaceAll('/Users/test/projects/agents', inJson(projectPath))
const fixtureLines = (path: string): string[] => fixture(path).split('\n').filter((line) => line !== '')

async function sendToOrchestrator(window: Page, text: string): Promise<void> {
  await window.evaluate(async (message) => {
    const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
    const listed = await bridge.invoke('agent.list')
    const [session] = (listed.value as { sessionId: string }[] | undefined) ?? []
    if (!session) throw new Error('no Session runs')
    // The moment the message leaves the renderer, for the timings measured inside the app.
    ;(globalThis as unknown as { __worfyTimeline?: { mark(name: string): void } }).__worfyTimeline?.mark('sent')
    const sent = await bridge.invoke('agent.send', { sessionId: session.sessionId, text: message })
    if (!sent.ok) throw new Error(sent.error)
  }, text)
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-subagents-')))
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
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await expect.poll(() => window.evaluate(async () => ((await (globalThis as unknown as { worfy: Bridge }).worfy.invoke('agent.list')).value as unknown[]).length)).toBe(1)

    // The turn's `task_started` follows the message at once: the Node must be there within 500 ms,
    // timed inside the renderer from the message leaving it to the Node's element in the page.
    const impl = window.locator('[data-testid="subagent-node"][data-subagent-id="afake00000000impl"]')
    await startTimeline(window, { impl: { selector: '[data-testid="subagent-node"][data-subagent-id="afake00000000impl"]' } })
    await sendToOrchestrator(window, 'run wave 3')
    await impl.waitFor({ state: 'visible', timeout: 5000 })
    const marks = await marksOf(window, ['sent', 'impl'])
    const appeared = Math.round(marks.impl! - marks.sent!)
    // Only a Node that came after the message counts.
    expect(appeared).toBeGreaterThanOrEqual(0)
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

    // The Session rail lists the same tree, the done Subagent with its scout in the closed "Done (1)" group.
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Session' }).click()
    const rail = window.getByTestId('subagents-rail')
    const group = rail.getByTestId('subagents-rail-done')
    await expect(group).toHaveText('Done (1)')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(rail.getByTestId('subagents-rail-row')).toHaveCount(0)
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(rail.getByTestId('subagents-rail-row')).toHaveCount(2)
    await expect(rail.locator('[data-subagent-id="afake00000000impl"]')).toHaveAttribute('data-status', 'done')
    await expect(rail.locator('[data-subagent-id="afake0000000scout"]')).toHaveAttribute('data-status', 'done')
    expectUntouched()
  } finally {
    await launched.close()
  }
})

test('an Epic frame keeps clear of the Subagent Nodes right of the Orchestrator (ADR-0032)', async () => {
  // epic-status answers one Epic with one open Ticket, so the Canvas has a frame from the start.
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = { epic: 'demo', num: 1, slug: 't1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [ticket] }))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'subagents' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    const frame = window.getByTestId('rf__node-epic:demo')
    await expect(frame).toBeVisible()
    await expect.poll(() => window.evaluate(async () => ((await (globalThis as unknown as { worfy: Bridge }).worfy.invoke('agent.list')).value as unknown[]).length)).toBe(1)
    await sendToOrchestrator(window, 'run wave 3')
    const impl = window.locator('[data-testid="subagent-node"][data-subagent-id="afake00000000impl"]')
    const scout = window.locator('[data-testid="subagent-node"][data-subagent-id="afake0000000scout"]')
    await expect(impl).toBeVisible()
    await expect(scout).toBeVisible()

    const area = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    const covered = async () => {
      const [f, i, s, o] = await Promise.all([frame.boundingBox(), impl.boundingBox(), scout.boundingBox(), window.getByTestId('orchestrator-node').boundingBox()])
      if (!f || !i || !s || !o) return null
      return [area(f, i), area(f, s), area(f, o)]
    }
    await expect.poll(covered).toEqual([0, 0, 0])
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
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
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

    // A Subagent's Node is not moved by hand (ADR-0037): dragged 200 px and dropped on nothing, it
    // goes back to its place, and the Layout's Nodes do not change.
    const layoutNow = () =>
      window.evaluate(async (projectId) => {
        const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
        return JSON.stringify(((await bridge.invoke('layout.get', { projectId })).value as { layout: { nodes: unknown[] } }).layout.nodes)
      }, PROJECT)
    const savedBefore = await layoutNow()
    const before = (await reviewer.boundingBox())!
    await window.mouse.move(before.x + 40, before.y + 12)
    await window.mouse.down()
    await window.mouse.move(before.x + 40 + 200, before.y + 212, { steps: 8 })
    await window.mouse.up()
    await canvasReady(launched)
    // A save the drop sent would have reached main by now: the renderer has caught up with it.
    await settled(window)
    const after = (await reviewer.boundingBox())!
    expect({ x: Math.round(after.x), y: Math.round(after.y) }).toEqual({ x: Math.round(before.x), y: Math.round(before.y) })
    expect(JSON.parse(await layoutNow()) as unknown).toEqual(JSON.parse(savedBefore) as unknown)
    expect(await layoutNow()).not.toContain('subagent-tree')

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
    await canvasReady(launched, { size: { width: 1600, height: 900 } })
    // Timed inside the renderer: from the Session Node's element to the first Subagent Node's, and
    // from the double click reaching the page to the 24th row of the rail.
    const rowSelector = '.w-shell__view[data-view="session"] [data-testid="subagents-rail-row"]'
    await startTimeline(window, {
      sessionNode: { selector: `[data-testid="session-node"][data-session-id="${sessionId}"]` },
      tree: { selector: '[data-testid="subagent-node"]' },
      opened: { event: 'dblclick' },
      rows: { selector: rowSelector, count: 24 },
    })
    const claude = claudeProcess()
    writeFileSync(join(claudeHome, 'sessions', `${claude.pid}.json`), JSON.stringify({ pid: claude.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'audit' }))
    const node = window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)
    await node.waitFor({ state: 'visible', timeout: 5000 })
    // The Canvas reads the tree as soon as the Session has a Node.
    await window.locator('[data-testid="subagent-node"]').first().waitFor({ state: 'visible', timeout: 5000 })
    const onCanvas = await marksOf(window, ['sessionNode', 'tree'])
    const treeShown = Math.round(onCanvas.tree! - onCanvas.sessionNode!)
    expect(treeShown).toBeGreaterThanOrEqual(0)
    console.info(`[subagent-tree] the tree of 24 Subagents was on the Canvas ${treeShown} ms after the Session Node`)
    expect(treeShown).toBeLessThanOrEqual(1000)
    await node.getByTestId('session-node-title').dblclick()
    const rows = window.locator(rowSelector)
    await expect(rows).toHaveCount(24, { timeout: 5000 })
    const inRail = await marksOf(window, ['opened', 'rows'])
    const shown = Math.round(inRail.rows! - inRail.opened!)
    // The rows come with the opened Session, not before it.
    expect(shown).toBeGreaterThanOrEqual(0)
    console.info(`[subagent-tree] 24 Subagents (24 files of ${Math.round((200 * filler.length) / 1024)} KB) shown ${shown} ms after opening the Session`)
    expect(shown).toBeLessThanOrEqual(1000)
  } finally {
    await launched.close()
  }
})

test('a Session with running, failed and done Subagents: the rail lists the newest first and folds the done ones', async () => {
  const sessionId = '99999999-9999-4999-8999-999999999999'
  const dir = transcriptDir(projectPath)
  // Started a minute apart, in this order. The one still running was started in the background; the
  // others are calls that waited for their answer, one of them an error (the file's meta names each).
  const statuses = ['done', 'error', 'done', 'done', 'running', 'done', 'done'] as const
  const at = (minute: number): string => `2026-10-05T10:${String(minute).padStart(2, '0')}:00.000Z`
  const record = (minute: number, fields: Record<string, unknown>) => JSON.stringify({ cwd: projectPath, sessionId, version: '2.1.289', timestamp: at(minute), ...fields })
  const main = [record(0, { type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the wave.' } })]
  mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true })
  statuses.forEach((status, n) => {
    const agentId = `a${String(n).padStart(16, '0')}`
    const toolUseId = `toolu_wave_${n}`
    const background = status === 'running'
    main.push(record(n + 1, { type: 'assistant', isSidechain: false, message: { id: `m${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'implementer', name: `impl-${n}`, run_in_background: background } }] } }))
    const content = background ? 'Async agent launched successfully.' : status === 'error' ? 'Agent failed: the tests are red.' : `impl-${n} is done.`
    main.push(record(n + 1, { type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: status === 'error' }] }, toolUseResult: background ? { status: 'async_launched', agentId } : undefined }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'implementer', name: `impl-${n}`, toolUseId, spawnDepth: 1, requestShape: background ? 'background' : 'foreground' }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`), `${record(n + 1, { type: 'assistant', isSidechain: true, agentId, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Working.' }], stop_reason: 'tool_use' } })}\n`)
  })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${main.join('\n')}\n`)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 } })
    const claude = claudeProcess()
    writeFileSync(join(claudeHome, 'sessions', `${claude.pid}.json`), JSON.stringify({ pid: claude.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave' }))
    expected = snapshot()
    const node = window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)
    await node.waitFor({ state: 'visible', timeout: 5000 })
    await node.getByTestId('session-node-title').dblclick()
    const rail = window.locator('.w-shell__view[data-view="session"]').getByTestId('subagents-rail')
    const rows = rail.getByTestId('subagents-rail-row')
    const shown = () => rows.evaluateAll((list) => list.map((row) => `${row.getAttribute('data-subagent-id')?.slice(-1)}:${row.getAttribute('data-status')}`))

    // Closed by default: the running and the failed one above it, newest first.
    const group = rail.getByTestId('subagents-rail-done')
    await expect(group).toHaveText('Done (5)')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(shown).toEqual(['4:running', '1:error'])
    const closed = await snapshotThemes(window, 'subagents-rail-closed')

    // Opened from the keyboard: the done ones under the group, newest first.
    await group.focus()
    await window.keyboard.press('Enter')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(shown).toEqual(['4:running', '1:error', '6:done', '5:done', '3:done', '2:done', '0:done'])
    const open = await snapshotThemes(window, 'subagents-rail-open')

    // Back on the Canvas and into the Session again: the group is still open; Space closes it.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await node.getByTestId('session-node-title').dblclick()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(rows).toHaveCount(7)
    await group.focus()
    await window.keyboard.press('Space')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(rows).toHaveCount(2)

    if (EVIDENCE_DIR) {
      mkdirSync(EVIDENCE_DIR, { recursive: true })
      for (const [state, shots] of [['closed', closed], ['open', open]] as const) {
        copyFileSync(shots.light, join(EVIDENCE_DIR, `21-subagents-rail-${state}-light.png`))
        copyFileSync(shots.dark, join(EVIDENCE_DIR, `21-subagents-rail-${state}-dark.png`))
      }
    }
    expectUntouched()
  } finally {
    await launched.close()
  }
})

test('a Session that runs a workflow script: its agents hang under the run and end by its journal (ADR-0035)', async () => {
  // Session 1212 (test/fixtures/claude-home/README.md) at 10:05: the run's implementer has answered,
  // its reviewer and scout still work, and the run's task-notification has not come yet.
  const S12 = '12121212-1212-4121-8121-121212121212'
  const RUN = 'wf_0a1b2c3d-4e5'
  const CALL = 'toolu_01S12WORKFLOW1XXXXXXXXX'
  const source = join(repoRoot, 'test', 'fixtures', 'claude-home', 'projects', '-Users-test-projects-workflow')
  const linesOf = (path: string): string[] =>
    readFileSync(join(source, path), 'utf8')
      .replaceAll('/Users/test/projects/workflow', inJson(projectPath))
      .split('\n')
      .filter((line) => line !== '')
  const dir = transcriptDir(projectPath)
  const main = linesOf(`${S12}.jsonl`)
  const notification = main.findIndex((line) => line.includes('<task-notification>'))
  const runFixture = join(S12, 'subagents', 'workflows', RUN)
  const journal = linesOf(join(runFixture, 'journal.jsonl'))
  mkdirSync(join(claudeHome, 'projects'), { recursive: true })
  expected = snapshot()
  write(join(dir, `${S12}.jsonl`), `${main.slice(0, notification).join('\n')}\n`)
  const run = join(dir, runFixture)
  for (const name of readdirSync(join(source, runFixture))) {
    write(join(run, name), `${(name === 'journal.jsonl' ? journal.slice(0, 5) : linesOf(join(runFixture, name))).join('\n')}\n`)
  }

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    const claude = claudeProcess()
    write(
      join(claudeHome, 'sessions', `${claude.pid}.json`),
      JSON.stringify({ pid: claude.pid, sessionId: S12, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave-03' }),
    )
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${S12}"]`)).toBeVisible()

    // The run is one Node of type workflow; its agents are Nodes to the right of it.
    const runNode = window.locator(`[data-testid="subagent-node"][data-node-id$="${CALL}"]`)
    await expect(runNode).toHaveAttribute('data-status', 'running')
    await expect(runNode.getByTestId('subagent-name')).toHaveText('wave-03')
    await expect(runNode.getByTestId('subagent-kind')).toHaveText('workflow')
    const review = window.locator('[data-testid="subagent-node"][data-subagent-id="a8200000000000260"]')
    const scout = window.locator('[data-testid="subagent-node"][data-subagent-id="a8300000000000260"]')
    await expect(review).toHaveAttribute('data-status', 'running')
    await expect(review.getByTestId('subagent-kind')).toHaveText('workflow-subagent · claude-sonnet-5')
    await expect(scout).toHaveAttribute('data-status', 'running')
    await expect(scout.getByTestId('subagent-name')).toHaveText('scout:03')
    // The implementer is done: folded under the run.
    const runFold = window.locator(`[data-testid="subagent-fold"][data-node-id$="/done:${CALL}"]`)
    await expect(runFold).toHaveText('1 done')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`workflow-tree-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // The journal ends the reviewer (failed) and the scout (result); the run still runs.
    write(join(run, 'journal.jsonl'), `${journal.slice(5).join('\n')}\n`, 'append')
    await expect(review).toHaveAttribute('data-status', 'error', { timeout: 5000 })
    await expect(runFold).toHaveText('2 done')
    await expect(runNode).toHaveAttribute('data-status', 'running')
    // The run's task-notification ends it: done, folded under the Session.
    write(join(dir, `${S12}.jsonl`), `${main.slice(notification).join('\n')}\n`, 'append')
    const sessionFold = window.locator('[data-testid="subagent-fold"][data-node-id$="/done:session"]')
    await expect(sessionFold).toHaveText('1 done', { timeout: 5000 })
    await expect(runNode).toHaveCount(0)
    expectUntouched()
  } finally {
    await launched.close()
  }
})

// ADR-0085: a Session continued in a new process keeps its sessionId; a Subagent that died with the
// earlier process is `interrupted`. «Hide» hides one entry of any status, «Hide finished» the ended
// ones; worfy keeps the list in the Project's data folder, so it holds across a restart.
test('a continued Session: a Subagent of its earlier process is interrupted, and Hide hides entries across a restart', async () => {
  const sessionId = '45454545-4545-4545-8545-454545454545'
  const dir = transcriptDir(projectPath)
  // A minute apart: done, error, then two in the background. The running process of the Session
  // started at 10:03:30, after the third one's last record and before the fourth one's.
  const kinds = ['done', 'error', 'background', 'background'] as const
  const at = (minute: number): string => `2026-10-05T10:${String(minute).padStart(2, '0')}:00.000Z`
  const record = (minute: number, fields: Record<string, unknown>) => JSON.stringify({ cwd: projectPath, sessionId, version: '2.1.289', timestamp: at(minute), ...fields })
  const main = [record(0, { type: 'user', isSidechain: false, message: { role: 'user', content: 'Run the wave.' } })]
  mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true })
  const agentOf = (n: number): string => `a${String(n).padStart(16, '0')}`
  kinds.forEach((kind, n) => {
    const agentId = agentOf(n)
    const toolUseId = `toolu_cont_${n}`
    const background = kind === 'background'
    main.push(record(n + 1, { type: 'assistant', isSidechain: false, message: { id: `m${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'implementer', name: `impl-${n}`, run_in_background: background } }] } }))
    const content = background ? 'Async agent launched successfully.' : kind === 'error' ? 'Agent failed: the tests are red.' : `impl-${n} is done.`
    main.push(record(n + 1, { type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: kind === 'error' }] }, toolUseResult: background ? { status: 'async_launched', agentId } : undefined }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'implementer', name: `impl-${n}`, toolUseId, spawnDepth: 1, requestShape: background ? 'background' : 'foreground' }))
    writeFileSync(join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`), `${record(n + 1, { type: 'assistant', isSidechain: true, agentId, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Working.' }], stop_reason: 'tool_use' } })}\n`)
  })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${main.join('\n')}\n`)
  const claude = claudeProcess()
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', name: 'wave', startedAt: Date.parse('2026-10-05T10:03:30.000Z') }),
  )
  expected = snapshot()
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' }
  const canvasNode = (window: Page, n: number) => window.locator(`[data-testid="subagent-node"][data-subagent-id="${agentOf(n)}"]`)
  const openRail = async (window: Page) => {
    await window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`).getByTestId('session-node-title').dblclick()
    return window.locator('.w-shell__view[data-view="session"]').getByTestId('subagents-rail')
  }
  const shown = (rail: ReturnType<Page['locator']>) => () =>
    rail.getByTestId('subagents-rail-row').evaluateAll((list) => list.map((row) => `${row.getAttribute('data-subagent-id')?.slice(-1)}:${row.getAttribute('data-status')}`))

  let launched = await launchApp({ env })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 } })
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)).toBeVisible({ timeout: 5000 })
    // On the Canvas: the running one and the failed one in the column; the done and the interrupted one folded.
    await expect(canvasNode(window, 3)).toHaveAttribute('data-status', 'running')
    await expect(canvasNode(window, 1)).toHaveAttribute('data-status', 'error')
    const fold = window.locator('[data-testid="subagent-fold"][data-node-id$="/done:session"]')
    await expect(fold).toHaveText('1 done · 1 interrupted')
    await fold.click()
    const interrupted = canvasNode(window, 2)
    await expect(interrupted).toHaveAttribute('data-status', 'interrupted')
    await expect(interrupted.getByTestId('subagent-status')).toHaveText(/^Interrupted /)
    await expect(interrupted.getByTestId('subagent-status')).toHaveAttribute('title', /process restarted after this agent's last record/)
    const canvasShots = await snapshotThemes(window, 'subagents-interrupted-canvas')

    // In the rail: the interrupted one in the group with the done one.
    const rail = await openRail(window)
    const group = rail.getByTestId('subagents-rail-done')
    await expect(group).toHaveText('Done (2) · 1 interrupted')
    await expect.poll(shown(rail)).toEqual(['3:running', '1:error'])
    await group.click()
    await expect.poll(shown(rail)).toEqual(['3:running', '1:error', '2:interrupted', '0:done'])
    const railShots = await snapshotThemes(window, 'subagents-interrupted-rail')

    // «Hide» on the failed one's Node: gone from the Canvas and from the rail.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await canvasNode(window, 1).getByTestId('subagent-hide').click()
    await expect(canvasNode(window, 1)).toHaveCount(0)
    await openRail(window)
    await expect.poll(shown(rail)).toEqual(['3:running', '2:interrupted', '0:done'])
    // «Hide finished» in the rail: the done and the interrupted one go, the running one stays.
    await rail.getByTestId('subagents-rail-hide-finished').click()
    await expect.poll(shown(rail)).toEqual(['3:running'])
    // «Hide» on the running one's row: a running entry hides too.
    await rail.getByTestId('subagents-rail-hide').click()
    await expect(rail).toContainText('Every Subagent is hidden')
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(window.getByTestId('subagent-node')).toHaveCount(0)
    await expect(window.getByTestId('subagent-fold')).toHaveCount(0)

    if (EVIDENCE_DIR) {
      mkdirSync(EVIDENCE_DIR, { recursive: true })
      for (const [place, shots] of [['canvas', canvasShots], ['rail', railShots]] as const) {
        copyFileSync(shots.light, join(EVIDENCE_DIR, `45-subagents-interrupted-${place}-light.png`))
        copyFileSync(shots.dark, join(EVIDENCE_DIR, `45-subagents-interrupted-${place}-dark.png`))
      }
    }
  } finally {
    await launched.close()
  }
  expect(JSON.parse(readFileSync(join(dataDir, PROJECT, 'hidden-subagents.json'), 'utf8'))).toEqual({
    sessions: { [sessionId]: ['toolu_cont_1', 'toolu_cont_0', 'toolu_cont_2', 'toolu_cont_3'] },
  })

  // worfy starts again: still hidden; «Show hidden Subagents» brings every entry back.
  launched = await launchApp({ env })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 900 } })
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)).toBeVisible({ timeout: 5000 })
    const rail = await openRail(window)
    const showHidden = rail.getByTestId('subagents-rail-show-hidden')
    await expect(showHidden).toHaveText('Show hidden Subagents (4)')
    await expect(rail.getByTestId('subagents-rail-row')).toHaveCount(0)
    await showHidden.click()
    await expect.poll(shown(rail)).toEqual(['3:running', '1:error'])
    await expect(showHidden).toHaveCount(0)
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(canvasNode(window, 3)).toHaveAttribute('data-status', 'running')
    expectUntouched()
  } finally {
    await launched.close()
  }
})
