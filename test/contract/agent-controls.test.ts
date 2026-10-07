// The controls of a Session through the `agent.*` IPC channels, on the fake agent (ticket 19):
// model, effort and permission mode (agent.configure, agent.models), and the message queue
// (agent.controls, agent.queueRemove, agent.queueSend). The model floor of worfy-daily ticket 07:
// no haiku in the list or in a Session, and a haiku in the user's settings.json of a temporary
// WORFY_CLAUDE_HOME starts Claude Code on sonnet without that file being touched.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_MODELS, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { HALT_TURN_MS, modelOptions, SessionRegistry, USER_MODEL_FALLBACK, type QueryRequest } from '../../src/main/agent/session'
import { readUserEffort, readUserModel } from '../../src/main/claude-home/user-model'
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

let emptyHome: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-controls-'))
  // The user's model and effort come from <Claude home>/settings.json: an empty home of the test's
  // own unless a test writes one, never the real ~/.claude.
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-controls-empty-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    // null goes back to the user's model and effort; with neither in settings.json, to Claude Code's defaults.
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
    await h.ok('agent.configure', { sessionId: id, change: { model: 'opus', permissionMode: 'default' } })
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    const starts = h.calls.filter((call) => call.kind === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ settings: { model: 'opus', effort: null, permissionMode: 'default' } })
    expect(h.ofType('init').at(-1)).toMatchObject({ model: 'opus', permissionMode: 'default' })
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
  it("lists supportedModels() of the live Session with only the declared keys, haiku left out; the SDK's default row is the null model", async () => {
    const h = await harness('turn')
    const id = await h.start()
    // The fake's rows carry `description` and `resolvedModel`, as the SDK's do, and a haiku row.
    expect(FAKE_MODELS[0]).toHaveProperty('resolvedModel')
    expect(FAKE_MODELS.map((model) => model.value)).toContain('haiku')
    expect(await h.ok('agent.models', { sessionId: id })).toStrictEqual({
      models: [
        { value: null, displayName: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'opus', displayName: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'sonnet', displayName: 'Sonnet', efforts: ['low', 'medium', 'high', 'max'] },
      ],
    })
  })

  it('modelOptions leaves out the haiku family by value or by name; sonnet and larger stay', () => {
    expect(
      modelOptions([
        { value: 'haiku' },
        { value: 'claude-haiku-4-5-20251001' },
        { value: 'claude-3-5-haiku-latest' },
        { value: 'fast', displayName: 'Haiku 4.5' },
        { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)' },
        { value: 'claude-opus-5-5' },
      ]).map((row) => row.value),
    ).toStrictEqual(['sonnet[1m]', 'claude-opus-5-5'])
  })

  it('modelOptions keeps the declared keys only and drops effort levels it does not know', () => {
    expect(
      modelOptions([{ value: 'x', displayName: 'X', supportsEffort: true, supportedEffortLevels: ['low', 'turbo'], description: 'd' } as never, { value: 'y' }]),
    ).toStrictEqual([
      { value: 'x', displayName: 'X', efforts: ['low'] },
      { value: 'y', displayName: 'y', efforts: [] },
    ])
  })

  it.each([
    ['claude-sonnet-4-5-20250929', [{ value: 'claude-sonnet-4-5-20250929', displayName: 'claude-sonnet-4-5-20250929', efforts: [] }]],
    // The init model of a process is not offered when it is a haiku.
    ['claude-haiku-4-5-20251001', []],
  ])('falls back to the model of the last system/init (%s) when supportedModels() has nothing', async (initModel, offered) => {
    const scriptsDir = await mkdtemp(join(tmpdir(), 'worfy-controls-scripts-'))
    try {
      const turn = await readFile(join(fixtures, 'turn.jsonl'), 'utf8')
      expect(turn).toContain('claude-haiku-4-5-20251001')
      await writeFile(join(scriptsDir, 'no-models.jsonl'), `${JSON.stringify({ fake: 'models', models: [] })}\n${turn.replaceAll('claude-haiku-4-5-20251001', initModel)}`)
      const h = await harness('no-models', scriptsDir)
      const id = await h.start()
      // Before any turn there is no model to offer.
      expect(await h.ok('agent.models', { sessionId: id })).toEqual({ models: [] })
      await h.ok('agent.send', { sessionId: id, text: 'hello' })
      await vi.waitFor(() => expect(h.results()).toBe(1))
      expect(h.ofType('init').at(-1)).toMatchObject({ model: initModel })
      expect(await h.ok('agent.models', { sessionId: id })).toStrictEqual({ models: offered })
    } finally {
      await rm(scriptsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

/** Every file under `dir` with its bytes and mtime: two equal snapshots mean nothing was written there. */
async function snapshot(dir: string): Promise<Record<string, { bytes: string; mtimeMs: number }>> {
  const tree: Record<string, { bytes: string; mtimeMs: number }> = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    const info = await stat(path)
    tree[relative(dir, path)] = { bytes: entry.isFile() ? (await readFile(path)).toString('base64') : '', mtimeMs: info.mtimeMs }
  }
  return tree
}

describe('the model floor: sonnet or larger, never haiku (worfy-daily ticket 07)', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'worfy-controls-claude-home-'))
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const userSettings = (value: unknown) => writeFile(join(home, 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value))

  it.each([
    ['no settings.json', null],
    ['a settings.json without a model', { theme: 'dark' }],
    ['a settings.json that is not JSON', '{"model": "haiku"'],
    ['a model of the wrong type', { model: 42 }],
    ['the user model opus[1m]', { model: 'opus[1m]' }],
    ['the user model sonnet', { model: 'sonnet' }],
  ])('a new Session without a pick starts with model null under %s', async (_label, settings) => {
    if (settings !== null) await userSettings(settings)
    const h = await harness('turn')
    const id = await h.start()
    expect(h.requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
    expect(h.registry.get(id).settings).toStrictEqual(DEFAULT_SETTINGS)
    expect(h.ofType('settings')).toEqual([{ type: 'settings', settings: DEFAULT_SETTINGS }])
  })

  it.each(['haiku', 'claude-haiku-4-5-20251001', 'Haiku'])(
    "a user model %s in settings.json starts Claude Code on sonnet; the Session keeps null and the Claude home is not touched",
    async (userModel) => {
      await userSettings({ model: userModel, permissions: { allow: ['Bash'] } })
      await mkdir(join(home, 'projects'))
      await writeFile(join(home, 'projects', 'keep.jsonl'), '{}\n')
      const before = await snapshot(home)

      const h = await harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
      const { sessionId: id } = await h.ok<{ sessionId: string }>('agent.start', { cwd })
      await h.ok('agent.send', { sessionId: id, text: 'go' })
      await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
      // Every process the Session starts is asked for sonnet: the first one and the resumed one.
      await h.ok('agent.send', { sessionId: id, text: 'again' })
      await vi.waitFor(() => expect(h.results()).toBe(1))
      const starts = h.calls.filter((call) => call.kind === 'start')
      expect(starts.map((call) => (call.kind === 'start' ? call.settings : null))).toStrictEqual([
        { ...DEFAULT_SETTINGS, model: 'sonnet' },
        { ...DEFAULT_SETTINGS, model: 'sonnet' },
      ])
      expect(h.ofType('init').at(-1)).toMatchObject({ model: 'sonnet' })
      // The Session's own settings, and so the Node's saved picks, stay the default model.
      expect(h.registry.get(id).settings).toStrictEqual(DEFAULT_SETTINGS)
      expect(h.ofType('settings').map((event) => event.settings)).toStrictEqual([DEFAULT_SETTINGS])
      // Back to the default model while on it: no control call, the process stays on sonnet.
      await h.ok('agent.configure', { sessionId: id, change: { model: null } })
      expect(controlCalls(h.calls)).toEqual([])

      expect(await snapshot(home)).toStrictEqual(before)
    },
  )

  it('a picked model is passed as it is, whatever the user model is', async () => {
    await userSettings({ model: 'haiku' })
    const h = await harness('turn')
    const session = h.registry.start(cwd, undefined, () => undefined, { model: 'opus', effort: 'high', permissionMode: 'plan' })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(h.requests.map((request) => request.settings)).toStrictEqual([{ model: 'opus', effort: 'high', permissionMode: 'plan' }])
  })

  it('reads the user model again for each Claude Code process', async () => {
    const h = await harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
    const { sessionId: id } = await h.ok<{ sessionId: string }>('agent.start', { cwd })
    await h.ok('agent.send', { sessionId: id, text: 'go' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    await userSettings({ model: 'haiku' })
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.requests.map((request) => request.settings.model)).toStrictEqual([null, 'sonnet'])
  })

  it('a user model that cannot be read leaves the Session on the default model', async () => {
    const fake = fakeQueryFactory({ scriptsDir: fixtures, script: 'turn' })
    const requests: QueryRequest[] = []
    const registry = new SessionRegistry(
      (request) => {
        requests.push(request)
        return fake(request)
      },
      () => {
        throw new Error('unreadable')
      },
    )
    registries.push(registry)
    const session = registry.start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
  })

  it.each([
    ['haiku', { model: 'haiku', effort: 'high', permissionMode: 'plan' }],
    ['a full haiku id', { model: 'claude-haiku-4-5-20251001', effort: null, permissionMode: 'acceptEdits' }],
  ] as const)('a Node with a saved %s starts on the default model with the effort reset', async (_label, saved) => {
    const h = await harness('turn')
    const events: AgentEvent[] = []
    const session = h.registry.start(cwd, undefined, (_id, event) => events.push(event), saved)
    const expected = { model: null, effort: null, permissionMode: saved.permissionMode }
    expect(session.settings).toStrictEqual(expected)
    // The start's settings event carries the corrected picks: the Orchestrator saves them from it.
    expect(events.find((event) => event.type === 'settings')).toEqual({ type: 'settings', settings: expected })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(h.requests.map((request) => request.settings)).toStrictEqual([expected])
    expect(h.calls.find((call) => call.kind === 'start')).toMatchObject({ settings: expected })
  })

  it('refuses to switch a Session to a haiku; the settings stay as they were', async () => {
    const h = await harness('turn')
    const id = await h.start()
    const result = await h.call('agent.configure', { sessionId: id, change: { model: 'claude-haiku-4-5', effort: 'low' } })
    expect(!result.ok && result.error).toMatch(/sonnet or a larger model/)
    expect(h.registry.get(id).settings).toStrictEqual(DEFAULT_SETTINGS)
    expect(controlCalls(h.calls)).toEqual([])
    // A model at the floor still goes through.
    expect(await h.ok('agent.configure', { sessionId: id, change: { model: 'sonnet' } })).toMatchObject({ model: 'sonnet' })
  })
})

describe("Default is the user's model and effort (worfy-daily ticket 23)", () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'worfy-controls-user-defaults-'))
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const userSettings = (value: unknown) => writeFile(join(home, 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value))
  const starts = (calls: FakeCall[]) => calls.flatMap((call) => (call.kind === 'start' ? [call.settings] : []))

  it("Default after another model calls setModel with the user's model from settings.json", async () => {
    await userSettings({ model: 'claude-opus-5-5[1m]', effortLevel: 'high' })
    const h = await harness('turn')
    const id = await h.start()
    await h.ok('agent.configure', { sessionId: id, change: { model: 'sonnet' } })
    const settings = await h.ok('agent.configure', { sessionId: id, change: { model: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'setModel', model: 'sonnet' },
      { kind: 'setModel', model: 'claude-opus-5-5[1m]' },
    ])
    // The Session's settings, and so its header and the Node's saved picks, keep "no pick".
    expect(settings).toMatchObject({ model: null })
    await h.ok('agent.send', { sessionId: id, text: 'hello' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.ofType('init').at(-1)).toMatchObject({ model: 'claude-opus-5-5[1m]' })
  })

  it.each([
    ['no settings.json', null],
    ['no model field', { effortLevel: 'high' }],
    ['a model of the wrong type', { model: 42 }],
  ])('Default after another model calls setModel(undefined) under %s', async (_label, value) => {
    if (value !== null) await userSettings(value)
    const h = await harness('turn')
    const id = await h.start()
    await h.ok('agent.configure', { sessionId: id, change: { model: 'opus' } })
    await h.ok('agent.configure', { sessionId: id, change: { model: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'setModel', model: 'opus' },
      { kind: 'setModel', model: null },
    ])
  })

  it("Default with a haiku as the user's model goes to sonnet (the model floor of ticket 07)", async () => {
    await userSettings({ model: 'claude-haiku-4-5' })
    const h = await harness('turn')
    const id = await h.start()
    await h.ok('agent.configure', { sessionId: id, change: { model: 'opus' } })
    await h.ok('agent.configure', { sessionId: id, change: { model: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'setModel', model: 'opus' },
      { kind: 'setModel', model: USER_MODEL_FALLBACK },
    ])
  })

  it("a Session without an effort pick starts with the user's effortLevel, and effort default goes back to it", async () => {
    await userSettings({ effortLevel: 'high' })
    const h = await harness('turn')
    const id = await h.start()
    expect(h.requests.map((request) => request.settings)).toStrictEqual([{ ...DEFAULT_SETTINGS, effort: 'high' }])
    expect(starts(h.calls)).toStrictEqual([{ ...DEFAULT_SETTINGS, effort: 'high' }])
    // The header still shows "no pick".
    expect(h.registry.get(id).settings).toStrictEqual(DEFAULT_SETTINGS)
    expect(h.ofType('settings').map((event) => event.settings)).toStrictEqual([DEFAULT_SETTINGS])

    await h.ok('agent.configure', { sessionId: id, change: { effort: 'low' } })
    await h.ok('agent.configure', { sessionId: id, change: { effort: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'applyFlagSettings', settings: { effortLevel: 'low' } },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'high' } },
    ])
    expect(h.registry.get(id).settings).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('a picked effort is passed as it is, whatever the user effort is', async () => {
    await userSettings({ effortLevel: 'high' })
    const h = await harness('turn')
    const session = h.registry.start(cwd, undefined, () => undefined, { model: null, effort: 'low', permissionMode: 'plan' })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(h.requests.map((request) => request.settings)).toStrictEqual([{ model: null, effort: 'low', permissionMode: 'plan' }])
  })

  it.each([
    ['no effortLevel', { model: 'opus' }],
    ['an effortLevel worfy does not know', { effortLevel: 'ultra' }],
    ['an effortLevel of the wrong type', { effortLevel: 3 }],
    ['a settings.json that is not JSON', '{"effortLevel": "high"'],
  ])('effort default calls applyFlagSettings with null under %s', async (_label, value) => {
    await userSettings(value)
    const h = await harness('turn')
    const id = await h.start()
    expect(starts(h.calls)).toStrictEqual([DEFAULT_SETTINGS])
    await h.ok('agent.configure', { sessionId: id, change: { effort: 'max' } })
    await h.ok('agent.configure', { sessionId: id, change: { effort: null } })
    expect(controlCalls(h.calls)).toEqual([
      { kind: 'applyFlagSettings', settings: { effortLevel: 'max' } },
      { kind: 'applyFlagSettings', settings: { effortLevel: null } },
    ])
  })

  it('reads the user effort again for each Claude Code process; a reader that throws leaves effort to Claude Code', async () => {
    const fake = fakeQueryFactory({ scriptsDir: fixtures, script: 'turn' })
    const requests: QueryRequest[] = []
    let effort: () => 'xhigh' | null = () => {
      throw new Error('unreadable')
    }
    const registry = new SessionRegistry(
      (request) => {
        requests.push(request)
        return fake(request)
      },
      () => null,
      () => effort(),
    )
    registries.push(registry)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = registry.start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(first.state).toBe('idle'))
    effort = () => 'xhigh'
    const second = registry.start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(second.state).toBe('idle'))
    expect(requests.map((request) => request.settings.effort)).toStrictEqual([null, 'xhigh'])
    expect(warn).toHaveBeenCalled()
  })

  it("leaves the Claude home as it was: settings.json and every other file", async () => {
    await userSettings({ model: 'claude-opus-5-5[1m]', effortLevel: 'high', permissions: { allow: ['Bash'] } })
    await mkdir(join(home, 'projects'))
    await writeFile(join(home, 'projects', 'keep.jsonl'), '{}\n')
    const before = await snapshot(home)

    const h = await harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
    const { sessionId: id } = await h.ok<{ sessionId: string }>('agent.start', { cwd })
    await h.ok('agent.configure', { sessionId: id, change: { model: 'sonnet', effort: 'low' } })
    await h.ok('agent.configure', { sessionId: id, change: { model: null, effort: null } })
    await h.ok('agent.send', { sessionId: id, text: 'go' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(starts(h.calls)).toHaveLength(2)

    expect(await snapshot(home)).toStrictEqual(before)
  })
})

