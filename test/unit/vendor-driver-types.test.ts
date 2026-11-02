// The Vendor driver (src/main/vendors/driver.ts, ADR-0094 item 2): the shapes of its parts, the
// registry of drivers, and the Claude driver over today's code (src/main/vendors/claude/). The type
// checks fail `pnpm typecheck`, not the run. Nothing here starts Claude Code: the modules the Claude
// driver wraps are mocked in each test that reaches them.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { QueryFactory, QueryHandle } from '../../src/main/agent/session'
import { projectDirName } from '../../src/main/claude-home/registry'
import type { AccountConnection, AccountPart, LoginAttempt, LoginStart } from '../../src/main/vendors/account'
import type { CommandsPart } from '../../src/main/vendors/commands'
import type { VendorDriver } from '../../src/main/vendors/driver'
import type { HistoryPart, HistorySession } from '../../src/main/vendors/history'
import type { LimitWindow } from '../../src/main/vendors/limits'
import type { OneShot } from '../../src/main/vendors/one-shot'
import type { SessionHandle } from '../../src/main/vendors/session'
import type { SlashCommand } from '../../src/shared/agent/commands'
import type { AgentEvent } from '../../src/shared/agent/events'
import { parseTranscriptLines, type TranscriptEntry } from '../../src/shared/transcript/parse'
import type { Capabilities } from '../../src/shared/vendors/capabilities'
import { removeTestTree } from '../remove'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() },
  sdk: () => ({
    query: () => {
      throw new Error('the SDK is not called in this test')
    },
  }),
}))

vi.mock('electron', () => ({ app: mocks.app }))
// No test may load the real SDK: a mistake below would start Claude Code. A test that stands in its
// own SDK (vi.doMock) gets this one back after it.
vi.mock('@anthropic-ai/claude-agent-sdk', mocks.sdk)

const APP_REGISTRY = '../../src/main/agent/app-registry'
const FIRST_RUN = '../../src/main/ipc/first-run'
const ASSIST = '../../src/main/terminal-ai/assist'
const LIMITS = '../../src/main/agent/limits'
const VENDOR_REGISTRY = '../../src/main/vendors/registry'
const AGENT_ENV = '../../src/main/agent/env'

// Each test loads the modules afresh (vi.resetModules), so a value it compares by identity is
// imported in the test, after the mocks it needs.
const trees: string[] = []

afterEach(() => {
  for (const path of [APP_REGISTRY, FIRST_RUN, ASSIST, LIMITS, VENDOR_REGISTRY, AGENT_ENV]) vi.doUnmock(path)
  vi.doMock('@anthropic-ai/claude-agent-sdk', mocks.sdk)
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const tree of trees.splice(0)) removeTestTree(tree)
})

/** A temporary folder, removed after the test. */
const tree = (name: string): string => {
  const path = mkdtempSync(join(tmpdir(), `worfy-vendor-${name}-`))
  trees.push(path)
  return path
}

/**
 * A SessionHandle as the Claude driver's own one holds Claude Code (ClaudeLiveSession,
 * src/main/vendors/claude/session.ts): its live query and its command catalog.
 */
async function claudeHandle(query: Partial<QueryHandle> | null): Promise<SessionHandle> {
  const { CommandCatalog } = await import('../../src/main/agent/commands')
  const refused = () => Promise.reject(new Error('not in this test'))
  return {
    send: refused,
    interrupt: refused,
    close: () => undefined,
    setModel: refused,
    setEffort: refused,
    setPermissionPreset: refused,
    events: { [Symbol.asyncIterator]: () => ({ next: refused }) },
    query: query as QueryHandle | null,
    catalog: new CommandCatalog(),
  } as SessionHandle
}

/** A fresh copy of the Claude driver, over the modules mocked before the call. */
const claude = async (): Promise<VendorDriver> => (await import('../../src/main/vendors/registry')).vendorDriver('claude')

