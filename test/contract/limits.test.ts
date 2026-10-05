// The Limits in main end to end: src/main/agent/limits.ts over a temporary WORFY_DATA_DIR, fed by
// the recorded SDK messages (test/fixtures/sdk-messages/) and by statusline-limits.json, and the
// `limits` channels registered through registerIpc, the same wrapper the app uses.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LimitsTracker } from '../../src/main/agent/limits'
import type { QueryHandle, QueryRequest } from '../../src/main/agent/session'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { limitsHandlers } from '../../src/main/ipc/limits'
import type { LimitsState } from '../../src/shared/agent/limits'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const FIXTURES = join(__dirname, '..', 'fixtures', 'sdk-messages')
const NOW = Date.UTC(2026, 9, 5, 5, 0)

let scratch: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-limits-')))
  dataDir = join(scratch, 'data')
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

  it('is followed while watched: a new file updates the Limits', { timeout: 15_000 }, async () => {
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

  async function register(source: () => Pick<LimitsTracker, 'snapshot' | 'subscribe'>): Promise<(input: unknown, window?: FakeWindow) => Promise<IpcResult<unknown>>> {
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
      (await listener({ senderFrame: { url: `file://${INDEX_HTML}` }, sender: window } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }

  it('answers limits.open with the known Limits and refuses an input', async () => {
    const limits = tracker()
    limits.recordSdkMessage(recorded('init.jsonl').find((message) => (message as { type?: string }).type === 'rate_limit_event'))
    const open = await register(() => limits)
    expect(await open(undefined)).toEqual({ ok: true, value: limits.snapshot() })
    const refused = await open({ window: 'five_hour' })
    expect(refused.ok).toBe(false)
  })

  it('sends only what the contract describes: unknown keys are dropped, a wrong type is refused', async () => {
    const window = { utilization: 0.5, resetsAt: 1791184200, status: 'allowed', receivedAt: NOW, source: 'sdk' as const }
    let snapshot: unknown = { windows: { five_hour: { ...window, raw: { headers: 'x' } } }, debug: true }
    const open = await register(() => ({ snapshot: () => snapshot as LimitsState, subscribe: () => () => undefined }))
    expect(await open(undefined)).toEqual({ ok: true, value: { windows: { five_hour: window } } })

    snapshot = { windows: { five_hour: { ...window, utilization: '50%' } } }
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
    expect(window.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}limits.changed`, payload: { windows: { five_hour: update.state } } }])

    // The 'destroyed' listener alone must stop the events (isDestroyed() is still false here).
    for (const listener of window.onDestroyed) listener()
    limits.record([{ ...update, state: { ...update.state, receivedAt: NOW + 2 } }])
    expect(window.sent).toHaveLength(1)
  })
})
