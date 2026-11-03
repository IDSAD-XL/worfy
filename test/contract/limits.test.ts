// The Limits in main end to end: src/main/agent/limits.ts over a temporary WORFY_DATA_DIR, fed by
// the recorded SDK messages (test/fixtures/sdk-messages/) and by statusline-limits.json, and the
// `limits` channels registered through registerIpc, the same wrapper the app uses.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsTracker, observeSessionLimits, type SessionLimitsStatus } from '../../src/main/agent/limits'
import type { QueryHandle, QueryRequest } from '../../src/main/agent/session'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { limitsHandlers } from '../../src/main/ipc/limits'
import type { AgentEvent } from '../../src/shared/agent/events'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'
import type { LimitWindow, LimitsState, LimitsView } from '../../src/shared/agent/limits'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

// node:fs as it is, except that watch is a spy: one test puts in a folder watch that reports nothing,
// to check the poll alone.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, watch: vi.fn(actual.watch) }
})

const FIXTURES = join(__dirname, '..', 'fixtures', 'sdk-messages')
const NOW = Date.UTC(2026, 9, 5, 5, 0)

let scratch: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-limits-')))
  dataDir = join(scratch, 'data')
})

afterEach(() => {
  removeTestTree(scratch)
})

const tracker = (now = NOW): LimitsTracker => new LimitsTracker({ dataDir, now: () => now })