describe('the shapes of the parts', () => {
  it('startLogin answers one of three kinds: a URL worfy opens, a browser the Vendor opens, a command in a terminal', () => {
    expectTypeOf<LoginAttempt['start']>().toEqualTypeOf<LoginStart>()
    expectTypeOf<LoginStart>().toEqualTypeOf<{ kind: 'url'; url: string } | { kind: 'vendorOpensBrowser' } | { kind: 'terminal'; command: string }>()
    const starts: LoginStart[] = [{ kind: 'url', url: 'https://auth.example/login' }, { kind: 'vendorOpensBrowser' }, { kind: 'terminal', command: 'claude' }]
    // @ts-expect-error -- a fourth kind is not a sign-in worfy knows how to show
    starts.push({ kind: 'apiKey', key: 'sk-x' })
    // @ts-expect-error -- a URL sign-in carries its URL
    starts.push({ kind: 'url' })
    expect(starts.map((start) => start.kind)).toEqual(['url', 'vendorOpensBrowser', 'terminal', 'apiKey', 'url'])
  })

  it('a sign-in that started tells when it is over, and can be cancelled', () => {
    expectTypeOf<Awaited<ReturnType<AccountPart['startLogin']>>>().toEqualTypeOf<LoginAttempt>()
    expectTypeOf<LoginAttempt['completed']>().toEqualTypeOf<Promise<AccountConnection[] | null>>()
    expectTypeOf<LoginAttempt['cancel']>().toEqualTypeOf<() => void>()
  })

  it('check answers a list of connections, each with its provider, sign-in, email and plan', () => {
    expectTypeOf<Awaited<ReturnType<AccountPart['check']>>>().toEqualTypeOf<AccountConnection[]>()
    expectTypeOf<AccountConnection>().toEqualTypeOf<{ provider: string; signedIn: boolean; email: string | null; plan: string | null }>()
  })

  it('a Limit window is the one of ticket 11: use, length and reset may be unknown, a provider may be named', () => {
    expectTypeOf<LimitWindow>().toEqualTypeOf<{
      vendor: string
      provider?: string | undefined
      id: string
      label: string
      usedPercent: number | null
      windowMinutes: number | null
      resetsAt: number | null
      state: 'ok' | 'warning' | 'reached' | null
      receivedAt: number
      source: string
    }>()
    expectTypeOf<Awaited<ReturnType<VendorDriver['limits']['read']>>>().toEqualTypeOf<LimitWindow[]>()
  })

  it('oneShot takes the prompt and options that may give read-only tools, a structured answer and progress lines', () => {
    expectTypeOf<Parameters<OneShot>[0]>().toEqualTypeOf<string>()
    expectTypeOf<Parameters<OneShot>[1]['readOnlyTools']>().toEqualTypeOf<readonly string[] | undefined>()
    expectTypeOf<Parameters<OneShot>[1]['outputSchema']>().toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>()
    expectTypeOf<Parameters<OneShot>[1]['onActivity']>().toEqualTypeOf<((text: string) => void) | undefined>()
  })

  it('a past Session says where it was started, when the Vendor knows', () => {
    expectTypeOf<HistorySession>().toEqualTypeOf<{ id: string; cwd: string | null; title: string | null; updatedAt: number | null; origin: 'worfy' | 'external' | null }>()
    expectTypeOf<HistoryPart['list']>().toEqualTypeOf<(cwd: string) => Promise<HistorySession[]>>()
    expectTypeOf<HistoryPart['read']>().toEqualTypeOf<(id: string, cwd: string) => Promise<TranscriptEntry[]>>()
  })

  it('the slash menu of a Session is worfy rows, asked of its handle', () => {
    expectTypeOf<CommandsPart['list']>().toEqualTypeOf<(session: SessionHandle) => Promise<SlashCommand[]>>()
  })

  it('capabilities are read, for the Vendor or for one live Session of it', () => {
    expectTypeOf<VendorDriver['capabilities']>().toEqualTypeOf<(session?: SessionHandle) => Promise<Capabilities>>()
  })

  it('a SessionHandle speaks only worfy types: a message of text and attachments, and AgentEvents', () => {
    expectTypeOf<Parameters<SessionHandle['send']>[0]['text']>().toEqualTypeOf<string>()
    expectTypeOf<SessionHandle['setPermissionPreset']>().parameter(0).toEqualTypeOf<string>()
    expectTypeOf<SessionHandle['events']>().toEqualTypeOf<AsyncIterable<AgentEvent>>()
  })
})

describe('the registry of drivers', () => {
  it('gives the Claude driver for claude, the same one each time', async () => {
    const { vendorDriver } = await import('../../src/main/vendors/registry')
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    const driver = vendorDriver('claude')
    expect(driver.id).toBe('claude')
    expect(await driver.capabilities()).toBe(CLAUDE_CAPABILITIES)
    expect(vendorDriver('claude')).toBe(driver)
  })

  it('has no driver for codex yet, and says so', async () => {
    const { vendorDriver } = await import('../../src/main/vendors/registry')
    expect(() => vendorDriver('codex')).toThrow(/codex/)
  })
})

