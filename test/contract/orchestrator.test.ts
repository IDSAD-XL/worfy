// The Orchestrator of a Project (src/main/agent/orchestrator.ts) over the real Layout store and
// Session registry, on the fake agent: its locked Node, what main writes into the Node's data as
// the Session runs, resume after a restart, the `orchestrator.open` channel and main's own wiring
// (src/main/ipc/orchestrator.ts).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { CostCounter, ORCHESTRATOR_HEIGHT, ORCHESTRATOR_WIDTH, Orchestrators, orchestratorPlace } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { LayoutStore } from '../../src/main/layout/store'
import type { AgentEventEnvelope } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { OrchestratorData, OrchestratorInfo } from '../../src/shared/ipc/orchestrator'
import type { LayoutNode } from '../../src/shared/layout/types'

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (() => void)[]>(),
  sent: [] as { channel: string; payload: unknown }[],
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/nowhere',
    on: (event: string, listener: () => void) => electron.listeners.set(event, [...(electron.listeners.get(event) ?? []), listener]),
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) } },
    ],
  },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-0000000d'

const BLOCK_1 = [
  '— Этап: worfy-mvp · /implement · волна 5',
  '— Сейчас: тикет 08 в работе, тесты пишутся',
  '— Дальше: PR и зелёный CI',
  '— Жду: ничего',
].join('\n')
const BLOCK_3 = ['- Этап: worfy-mvp · /implement · волна 6', '- Сейчас: PR #21 ждёт ревью', '- Дальше: мерж волны 5', '- Жду: решение владельца по ADR'].join('\n')

let scratch: string
let repo: string
/** Registries of the test, closed before its folder goes, so no late write lands in a removed folder. */
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-orchestrator-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** One run of the app: a Layout store over the data folder, a registry on the fake agent, the Orchestrators. */
function harness(script = 'orchestrator') {
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const requests: QueryRequest[] = []
  const factory = fakeQueryFactory({ scriptsDir, script })
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return factory(request)
  })
  registries.push(registry)
  const broadcast: AgentEventEnvelope[] = []
  const known = new Set([PROJECT])
  const orchestrators = new Orchestrators({
    layout,
    projectPath: (projectId) => {
      if (!known.has(projectId)) throw new Error(`No Project with id ${projectId}`)
      return repo
    },
    registry,
    broadcast: (sessionId, event) => broadcast.push({ sessionId, event }),
  })
  const node = (): LayoutNode => {
    const found = layout.get(PROJECT).layout.nodes.filter((each) => each.kind === 'orchestrator')
    expect(found).toHaveLength(1)
    return found[0] as LayoutNode
  }
  const data = () => node().data as OrchestratorData
  /** Every state the Node's data went through, in order. */
  const states: string[] = []
  layout.onChange(({ op }) => {
    if (op.op === 'patchData' && typeof op.data.state === 'string') states.push(op.data.state)
  })
  return { layout, registry, requests, broadcast, orchestrators, node, data, states, known }
}

