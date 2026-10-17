// The autocompact window of a Session (worfy-polish ticket 24): two app settings of this Machine
// (src/shared/settings/app-settings.ts), one for the Orchestrator — attended and under Autopilot —
// and one for every other Session. Main reads them each time a Session starts Claude Code
// (src/main/agent/app-registry.ts) and passes the window as the flag settings of query()
// (`settings: { autoCompactWindow }`, src/main/agent/options.ts); "Claude Code default" (null)
// passes nothing, so the user's settings.json and Claude Code decide.
//
// A window the person never chose in worfy (worfy-polish ticket 29) gives way to `autoCompactWindow`
// of <claudeHome>/settings.json: worfy then passes nothing and Claude Code takes the user's own
// window; only with none there do worfy's 400K and 500K go. A window chosen in Settings — "Custom" or
// "Claude Code default" — wins over settings.json.
//
// The chain runs for real from the Orchestrators and the Session registry down to the options of
// query(); the Session itself plays the fake agent. No Claude Code can start, three ways over:
// - sdkQueryFactory gets query() from the test (`loadSdk`), so the SDK module is never imported;
// - were it imported all the same, the mock below answers in its place, and its query() throws;
// - were the real query() reached even so (a mocked module imported twice at once has once come
//   back real under vitest), the app counts as packaged with Resources in a folder that does not
//   exist, so the executable it is pointed at is not there and nothing is spawned.
// The app settings live in a temporary data folder, the Claude home is a temporary folder too:
// nothing is read from or written to the real ~/.claude or worfy's real data folder.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { sessionOptions } from '../../src/main/agent/options'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryFactory, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import { appSettingsStore } from '../../src/main/settings/store'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  loadSdk: vi.fn(),
  agentEnv: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: sdkQueryFactory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')

const PROJECT = 'demo-0000000d'
const LOGIN_ENV = { HOME: '/Users/tester', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
const SDK_QUERY = { kind: 'sdk query' }
/** Contents/Resources of the "packaged" app of this file: a folder that does not exist, so no executable is found in it. */
const NO_RESOURCES = join(tmpdir(), 'worfy-autocompact-no-resources-0d0d0d', 'Contents', 'Resources')

/** The data folder of the whole file: the app's settings store is one per app run, made on first use. */
let dataDir: string
let scratch: string
let repo: string
let registries: SessionRegistry[] = []
let resourcesPath: PropertyDescriptor | undefined

beforeAll(() => {
  dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autocompact-data-')))
  vi.stubEnv('WORFY_DATA_DIR', dataDir)
  resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: NO_RESOURCES, configurable: true })
})

afterAll(async () => {
  if (resourcesPath) Object.defineProperty(process, 'resourcesPath', resourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  vi.unstubAllEnvs()
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autocompact-')))
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  mocks.query.mockReset().mockReturnValue(SDK_QUERY)
  mocks.loadSdk.mockReset().mockResolvedValue({ query: mocks.query })
  mocks.agentEnv.mockReset().mockResolvedValue({ env: LOGIN_ENV, from: 'login-shell' })
  // Back to a Machine whose person never chose a window: worfy's 400K and 500K, unless settings.json has one.
  appSettingsStore().set({ autoCompactWindow: { orchestrator: 'worfy-default', other: 'worfy-default' } })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Scripts of the fake agent: one turn per message, as test/contract/orchestrator.test.ts plays them. */
function scripts(): string {
  const dir = join(scratch, 'scripts')
  mkdirSync(dir)
  const wait = JSON.stringify({ fake: 'wait_message' })
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000000e1' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-0000000000e2' })
  writeFileSync(join(dir, 'turn.jsonl'), [wait, init, result].join('\n'))
  return dir
}

/**
 * One run of the app: every Session start goes through the real sdkQueryFactory — its options land
 * in the mocked query() — and the Session then runs on the fake agent.
 */
function harness() {
  const calls: FakeCall[] = []
  const requests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir: scripts(), script: 'turn', record: (call) => calls.push(call) })
  // No canvas and the default MCP list: this file is about the autocompact window alone.
  const sdk = sdkQueryFactory(
    () => Promise.resolve(null),
    () => Promise.resolve([]),
    { loadSdk: mocks.loadSdk },
  )
  // Starts run side by side, as in the app: the Orchestrator and a Session of the Canvas may start at once.
  const factory: QueryFactory = async (request) => {
    requests.push(request)
    if (((await sdk(request)) as unknown) !== SDK_QUERY) throw new Error('sdkQueryFactory reached past the query() of loadSdk')
    return fake(request)
  }
  const registry = new SessionRegistry(factory, () => null, () => null)
  registries.push(registry)
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const orchestratorState = (): string | undefined => {
    const node = layout.get(PROJECT).layout.nodes.find((each) => each.kind === 'orchestrator')
    return node === undefined ? undefined : orchestrators.view(node.id)?.state
  }
  return { calls, requests, registry, orchestrators, orchestratorState }
}

/** Writes <claudeHome>/settings.json of this test: the user's own Claude Code settings. */
function userSettings(fields: Record<string, unknown> | string): void {
  writeFileSync(join(scratch, 'claude-home', 'settings.json'), typeof fields === 'string' ? fields : JSON.stringify(fields))
}

