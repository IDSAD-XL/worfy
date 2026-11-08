// The active source of the Limits (src/main/agent/limits-usage.ts): the refresher that asks the
// SDK's usage every 30 minutes, with a fake clock and a stub reader, and the SDK reader of the Limits
// probe (src/main/vendors/claude/limits.ts) over a fake SDK. No Claude Code starts and nothing goes
// to the network. The same refresher polls the windows of Codex (worfy-multi-vendor ticket 21) through
// a stand-in poll of the Codex driver: no Codex starts either.
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLimitsRefresh, LimitsRefresher, refreshAppUsage, USAGE_REFRESH_MS, type VendorLimitsPoll } from '../../src/main/agent/limits-usage'
import { askUsage, claudeUsageReader, sdkUsageReader, USAGE_METHOD, usageOptions, type UsageQuery, type UsageSdk } from '../../src/main/vendors/claude/limits'
import { emptyLimits, mergeLimits, type LimitUpdate, type LimitWindow, type LimitsState, type LimitWindowState } from '../../src/shared/agent/limits'
import { removeTestTree } from '../remove'

// The app's probe (claudeUsageReader) and the app's refresher (installLimitsRefresh) over a stand-in
// SDK: each query() is recorded with its folder, and whether that folder existed when Claude Code
// would have started in it. The app's Limits store is a stand-in too, so nothing watches files.
const app = vi.hoisted(() => ({
  queries: [] as { cwd: unknown; cwdExisted: boolean }[],
  closed: 0,
  recorded: [] as unknown[][],
  answer: null as unknown,
  /** What the app's store was given for Codex, and the signals of the Codex polls. */
  codexWindows: [] as [string, unknown][],
  codexPolls: [] as AbortSignal[],
}))
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const { existsSync: exists } = await import('node:fs')
  const { USAGE_METHOD: method } = await import('../../src/main/vendors/claude/limits')
  return {
    query: ({ options }: { options: { cwd?: string } }) => {
      app.queries.push({ cwd: options.cwd, cwdExisted: typeof options.cwd === 'string' && exists(options.cwd) })
      return { [method]: () => Promise.resolve(app.answer), close: () => void (app.closed += 1) }
    },
  }
})
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../../src/main/agent/env', async (original) => ({
  ...(await original<object>()),
  agentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin:/bin', HOME: '/home/someone' }, from: 'login-shell', error: null }),
}))
vi.mock('../../src/main/agent/limits', () => ({
  appLimits: () => ({
    snapshot: () => ({ windows: {} }),
    record: (updates: unknown[]) => void app.recorded.push([...updates]),
    setWindows: (vendor: string, windows: unknown) => void app.codexWindows.push([vendor, windows]),
  }),
}))
vi.mock('../../src/main/vendors/codex/limits', () => ({
  CODEX_VENDOR: 'codex',
  codexLimits: {
    poll: (signal: AbortSignal) => {
      app.codexPolls.push(signal)
      return Promise.resolve([{ id: 'primary' }])
    },
  },
}))

const START = Date.UTC(2026, 9, 19, 18, 0)
const MINUTE = 60 * 1000

/** An answer of the usage request in the SDK's shape (sdk.d.ts, SDKControlGetUsageResponse). */
const answer = (fiveHour: number, sevenDay: number) => ({
  session: { total_cost_usd: 0, model_usage: {} },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: fiveHour, resets_at: '2026-10-19T20:30:00Z' },
    seven_day: { utilization: sevenDay, resets_at: '2026-10-26T06:00:00Z' },
  },
  behaviors: null,
})

class Store {
  state: LimitsState = emptyLimits()
  recorded: LimitUpdate[][] = []
  /** Every setWindows call: the Vendor and its windows (null: forgotten). */
  vendorWindows: [string, readonly LimitWindow[] | null][] = []
  setWindows(vendor: string, windows: readonly LimitWindow[] | null): void {
    this.vendorWindows.push([vendor, windows])
  }
  snapshot(): LimitsState {
    return this.state
  }
  record(updates: readonly LimitUpdate[]): void {
    this.recorded.push([...updates])
    this.state = mergeLimits(this.state, updates)
  }
}