describe('Orchestrator Node', () => {
  it('is created locked on the first open, once: a second open keeps the Node and the Session', () => {
    const h = harness()
    const first = h.orchestrators.open(PROJECT)
    const node = h.node()
    expect(node).toMatchObject({ id: first.nodeId, kind: 'orchestrator', locked: true, x: 40, y: 40, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT })
    expect(first).toMatchObject({ projectId: PROJECT, sessionId: expect.stringMatching(/^pending-/) as unknown })

    expect(h.orchestrators.open(PROJECT)).toEqual(h.orchestrators.open(PROJECT))
    expect(h.orchestrators.open(PROJECT).sessionId).toBe(first.sessionId)
    expect(h.requests).toHaveLength(1)
    expect(h.layout.get(PROJECT).layout.nodes).toHaveLength(1)
  })

  it('cannot be removed, but can be moved and resized', () => {
    const h = harness()
    const { nodeId } = h.orchestrators.open(PROJECT)
    expect(() => h.layout.apply(PROJECT, { op: 'remove', id: nodeId })).toThrow(/locked/)
    h.layout.apply(PROJECT, { op: 'move', id: nodeId, x: 400, y: 300 })
    h.layout.apply(PROJECT, { op: 'resize', id: nodeId, w: 500, h: 260 })
    expect(h.node()).toMatchObject({ x: 400, y: 300, w: 500, h: 260, locked: true })
  })

  it('goes under the Nodes already on the Canvas instead of covering them', () => {
    const note = (x: number, y: number, w = 220, h = 120) => ({ id: `${x}-${y}`, kind: 'note', x, y, w, h, hidden: false, locked: false, pinned: false, tags: [], data: {} })
    expect(orchestratorPlace([])).toEqual({ x: 40, y: 40 })
    expect(orchestratorPlace([note(600, 40)])).toEqual({ x: 40, y: 40 })
    expect(orchestratorPlace([note(120, 80), note(500, 300, 100, 50)])).toEqual({ x: 120, y: 390 })
  })

  it('is found again by its kind, and the Session resumes the SDK session saved in its data', () => {
    writeFileSync(
      join(scratch, 'data', PROJECT, 'layout.json'),
      JSON.stringify({
        nodes: [{ id: 'orch', kind: 'orchestrator', x: 10, y: 20, w: 300, h: 180, locked: true, data: { sessionId: 'sdk-saved', costUsd: 'damaged', statusBlock: BLOCK_1 } }],
      }),
    )
    const h = harness()
    expect(h.orchestrators.open(PROJECT).nodeId).toBe('orch')
    // A damaged field is dropped; the rest of the data still counts.
    expect(h.requests.map((request) => request.resume)).toEqual(['sdk-saved'])
    expect(h.node()).toMatchObject({ x: 10, y: 20, data: { statusBlock: BLOCK_1 } })
  })

  it('a Project that is not in the list has no Orchestrator', () => {
    const h = harness()
    expect(() => h.orchestrators.open('nope-00000000')).toThrow(/No Project/)
    expect(h.requests).toEqual([])
  })
})