describe('readUserEffort', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'worfy-user-effort-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it.each([
    ['no settings.json', undefined, null],
    ['a file that is not JSON', '{"effortLevel":', null],
    ['JSON that is not an object', '"high"', null],
    ['no effortLevel field', '{"model":"opus"}', null],
    ['an effortLevel that is not a string', '{"effortLevel":["high"]}', null],
    ['an unknown level', '{"effortLevel":"ultra"}', null],
    ['high', '{"effortLevel":"high","model":"opus"}', 'high'],
    ['xhigh', '{"effortLevel":"xhigh"}', 'xhigh'],
  ])('answers %s with %s', async (_label, text, expected) => {
    if (text !== undefined) await writeFile(join(home, 'settings.json'), text)
    expect(readUserEffort(home)).toBe(expected)
  })

  it('reads <WORFY_CLAUDE_HOME>/settings.json by default', async () => {
    await writeFile(join(home, 'settings.json'), '{"effortLevel":"low"}')
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
    expect(readUserEffort()).toBe('low')
  })
})

describe('readUserModel', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'worfy-user-model-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it.each([
    ['no settings.json', undefined, null],
    ['an empty file', '', null],
    ['a file that is not JSON', '{"model":', null],
    ['JSON that is not an object', '"opus"', null],
    ['JSON null', 'null', null],
    ['no model field', '{"theme":"dark"}', null],
    ['a model that is not a string', '{"model":["opus"]}', null],
    ['an empty model', '{"model":"  "}', null],
    ['a model', '{"model":"opus[1m]","env":{}}', 'opus[1m]'],
  ])('answers %s with %s', async (_label, text, expected) => {
    if (text !== undefined) await writeFile(join(home, 'settings.json'), text)
    expect(readUserModel(home)).toBe(expected)
  })

  it('reads <WORFY_CLAUDE_HOME>/settings.json by default', async () => {
    await writeFile(join(home, 'settings.json'), '{"model":"sonnet"}')
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
    try {
      expect(readUserModel()).toBe('sonnet')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('answers null when settings.json is a directory', async () => {
    await mkdir(join(home, 'settings.json'))
    expect(readUserModel(home)).toBeNull()
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

describe('Session.halt: Stop in Autopilot (worfy-week ticket 17)', () => {
  /** A registry over the fake agent whose queries count their interrupt() calls. */
  async function halting(script: string, dir = fixtures) {
    const calls: FakeCall[] = []
    const interrupts: number[] = []
    const factory = fakeQueryFactory({ scriptsDir: dir, script, record: (call) => calls.push(call) })
    const registry = new SessionRegistry(async (request) => {
      const query = await factory(request)
      const interrupt = query.interrupt.bind(query)
      query.interrupt = () => {
        interrupts.push(Date.now())
        return interrupt()
      }
      return query
    })
    registries.push(registry)
    const session = registry.start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    const messages = () => calls.flatMap((call) => (call.kind === 'message' ? [call.text] : []))
    return { session, interrupts, messages }
  }

  it('in a turn: interrupts it and waits for its result; the queue is held after', async () => {
    const { session, interrupts, messages } = await halting('interrupt')
    session.send('count')
    session.send('then this')
    expect(session.state).toBe('busy')
    await session.halt()
    expect(interrupts).toHaveLength(1)
    expect(session.state).toBe('idle')
    expect(session.queued()).toMatchObject({ items: [{ text: 'then this' }], paused: true })
    // Nothing more goes into the process: the queued message waits for "Send queued".
    await new Promise((done) => setTimeout(done, 50))
    expect(messages()).toEqual(['count'])
  })

  it('an idle Session is not interrupted', async () => {
    const { session, interrupts } = await halting('interrupt')
    await session.halt()
    expect(interrupts).toEqual([])
    expect(session.state).toBe('idle')
  })

  it('waits no longer than its limit for a turn that does not end; HALT_TURN_MS is 15 s', async () => {
    expect(HALT_TURN_MS).toBe(15_000)
    const dir = await mkdtemp(join(tmpdir(), 'worfy-halt-scripts-'))
    try {
      const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'claude-opus-5-5', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', uuid: '00000000-0000-4000-8000-000000017001' }
      await writeFile(join(dir, 'stuck.jsonl'), `${[{ fake: 'wait_message' }, init, { fake: 'wait_release', name: 'never' }].map((line) => JSON.stringify(line)).join('\n')}\n`)
      const { session, interrupts } = await halting('stuck', dir)
      session.send('a long task')
      const started = Date.now()
      await session.halt(100)
      expect(Date.now() - started).toBeLessThan(2000)
      expect(interrupts).toHaveLength(1)
      // The turn still runs: closing the process (Orchestrators.giveBackNow) ends it.
      expect(session.state).toBe('busy')
      session.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a message a person sends while the halt waits is held, not sent after the interrupted turn', async () => {
    const { session, messages } = await halting('interrupt')
    session.send('count')
    const halted = session.halt()
    // Between the interrupt and the turn's result: the queue was empty when it was held.
    expect(session.send('sent during the stop')).toBe('queued')
    await halted
    await new Promise((done) => setTimeout(done, 50))
    expect(messages()).toEqual(['count'])
    expect(session.queued()).toMatchObject({ items: [{ text: 'sent during the stop' }], paused: true })
    // After the halt an idle Session takes nothing in either: the message waits in the held queue.
    expect(session.send('sent after the stop')).toBe('queued')
    await new Promise((done) => setTimeout(done, 50))
    expect(messages()).toEqual(['count'])
    expect(session.queued().items.map((item) => item.text)).toEqual(['sent during the stop', 'sent after the stop'])
  })

  it('"Send queued" on a halted Session sends nothing into its process: during the halt\'s wait, at the turn\'s end, or after (Force stop, worfy-week ticket 18)', async () => {
    const { session, messages } = await halting('interrupt')
    session.send('count')
    session.send('then this')
    const halted = session.halt()
    // The person resumes the queue while the halt waits: the interrupted turn's end must not send it.
    session.sendQueued()
    await halted
    await new Promise((done) => setTimeout(done, 50))
    expect(session.state).toBe('idle')
    expect(messages()).toEqual(['count'])
    // Resumed again on the idle, halted Session: still nothing goes into the process.
    session.sendQueued()
    await new Promise((done) => setTimeout(done, 50))
    expect(messages()).toEqual(['count'])
    expect(session.state).toBe('idle')
    expect(session.queued().items.map((item) => item.text)).toEqual(['then this'])
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