const window = (receivedAt: number, source: LimitWindowState['source']): LimitWindowState => ({ utilization: 0.1, resetsAt: 1792440000, status: null, receivedAt, source })
const both = (receivedAt: number, source: LimitWindowState['source']): LimitsState => ({ windows: { five_hour: window(receivedAt, source), seven_day: window(receivedAt, source) } })

/** Lets the refresher's awaits run under fake timers. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('the interval', () => {
  it('is 30 minutes', () => {
    expect(USAGE_REFRESH_MS).toBe(1_800_000)
  })
})

describe('installLimitsRefresh', () => {
  afterEach(() => vi.useRealTimers())

  it.each([{ WORFY_AGENT: 'fake' }, { VITEST: 'true' }, { VITEST: 'true', WORFY_CODEX: 'fake' }])('starts nothing with %o: no timer, no Claude Code', async (env) => {
    vi.useFakeTimers()
    const stop = await installLimitsRefresh(env)
    expect(vi.getTimerCount()).toBe(0)
    expect(() => stop()).not.toThrow()
  })
})

describe('the app\'s Limits probe and refresher', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'worfy-usage-'))
    vi.stubEnv('WORFY_DATA_DIR', dataDir)
    app.queries.length = 0
    app.closed = 0
    app.recorded.length = 0
    app.codexWindows.length = 0
    app.codexPolls.length = 0
    app.answer = answer(10, 20)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTestTree(dataDir)
  })

  it('claudeUsageReader asks in worfy\'s own empty folder <WORFY_DATA_DIR>/terminal-ai (ADR-0058), made before Claude Code starts', async () => {
    const folder = join(dataDir, 'terminal-ai')
    expect(existsSync(folder)).toBe(false)
    const read = await claudeUsageReader()
    expect(await read(new AbortController().signal)).toEqual(answer(10, 20))
    expect(app.queries).toEqual([{ cwd: folder, cwdExisted: true }])
    expect(app.closed).toBe(1)
  })

  it('installLimitsRefresh outside e2e runs and vitest starts the refresher over the Claude driver\'s probe: the usage is asked and recorded', async () => {
    const stop = await installLimitsRefresh({})
    try {
      await vi.waitFor(() => expect(app.recorded).toHaveLength(1))
      expect(app.queries).toEqual([{ cwd: join(dataDir, 'terminal-ai'), cwdExisted: true }])
      expect((app.recorded[0] as LimitUpdate[]).map(({ window, state }) => [window, state.utilization, state.source])).toEqual([
        ['five_hour', 0.1, 'usage'],
        ['seven_day', 0.2, 'usage'],
      ])
    } finally {
      stop()
    }
  })

  it('installLimitsRefresh polls Codex through its driver too, records its windows under its name, and its stop aborts that poll', async () => {
    const stop = await installLimitsRefresh({})
    try {
      await vi.waitFor(() => expect(app.codexWindows).toEqual([['codex', [{ id: 'primary' }]]]))
      expect(app.codexPolls).toHaveLength(1)
      expect(app.codexPolls[0]!.aborted).toBe(false)
    } finally {
      stop()
    }
    expect(app.codexPolls[0]!.aborted).toBe(true)
  })

  it('e2e runs with the fake Codex (WORFY_AGENT=fake, WORFY_CODEX=fake) poll Codex only: Claude Code is never asked, and refreshAppUsage stays Claude\'s, resolving at once (ticket 26)', async () => {
    const stop = await installLimitsRefresh({ WORFY_AGENT: 'fake', WORFY_CODEX: 'fake' })
    try {
      await vi.waitFor(() => expect(app.codexWindows).toEqual([['codex', [{ id: 'primary' }]]]))
      await refreshAppUsage(0)
      expect(app.queries).toEqual([])
      expect(app.recorded).toEqual([])
    } finally {
      stop()
    }
    expect(app.codexPolls[0]!.aborted).toBe(true)
  })
})

describe('LimitsRefresher', () => {
  let store: Store
  let read: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<unknown>>>
  let log: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>>
  let refresher: LimitsRefresher | null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    store = new Store()
    read = vi.fn<(signal: AbortSignal) => Promise<unknown>>(() => Promise.resolve(answer(10, 8)))
    log = vi.fn<(message: string, error?: unknown) => void>()
    refresher = null
  })

  afterEach(() => {
    refresher?.stop()
    vi.useRealTimers()
  })

  const start = (): LimitsRefresher => {
    refresher = new LimitsRefresher({ limits: store, read, log, now: Date.now })
    refresher.start()
    return refresher
  }

  it('asks at start when nothing is known, and records the answer with its own time and source', async () => {
    start()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.state.windows.five_hour).toEqual({ utilization: 0.1, resetsAt: Date.parse('2026-10-19T20:30:00Z') / 1000, status: null, receivedAt: START, source: 'usage' })
    expect(store.state.windows.seven_day).toMatchObject({ utilization: 0.08, receivedAt: START, source: 'usage' })
  })

  it('asks at start when the data is older than 30 minutes', async () => {
    store.state = both(START - USAGE_REFRESH_MS - 1, 'sdk')
    start()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not ask at start when the data is fresher than 30 minutes, whatever its source', async () => {
    store.state = both(START - 10 * MINUTE, 'usage')
    start()
    await settle()
    expect(read).not.toHaveBeenCalled()
  })

  it('asks every 30 minutes, also right after its own answer', async () => {
    // The answer comes 2 s after the ask, so the usage it recorded is younger than 30 minutes at the next tick.
    read.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(answer(10, 8)), 2000)))
    start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.state.windows.five_hour?.receivedAt).toBe(START + 2000)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(3)
    expect(store.recorded).toHaveLength(3)
  })

  it('skips a tick while a passive source brought both windows in the last 30 minutes', async () => {
    store.state = both(START - 5 * MINUTE, 'sdk')
    start()
    await settle()
    expect(read).not.toHaveBeenCalled()
    // A Session's rate_limit_event 10 minutes before the tick.
    vi.setSystemTime(START + 20 * MINUTE)
    store.state = both(Date.now(), 'sdk')
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS - 20 * MINUTE)
    expect(read).not.toHaveBeenCalled()
    // Nothing passive since: the next tick asks.
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('asks when only one window is fresh', async () => {
    store.state = { windows: { five_hour: window(START - MINUTE, 'sdk') } }
    start()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('an answer without rate limits (null, an API key) is logged once and not asked again before the next tick', async () => {
    read.mockResolvedValue(null)
    start()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/no rate limits/)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS - 1)
    expect(read).toHaveBeenCalledTimes(1)
    read.mockResolvedValue({ rate_limits_available: false, rate_limits: null })
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    // Still one line in the log.
    expect(log).toHaveBeenCalledTimes(1)
    expect(store.recorded).toHaveLength(0)
  })

  it('a failure is logged once, the Limits stay as they were, and the next tick tries again', async () => {
    store.state = both(START - 2 * USAGE_REFRESH_MS, 'statusline')
    const before = store.state
    read.mockRejectedValue(new Error('control request failed'))
    start()
    await settle()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/failed/)
    expect(store.state).toBe(before)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
    // After an answer that works, a later failure is logged again.
    read.mockResolvedValueOnce(answer(20, 9))
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(store.recorded).toHaveLength(1)
    read.mockRejectedValue(new Error('again'))
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('one ask at a time: a tick while an ask runs is skipped', async () => {
    let finish: (value: unknown) => void = () => undefined
    read.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    start()
    await settle()
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(1)
    finish(answer(10, 8))
    await settle()
    expect(store.recorded).toHaveLength(1)
  })

  it('stop() ends the ticks, aborts the ask in flight and drops its answer', async () => {
    let finish: (value: unknown) => void = () => undefined
    read.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const running = start()
    await settle()
    const signal = read.mock.calls[0]![0]
    expect(signal.aborted).toBe(false)
    running.stop()
    expect(signal.aborted).toBe(true)
    finish(answer(10, 8))
    await settle()
    expect(store.recorded).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5 * USAGE_REFRESH_MS)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    // A stopped refresher does not start again.
    running.start()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('LimitsRefresher: the other Vendors (Codex, worfy-multi-vendor ticket 21)', () => {
  let store: Store
  let read: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<unknown>>>
  let poll: ReturnType<typeof vi.fn<VendorLimitsPoll['poll']>>
  let log: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>>
  let refresher: LimitsRefresher | null

  const WINDOWS: readonly LimitWindow[] = [
    { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 12, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt: START, source: 'read' },
  ]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    store = new Store()
    read = vi.fn<(signal: AbortSignal) => Promise<unknown>>(() => Promise.resolve(answer(10, 8)))
    poll = vi.fn<VendorLimitsPoll['poll']>(() => Promise.resolve(WINDOWS))
    log = vi.fn<(message: string, error?: unknown) => void>()
    refresher = null
  })

  afterEach(() => {
    refresher?.stop()
    vi.useRealTimers()
  })

  const start = (): LimitsRefresher => {
    refresher = new LimitsRefresher({ limits: store, read, log, now: Date.now, vendors: [{ vendor: 'codex', poll }] })
    refresher.start()
    return refresher
  }

  it('polls at start and every 30 minutes, whatever Claude\'s data, and records the windows under the Vendor\'s name', async () => {
    store.state = both(START - MINUTE, 'sdk')
    start()
    await settle()
    expect(read).not.toHaveBeenCalled()
    expect(poll).toHaveBeenCalledTimes(1)
    expect(store.vendorWindows).toEqual([['codex', WINDOWS]])
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS - 1)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(store.vendorWindows).toHaveLength(2)
  })

  it('signed out (null): the Vendor\'s windows are forgotten', async () => {
    poll.mockResolvedValue(null)
    start()
    await settle()
    expect(store.vendorWindows).toEqual([['codex', null]])
  })

  it('a failure is logged once, the windows stay as they were, the next tick tries again, and a success logs again on the next failure', async () => {
    const failure = new Error('Codex app-server did not answer')
    poll.mockRejectedValue(failure)
    start()
    await settle()
    expect(store.vendorWindows).toEqual([])
    expect(log).toHaveBeenCalledWith('[limits] the Limits of codex could not be read: they keep what was read last', failure)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
    poll.mockResolvedValueOnce(WINDOWS)
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(store.vendorWindows).toEqual([['codex', WINDOWS]])
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('one poll of a Vendor at a time: a tick while it runs starts no second one', async () => {
    let finish: (windows: readonly LimitWindow[] | null) => void = () => undefined
    poll.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    start()
    await settle()
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(poll).toHaveBeenCalledTimes(1)
    finish(WINDOWS)
    await settle()
    expect(store.vendorWindows).toEqual([['codex', WINDOWS]])
    await vi.advanceTimersByTimeAsync(USAGE_REFRESH_MS)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('a poll that hangs does not hold Claude\'s ask, and Claude\'s ask failing does not hold the poll', async () => {
    poll.mockImplementation(() => new Promise(() => undefined))
    start()
    await settle()
    expect(store.recorded).toHaveLength(1)

    const second = new Store()
    const other = new LimitsRefresher({ limits: second, read: () => Promise.reject(new Error('no Claude Code')), log: () => undefined, vendors: [{ vendor: 'codex', poll: () => Promise.resolve(WINDOWS) }] })
    other.start()
    await settle()
    other.stop()
    expect(second.vendorWindows).toEqual([['codex', WINDOWS]])
  })

  it('stop() aborts the poll in flight through the same signal as Claude\'s ask, drops its answer and logs no failure', async () => {
    let finish: (windows: readonly LimitWindow[] | null) => void = () => undefined
    let fail: (error: Error) => void = () => undefined
    poll.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const running = start()
    await settle()
    const signal = poll.mock.calls[0]![0]
    expect(signal).toBe(read.mock.calls[0]![0])
    expect(signal.aborted).toBe(false)
    running.stop()
    expect(signal.aborted).toBe(true)
    finish(WINDOWS)
    await settle()
    expect(store.vendorWindows).toEqual([])

    // A poll that rejects because of the abort is not a failure to log.
    const next = new Store()
    poll.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const other = new LimitsRefresher({ limits: next, read, log, vendors: [{ vendor: 'codex', poll }] })
    other.start()
    await settle()
    other.stop()
    fail(new Error('the app quits'))
    await settle()
    expect(log).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5 * USAGE_REFRESH_MS)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('pollVendors() on a stopped refresher polls nothing; without Vendors it resolves', async () => {
    const stopped = new LimitsRefresher({ limits: store, read, log, vendors: [{ vendor: 'codex', poll }] })
    stopped.stop()
    await stopped.pollVendors()
    expect(poll).not.toHaveBeenCalled()
    await expect(new LimitsRefresher({ limits: store, read, log }).pollVendors()).resolves.toBeUndefined()
  })
})

describe('LimitsRefresher.refreshIfOlder (before a Wave of Autopilot, worfy-throughput ticket 40)', () => {
  let store: Store
  let read: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<unknown>>>
  let clock: number
  let refresher: LimitsRefresher

  beforeEach(() => {
    clock = START
    store = new Store()
    read = vi.fn<(signal: AbortSignal) => Promise<unknown>>(() => Promise.resolve(answer(10, 40)))
    // Not started: no timer, only the asks of refreshIfOlder.
    refresher = new LimitsRefresher({ limits: store, read, log: () => undefined, now: () => clock })
  })

  afterEach(() => refresher.stop())

  it('asks once when a window is older than the age given, and resolves after the answer is recorded', async () => {
    store.state = both(START - 5 * MINUTE - 1, 'usage')
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.state.windows.seven_day).toMatchObject({ utilization: 0.4, receivedAt: START, source: 'usage' })
    // Fresh now: the next call asks nothing.
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('asks nothing while both windows are at most that old, whatever their source', async () => {
    store.state = both(START - 5 * MINUTE, 'usage')
    await refresher.refreshIfOlder(5 * MINUTE)
    store.state = both(START - MINUTE, 'statusline')
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).not.toHaveBeenCalled()
  })

  it('asks when one window is missing', async () => {
    store.state = { windows: { five_hour: window(START, 'sdk') } }
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('asks when a fresh window is known without its share (utilization null)', async () => {
    store.state = { windows: { five_hour: window(START, 'sdk'), seven_day: { ...window(START, 'sdk'), utilization: null } } }
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.state.windows.seven_day).toMatchObject({ utilization: 0.4, receivedAt: START, source: 'usage' })
  })

  it('waits for an ask already running instead of starting a second one', async () => {
    let finish: (value: unknown) => void = () => undefined
    read.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const tick = refresher.check(false)
    let done = false
    const refresh = refresher.refreshIfOlder(5 * MINUTE).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    finish(answer(10, 40))
    await Promise.all([tick, refresh])
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.state.windows.seven_day?.utilization).toBe(0.4)
  })

  it('resolves without throwing when the ask fails, and asks nothing once stopped', async () => {
    read.mockRejectedValueOnce(new Error('no network'))
    await expect(refresher.refreshIfOlder(5 * MINUTE)).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
    refresher.stop()
    await refresher.refreshIfOlder(5 * MINUTE)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('askUsage', () => {
  it('calls the SDK method by its one name, without the transcript scan', async () => {
    const method = vi.fn(() => Promise.resolve(answer(1, 2)))
    const query = { close: () => undefined, [USAGE_METHOD]: method } as unknown as UsageQuery
    expect(await askUsage(query)).toEqual(answer(1, 2))
    expect(method).toHaveBeenCalledWith({ skipBehaviors: true })
  })

  it('answers null when the SDK has no such method (a rename)', async () => {
    expect(await askUsage({ close: () => undefined })).toBeNull()
  })
})

describe('sdkUsageReader', () => {
  const fakeSdk = (method: () => Promise<unknown>) => {
    const close = vi.fn()
    const query = vi.fn((params: { prompt: AsyncIterable<never>; options: unknown }) => {
      void params
      return { close, [USAGE_METHOD]: method } as unknown as UsageQuery
    })
    const sdk: UsageSdk = { query }
    return { sdk, close, query }
  }

  afterEach(() => vi.useRealTimers())

  it('starts a query that sends no message, asks, and closes it', async () => {
    const { sdk, close, query } = fakeSdk(() => Promise.resolve(answer(3, 4)))
    const read = sdkUsageReader({ loadSdk: () => Promise.resolve(sdk), options: () => Promise.resolve({ persistSession: false }) })
    expect(await read(new AbortController().signal)).toEqual(answer(3, 4))
    expect(close).toHaveBeenCalledTimes(1)
    const prompt = query.mock.calls[0]![0].prompt
    // The prompt is a stream that never yields: no user message goes out.
    const first = await Promise.race([prompt[Symbol.asyncIterator]().next(), new Promise((resolve) => setTimeout(() => resolve('nothing'), 20))])
    expect(first).toBe('nothing')
  })

  it('closes the query when the ask fails', async () => {
    const { sdk, close } = fakeSdk(() => Promise.reject(new Error('boom')))
    const read = sdkUsageReader({ loadSdk: () => Promise.resolve(sdk), options: () => Promise.resolve({}) })
    await expect(read(new AbortController().signal)).rejects.toThrow('boom')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the query after the timeout', async () => {
    vi.useFakeTimers()
    const { sdk, close } = fakeSdk(() => new Promise(() => undefined))
    const read = sdkUsageReader({ loadSdk: () => Promise.resolve(sdk), options: () => Promise.resolve({}), timeoutMs: 1000 })
    const asked = read(new AbortController().signal)
    const outcome = expect(asked).rejects.toThrow(/did not answer/)
    await vi.advanceTimersByTimeAsync(1000)
    await outcome
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a usage method that rejects after the timeout or the abort leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', listener)
    try {
      vi.useFakeTimers()
      const late = (): Promise<unknown> => new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 2000))
      const timedOut = sdkUsageReader({ loadSdk: () => Promise.resolve(fakeSdk(late).sdk), options: () => Promise.resolve({}), timeoutMs: 1000 })
      const first = expect(timedOut(new AbortController().signal)).rejects.toThrow(/did not answer/)
      await vi.advanceTimersByTimeAsync(1000)
      await first
      const quit = new AbortController()
      const aborted = sdkUsageReader({ loadSdk: () => Promise.resolve(fakeSdk(late).sdk), options: () => Promise.resolve({}) })(quit.signal)
      const second = expect(aborted).rejects.toThrow(/quits/)
      await vi.advanceTimersByTimeAsync(0)
      quit.abort()
      await second
      // Both usage methods reject now, after nobody waits for them.
      await vi.advanceTimersByTimeAsync(2000)
      vi.useRealTimers()
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', listener)
    }
  })

  it('closes the query at once when the app quits', async () => {
    const { sdk, close } = fakeSdk(() => new Promise(() => undefined))
    const read = sdkUsageReader({ loadSdk: () => Promise.resolve(sdk), options: () => Promise.resolve({}) })
    const quit = new AbortController()
    const asked = read(quit.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    quit.abort()
    await expect(asked).rejects.toThrow(/quits/)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when the app quit before the SDK loaded', async () => {
    const { sdk, query } = fakeSdk(() => Promise.resolve(answer(1, 1)))
    const quit = new AbortController()
    quit.abort()
    const read = sdkUsageReader({ loadSdk: () => Promise.resolve(sdk), options: () => Promise.resolve({}) })
    await expect(read(quit.signal)).rejects.toThrow(/quits/)
    expect(query).not.toHaveBeenCalled()
  })
})

describe('usageOptions', () => {
  it('no transcript, no settings, no MCP, no tools, no API keys, in the given folder', () => {
    const options = usageOptions({ env: { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' }, cwd: '/data/terminal-ai', executable: undefined })
    expect(options).toMatchObject({ cwd: '/data/terminal-ai', persistSession: false, settingSources: [], mcpServers: {}, strictMcpConfig: true, tools: [], permissionMode: 'dontAsk' })
    // No telemetry: without a network each start would leave a file in telemetry/.
    expect(options.env).toEqual({ PATH: '/bin', DISABLE_TELEMETRY: '1' })
    expect(options.pathToClaudeCodeExecutable).toBeUndefined()
    expect(usageOptions({ env: {}, cwd: '/d', executable: '/app/claude' }).pathToClaudeCodeExecutable).toBe('/app/claude')
  })
})

describe("LimitsRefresher.refreshIfOlder with a Vendor (Autopilot's run on Codex, worfy-multi-vendor ticket 38)", () => {
  /** The store with Codex's windows as last read, as LimitsTracker.windowsOf answers them. */
  class VendorStore extends Store {
    windows = new Map<string, readonly LimitWindow[]>()
    windowsOf(vendor: string): readonly LimitWindow[] | null {
      return this.windows.get(vendor) ?? null
    }
    override setWindows(vendor: string, windows: readonly LimitWindow[] | null): void {
      super.setWindows(vendor, windows)
      if (windows === null) this.windows.delete(vendor)
      else this.windows.set(vendor, windows)
    }
  }
  const codex = (receivedAt: number): LimitWindow[] => [
    { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 12, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt, source: 'read' },
    { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 40, windowMinutes: 10080, resetsAt: 1793400000, state: 'ok', receivedAt, source: 'read' },
  ]
  let store: VendorStore
  let read: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<unknown>>>
  let poll: ReturnType<typeof vi.fn<VendorLimitsPoll['poll']>>
  let clock: number
  let refresher: LimitsRefresher

  beforeEach(() => {
    clock = START
    store = new VendorStore()
    read = vi.fn<(signal: AbortSignal) => Promise<unknown>>(() => Promise.resolve(answer(10, 40)))
    poll = vi.fn<VendorLimitsPoll['poll']>(() => Promise.resolve(codex(clock)))
    refresher = new LimitsRefresher({ limits: store, read, log: () => undefined, now: () => clock, vendors: [{ vendor: 'codex', poll }] })
  })

  afterEach(() => refresher.stop())

  it("polls that Vendor, not Claude's usage, when none of its windows is known or one is older than the age; a fresh one polls nothing", async () => {
    await refresher.refreshIfOlder(5 * MINUTE, 'codex')
    expect(poll).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
    expect(store.vendorWindows).toEqual([['codex', codex(START)]])
    // Exactly 5 minutes old is fresh, one millisecond more is not.
    clock = START + 5 * MINUTE
    await refresher.refreshIfOlder(5 * MINUTE, 'codex')
    expect(poll).toHaveBeenCalledTimes(1)
    clock += 1
    await refresher.refreshIfOlder(5 * MINUTE, 'codex')
    expect(poll).toHaveBeenCalledTimes(2)
    // Claude's ask is the one without a Vendor, or with Claude's name.
    await refresher.refreshIfOlder(5 * MINUTE, 'claude')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('an age of 0 polls whatever is known (the read after a wait for the Limits); a poll running is waited for, not doubled', async () => {
    store.setWindows('codex', codex(START))
    let finish!: (windows: LimitWindow[]) => void
    poll.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const first = refresher.refreshIfOlder(0, 'codex')
    const second = refresher.refreshIfOlder(0, 'codex')
    let done = false
    void second.then(() => (done = true))
    await settle()
    expect(poll).toHaveBeenCalledTimes(1)
    expect(done).toBe(false)
    finish(codex(START + MINUTE))
    await Promise.all([first, second])
    expect(store.windowsOf('codex')).toEqual(codex(START + MINUTE))
  })

  it('a poll running is waited for even when the windows known are fresh: the answer is the one being read', async () => {
    store.setWindows('codex', codex(START))
    let finish!: (windows: LimitWindow[]) => void
    poll.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const forced = refresher.refreshIfOlder(0, 'codex')
    let done = false
    const fresh = refresher.refreshIfOlder(5 * MINUTE, 'codex').then(() => (done = true))
    await settle()
    expect(done).toBe(false)
    finish(codex(START + MINUTE))
    await Promise.all([forced, fresh])
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('a Vendor the refresher does not poll, or a stopped refresher, resolves at once and polls nothing', async () => {
    await refresher.refreshIfOlder(0, 'gemini')
    refresher.stop()
    await refresher.refreshIfOlder(0, 'codex')
    expect(poll).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
})