describe('Orchestrator Session', () => {
  it('shows state, model, cost and the last status block in the Node data; an answer without a block leaves it', async () => {
    const h = harness()
    const { sessionId: tempId } = h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.data().state).toBe('idle'))
    expect(h.data()).toStrictEqual({ state: 'idle', error: null })

    // Turn 1 of the script holds the turn open after its answer until the next message.
    h.registry.get(tempId).send('прогони волну 5')
    await vi.waitFor(() => expect(h.data().statusBlock).toBe(BLOCK_1))
    expect(h.data().state).toBe('busy')
    const sdkId = h.data().sessionId
    expect(sdkId).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.data()).toMatchObject({ model: 'claude-opus-5-5' })
    h.registry.get(tempId).send('дальше')
    await vi.waitFor(() => expect(h.data().costUsd).toBe(0.0125))
    expect(h.data().state).toBe('idle')

    // Turn 2: a subagent's block and an answer without one change nothing.
    h.registry.get(tempId).send('статус')
    await vi.waitFor(() => expect(h.data().costUsd).toBe(0.02))
    expect(h.data().statusBlock).toBe(BLOCK_1)

    // Turn 3: of two blocks, the last one.
    h.registry.get(tempId).send('статус')
    await vi.waitFor(() => expect(h.data().costUsd).toBe(0.03))
    expect(h.data()).toStrictEqual({ state: 'idle', error: null, sessionId: sdkId, model: 'claude-opus-5-5', costUsd: 0.03, statusBlock: BLOCK_3 })
    expect(h.states).toEqual(['starting', 'idle', 'busy', 'idle', 'busy', 'idle', 'busy', 'idle'])

    // Every event also went out under the Session's id, the final one from `renamed` on.
    expect(h.broadcast.filter((e) => e.event.type === 'result')).toHaveLength(3)
    expect(h.broadcast.find((e) => e.event.type === 'renamed')).toEqual({ sessionId: sdkId, event: { type: 'renamed', from: tempId } })
  })

  it('after a restart resumes the saved session and keeps counting its cost', async () => {
    const first = harness()
    const { sessionId } = first.orchestrators.open(PROJECT)
    first.registry.get(sessionId).send('one')
    await vi.waitFor(() => expect(first.data().statusBlock).toBe(BLOCK_1))
    first.registry.get(sessionId).send('release')
    await vi.waitFor(() => expect(first.data().costUsd).toBe(0.0125))
    const sdkId = first.data().sessionId
    first.registry.closeAll()
    first.layout.flushAll()
    const onDisk = JSON.parse(readFileSync(join(scratch, 'data', PROJECT, 'layout.json'), 'utf8')) as { nodes: LayoutNode[] }
    expect(onDisk.nodes[0]?.data).toMatchObject({ sessionId: sdkId, costUsd: 0.0125, statusBlock: BLOCK_1 })

    const second = harness()
    const reopened = second.orchestrators.open(PROJECT)
    expect(second.requests.map((request) => request.resume)).toEqual([sdkId])
    // What the Node showed before the restart is there at once; the state starts over.
    expect(second.data()).toMatchObject({ state: 'starting', statusBlock: BLOCK_1, costUsd: 0.0125 })
    second.registry.get(reopened.sessionId).send('one')
    await vi.waitFor(() => expect(second.data().state).toBe('busy'))
    second.registry.get(reopened.sessionId).send('release')
    // A new Claude Code process counts from zero: 0.0125 before the restart + 0.0125 now.
    await vi.waitFor(() => expect(second.data().costUsd).toBe(0.025))
    expect(second.data().sessionId).toBe(sdkId)
  })

  it('a crashed Session shows error with its reason in the Node data', async () => {
    const h = harness('crash')
    const { sessionId } = h.orchestrators.open(PROJECT)
    h.registry.get(sessionId).send('go')
    await vi.waitFor(() => expect(h.data().state).toBe('error'))
    expect(h.data().error).toEqual(expect.any(String))
  })

  it('a closed Orchestrator is started again by the next open, resuming its session', async () => {
    const h = harness()
    const first = h.orchestrators.open(PROJECT)
    h.registry.get(first.sessionId).send('one')
    await vi.waitFor(() => expect(h.data().sessionId).toBeDefined())
    h.registry.get(first.sessionId).close()
    expect(h.data().state).toBe('closed')
    const again = h.orchestrators.open(PROJECT)
    expect(again.sessionId).not.toBe(first.sessionId)
    expect(h.requests.map((request) => request.resume)).toEqual([undefined, h.data().sessionId])
  })

  it('retain stops the Orchestrators of Projects removed from the list', () => {
    const h = harness()
    const { sessionId } = h.orchestrators.open(PROJECT)
    h.orchestrators.retain(new Set([PROJECT]))
    expect(h.registry.get(sessionId).state).not.toBe('closed')
    h.known.delete(PROJECT)
    h.orchestrators.retain(new Set())
    expect(() => h.registry.get(sessionId)).toThrow(/No live Session/)
  })
})

describe('CostCounter', () => {
  it('adds the processes of a Session: a crash or a smaller figure starts a new process', () => {
    const cost = new CostCounter(1)
    expect(cost.result(0.5)).toBe(1.5)
    expect(cost.result(0.75)).toBe(1.75)
    cost.processEnded()
    expect(cost.result(0.25)).toBe(2)
    // No crash reported, but the figure went down: a new process.
    expect(cost.result(0.1)).toBe(2.1)
  })
})