describe('the Claude driver over today\'s code', () => {
  it('session: the query factory is the one queryFactoryFromEnv makes for the given environment', async () => {
    const factory: QueryFactory = () => Promise.reject(new Error('not started'))
    const queryFactoryFromEnv = vi.fn(() => factory)
    vi.doMock(APP_REGISTRY, () => ({ queryFactoryFromEnv }))
    const env = { WORFY_AGENT: 'fake' }
    expect((await claude()).session.queryFactory(env)).toBe(factory)
    expect(queryFactoryFromEnv).toHaveBeenCalledWith(env)
  })

  it('account: check asks accountInfo() the way the first-run check does, and answers one Anthropic connection', async () => {
    const askSignedInAccount = vi.fn(async () => ({ apiProvider: 'firstParty', email: 'a@example.com', subscriptionType: 'Claude Max', tokenSource: 'claude.ai' }))
    vi.doMock(FIRST_RUN, () => ({ askSignedInAccount }))
    const signal = new AbortController().signal
    expect(await (await claude()).account.check(signal)).toEqual([{ provider: 'anthropic', signedIn: true, email: 'a@example.com', plan: 'Claude Max' }])
    expect(askSignedInAccount).toHaveBeenCalledWith(signal)
  })

  it('account: no subscription and token source "none" is not signed in (ADR-0009)', async () => {
    vi.doMock(FIRST_RUN, () => ({ askSignedInAccount: async () => ({ apiProvider: 'firstParty', tokenSource: 'none' }) }))
    expect(await (await claude()).account.check()).toEqual([{ provider: 'anthropic', signedIn: false, email: null, plan: null }])
  })

  it('account: a token from another source than "none" is signed in without a plan', async () => {
    vi.doMock(FIRST_RUN, () => ({ askSignedInAccount: async () => ({ tokenSource: 'apiKeyHelper' }) }))
    expect(await (await claude()).account.check()).toEqual([{ provider: 'anthropic', signedIn: true, email: null, plan: null }])
  })

  it('account: a failed ask is the caller\'s to show, as in the first-run check', async () => {
    vi.doMock(FIRST_RUN, () => ({ askSignedInAccount: () => Promise.reject(new Error('Claude Code did not answer within 60 s')) }))
    await expect((await claude()).account.check()).rejects.toThrow('did not answer')
  })

  it('account: the sign-in is claude in a terminal, as the first-run screen says; worfy cannot see it end there', async () => {
    const attempt = await (await claude()).account.startLogin()
    expect(attempt.start).toEqual({ kind: 'terminal', command: 'claude' })
    await expect(attempt.completed).resolves.toBeNull()
    expect(() => attempt.cancel()).not.toThrow()
  })

  it('Terminal AI: the backend is the one backendFromEnv makes for the given environment', async () => {
    const backend = { kind: 'backend' }
    const backendFromEnv = vi.fn(async () => backend)
    vi.doMock(ASSIST, () => ({ backendFromEnv }))
    const { claudeDriver } = await import('../../src/main/vendors/claude')
    const env = { WORFY_AGENT: 'fake' }
    expect(await claudeDriver().terminalAi.backend(env)).toBe(backend)
    expect(backendFromEnv).toHaveBeenCalledWith(env)
  })

  it('commands: the rows of the Session\'s catalog, with supportedCommands() of its live query', async () => {
    const session = await claudeHandle({ supportedCommands: async () => [{ name: 'review', description: 'Review the diff', argumentHint: '<path>' }] })
    expect(await (await claude()).commands.list(session)).toEqual([expect.objectContaining({ name: 'review', description: 'Review the diff', argumentHint: '<path>' })])
  })

  it('commands: a Session between queries lists what its catalog last heard', async () => {
    const session = await claudeHandle(null)
    ;(session as unknown as { catalog: { observe(message: unknown): void } }).catalog.observe({ type: 'system', subtype: 'init', slash_commands: ['compact'], skills: [] })
    expect((await (await claude()).commands.list(session)).map((row) => row.name)).toEqual(['compact'])
  })

  it('commands: a handle that is not the Claude driver\'s is refused, naming the ticket that makes it', async () => {
    const session = { ...(await claudeHandle(null)), catalog: undefined } as unknown as SessionHandle
    await expect((await claude()).commands.list(session)).rejects.toThrow(/commands\.list.*ticket 14/)
  })

  it('capabilities: a live Session gives the models of supportedModels(), as the picker lists them today', async () => {
    const supportedModels = vi.fn(async () => [
      { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'turbo'] },
      { value: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
      { value: 'opus', displayName: 'Opus', supportsEffort: false, supportedEffortLevels: ['high'] },
    ])
    const driver = await claude()
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    expect(await driver.capabilities(await claudeHandle({ supportedModels }))).toEqual({
      ...CLAUDE_CAPABILITIES,
      models: [
        { id: 'default', label: 'Default (recommended)', effortLevels: ['low', 'high'] },
        { id: 'opus', label: 'Opus', effortLevels: [] },
      ],
    })
  })

  it('capabilities: without a live query, or when it fails to list, the static ones', async () => {
    const driver = await claude()
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    expect(await driver.capabilities(await claudeHandle(null))).toBe(CLAUDE_CAPABILITIES)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await driver.capabilities(await claudeHandle({ supportedModels: () => Promise.reject(new Error('gone')) }))).toBe(CLAUDE_CAPABILITIES)
    expect(await driver.capabilities(await claudeHandle({ supportedModels: async () => [] }))).toBe(CLAUDE_CAPABILITIES)
  })

  it('mcp: the servers of worfy run in the process of the app', async () => {
    expect((await claude()).mcp.delivery).toBe('inProcess')
  })

  it('limits: read is one Limits probe (worfy-multi-vendor ticket 15), its answer as the windows of the neutral view', async () => {
    vi.stubEnv('WORFY_DATA_DIR', tree('data'))
    const { USAGE_METHOD } = await import('../../src/main/vendors/claude/limits')
    const close = vi.fn()
    const usage = vi.fn(async () => ({ rate_limits: { five_hour: { utilization: 62, resets_at: '2026-11-02T15:00:00Z' }, seven_day: null } }))
    const query = vi.fn((params: { options: object }) => ({ params, close, [USAGE_METHOD]: usage }))
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({ query }))
    vi.doMock(AGENT_ENV, () => ({ agentEnv: async () => ({ env: { PATH: '/bin', ANTHROPIC_API_KEY: 'k' }, from: 'login-shell', error: null }) }))
    const windows = await (await claude()).limits.read()
    expect(windows).toEqual([
      { vendor: 'claude', id: 'five_hour', label: '5-hour', usedPercent: 62, windowMinutes: 300, resetsAt: Date.parse('2026-11-02T15:00:00Z') / 1000, state: null, receivedAt: expect.any(Number), source: 'usage' },
    ])
    expect(usage).toHaveBeenCalledWith({ skipBehaviors: true })
    expect(close).toHaveBeenCalledTimes(1)
    // The probe's own options: no tools, no transcript, no API key.
    expect(query.mock.calls[0]?.[0]).toMatchObject({ options: { tools: [], persistSession: false, env: { PATH: '/bin', DISABLE_TELEMETRY: '1' } } })
  })

  it('limits: an answer without rate limits is no windows, a failed probe rejects', async () => {
    vi.stubEnv('WORFY_DATA_DIR', tree('data'))
    vi.doMock(AGENT_ENV, () => ({ agentEnv: async () => ({ env: {}, from: 'login-shell', error: null }) }))
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({ query: () => ({ close: () => undefined }) }))
    expect(await (await claude()).limits.read()).toEqual([])
    vi.resetModules()
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({ query: () => ({ close: () => undefined, usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => Promise.reject(new Error('boom')) }) }))
    await expect((await claude()).limits.read()).rejects.toThrow('boom')
  })
})