/** The SDK messages of a recorded session, in order. */
function recorded(file: string): unknown[] {
  return readFileSync(join(FIXTURES, file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)
}

/** A query that yields `messages`; `interrupted` counts interrupt() calls that reached it. */
function fakeQuery(messages: unknown[]): QueryHandle & { interrupted: number } {
  return {
    interrupted: 0,
    async interrupt() {
      this.interrupted++
    },
    close() {},
    accountInfo: async () => ({}),
    setModel: async () => undefined,
    setPermissionMode: async () => undefined,
    applyFlagSettings: async () => undefined,
    supportedModels: async () => [],
    async *[Symbol.asyncIterator]() {
      yield* messages
    },
  }
}

const request = {} as QueryRequest

describe('LimitsTracker', () => {
  it('records the rate_limit_event of every query from the observed factory and passes every message on unchanged', async () => {
    const limits = tracker()
    const messages = recorded('init.jsonl')
    const query = fakeQuery(messages)
    const handle = await limits.observe(async () => query)(request)

    const seen: unknown[] = []
    for await (const message of handle) seen.push(message)
    expect(seen).toEqual(messages)
    await handle.interrupt()
    expect(query.interrupted).toBe(1)

    // init.jsonl: five_hour 0.05 (the rateLimitType, status allowed), seven_day 0.62.
    expect(limits.snapshot()).toEqual({
      windows: {
        five_hour: { utilization: 0.05, resetsAt: 1791184200, status: 'allowed', receivedAt: NOW, source: 'sdk' },
        seven_day: { utilization: 0.62, resetsAt: 1791172800, status: null, receivedAt: NOW, source: 'sdk' },
      },
    })
  })

  it('logs a failure to record under its own label and still passes every message on', async () => {
    const limits = new LimitsTracker({
      dataDir,
      now: () => {
        throw new Error('clock failed')
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const messages = recorded('init.jsonl')
      const handle = await limits.observe(async () => fakeQuery(messages))(request)
      const seen: unknown[] = []
      for await (const message of handle) seen.push(message)
      expect(seen).toEqual(messages)
      expect(warn.mock.calls.length).toBe(messages.length)
      for (const [label] of warn.mock.calls) expect(label).toBe('[limits] could not record an SDK message')
      expect(limits.snapshot()).toEqual({ windows: {} })
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps the Limits across a restart, in limits.json and nowhere else', async () => {
    const first = tracker()
    for (const message of recorded('bypass.jsonl')) first.recordSdkMessage(message)
    const saved = first.snapshot()
    expect(saved.windows.five_hour?.utilization).toBe(0.06)

    expect(readdirSync(dataDir)).toEqual(['limits.json'])
    expect(tracker(NOW + 1).snapshot()).toEqual(saved)
  })

  it('drops keys outside the schema from limits.json and sets an unreadable file aside', () => {
    mkdirSync(dataDir, { recursive: true })
    const window = { utilization: 0.5, resetsAt: 1791184200, status: 'allowed', receivedAt: NOW, source: 'sdk', extra: 'x' }
    writeFileSync(join(dataDir, 'limits.json'), JSON.stringify({ windows: { five_hour: window }, other: 1 }))
    expect(tracker().snapshot()).toEqual({ windows: { five_hour: { utilization: 0.5, resetsAt: 1791184200, status: 'allowed', receivedAt: NOW, source: 'sdk' } } })

    writeFileSync(join(dataDir, 'limits.json'), JSON.stringify({ windows: { five_hour: { ...window, utilization: '50%' } } }))
    expect(tracker().snapshot()).toEqual({ windows: {} })
    expect(readdirSync(dataDir).some((name) => name.startsWith('limits.json.unreadable-'))).toBe(true)
  })

  it('tells subscribers about a change, and only about a change', () => {
    const limits = tracker()
    const states: LimitsState[] = []
    const unsubscribe = limits.subscribe((state) => states.push(state))
    const event = recorded('init.jsonl').find((message) => (message as { type?: string }).type === 'rate_limit_event')
    limits.recordSdkMessage(event)
    limits.recordSdkMessage(event)
    limits.recordSdkMessage({ type: 'result', subtype: 'success' })
    expect(states).toHaveLength(1)
    unsubscribe()
    limits.record([{ window: 'five_hour', state: { utilization: 0.9, resetsAt: null, status: null, receivedAt: NOW + 1, source: 'sdk' } }])
    expect(states).toHaveLength(1)
  })
})

describe('LimitsTracker: the windows of the other Vendors (Codex, worfy-multi-vendor ticket 21)', () => {
  const window = (usedPercent: number): LimitWindow => ({
    vendor: 'codex', id: 'primary', label: '5h', usedPercent, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt: NOW, source: 'read',
  })

  it('keeps them next to Claude\'s state, by Vendor, replaced by each read and forgotten on sign-out', () => {
    const limits = tracker()
    for (const message of recorded('init.jsonl')) limits.recordSdkMessage(message)
    const claude = limits.snapshot()
    expect(limits.windowsOf('codex')).toBeNull()
    expect(limits.view()).toEqual({ claude, vendors: {} })

    limits.setWindows('codex', [window(12), { ...window(40), id: 'secondary', label: 'weekly' }])
    limits.setWindows('codex', [window(15)])
    expect(limits.windowsOf('codex')).toEqual([window(15)])
    expect(limits.windowsOf('other')).toBeNull()
    expect(limits.snapshot()).toBe(claude)
    expect(limits.view()).toEqual({ claude, vendors: { codex: [window(15)] } })

    // Signed in, and the plan reports no windows (ticket 26): [], not the null of a Vendor signed out.
    limits.setWindows('codex', [])
    expect(limits.windowsOf('codex')).toEqual([])
    expect(limits.view()).toEqual({ claude, vendors: { codex: [] } })

    limits.setWindows('codex', null)
    expect(limits.windowsOf('codex')).toBeNull()
    expect(limits.snapshot()).toBe(claude)
    expect(limits.view()).toEqual({ claude, vendors: {} })
  })

  it('keeps them in memory only: limits.json keeps Claude\'s form', () => {
    const limits = tracker()
    for (const message of recorded('init.jsonl')) limits.recordSdkMessage(message)
    const saved = readFileSync(join(dataDir, 'limits.json'), 'utf8')
    limits.setWindows('codex', [window(12)])
    expect(readFileSync(join(dataDir, 'limits.json'), 'utf8')).toBe(saved)
    expect(readdirSync(dataDir)).toEqual(['limits.json'])
    expect(tracker(NOW + 1).windowsOf('codex')).toBeNull()
  })

  it('tells its subscribers each recording, null on sign-out, nothing for a Vendor forgotten twice; a subscriber that throws is logged', () => {
    const limits = tracker()
    const told: [string, readonly LimitWindow[] | null][] = []
    const claudeStates: LimitsState[] = []
    limits.subscribe((state) => claudeStates.push(state))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      limits.subscribeWindows(() => {
        throw new Error('a window is gone')
      })
      const unsubscribe = limits.subscribeWindows((vendor, windows) => told.push([vendor, windows]))
      limits.setWindows('codex', null)
      expect(told).toEqual([])
      limits.setWindows('codex', [window(12)])
      limits.setWindows('codex', [])
      limits.setWindows('codex', null)
      limits.setWindows('codex', null)
      expect(told).toEqual([['codex', [window(12)]], ['codex', []], ['codex', null]])
      expect(warn).toHaveBeenCalledWith('[limits] a subscriber of the Vendor windows threw', expect.any(Error))
      expect(claudeStates).toEqual([])
      unsubscribe()
      limits.setWindows('codex', [window(20)])
      expect(told).toHaveLength(3)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('statusline-limits.json', () => {
  const STATUSLINE = { five_hour: { used_percentage: 29, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }

  function writeStatusline(value: unknown, modifiedMs: number): void {
    mkdirSync(dataDir, { recursive: true })
    const file = join(dataDir, 'statusline-limits.json')
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
    utimesSync(file, modifiedMs / 1000, modifiedMs / 1000)
  }

  it('is read with the time it was written, as shares, without keys it does not know', () => {
    writeStatusline({ ...STATUSLINE, five_hour: { ...STATUSLINE.five_hour, token: 'secret' } }, NOW + 5000)
    const limits = tracker()
    limits.readStatusline()
    expect(limits.snapshot().windows).toEqual({
      five_hour: { utilization: 0.29, resetsAt: 1791202800, status: null, receivedAt: NOW + 5000, source: 'statusline' },
      seven_day: { utilization: 0.09, resetsAt: 1791777600, status: null, receivedAt: NOW + 5000, source: 'statusline' },
    })
    expect(readFileSync(join(dataDir, 'limits.json'), 'utf8')).not.toContain('secret')
  })

  it('does not undo a newer SDK event, and a broken file changes nothing', () => {
    const limits = tracker()
    limits.recordSdkMessage(recorded('init.jsonl').find((message) => (message as { type?: string }).type === 'rate_limit_event'))
    const before = limits.snapshot()

    writeStatusline(STATUSLINE, NOW - 1000)
    limits.readStatusline()
    expect(limits.snapshot()).toBe(before)

    writeStatusline('{"five_hour": ', NOW + 1000)
    limits.readStatusline()
    expect(limits.snapshot()).toBe(before)
    // The bridge's file is the user's, not worfy's state: a broken one is left where it is.
    expect(existsSync(join(dataDir, 'statusline-limits.json'))).toBe(true)
  })

  it('is read when the watch starts: a file written while worfy was closed replaces older saved Limits', () => {
    // The saved state comes from an SDK event at NOW; the bridge wrote its file later, before this start.
    tracker().recordSdkMessage(recorded('init.jsonl').find((message) => (message as { type?: string }).type === 'rate_limit_event'))
    writeStatusline(STATUSLINE, NOW + 5000)

    const limits = tracker(NOW + 10_000)
    expect(limits.snapshot().windows.five_hour?.source).toBe('sdk')
    const states: LimitsState[] = []
    limits.subscribe((state) => states.push(state))
    limits.watchStatusline()
    try {
      // Checked right away, with no later change to the file: watch and poll report changes only.
      const fromFile = { status: null, receivedAt: NOW + 5000, source: 'statusline' }
      expect(limits.snapshot().windows).toEqual({
        five_hour: { utilization: 0.29, resetsAt: 1791202800, ...fromFile },
        seven_day: { utilization: 0.09, resetsAt: 1791777600, ...fromFile },
      })
      expect(states).toEqual([limits.snapshot()])
      expect(JSON.parse(readFileSync(join(dataDir, 'limits.json'), 'utf8'))).toEqual(limits.snapshot())
    } finally {
      limits.stop()
    }
  })

  it('is followed while watched: a new file updates the Limits', { timeout: ms(15_000) }, async () => {
    const limits = tracker()
    const changed = new Promise<LimitsState>((resolve) => limits.subscribe(resolve))
    limits.watchStatusline()
    try {
      writeStatusline(STATUSLINE, Date.now())
      const state = await Promise.race([changed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no change within 10 s')), 10_000))])
      expect(state.windows.five_hour).toMatchObject({ utilization: 0.29, source: 'statusline' })
    } finally {
      limits.stop()
    }
  })

  it('is polled too: a write made while the folder watch starts is read although the watch never reports it', { timeout: ms(10_000) }, async () => {
    // FSEvents starts its stream on another thread and may miss a write made before the stream is up.
    // This folder watch misses the write made while it starts, and reports nothing afterwards either.
    let starts = 0
    vi.mocked(watch).mockImplementationOnce(() => {
      starts++
      writeStatusline(STATUSLINE, Date.now())
      return Object.assign(new EventEmitter(), { close: () => undefined }) as unknown as FSWatcher
    })
    const limits = tracker()
    const changed = new Promise<LimitsState>((resolve) => limits.subscribe(resolve))
    limits.watchStatusline()
    try {
      // The write came after the first read and before the poll started. A poll whose baseline is a
      // first look of its own already has the new file in that baseline and never reports it.
      expect(starts).toBe(1)
      const state = await Promise.race([changed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no change within 3 s')), 3_000))])
      expect(state.windows.five_hour).toMatchObject({ utilization: 0.29, source: 'statusline' })
    } finally {
      limits.stop()
    }
  })
})

describe('limits channels', () => {
  type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

  interface FakeWindow {
    sent: { channel: string; payload: unknown }[]
    destroyed: boolean
    onDestroyed: (() => void)[]
    send(channel: string, payload: unknown): void
    isDestroyed(): boolean
    once(event: 'destroyed', listener: () => void): void
  }

  function fakeWindow(): FakeWindow {
    return {
      sent: [],
      destroyed: false,
      onDestroyed: [],
      send(channel, payload) {
        this.sent.push({ channel, payload })
      },
      isDestroyed() {
        return this.destroyed
      },
      once(_event, listener) {
        this.onDestroyed.push(listener)
      },
    }
  }

  async function register(source: () => Pick<LimitsTracker, 'view' | 'subscribe' | 'subscribeWindows'>): Promise<(input: unknown, window?: FakeWindow) => Promise<IpcResult<unknown>>> {
    const handlers = new Map<string, Listener>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
      {
        modules: { './limits.ts': async () => limitsHandlers(source as () => LimitsTracker) },
        isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
      },
    )
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}limits.open`)
    if (!listener) throw new Error('limits.open is not registered')
    return async (input, window = fakeWindow()) =>
      (await listener({ senderFrame: { url: APP_URL }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }

  it('answers limits.open with the known Limits and refuses an input', async () => {
    const limits = tracker()
    limits.recordSdkMessage(recorded('init.jsonl').find((message) => (message as { type?: string }).type === 'rate_limit_event'))
    const open = await register(() => limits)
    expect(await open(undefined)).toEqual({ ok: true, value: { claude: limits.snapshot(), vendors: {} } })
    const refused = await open({ window: 'five_hour' })
    expect(refused.ok).toBe(false)
  })

  it('sends only what the contract describes: unknown keys are dropped, a wrong type is refused', async () => {
    const window = { utilization: 0.5, resetsAt: 1791184200, status: 'allowed', receivedAt: NOW, source: 'sdk' as const }
    let snapshot: unknown = { claude: { windows: { five_hour: { ...window, raw: { headers: 'x' } } }, debug: true }, vendors: {} }
    const open = await register(() => ({ view: () => snapshot as LimitsView, subscribe: () => () => undefined, subscribeWindows: () => () => undefined }))
    expect(await open(undefined)).toEqual({ ok: true, value: { claude: { windows: { five_hour: window } }, vendors: {} } })

    snapshot = { claude: { windows: { five_hour: { ...window, utilization: '50%' } } }, vendors: {} }
    const refused = await open(undefined)
    expect(refused).toEqual({ ok: false, error: 'limits.open: invalid output from the handler' })
  })

  it('sends every change to an open window as limits.changed until the window is destroyed', async () => {
    const limits = tracker()
    const open = await register(() => limits)
    const window = fakeWindow()
    await open(undefined, window)
    await open(undefined, window) // a second open in the same window does not double the events

    const update = { window: 'five_hour', state: { utilization: 0.7, resetsAt: null, status: null, receivedAt: NOW + 1, source: 'sdk' as const } }
    limits.record([update])
    const claude = { windows: { five_hour: update.state } }
    expect(window.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}limits.changed`, payload: { claude, vendors: {} } }])

    // Another Vendor's windows (ticket 26): signed in with windows, signed in with none, signed out.
    const codex: LimitWindow = { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 12, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt: NOW, source: 'read' }
    limits.setWindows('codex', [codex])
    limits.setWindows('codex', [])
    limits.setWindows('codex', null)
    expect(window.sent.slice(1).map(({ payload }) => payload)).toEqual([
      { claude, vendors: { codex: [codex] } },
      { claude, vendors: { codex: [] } },
      { claude, vendors: {} },
    ])

    // The 'destroyed' listener alone must stop the events (isDestroyed() is still false here).
    for (const listener of window.onDestroyed) listener()
    limits.record([{ ...update, state: { ...update.state, receivedAt: NOW + 2 } }])
    limits.setWindows('codex', [codex])
    expect(window.sent).toHaveLength(4)
  })
})

describe('observeSessionLimits over the limits and limit_reached events (worfy-multi-vendor ticket 11)', () => {
  /** The statuses observeSessionLimits reports for `messages`, sent as one Session's events. */
  function observed(messages: readonly unknown[]): SessionLimitsStatus[] {
    let sink: ((sessionId: string, event: AgentEvent) => void) | null = null
    const seen: SessionLimitsStatus[] = []
    const off = observeSessionLimits(
      (each) => {
        sink = each
        return () => (sink = null)
      },
      () => true,
      (status) => seen.push(status),
    )
    for (const message of messages) for (const event of sdkMessageToEvents(message, NOW)) sink!('s', event)
    off()
    return seen
  }

  /** What the `rate_limit` event of each message told before ticket 11: its status, rateLimitType and resetsAt, once per change. */
  function asBefore(messages: readonly unknown[]): SessionLimitsStatus[] {
    const seen: SessionLimitsStatus[] = []
    for (const message of messages) {
      const info = (message as { rate_limit_info: { status: string; rateLimitType?: string | null; resetsAt?: number | null } }).rate_limit_info
      const next = { status: info.status, window: info.rateLimitType ?? null, resetsAt: info.resetsAt ?? null }
      const last = seen.at(-1)
      if (last === undefined || last.status !== next.status || last.window !== next.window || last.resetsAt !== next.resetsAt) seen.push(next)
    }
    return seen
  }

  const event = (status: string, rateLimitType: string | undefined, resetsAt: number | undefined, unifiedWindows?: unknown) => ({
    type: 'rate_limit_event',
    rate_limit_info: { status, rateLimitType, resetsAt, unifiedWindows },
  })

  it('reports the same statuses for every recorded rate_limit_event as the rate_limit event did', () => {
    const scripts = join(__dirname, '..', 'fixtures', 'agent-scripts')
    const lines = (file: string): unknown[] =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown)
    const files = [
      ...readdirSync(FIXTURES).filter((name) => name.endsWith('.jsonl')).map((name) => join(FIXTURES, name)),
      join(scripts, 'limits.jsonl'),
      join(scripts, 'autopilot-limits.jsonl'),
    ]
    const messages = files.flatMap(lines).filter((message) => (message as { type?: unknown }).type === 'rate_limit_event')
    expect(messages.length).toBeGreaterThanOrEqual(5)
    expect(new Set(messages.map((message) => (message as { rate_limit_info: { status: string } }).rate_limit_info.status))).toEqual(new Set(['allowed', 'rejected']))
    expect(observed(messages)).toEqual(asBefore(messages))
  })

  it('reports the same for a warning, another window, a refusal without a reset time and one without a window', () => {
    const messages = [
      event('allowed', 'five_hour', 1791184200, { five_hour: { utilization: 0.5, resetsAt: 1791184200 }, seven_day: { utilization: 0.3, resetsAt: 1791795600 } }),
      event('allowed_warning', 'five_hour', 1791184200, { five_hour: { utilization: 0.81, resetsAt: 1791184200 } }),
      event('allowed_warning', 'five_hour', 1791184200),
      event('rejected', 'seven_day_opus', 1791795600),
      event('rejected', 'seven_day', undefined, { seven_day: { utilization: 1, resetsAt: 1791795600 } }),
      event('allowed', 'seven_day', 1791795600),
      event('rejected', undefined, 1791184200),
    ]
    expect(observed(messages)).toEqual(asBefore(messages))
    expect(observed(messages)).toEqual([
      { status: 'allowed', window: 'five_hour', resetsAt: 1791184200 },
      { status: 'allowed_warning', window: 'five_hour', resetsAt: 1791184200 },
      { status: 'rejected', window: 'seven_day_opus', resetsAt: 1791795600 },
      { status: 'rejected', window: 'seven_day', resetsAt: null },
      { status: 'allowed', window: 'seven_day', resetsAt: 1791795600 },
      { status: 'rejected', window: null, resetsAt: 1791184200 },
    ])
  })

  it('reports a status that names no window, so an allowed one after a refusal ends the refusal', () => {
    const messages = [
      event('rejected', 'five_hour', 400),
      event('allowed', undefined, 500, { five_hour: { utilization: 0.2 } }),
      event('allowed_warning', undefined, undefined),
      event('something_new', undefined, 600),
    ]
    expect(observed(messages)).toEqual(asBefore(messages))
    expect(observed(messages)).toEqual([
      { status: 'rejected', window: 'five_hour', resetsAt: 400 },
      { status: 'allowed', window: null, resetsAt: 500 },
      { status: 'allowed_warning', window: null, resetsAt: null },
      { status: 'something_new', window: null, resetsAt: 600 },
    ])
  })

  it('takes the reset time of the status as sent, not that of its window, -1 too', () => {
    const messages = [
      event('allowed', 'five_hour', 100, { five_hour: { utilization: 0.1, resetsAt: 200 } }),
      event('allowed', 'five_hour', -1, { five_hour: { utilization: 0.1, resetsAt: 300 } }),
      event('allowed', 'five_hour', undefined, { five_hour: { utilization: 0.1, resetsAt: 300 } }),
    ]
    expect(observed(messages)).toEqual(asBefore(messages))
    expect(observed(messages)).toEqual([
      { status: 'allowed', window: 'five_hour', resetsAt: 100 },
      { status: 'allowed', window: 'five_hour', resetsAt: -1 },
      { status: 'allowed', window: 'five_hour', resetsAt: null },
    ])
  })

  it('reports a refusal once, though it comes as both limits and limit_reached', () => {
    const messages = [event('rejected', 'five_hour', 400, { five_hour: { utilization: 1, resetsAt: 900 } })]
    expect(observed(messages)).toEqual([{ status: 'rejected', window: 'five_hour', resetsAt: 400 }])
  })
})