/** Starts the Orchestrator and a Session of the Canvas, and waits for the query() of both. */
async function startBoth(h: ReturnType<typeof harness>, calls = 2): Promise<void> {
  await h.orchestrators.open(PROJECT)
  h.registry.start(repo, undefined, () => undefined)
  await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(calls))
  expect(h.requests.slice(-2).map((request) => request.orchestrator === true)).toEqual([true, false])
}

/** The options query() got at its n-th call. */
function sdkOptions(n: number): Record<string, unknown> {
  const call = mocks.query.mock.calls[n] as [{ options: Record<string, unknown> }] | undefined
  if (call === undefined) throw new Error(`query() was called ${mocks.query.mock.calls.length} times, not ${n + 1}`)
  return call[0].options
}

/** The window query() was asked for at its n-th call; undefined when no flag settings carry one. */
const windowAsked = (n: number): unknown => (sdkOptions(n).settings as { autoCompactWindow?: unknown } | undefined)?.autoCompactWindow

describe('sessionOptions: the autocompact window', () => {
  const base = { cwd: '/Users/tester/project', env: LOGIN_ENV, runtime: { packaged: false, resourcesPath: '/nowhere', platform: process.platform, arch: process.arch } }

  it('passes a window as the flag settings of query()', () => {
    expect(sessionOptions({ ...base, autoCompactWindow: 400_000 }).settings).toStrictEqual({ autoCompactWindow: 400_000 })
  })

  it('passes no flag settings at all for "Claude Code default", nor when no window is given', () => {
    expect(sessionOptions({ ...base, autoCompactWindow: null })).not.toHaveProperty('settings')
    expect(sessionOptions(base)).not.toHaveProperty('settings')
  })
})

describe('sessionAutocompact.shellOverride: the window the login shell sets for every Session', () => {
  const answer = async (): Promise<unknown> => {
    const [handler] = (await import('../../src/main/ipc/session-autocompact')).default
    if (handler === undefined) throw new Error('the module has no handler')
    expect(handler.channel.name).toBe('sessionAutocompact.shellOverride')
    return handler.handle(undefined, { event: {} as never })
  }

  it('answers CLAUDE_CODE_AUTO_COMPACT_WINDOW of the environment Sessions get, as written there', async () => {
    mocks.agentEnv.mockResolvedValue({ env: { ...LOGIN_ENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, from: 'login-shell' })
    expect(await answer()).toStrictEqual({ value: '300000' })
  })

  it('answers null when the environment has none, or an empty one', async () => {
    expect(await answer()).toStrictEqual({ value: null })
    mocks.agentEnv.mockResolvedValue({ env: { ...LOGIN_ENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' }, from: 'login-shell' })
    expect(await answer()).toStrictEqual({ value: null })
  })
})

describe('where query() comes from', () => {
  it('from loadSdk, once per start, for two Sessions starting at once; the executable named lies in no existing folder', async () => {
    const h = harness()
    await Promise.all([h.orchestrators.open(PROJECT), Promise.resolve(h.registry.start(repo, undefined, () => undefined))])
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect(mocks.loadSdk).toHaveBeenCalledTimes(2)
    for (const n of [0, 1]) expect(String(sdkOptions(n).pathToClaudeCodeExecutable).startsWith(NO_RESOURCES)).toBe(true)
  })
})

describe('the window by the role of the Session', () => {
  it('the Orchestrator gets the "Orchestrator" window, a Session of the Canvas the "Other Sessions" one', async () => {
    appSettingsStore().set({ autoCompactWindow: { orchestrator: 300_000, other: 700_000 } })
    const h = harness()
    await h.orchestrators.open(PROJECT)
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))

    expect(h.requests.map((request) => request.orchestrator)).toEqual([true, false])
    expect([windowAsked(0), windowAsked(1)]).toEqual([300_000, 700_000])
    // The flag settings carry the window and nothing else of worfy's.
    expect(sdkOptions(0).settings).toStrictEqual({ autoCompactWindow: 300_000 })
    // The fake agent hears the role too, so an e2e run can see it in its log.
    expect(h.calls.filter((call) => call.kind === 'start')).toEqual([
      { kind: 'start', resume: null, settings: expect.any(Object), orchestrator: true },
      { kind: 'start', resume: null, settings: expect.any(Object) },
    ])
  })

  it('Autopilot — the Orchestrator started again unattended — gets the "Orchestrator" window, and so does the Session given back', async () => {
    appSettingsStore().set({ autoCompactWindow: { orchestrator: 250_000, other: 900_000 } })
    const h = harness()
    await h.orchestrators.open(PROJECT)
    await vi.waitFor(() => expect(h.orchestratorState()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(h.orchestratorState()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, false)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))

    expect(h.requests.map((request) => [request.unattended, request.orchestrator])).toEqual([
      [false, true],
      [true, true],
      [false, true],
    ])
    expect([windowAsked(0), windowAsked(1), windowAsked(2)]).toEqual([250_000, 250_000, 250_000])
  })

  it('the defaults of a Machine that never changed them: 400K for the Orchestrator, 500K for the others', async () => {
    const h = harness()
    await h.orchestrators.open(PROJECT)
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect([windowAsked(0), windowAsked(1)]).toEqual([400_000, 500_000])
  })

  it('"Claude Code default" for one role passes no flag settings to that role and keeps the other\'s window', async () => {
    appSettingsStore().set({ autoCompactWindow: { orchestrator: null, other: 600_000 } })
    const h = harness()
    await h.orchestrators.open(PROJECT)
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect(sdkOptions(0)).not.toHaveProperty('settings')
    expect(windowAsked(1)).toBe(600_000)

    appSettingsStore().set({ autoCompactWindow: { orchestrator: 300_000, other: null } })
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))
    expect(sdkOptions(2)).not.toHaveProperty('settings')
  })

  it('a change reaches the next start only: a live Session is not asked to apply it', async () => {
    const h = harness()
    const first = h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(first.state).toBe('idle'))

    appSettingsStore().set({ autoCompactWindow: { other: 800_000 } })
    first.send('hello')
    await vi.waitFor(() => expect(first.state).toBe('idle'))
    // The live Session's process runs on, with the window it was started with.
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(h.calls.filter((call) => call.kind === 'applyFlagSettings')).toEqual([])

    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect([windowAsked(0), windowAsked(1)]).toEqual([500_000, 800_000])
  })
})