describe('the history of the Claude driver over the transcripts in <claude home>/projects', () => {
  /** A transcript of the Session `id` in the folder `cwd`, its records from `lines`, modified at `mtime` (seconds). */
  function transcript(home: string, cwd: string, id: string, lines: readonly object[], mtime: number): string {
    const dir = join(home, 'projects', projectDirName(cwd))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.jsonl`)
    writeFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
    utimesSync(file, mtime, mtime)
    return file
  }

  const user = (id: string, cwd: string, text: string, entrypoint?: string) => ({
    type: 'user',
    sessionId: id,
    cwd,
    uuid: `${id.slice(0, 8)}-0000-4000-8000-000000000001`,
    timestamp: '2026-11-02T10:00:00.000Z',
    ...(entrypoint === undefined ? {} : { entrypoint }),
    message: { role: 'user', content: text },
  })

  const assistant = (id: string, cwd: string, text: string) => ({
    type: 'assistant',
    sessionId: id,
    cwd,
    uuid: `${id.slice(0, 8)}-0000-4000-8000-000000000002`,
    timestamp: '2026-11-02T10:00:05.000Z',
    message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] },
  })

  const TERMINAL = '11111111-1111-4111-8111-111111111111'
  const SDK = '22222222-2222-4222-8222-222222222222'
  const UNSAID = '33333333-3333-4333-8333-333333333333'

  function home(): { home: string; cwd: string } {
    const claudeHome = tree('home')
    const cwd = tree('project')
    vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
    transcript(claudeHome, cwd, TERMINAL, [user(TERMINAL, cwd, 'Started in a terminal', 'cli'), assistant(TERMINAL, cwd, 'Hello')], 1_800_000_300)
    transcript(claudeHome, cwd, SDK, [user(SDK, cwd, 'Started on the Agent SDK', 'sdk-ts')], 1_800_000_200)
    transcript(claudeHome, cwd, UNSAID, [user(UNSAID, cwd, 'No entrypoint')], 1_800_000_100)
    return { home: claudeHome, cwd }
  }

  it('list: the Sessions of the folder, latest first, with their title, time and where they were started', async () => {
    const { cwd } = home()
    expect(await (await claude()).history.list(cwd)).toEqual([
      { id: TERMINAL, cwd, title: 'Started in a terminal', updatedAt: 1_800_000_300_000, origin: 'external' },
      // Every program on the Agent SDK writes sdk-ts, worfy among them: not known.
      { id: SDK, cwd, title: 'Started on the Agent SDK', updatedAt: 1_800_000_200_000, origin: null },
      { id: UNSAID, cwd, title: 'No entrypoint', updatedAt: 1_800_000_100_000, origin: null },
    ])
  })

  it('list: a folder without transcripts has no Sessions', async () => {
    home()
    expect(await (await claude()).history.list(tree('empty'))).toEqual([])
  })

  it('read: the transcript entries of the Session, as the transcript reader parses its lines', async () => {
    const { cwd } = home()
    const entries = await (await claude()).history.read(TERMINAL, cwd)
    expect(entries).toEqual(parseTranscriptLines([JSON.stringify(user(TERMINAL, cwd, 'Started in a terminal', 'cli')), JSON.stringify(assistant(TERMINAL, cwd, 'Hello'))]))
    expect(entries.map((entry) => entry.event.type)).toContain('text')
  })

  it('read: a transcript longer than one read of the file comes whole', async () => {
    const { home: claudeHome, cwd } = home()
    const id = '44444444-4444-4444-8444-444444444444'
    const long = (n: number) => assistant(id, cwd, `${n}`.padEnd(700_000, 'x'))
    transcript(claudeHome, cwd, id, [user(id, cwd, 'Long', 'cli'), long(1), long(2)], 1_800_000_400)
    const texts = (await (await claude()).history.read(id, cwd)).flatMap((entry) => (entry.event.type === 'text' ? [entry.event.text.slice(0, 1)] : []))
    expect(texts).toEqual(['1', '2'])
  })

  it('read: a Session the folder has no transcript of, or an id that is no Session id, is refused', async () => {
    const { cwd } = home()
    const driver = await claude()
    await expect(driver.history.read('55555555-5555-4555-8555-555555555555', cwd)).rejects.toThrow(/no transcript/)
    await expect(driver.history.read('../../etc/passwd', cwd)).rejects.toThrow(/no transcript/)
  })
})

describe('the app registry of Sessions', () => {
  it('takes its query factory from the Claude driver', async () => {
    const factory: QueryFactory = () => Promise.reject(new Error('not started'))
    const queryFactory = vi.fn(() => factory)
    const vendorDriver = vi.fn(() => ({ session: { queryFactory } }))
    const observe = vi.fn((given: QueryFactory) => given)
    vi.doMock(VENDOR_REGISTRY, () => ({ vendorDriver }))
    vi.doMock(LIMITS, () => ({ appLimits: () => ({ observe }) }))
    const { sharedRegistry } = await import('../../src/main/agent/app-registry')
    sharedRegistry()
    expect(vendorDriver).toHaveBeenCalledWith('claude')
    expect(queryFactory).toHaveBeenCalledTimes(1)
    expect(queryFactory).toHaveBeenCalledWith()
    expect(observe).toHaveBeenCalledWith(factory)
  })
})
