import { mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Orchestrator Node against the built app, on the fake agent: the script
// test/fixtures/agent-scripts/orchestrator.jsonl plays three turns. Turn 1 answers with a status
// block and then holds the turn open until it is interrupted, so `busy` stays on the Node long
// enough to be seen (a message sent during a turn would wait in the queue, ticket 19); turn 2 answers without a block; turn 3 has two blocks. Its costs grow per
// process as Claude Code reports them: 0.0125, 0.02, 0.03. Messages are sent over `agent.send`
// directly: the input field is ticket 33.
//
// Between the two runs the test writes the session's transcript into the Claude home, as Claude
// Code would after the session went on in a terminal: the second run shows the transcript's model
// and newest block, not anything worfy kept (ADR 0002, ADR 0005).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

const BLOCK_1 = [
  '— Этап: worfy-mvp · /implement · волна 5',
  '— Сейчас: тикет 08 в работе, тесты пишутся',
  '— Дальше: PR и зелёный CI',
  '— Жду: ничего',
].join('\n')
const BLOCK_3 = ['- Этап: worfy-mvp · /implement · волна 6', '- Сейчас: PR #21 ждёт ревью', '- Дальше: мерж волны 5', '- Жду: решение владельца по ADR'].join('\n')
const BLOCK_TERMINAL = ['— Этап: worfy-mvp · из терминала', '— Сейчас: продолжено через claude --resume', '— Дальше: вернуться в worfy', '— Жду: ничего'].join('\n')
const BLOCK_NOT_OURS = ['— Этап: не оркестратор', '— Сейчас: subagent', '— Дальше: ничего', '— Жду: ничего'].join('\n')

interface LayoutNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  locked: boolean
  data: Record<string, unknown>
}
interface Envelope {
  sessionId: string
  event: { type: string; state?: string; from?: string }
}

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-orchestrator-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  projectPath = path
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }>; on(channel: string, handler: (payload: unknown) => void): number }

async function invoke<T>(window: Page, channel: string, input: unknown): Promise<{ ok: boolean; value?: T; error?: string }> {
  return (await window.evaluate(
    ([name, payload]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, payload),
    [channel, input] as const,
  )) as { ok: boolean; value?: T; error?: string }
}

async function orchestratorNodes(window: Page): Promise<LayoutNode[]> {
  const result = await invoke<{ layout: { nodes: LayoutNode[] } }>(window, 'layout.get', { projectId: PROJECT })
  expect(result.ok).toBe(true)
  return (result.value?.layout.nodes ?? []).filter((node) => node.kind === 'orchestrator')
}

/** Starts recording every `agent.event` in the page, to read back with recorded(). */
async function record(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = globalThis as unknown as { worfy: Bridge; recorded: unknown[] }
    store.recorded = []
    store.worfy.on('agent.event', (payload) => store.recorded.push(payload))
  })
}
const recorded = (window: Page): Promise<Envelope[]> => window.evaluate(() => (globalThis as unknown as { recorded: Envelope[] }).recorded)

/** Ends turn 1 of the script, which holds until it is interrupted. */
async function release(window: Page, sessionId: string): Promise<void> {
  const result = await invoke<{ interrupted: boolean }>(window, 'agent.interrupt', { sessionId })
  expect(result.value).toEqual({ interrupted: true })
}

async function send(window: Page, sessionId: string, text: string): Promise<void> {
  const result = await invoke(window, 'agent.send', { sessionId, text })
  expect(result.error).toBeUndefined()
}

/** Every file under `dir` with its size and modification time: what must not change. */
function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      const info = statSync(path)
      return `${path.slice(dir.length)}:${info.size}:${info.mtimeMs}`
    })
    .sort()
}