describe('orchestrator.open channel', () => {
  async function channel(open: (projectId: string) => unknown) {
    const { orchestratorHandlers } = await import('../../src/main/ipc/orchestrator')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    const fake = { open: vi.fn(open) }
    await registerIpc(
      { handle: (name, listener) => handlers.set(name, listener) },
      { modules: { './orchestrator.ts': () => Promise.resolve(orchestratorHandlers(() => fake as unknown as Orchestrators)) }, isTrustedSender: (url) => url === APP_URL },
    )
    const call = async (input: unknown) => {
      const listener = handlers.get(`${IPC_CHANNEL_PREFIX}orchestrator.open`)
      if (!listener) throw new Error('orchestrator.open is not registered')
      return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<OrchestratorInfo>
    }
    return { call, fake }
  }

  const info: OrchestratorInfo = { projectId: PROJECT, nodeId: 'orch', sessionId: 'pending-1', state: 'idle' }

  it.each([
    ['no projectId', {}],
    ['a projectId of the wrong type', { projectId: 7 }],
    ['an empty projectId', { projectId: '' }],
  ])('rejects %s before the handler runs', async (_label, input) => {
    const { call, fake } = await channel(() => info)
    const result = await call(input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/orchestrator\.open: invalid input/)
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('passes only the projectId and answers only the declared keys', async () => {
    const { call, fake } = await channel(() => ({ ...info, internal: 'leak' }))
    expect(await call({ projectId: PROJECT, admin: true })).toStrictEqual({ ok: true, value: info })
    expect(fake.open).toHaveBeenCalledWith(PROJECT)
  })

  it('refuses an answer outside the contract', async () => {
    const { call } = await channel(() => ({ ...info, state: 'sleeping' }))
    const result = await call({ projectId: PROJECT })
    expect(result.ok).toBe(false)
  })
})

describe("main's own wiring", () => {
  it('opens the active Project on the first window, a Project that becomes active, and stops a removed one', async () => {
    const other = join(scratch, 'other')
    mkdirSync(other)
    mkdirSync(join(scratch, 'data', 'other-0000000e'))
    writeFileSync(
      join(scratch, 'data', 'projects.json'),
      JSON.stringify({ projects: [{ id: PROJECT, name: 'repo', path: repo }, { id: 'other-0000000e', name: 'other', path: other }], activeId: PROJECT }),
    )
    vi.stubEnv('WORFY_DATA_DIR', join(scratch, 'data'))
    vi.stubEnv('WORFY_AGENT', 'fake')
    vi.stubEnv('WORFY_AGENT_SCRIPTS', scriptsDir)
    vi.stubEnv('WORFY_AGENT_SCRIPT', 'orchestrator')
    // Only this module instance may answer the window event: an earlier import of the module
    // (the channel tests) runs over the real data folder.
    electron.listeners.clear()
    vi.resetModules()
    try {
      await import('../../src/main/ipc/orchestrator')
      const { layoutStore } = await import('../../src/main/layout/store')
      const { projectStore } = await import('../../src/main/projects/store')
      const { sharedRegistry } = await import('../../src/main/ipc/agent')
      const orchestratorOf = (projectId: string) => layoutStore().get(projectId).layout.nodes.filter((node) => node.kind === 'orchestrator')

      // Nothing is opened while the module loads.
      expect(sharedRegistry().list()).toEqual([])
      for (const listener of electron.listeners.get('browser-window-created') ?? []) listener()
      expect(orchestratorOf(PROJECT)).toHaveLength(1)
      expect(sharedRegistry().list()).toMatchObject([{ cwd: repo }])
      await vi.waitFor(() => expect(electron.sent.some(({ channel }) => channel === `${IPC_CHANNEL_PREFIX}agent.event`)).toBe(true))

      projectStore().select('other-0000000e')
      expect(orchestratorOf('other-0000000e')).toHaveLength(1)
      expect(sharedRegistry().list().map((session) => session.cwd)).toEqual([repo, other])

      projectStore().remove(PROJECT)
      expect(sharedRegistry().list().map((session) => session.cwd)).toEqual([other])
      sharedRegistry().closeAll()
      layoutStore().flushAll()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
