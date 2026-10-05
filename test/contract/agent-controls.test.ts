// The controls of a Session through the `agent.*` IPC channels, on the fake agent (ticket 19):
// model, effort and permission mode (agent.configure, agent.models), and the message queue
// (agent.controls, agent.queueRemove, agent.queueSend).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_MODELS, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { modelOptions, SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { agentHandlers } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS, readSettings } from '../../src/shared/agent/settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let cwd: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-controls-'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function harness(script: string | ((request: QueryRequest) => string), scriptsDir = fixtures) {
  const calls: FakeCall[] = []
  const requests: QueryRequest[] = []
  const factory = fakeQueryFactory({ scriptsDir, script, record: (call) => calls.push(call) })
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return factory(request)
  })
  registries.push(registry)
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry)) }, isTrustedSender: (url) => url === APP_URL })
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  const call = async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown): Promise<T> => {
    const result = await call(channel, input)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  const events = (): AgentEvent[] => received.map((each) => each.event)
  const ofType = <T extends AgentEvent['type']>(type: T) => events().filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  const start = async () => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', { cwd })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    return sessionId
  }
  const results = () => ofType('result').length
  return { call, ok, calls, requests, registry, events, ofType, start, results }
}

const controlCalls = (calls: FakeCall[]) => calls.filter((call) => call.kind !== 'message' && call.kind !== 'start')

describe('agent.configure', () => {
  it('changes model, effort and permission mode of the live Session; the next turn runs with the model and mode', async () => {
    const h = await harness('turn')
    const id = await h.start()
    expect(h.ofType('settings')).toEqual([{ type: 'settings', settings: DEFAULT_SETTINGS }])

    const settings = await h.ok('agent.configure', { sessionId: id, change: { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' } })
    expect(settings).toStrictEqual({ model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'setModel', model: 'sonnet' },
      { kind: 'setPermissionMode', mode: 'acceptEdits' },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'high' } },
    ])
    expect(h.ofType('settings').at(-1)).toEqual({ type: 'settings', settings })

    await h.ok('agent.send', { sessionId: id, text: 'hello' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.ofType('init').at(-1)).toMatchObject({ model: 'sonnet', permissionMode: 'acceptEdits' })
    // No restart: one Claude Code process for all of it.
    expect(h.requests).toHaveLength(1)
  })

  it('calls only the control of what changed; a change to the same value calls nothing', async () => {
    const h = await harness('turn')
    const id = await h.start()
    await h.ok('agent.configure', { sessionId: id, change: { permissionMode: 'plan' } })
    await h.ok('agent.configure', { sessionId: id, change: { permissionMode: 'plan' } })
    await h.ok('agent.configure', { sessionId: id, change: { effort: 'low' } })
    // null goes back to Claude Code's default model and the model's default effort.
    await h.ok('agent.configure', { sessionId: id, change: { model: 'opus' } })
    await h.ok('agent.configure', { sessionId: id, change: { model: null, effort: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'setPermissionMode', mode: 'plan' },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'low' } },
      { kind: 'setModel', model: 'opus' },
      { kind: 'setModel', model: null },
      { kind: 'applyFlagSettings', settings: { effortLevel: null } },
    ])
    expect(h.ofType('settings')).toHaveLength(5)
  })

  it('a Session resumed after a crash starts its new Claude Code with the settings', async () => {
    const h = await harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
    const { sessionId: id } = await h.ok<{ sessionId: string }>('agent.start', { cwd })
    await h.ok('agent.send', { sessionId: id, text: 'go' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    await h.ok('agent.configure', { sessionId: id, change: { model: 'haiku', permissionMode: 'default' } })
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    const starts = h.calls.filter((call) => call.kind === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ settings: { model: 'haiku', effort: null, permissionMode: 'default' } })
    expect(h.ofType('init').at(-1)).toMatchObject({ model: 'haiku', permissionMode: 'default' })
  })

  it('settings changed while Claude Code is still starting reach it once it is up', async () => {
    const calls: FakeCall[] = []
    const fake = fakeQueryFactory({ scriptsDir: fixtures, script: 'turn', record: (call) => calls.push(call) })
    let release: () => void = () => undefined
    const started = new Promise<void>((settle) => {
      release = settle
    })
    const registry = new SessionRegistry(async (request) => {
      await started
      return fake(request)
    })
    registries.push(registry)
    const events: AgentEvent[] = []
    const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
    // No live query yet: the change is only remembered.
    expect(await session.configure({ model: 'sonnet', effort: 'high', permissionMode: 'plan' })).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'plan' })
    expect(calls).toEqual([])

    release()
    await vi.waitFor(() =>
      expect(controlCalls(calls)).toEqual([
        { kind: 'setModel', model: 'sonnet' },
        { kind: 'setPermissionMode', mode: 'plan' },
        { kind: 'applyFlagSettings', settings: { effortLevel: 'high' } },
      ]),
    )
    // The query was asked for with the settings of the moment it was started.
    expect(calls.find((call) => call.kind === 'start')).toMatchObject({ settings: DEFAULT_SETTINGS })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('hello')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'result')).toBe(true))
    expect(events.findLast((event) => event.type === 'init')).toMatchObject({ model: 'sonnet', permissionMode: 'plan' })
  })

  it('a control call that fails answers the error and leaves the settings as they were', async () => {
    const h = await harness('turn')
    const id = await h.start()
    const session = h.registry.get(id)
    const run = (session as unknown as { run: { query: { setPermissionMode: () => Promise<void> } } }).run
    vi.spyOn(run.query, 'setPermissionMode').mockRejectedValue(new Error('mode refused'))
    const result = await h.call('agent.configure', { sessionId: id, change: { permissionMode: 'plan' } })
    expect(!result.ok && result.error).toMatch(/mode refused/)
    expect(session.settings).toEqual(DEFAULT_SETTINGS)
    // The next change still goes through.
    expect(await h.ok('agent.configure', { sessionId: id, change: { effort: 'max' } })).toEqual({ ...DEFAULT_SETTINGS, effort: 'max' })
  })

  it.each([
    ['a permission mode worfy does not offer', { permissionMode: 'dontAsk' }],
    ['a permission mode of the wrong type', { permissionMode: 1 }],
    ['an effort level the SDK does not take', { effort: 'ultra' }],
    ['an empty model', { model: '' }],
    ['a model of the wrong type', { model: 42 }],
  ])('refuses %s before the Session sees it', async (_label, change) => {
    const h = await harness('turn')
    const id = await h.start()
    const configure = vi.spyOn(h.registry.get(id), 'configure')
    const result = await h.call('agent.configure', { sessionId: id, change })
    expect(!result.ok && result.error).toMatch(/agent\.configure: invalid input/)
    expect(configure).not.toHaveBeenCalled()
    expect(controlCalls(h.calls)).toEqual([])
  })

  it('passes only the parsed change to the Session: extra keys never reach it', async () => {
    const h = await harness('turn')
    const id = await h.start()
    const configure = vi.spyOn(h.registry.get(id), 'configure')
    await h.ok('agent.configure', { sessionId: id, change: { model: 'opus', fastMode: true }, admin: true })
    expect(configure.mock.calls).toStrictEqual([[{ model: 'opus' }]])
  })
})

