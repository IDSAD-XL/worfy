// The Vendor driver (src/main/vendors/driver.ts, ADR-0094 item 2): the shapes of its parts, the
// registry of drivers, and the Claude driver over today's code (src/main/vendors/claude/). The type
// checks fail `pnpm typecheck`, not the run. Nothing here starts Claude Code: the modules the Claude
// driver wraps are mocked in each test that reaches them.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { QueryFactory } from '../../src/main/agent/session'
import type { AccountConnection, AccountPart, LoginStart } from '../../src/main/vendors/account'
import type { VendorDriver } from '../../src/main/vendors/driver'
import type { LimitWindow } from '../../src/main/vendors/limits'
import type { OneShot } from '../../src/main/vendors/one-shot'
import type { SessionHandle } from '../../src/main/vendors/session'

const mocks = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

vi.mock('electron', () => ({ app: mocks.app }))
// No test may load the real SDK: a mistake below would start Claude Code.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the SDK is not called in this test')
  },
}))

const APP_REGISTRY = '../../src/main/agent/app-registry'
const FIRST_RUN = '../../src/main/ipc/first-run'
const ASSIST = '../../src/main/terminal-ai/assist'
const LIMITS = '../../src/main/agent/limits'
const VENDOR_REGISTRY = '../../src/main/vendors/registry'

// Each test loads the modules afresh (vi.resetModules), so a value it compares by identity is
// imported in the test, after the mocks it needs.
afterEach(() => {
  for (const path of [APP_REGISTRY, FIRST_RUN, ASSIST, LIMITS, VENDOR_REGISTRY]) vi.doUnmock(path)
  vi.resetModules()
})

/** A fresh copy of the Claude driver, over the modules mocked before the call. */
const claude = async (): Promise<VendorDriver> => (await import('../../src/main/vendors/registry')).vendorDriver('claude')

describe('the shapes of the parts', () => {
  it('startLogin answers one of three kinds: a URL worfy opens, a browser the Vendor opens, a command in a terminal', () => {
    expectTypeOf<Awaited<ReturnType<AccountPart['startLogin']>>>().toEqualTypeOf<LoginStart>()
    expectTypeOf<LoginStart>().toEqualTypeOf<{ kind: 'url'; url: string } | { kind: 'vendorOpensBrowser' } | { kind: 'terminal'; command: string }>()
    const starts: LoginStart[] = [{ kind: 'url', url: 'https://auth.example/login' }, { kind: 'vendorOpensBrowser' }, { kind: 'terminal', command: 'claude' }]
    // @ts-expect-error -- a fourth kind is not a sign-in worfy knows how to show
    starts.push({ kind: 'apiKey', key: 'sk-x' })
    // @ts-expect-error -- a URL sign-in carries its URL
    starts.push({ kind: 'url' })
    expect(starts.map((start) => start.kind)).toEqual(['url', 'vendorOpensBrowser', 'terminal', 'apiKey', 'url'])
  })

  it('check answers a list of connections, each with its provider, sign-in, email and plan', () => {
    expectTypeOf<Awaited<ReturnType<AccountPart['check']>>>().toEqualTypeOf<AccountConnection[]>()
    expectTypeOf<AccountConnection>().toEqualTypeOf<{ provider: string; signedIn: boolean; email: string | null; plan: string | null }>()
  })

  it('a Limit window may know neither its use, its length nor its reset, and may name a provider', () => {
    expectTypeOf<LimitWindow['usedPercent']>().toEqualTypeOf<number | null>()
    expectTypeOf<LimitWindow['windowMinutes']>().toEqualTypeOf<number | null>()
    expectTypeOf<LimitWindow['resetsAt']>().toEqualTypeOf<number | null>()
    expectTypeOf<LimitWindow['state']>().toEqualTypeOf<'ok' | 'warning' | 'reached' | null>()
    expectTypeOf<LimitWindow['provider']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Awaited<ReturnType<VendorDriver['limits']['read']>>>().toEqualTypeOf<LimitWindow[]>()
  })

  it('oneShot takes the prompt and options that may give read-only tools and a structured answer', () => {
    expectTypeOf<Parameters<OneShot>[0]>().toEqualTypeOf<string>()
    expectTypeOf<Parameters<OneShot>[1]['readOnlyTools']>().toEqualTypeOf<readonly string[] | undefined>()
    expectTypeOf<Parameters<OneShot>[1]['outputSchema']>().toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>()
  })

  it('a SessionHandle speaks only worfy types: a message of text and attachments, and AgentEvents', () => {
    expectTypeOf<Parameters<SessionHandle['send']>[0]['text']>().toEqualTypeOf<string>()
    expectTypeOf<SessionHandle['setPermissionPreset']>().parameter(0).toEqualTypeOf<string>()
    expectTypeOf<SessionHandle['events']>().toExtend<AsyncIterable<{ type: string }>>()
  })
})

describe('the registry of drivers', () => {
  it('gives the Claude driver for claude, the same one each time', async () => {
    const { vendorDriver } = await import('../../src/main/vendors/registry')
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    const driver = vendorDriver('claude')
    expect(driver.id).toBe('claude')
    expect(driver.capabilities).toBe(CLAUDE_CAPABILITIES)
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

  it('account: the sign-in is claude in a terminal, as the first-run screen says', async () => {
    expect(await (await claude()).account.startLogin()).toEqual({ kind: 'terminal', command: 'claude' })
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

  it('commands: each Session gets a catalog of its own', async () => {
    const driver = await claude()
    const { CommandCatalog } = await import('../../src/main/agent/commands')
    const first = driver.commands.catalog()
    expect(first).toBeInstanceOf(CommandCatalog)
    expect(driver.commands.catalog()).not.toBe(first)
  })

  it('mcp: the servers of worfy run in the process of the app', async () => {
    expect((await claude()).mcp.delivery).toBe('inProcess')
  })

  it('limits, oneShot and history are not wired yet and say which ticket wires them', async () => {
    const driver = await claude()
    await expect(driver.limits.read()).rejects.toThrow(/limits\.read.*ticket 15/)
    await expect(driver.oneShot('hello', { cwd: '/tmp' })).rejects.toThrow(/oneShot.*ticket 15/)
    await expect(driver.history.list('/tmp')).rejects.toThrow(/history\.list/)
    await expect(driver.history.read('id')).rejects.toThrow(/history\.read/)
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
