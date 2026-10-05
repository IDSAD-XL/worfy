import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Orchestrator Node against the built app, on the fake agent: the script
// test/fixtures/agent-scripts/orchestrator.jsonl plays three turns. Turn 1 answers with a status
// block and then holds the turn open until the next message, so `busy` stays on the Node long
// enough to be seen; turn 2 answers without a block; turn 3 has two blocks. Its costs grow per
// process as Claude Code reports them: 0.0125, 0.02, 0.03. Messages are sent over `agent.send`
// directly: the input field is ticket 33.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

const BLOCK_1 = [
  '— Этап: worfy-mvp · /implement · волна 5',
  '— Сейчас: тикет 08 в работе, тесты пишутся',
  '— Дальше: PR и зелёный CI',
  '— Жду: ничего',
].join('\n')
const BLOCK_3 = ['- Этап: worfy-mvp · /implement · волна 6', '- Сейчас: PR #21 ждёт ревью', '- Дальше: мерж волны 5', '- Жду: решение владельца по ADR'].join('\n')

interface LayoutNode {
  id: string
  kind: string
  x: number
  y: number
  locked: boolean
  data: Record<string, unknown>
}
interface Envelope {
  sessionId: string
  event: { type: string; state?: string; from?: string }
}

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-orchestrator-')))
  dataDir = join(scratch, 'data')
  const path = join(scratch, 'alpha')
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

async function send(window: Page, sessionId: string, text: string): Promise<void> {
  const result = await invoke(window, 'agent.send', { sessionId, text })
  expect(result.error).toBeUndefined()
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('the Orchestrator Node: locked, live on the fake agent with its state, cost and status block, and the same Session after a restart', async () => {
  let savedSessionId: unknown
  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'orchestrator' } })
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
    await send(window, sessionId, 'дальше')
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
  } finally {
    await first.close()
  }

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'orchestrator' } })
  try {
    const { window } = second
    await record(window)
    const node = window.getByTestId('orchestrator-node')
    // The last block and the cost are on the Node at once, before any turn.
    await expect(node.getByTestId('orchestrator-status-block')).toHaveText(BLOCK_3, { useInnerText: true })
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0300')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    expect(await orchestratorNodes(window)).toHaveLength(1)

    const opened = await invoke<{ sessionId: string }>(window, 'orchestrator.open', { projectId: PROJECT })
    const sessionId = opened.value?.sessionId ?? ''
    await send(window, sessionId, 'продолжаем')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('busy')
    await send(window, sessionId, 'дальше')
    // The fake agent answers under the session it was asked to resume: the same one as before.
    await expect.poll(async () => (await recorded(window)).find((e) => e.event.type === 'renamed')?.sessionId).toBe(savedSessionId)
    // A new Claude Code process counts from zero; the Node keeps the sum.
    await expect(node.getByTestId('orchestrator-cost')).toHaveText('$0.0425')
    expect((await orchestratorNodes(window))[0]?.data.sessionId).toBe(savedSessionId)
  } finally {
    await second.close()
  }
})