describe('autoCompactWindow of ~/.claude/settings.json', () => {
  it('a window there and a setting the person never chose in worfy: query() gets no flag settings, so Claude Code takes the user\'s window', async () => {
    userSettings({ model: 'opus', autoCompactWindow: 300_000 })
    const h = harness()
    await startBoth(h)
    expect(sdkOptions(0)).not.toHaveProperty('settings')
    expect(sdkOptions(1)).not.toHaveProperty('settings')
  })

  it.each([
    ['no settings.json', null],
    ['a settings.json without the field', { model: 'opus' }],
    ['"auto"', { autoCompactWindow: 'auto' }],
    ['a number as a string', { autoCompactWindow: '300000' }],
    ['zero', { autoCompactWindow: 0 }],
    ['a negative number', { autoCompactWindow: -300_000 }],
    ['a fraction', { autoCompactWindow: 300_000.5 }],
    ['not JSON', '{ "autoCompactWindow": 300000'],
  ])('with no whole positive window there (%s): worfy\'s 400K to the Orchestrator, 500K to the others', async (_case, fields) => {
    if (fields !== null) userSettings(fields)
    const h = harness()
    await startBoth(h)
    expect([windowAsked(0), windowAsked(1)]).toEqual([400_000, 500_000])
  })

  it('a window the person chose in worfy wins over settings.json: "Custom" — the default value too — and "Claude Code default"', async () => {
    userSettings({ autoCompactWindow: 300_000 })
    appSettingsStore().set({ autoCompactWindow: { orchestrator: 450_000, other: null } })
    const h = harness()
    await startBoth(h)
    expect(windowAsked(0)).toBe(450_000)
    expect(sdkOptions(1)).not.toHaveProperty('settings')

    // "Custom" at the value worfy would give by default is a choice all the same.
    appSettingsStore().set({ autoCompactWindow: { orchestrator: 400_000, other: 500_000 } })
    await vi.waitFor(() => expect(h.orchestratorState()).toBe('idle'))
    await h.orchestrators.setUnattended(PROJECT, true)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(4))
    expect(h.requests.slice(2).map((request) => request.orchestrator === true)).toEqual([true, false])
    expect([windowAsked(2), windowAsked(3)]).toEqual([400_000, 500_000])
  })

  it('is read at every start: a window written there while worfy runs reaches the next start, and so does one taken away', async () => {
    const h = harness()
    const first = h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(first.state).toBe('idle'))
    expect(windowAsked(0)).toBe(500_000)

    userSettings({ autoCompactWindow: 600_000 })
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2))
    expect(sdkOptions(1)).not.toHaveProperty('settings')

    userSettings({})
    h.registry.start(repo, undefined, () => undefined)
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(3))
    expect(windowAsked(2)).toBe(500_000)
  })
})

describe('sessionAutocompact.userSettings: the window of ~/.claude/settings.json for Settings → Sessions', () => {
  const answer = async (): Promise<unknown> => {
    const handler = (await import('../../src/main/ipc/session-autocompact')).default.find((each) => each.channel.name === 'sessionAutocompact.userSettings')
    if (handler === undefined) throw new Error('the module has no sessionAutocompact.userSettings handler')
    expect(handler.channel.access).toBe('local')
    return handler.handle(undefined, { event: {} as never })
  }

  it('answers the whole positive window of the Claude home of this run, read at each call', async () => {
    expect(await answer()).toStrictEqual({ value: null })
    userSettings({ autoCompactWindow: 300_000 })
    expect(await answer()).toStrictEqual({ value: 300_000 })
    userSettings({ autoCompactWindow: 'auto' })
    expect(await answer()).toStrictEqual({ value: null })
  })
})