/** The transcript of `sessionId` as Claude Code keeps it for Sessions started in the Project's root. */
function writeTranscript(sessionId: string): void {
  const dir = join(claudeHome, 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const base = { sessionId, cwd: projectPath, timestamp: '2026-10-05T12:00:00.000Z' }
  const assistant = (uuid: string, model: string, text: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ ...base, type: 'assistant', uuid, isSidechain: false, message: { id: `msg_${uuid}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text }] }, ...extra })
  const lines = [
    JSON.stringify({ ...base, type: 'user', uuid: 'u1', isSidechain: false, message: { role: 'user', content: 'продолжаем из терминала' } }),
    assistant('a1', 'claude-sonnet-5', `Продолжил.\n\n${BLOCK_TERMINAL}`),
    assistant('a2', 'claude-sonnet-5', `Отчёт.\n${BLOCK_NOT_OURS}`, { isSidechain: true, agentId: 'a0000000000000001' }),
    assistant('a3', '<synthetic>', `API Error.\n${BLOCK_NOT_OURS}`),
  ]
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`)
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('the Orchestrator Node: locked, live on the fake agent with its state, cost and status block, and the same Session after a restart', async () => {
  let savedSessionId: unknown
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator' }
  const first = await launchApp({ env })
  try {
    const { window } = first
    await record(window)
    // Created on the first open of the Project, locked, before any message.
    const node = window.getByTestId('orchestrator-node')
    await expect(node).toHaveCount(1)
    await expect(node).toContainText('Orchestrator')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await expect(node.getByTestId('orchestrator-status-block-empty')).toHaveText('No status block yet')
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.00')
    const [created] = await orchestratorNodes(window)
    if (!created) throw new Error('no Orchestrator Node')
    expect(created).toMatchObject({ locked: true, x: 40, y: 40 })

    // It cannot be removed; it can be moved by its header.
    const removed = await invoke(window, 'layout.apply', { projectId: PROJECT, op: { op: 'remove', id: created.id } })
    expect(removed.ok).toBe(false)
    expect(removed.error).toMatch(/locked/)
    const start = await center(node.locator('.w-orchestrator__header'))
    await window.mouse.move(start.x, start.y)
    await window.mouse.down()
    await window.mouse.move(start.x + 200, start.y + 150, { steps: 12 })
    await window.mouse.up()
    await expect.poll(async () => (await orchestratorNodes(window))[0]?.x ?? 0).toBeGreaterThan(created.x + 150)
    expect(await orchestratorNodes(window)).toHaveLength(1)

    const opened = await invoke<{ sessionId: string; nodeId: string }>(window, 'orchestrator.open', { projectId: PROJECT })
    expect(opened.value?.nodeId).toBe(created.id)
    const sessionId = opened.value?.sessionId ?? ''

    // Turn 1: busy with the status block on the Node, then idle with the turn's cost.
    await send(window, sessionId, 'прогони волну 5')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('busy')
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_1, { useInnerText: true })
    await release(window, sessionId)
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0125')
    await expect(node.getByTestId('orchestrator-model')).toHaveText('claude-opus-5-5')

    // Turn 2: an answer without a block leaves the old one.
    await send(window, sessionId, 'статус')
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0200')
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_1, { useInnerText: true })

    // Turn 3: a new block replaces it; of two, the last.
    await send(window, sessionId, 'статус')
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_3, { useInnerText: true })
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0300')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')

    // The events reached the window too: busy → idle for each turn.
    const states = (await recorded(window)).flatMap((e) => (e.event.type === 'state' && e.event.state ? [e.event.state] : []))
    expect(states.slice(-6)).toEqual(['busy', 'idle', 'busy', 'idle', 'busy', 'idle'])

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await node.screenshot({ path: test.info().outputPath(`orchestrator-${scheme}.png`) })
    }
    savedSessionId = (await orchestratorNodes(window))[0]?.data.sessionId
    expect(savedSessionId).toMatch(/^[0-9a-f-]{36}$/)
    // The Layout keeps only what nothing else records: the session to resume and the summed cost.
    expect((await orchestratorNodes(window))[0]?.data).toStrictEqual({ sessionId: savedSessionId, costUsd: 0.03 })
  } finally {
    await first.close()
  }
  // ADR 0005: opening the Project and running its Orchestrator wrote nothing into the Project or the Claude home.
  expect(readdirSync(projectPath)).toEqual([])
  expect(listing(claudeHome)).toEqual([])

  writeTranscript(String(savedSessionId))
  const claudeHomeBefore = listing(claudeHome)
  const second = await launchApp({ env })
  try {
    const { window } = second
    await record(window)
    const node = window.getByTestId('orchestrator-node')
    // Before any turn: the model and the newest block of the transcript, and the kept cost.
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_TERMINAL, { useInnerText: true })
    await expect(node.getByTestId('orchestrator-model')).toHaveText('claude-sonnet-5')
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0300')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    expect(await orchestratorNodes(window)).toHaveLength(1)

    const opened = await invoke<{ sessionId: string }>(window, 'orchestrator.open', { projectId: PROJECT })
    const sessionId = opened.value?.sessionId ?? ''
    await send(window, sessionId, 'продолжаем')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('busy')
    await release(window, sessionId)
    // The fake agent answers under the session it was asked to resume: the same one as before.
    await expect.poll(async () => (await recorded(window)).find((e) => e.event.type === 'renamed')?.sessionId).toBe(savedSessionId)
    // A new Claude Code process counts from zero; the Node keeps the sum.
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0425')
    expect((await orchestratorNodes(window))[0]?.data.sessionId).toBe(savedSessionId)
    // The live Session's answer replaces the transcript's block.
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_1, { useInnerText: true })
  } finally {
    await second.close()
  }
  expect(readdirSync(projectPath)).toEqual([])
  expect(listing(claudeHome)).toEqual(claudeHomeBefore)
})