describe('agent.models', () => {
  it("lists supportedModels() of the live Session with only the declared keys; the SDK's default row is the null model", async () => {
    const h = await harness('turn')
    const id = await h.start()
    // The fake's rows carry `description` and `resolvedModel`, as the SDK's do.
    expect(FAKE_MODELS[0]).toHaveProperty('resolvedModel')
    expect(await h.ok('agent.models', { sessionId: id })).toStrictEqual({
      models: [
        { value: null, displayName: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'opus', displayName: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'sonnet', displayName: 'Sonnet', efforts: ['low', 'medium', 'high', 'max'] },
        { value: 'haiku', displayName: 'Haiku', efforts: [] },
      ],
    })
  })

  it('modelOptions keeps the declared keys only and drops effort levels it does not know', () => {
    expect(
      modelOptions([{ value: 'x', displayName: 'X', supportsEffort: true, supportedEffortLevels: ['low', 'turbo'], description: 'd' } as never, { value: 'y' }]),
    ).toStrictEqual([
      { value: 'x', displayName: 'X', efforts: ['low'] },
      { value: 'y', displayName: 'y', efforts: [] },
    ])
  })

  it('falls back to the model of the last system/init when supportedModels() has nothing', async () => {
    const scriptsDir = await mkdtemp(join(tmpdir(), 'worfy-controls-scripts-'))
    try {
      const turn = await import('node:fs/promises').then(({ readFile }) => readFile(join(fixtures, 'turn.jsonl'), 'utf8'))
      await writeFile(join(scriptsDir, 'no-models.jsonl'), `${JSON.stringify({ fake: 'models', models: [] })}\n${turn}`)
      const h = await harness('no-models', scriptsDir)
      const id = await h.start()
      // Before any turn there is no model to offer.
      expect(await h.ok('agent.models', { sessionId: id })).toEqual({ models: [] })
      await h.ok('agent.send', { sessionId: id, text: 'hello' })
      await vi.waitFor(() => expect(h.results()).toBe(1))
      expect(await h.ok('agent.models', { sessionId: id })).toStrictEqual({ models: [{ value: 'claude-haiku-4-5-20251001', displayName: 'claude-haiku-4-5-20251001', efforts: [] }] })
    } finally {
      await rm(scriptsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('the queue over IPC', () => {
  it('agent.controls answers the settings and the queue; queueRemove and queueSend act on it', async () => {
    const h = await harness('interrupt')
    const id = await h.start()
    expect(await h.ok('agent.controls', { sessionId: id })).toStrictEqual({ settings: DEFAULT_SETTINGS, queue: { items: [], paused: false } })
    await h.ok('agent.send', { sessionId: id, text: 'count' })
    await h.ok('agent.send', { sessionId: id, text: 'keep' })
    await h.ok('agent.send', { sessionId: id, text: 'drop' })
    const { queue } = await h.ok<{ queue: { items: { id: string; text: string }[] } }>('agent.controls', { sessionId: id })
    expect(queue.items.map((item) => item.text)).toEqual(['keep', 'drop'])
    const drop = queue.items[1]?.id
    expect(await h.ok('agent.queueRemove', { sessionId: id, id: drop })).toStrictEqual({ removed: true })
    expect(await h.ok('agent.queueRemove', { sessionId: id, id: drop })).toStrictEqual({ removed: false })

    await vi.waitFor(() => expect(h.ofType('delta')).toHaveLength(1))
    await h.ok('agent.interrupt', { sessionId: id })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.ofType('queue').at(-1)).toMatchObject({ items: [{ text: 'keep' }], paused: true })
    await h.ok('agent.queueSend', { sessionId: id })
    await vi.waitFor(() => expect(h.calls.filter((call) => call.kind === 'message').map((call) => (call.kind === 'message' ? call.text : ''))).toEqual(['count', 'keep']))
    expect(h.ofType('prompt').map((event) => event.text)).toEqual(['count', 'keep'])
  })

  it.each([
    ['an empty queued id', 'agent.queueRemove', { sessionId: 's', id: '' }],
    ['a queued id of the wrong type', 'agent.queueRemove', { sessionId: 's', id: 3 }],
    ['a session id of the wrong type', 'agent.queueSend', { sessionId: 3 }],
    ['a missing session id', 'agent.controls', {}],
    ['a session id of the wrong type', 'agent.models', { sessionId: null }],
  ])('refuses %s (%s)', async (_label, channel, input) => {
    const h = await harness('turn')
    const result = await h.call(channel, input)
    expect(!result.ok && result.error).toMatch(new RegExp(`${channel.replace('.', '\\.')}: invalid input`))
  })

  it('answers agent.controls with the declared keys only', async () => {
    const h = await harness('turn')
    const id = await h.start()
    const session = h.registry.get(id)
    vi.spyOn(session, 'controls').mockReturnValue({
      settings: { ...DEFAULT_SETTINGS, secret: 'x' },
      queue: { items: [{ id: 'q', text: 't', at: 1 }], paused: false, extra: 1 },
    } as never)
    expect(await h.ok('agent.controls', { sessionId: id })).toStrictEqual({ settings: DEFAULT_SETTINGS, queue: { items: [{ id: 'q', text: 't' }], paused: false } })
  })
})

describe('readSettings', () => {
  it('keeps the valid fields and falls back to the default for each damaged one', () => {
    expect(readSettings(undefined)).toStrictEqual(DEFAULT_SETTINGS)
    expect(readSettings('opus')).toStrictEqual(DEFAULT_SETTINGS)
    expect(readSettings({ model: 'opus', effort: 'ultra', permissionMode: 'yolo', extra: 1 })).toStrictEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(readSettings({ model: null, effort: 'max', permissionMode: 'plan' })).toStrictEqual({ model: null, effort: 'max', permissionMode: 'plan' })
  })
})