// Ticket 27: a status block of four 90-character lines on the Node of the default size, 360×200.
// Each line is cut to one line with an ellipsis; the whole line stays in its tooltip and in the
// Session view. The fake agent answers with such a block from a script the test writes itself.
const LONG_FILLER = ' тикет 11 ждёт ревью по линзе границ модулей, затем мерж волны 8 и новый HANDOFF у владельца'
const longLine = (head: string): string => `${head}${LONG_FILLER}`.slice(0, 89).trimEnd().padEnd(89, '.') + '.'
const LONG_BLOCK = [longLine('— Этап: worfy-daily · /epic-wave · волна 8'), longLine('— Сейчас:'), longLine('— Дальше:'), longLine('— Жду:')].join('\n')

function longBlockScript(): string {
  const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: ['Bash'], mcp_servers: [], model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000000101' }
  const text = `Волна 8 идёт.\n\n${LONG_BLOCK}\n`
  const assistant = { type: 'assistant', message: { id: 'msg_long_1', model: 'claude-opus-5-5', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: null }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000102' }
  const result = { type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.01, duration_ms: 1500, duration_api_ms: 1100, num_turns: 1, usage: { input_tokens: 20, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', stop_reason: 'end_turn', session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000103' }
  return `${[{ fake: 'wait_message' }, init, assistant, result].map((line) => JSON.stringify(line)).join('\n')}\n`
}

test('a status block of four 90-character lines fits the Orchestrator Node: «— Жду:» is seen without scrolling', async () => {
  for (const line of LONG_BLOCK.split('\n')) expect(line).toHaveLength(90)
  const scripts = join(scratch, 'scripts')
  mkdirSync(scripts)
  writeFileSync(join(scripts, 'long-block.jsonl'), longBlockScript())
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'long-block' } })
  try {
    const { window } = app
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    const [created] = await orchestratorNodes(window)
    expect(created).toMatchObject({ w: 360, h: 200 })
    const opened = await invoke<{ sessionId: string }>(window, 'orchestrator.open', { projectId: PROJECT })
    await send(window, opened.value?.sessionId ?? '', 'статус')
    const block = node.getByTestId('orchestrator-status-block')
    await expect(block).toHaveText(LONG_BLOCK, { useInnerText: true })
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')

    const fit = await block.evaluate((found) => {
      // Where the text «— Жду:» is drawn, against the block's box and the Node's. The e2e
      // tsconfig has no DOM types: the few members used are typed here.
      type Box = { top: number; bottom: number; left: number; right: number }
      type Text = { textContent: string | null }
      type Element = {
        scrollHeight: number
        clientHeight: number
        getBoundingClientRect(): Box
        closest(selector: string): Element | null
        ownerDocument: {
          createTreeWalker(root: Element, whatToShow: number): { nextNode(): Text | null }
          createRange(): { setStart(node: Text, offset: number): void; setEnd(node: Text, offset: number): void; getBoundingClientRect(): Box }
        }
      }
      const SHOW_TEXT = 4
      const element = found as unknown as Element
      const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT)
      let waiting: Box | null = null
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        const at = text.textContent?.indexOf('— Жду:') ?? -1
        if (at < 0) continue
        const range = element.ownerDocument.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + '— Жду:'.length)
        waiting = range.getBoundingClientRect()
      }
      const box = element.getBoundingClientRect()
      const nodeBox = element.closest('[data-testid="orchestrator-node"]')?.getBoundingClientRect()
      return {
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        waiting: waiting && { top: waiting.top, bottom: waiting.bottom, left: waiting.left, right: waiting.right },
        box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        nodeBottom: nodeBox?.bottom ?? 0,
      }
    })
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight)
    expect(fit.waiting).not.toBeNull()
    expect(fit.waiting?.top ?? -1).toBeGreaterThanOrEqual(fit.box.top)
    expect(fit.waiting?.bottom ?? Infinity).toBeLessThanOrEqual(fit.box.bottom)
    expect(fit.waiting?.right ?? Infinity).toBeLessThanOrEqual(fit.box.right)
    expect(fit.box.bottom).toBeLessThanOrEqual(fit.nodeBottom)

    // The whole line is in the tooltip of its row.
    const lines = LONG_BLOCK.split('\n')
    await expect(block.getByTestId('orchestrator-status-line')).toHaveCount(4)
    for (const [index, line] of lines.entries()) await expect(block.getByTestId('orchestrator-status-line').nth(index)).toHaveAttribute('title', line)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await node.screenshot({ path: test.info().outputPath(`orchestrator-long-block-${scheme}.png`) })
    }
  } finally {
    await app.close()
  }
})
