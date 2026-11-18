// The quit's coordinator (src/main/quit-grace.ts, worfy-continuity ticket 04): the order of its steps, the grace
// for the external calls on the test's clock, Quit now, the shutdown of the system on each platform, and the halt
// of the registry — every Session interrupted, closed, and its process killed with SIGKILL after EXIT_WAIT_MS
// (ADR-0064) before the records are written.
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXIT_WAIT_MS, KILL_EXIT_MS } from '../../src/main/agent/session/process'
import { SessionRegistry } from '../../src/main/agent/session/registry'
import { followShutdown, GRACE_MS, OpenCalls, QuitGrace, quitSteps, type QuitClock, type QuitGraceDeps } from '../../src/main/quit-grace'
import type { SessionHandle, SessionPart } from '../../src/main/vendors/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { SuspendCause } from '../../src/shared/autopilot/journal'
import type { QuitGraceView } from '../../src/shared/ipc/quit-grace'

/** The test's clock: time moves and timers fire only when the test says so. */
class TestClock implements QuitClock {
  at = 1_000_000
  private next = 1
  private readonly timers = new Map<number, { at: number; fire: () => void }>()
  now = (): number => this.at
  setTimeout = (fire: () => void, delay: number): number => {
    const id = this.next++
    this.timers.set(id, { at: this.at + delay, fire })
    return id
  }
  clearTimeout = (handle: unknown): void => void this.timers.delete(handle as number)
  advance(delay: number): void {
    this.at += delay
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.at || !this.timers.delete(id)) continue
      timer.fire()
    }
  }
}

const use = (id: string, command: string, parent: string | null = null): AgentEvent => ({ type: 'tool_use', id, name: 'Bash', input: { command }, parentToolUseId: parent })
const done = (id: string, parent: string | null = null): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: 'ok', isError: false, parentToolUseId: parent })
const result = (): AgentEvent =>
  ({
    type: 'result',
    subtype: 'success',
    isError: false,
    error: null,
    text: 'done',
    costUsd: 0,
    durationMs: 1,
    numTurns: 1,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    terminalReason: null,
    interrupted: false,
  }) as AgentEvent

/** Lets every settled promise run its callbacks. */
const flush = async (): Promise<void> => {
  for (let round = 0; round < 20; round++) await Promise.resolve()
}

/** A coordinator over steps that log what they do, the open calls of `calls`, and the test's clock. */
function coordinator(options: { halt?: () => Promise<void> } = {}) {
  const clock = new TestClock()
  const calls = new OpenCalls()
  const log: string[] = []
  const views: QuitGraceView[] = []
  const deps: QuitGraceDeps = {
    depart: () => void log.push('depart'),
    halt: async () => {
      log.push('halt')
      await options.halt?.()
      log.push('halted')
    },
    record: async (cause: SuspendCause) => void log.push(`record ${cause}`),
    calls,
    show: (view) => void views.push(view),
    quit: () => void log.push('quit'),
    clock,
  }
  const grace = new QuitGrace(deps)
  return { grace, clock, calls, log, views }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the quit coordinator', () => {
  it('departs, waits for the calls, halts, writes the records, then lets the quit go — in that order', async () => {
    const { grace, clock, calls, log, views } = coordinator()
    calls.sink('s1', { type: 'prompt', text: 'go' })
    calls.sink('s1', use('t1', 'git push origin demo/01'))
    const event = { preventDefault: vi.fn() }
    grace.beforeQuit(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    await flush()
    // Departed at once; the wait holds the halt back while git push has no result.
    expect(log).toEqual(['depart'])
    expect(views.at(-1)).toEqual({ stage: 'waiting', calls: [{ id: 't1', description: 'git push origin demo/01' }], total: 1, leftMs: GRACE_MS })
    clock.advance(10_000)
    calls.sink('s1', done('t1'))
    await flush()
    expect(log).toEqual(['depart', 'halt', 'halted', 'record quit', 'quit'])
    // The window said the agents were being stopped, and closed before the quit went.
    expect(views.slice(-2)).toEqual([{ stage: 'stopping', calls: [{ id: 't1', description: 'git push origin demo/01' }], total: 1, leftMs: 0 }, null])
    // Let go: the next before-quit passes, and nothing runs again.
    const again = { preventDefault: vi.fn() }
    grace.beforeQuit(again)
    expect(again.preventDefault).not.toHaveBeenCalled()
    expect(log.filter((entry) => entry === 'depart')).toHaveLength(1)
  })

  it('without external calls it neither waits nor opens the window', async () => {
    const { grace, calls, log, views } = coordinator()
    // A local command and a finished push wait for nothing.
    calls.sink('s1', use('t1', 'ls -la'))
    calls.sink('s1', use('t2', 'git push origin main'))
    calls.sink('s1', done('t2'))
    await grace.leave('quit')
    expect(log).toEqual(['depart', 'halt', 'halted', 'record quit', 'quit'])
    expect(views).toEqual([])
  })

  it('waits no longer than GRACE_MS by its clock for a call that never gets its result', async () => {
    const { grace, clock, calls, log } = coordinator()
    calls.sink('s1', use('t1', 'gh pr merge 12 --squash'))
    void grace.leave('quit')
    await flush()
    clock.advance(GRACE_MS - 1)
    await flush()
    expect(log).toEqual(['depart'])
    clock.advance(1)
    await flush()
    expect(log).toEqual(['depart', 'halt', 'halted', 'record quit', 'quit'])
  })

  it('Quit now ends the wait at once', async () => {
    const { grace, calls, log } = coordinator()
    calls.sink('s1', use('t1', 'git push'))
    void grace.leave('quit')
    await flush()
    expect(log).toEqual(['depart'])
    grace.quitNow()
    await flush()
    expect(log).toEqual(['depart', 'halt', 'halted', 'record quit', 'quit'])
  })

  it('a second quit during the steps is held and starts nothing new; "Restart now" writes the cause update', async () => {
    const { grace, calls, log } = coordinator()
    calls.sink('s1', use('t1', 'git push'))
    const update = grace.leave('update')
    const event = { preventDefault: vi.fn() }
    grace.beforeQuit(event)
    expect(event.preventDefault).toHaveBeenCalled()
    grace.quitNow()
    await update
    expect(log).toEqual(['depart', 'halt', 'halted', 'record update', 'quit'])
  })

  it('a shutdown of the system departs and writes the records with shutdown, with no grace and no halt', async () => {
    const { grace, calls, log, views } = coordinator()
    calls.sink('s1', use('t1', 'git push'))
    await grace.shutdown()
    expect(log).toEqual(['depart', 'record shutdown', 'quit'])
    expect(views).toEqual([])
  })

  it('a shutdown during the grace ends it: no halt, the records with shutdown', async () => {
    const { grace, calls, log } = coordinator()
    calls.sink('s1', use('t1', 'git push'))
    void grace.leave('quit')
    await flush()
    await grace.shutdown()
    expect(log).toEqual(['depart', 'record shutdown', 'quit'])
  })
})

describe('the open calls of the Sessions', () => {
  it('names the top-level external calls without a result; a Subagent call, a local one and one with its result are not', () => {
    const calls = new OpenCalls()
    calls.sink('s1', use('t1', 'git push origin demo/01'))
    calls.sink('s1', use('t2', 'ls src'))
    calls.sink('s1', use('t3', 'gh pr merge 7', 'agent-1'))
    calls.sink('s2', use('t4', 'curl -X POST https://example.com/hook'))
    calls.sink('s2', done('t4'))
    expect(calls.open()).toEqual([{ sessionId: 's1', toolUseId: 't1', description: 'git push origin demo/01' }])
  })

  it('a turn end, a new turn and a closed Session drop the calls; a renamed Session keeps them', () => {
    const calls = new OpenCalls()
    const changes = vi.fn()
    calls.observe(changes)
    calls.sink('pending-1', use('t1', 'git push'))
    calls.sink('sdk-1', { type: 'renamed', from: 'pending-1' })
    expect(calls.open()).toEqual([{ sessionId: 'sdk-1', toolUseId: 't1', description: 'git push' }])
    calls.sink('sdk-1', result())
    expect(calls.open()).toEqual([])
    calls.sink('s2', use('t2', 'git push'))
    calls.sink('s2', { type: 'prompt', text: 'next' })
    expect(calls.open()).toEqual([])
    calls.sink('s3', use('t3', 'git push'))
    calls.sink('s3', { type: 'state', state: 'closed', error: null })
    expect(calls.open()).toEqual([])
    // Told of each change that may end the wait: the calls, the results, the ends.
    expect(changes).toHaveBeenCalledTimes(6)
  })
})

describe('the shutdown of the system', () => {
  it('on macOS and Linux: powerMonitor `shutdown`, its preventDefault asked; no window event', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const power = new EventEmitter()
      const windows = new EventEmitter()
      const shutdown = vi.fn()
      followShutdown({ platform, power, windows }, shutdown)
      expect(windows.listenerCount('browser-window-created')).toBe(0)
      const event = { preventDefault: vi.fn() }
      power.emit('shutdown', event)
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(shutdown).toHaveBeenCalledTimes(1)
    }
  })

  it("on Windows: each window's `session-end`; powerMonitor is not asked", () => {
    const power = new EventEmitter()
    const windows = new EventEmitter()
    const shutdown = vi.fn()
    followShutdown({ platform: 'win32', power, windows }, shutdown)
    expect(power.listenerCount('shutdown')).toBe(0)
    const window = new EventEmitter()
    windows.emit('browser-window-created', {}, window)
    window.emit('session-end', {})
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})

describe('the steps over the app', () => {
  it('stops the record of live Sessions and waits for its write before the halt; the records after it', async () => {
    const log: string[] = []
    const steps = quitSteps(() => ({
      registry: { depart: () => void log.push('registry depart'), haltAll: async (ms) => void log.push(`haltAll ${ms}`) },
      live: { stop: () => void log.push('live stop'), settled: async () => void log.push('live settled') },
      autopilot: { suspendAll: () => void log.push('suspendAll'), recordQuit: async (cause) => void log.push(`recordQuit ${cause}`) },
      continuer: { stop: () => void log.push('continue stop') },
      haltTurnMs: 50,
    }))
    steps.depart()
    await steps.halt()
    await steps.record('update')
    expect(log).toEqual(['registry depart', 'suspendAll', 'continue stop', 'live stop', 'live settled', 'haltAll 50', 'recordQuit update'])
  })

  it('a quit before anything was made acts on nothing', async () => {
    const steps = quitSteps(() => ({}))
    steps.depart()
    await steps.halt()
    await steps.record('quit')
  })
})

const PID = 4242

/** A Claude Code process that ignores the close: it exits only when killed with SIGKILL. */
function stubbornChild() {
  const events = new EventEmitter()
  const child = {
    pid: PID,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    signals: [] as string[],
    kill(signal: NodeJS.Signals): boolean {
      child.signals.push(signal)
      if (signal === 'SIGKILL') {
        child.signalCode = 'SIGKILL'
        events.emit('exit', null, 'SIGKILL')
      }
      return true
    },
    once: (event: 'exit', listener: () => void) => events.once(event, listener),
  }
  return child
}

/** A Vendor's session part whose one process is `child`; its events never end, and its close does nothing. */
function partOf(child: ReturnType<typeof stubbornChild>): SessionPart {
  const handle: SessionHandle = {
    send: () => Promise.resolve(),
    interrupt: () => Promise.resolve(),
    close: () => undefined,
    setModel: () => Promise.resolve(),
    setEffort: () => Promise.resolve(),
    setPermissionPreset: () => Promise.resolve(),
    models: () => Promise.resolve([]),
    commands: () => Promise.resolve([]),
    events: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<AgentEvent>>(() => undefined) }) },
  }
  const start = (opts: { spawned?: ((process: typeof child) => void) | undefined }): Promise<SessionHandle> => {
    opts.spawned?.(child)
    return Promise.resolve(handle)
  }
  return { start, resume: (_id, opts) => start(opts) }
}

describe('the registry while worfy quits', () => {
  it('after depart a message waits in the queue, which is not held; a Session started later is held too', async () => {
    const registry = new SessionRegistry(partOf(stubbornChild()))
    const before = registry.start('/tmp', undefined, () => undefined)
    await flush()
    expect(before.send('one')).toBe('sent')
    registry.depart()
    expect(before.send('two')).toBe('queued')
    expect(before.queued()).toMatchObject({ items: [{ text: 'two' }], paused: false })
    const later = registry.start('/tmp', undefined, () => undefined)
    await flush()
    expect(later.send('three')).toBe('queued')
    expect(later.queued()).toMatchObject({ items: [{ text: 'three' }], paused: false })
    registry.closeAll()
  })
})

describe('the halt of the registry (ADR-0064)', () => {
  it('closes every Session and kills a process that outlives EXIT_WAIT_MS with SIGKILL before the records are written', async () => {
    vi.useFakeTimers()
    // The system runs the process until it is killed (waitForExit asks process.kill(pid, 0)).
    const child = stubbornChild()
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect([pid, signal]).toEqual([PID, 0])
      if (child.signalCode === null) return true
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    })
    const registry = new SessionRegistry(partOf(child))
    const session = registry.start('/tmp', undefined, () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    const clock = new TestClock()
    const log: string[] = []
    const grace = new QuitGrace({
      ...quitSteps(() => ({ registry, autopilot: { suspendAll: () => undefined, recordQuit: async (cause) => void log.push(`record ${cause}`) } })),
      calls: new OpenCalls(),
      show: () => undefined,
      quit: () => void log.push('quit'),
      clock,
    })
    const left = grace.leave('quit')
    await vi.advanceTimersByTimeAsync(0)
    expect(session.state).toBe('closed')
    // The process ignores the close: no record, no quit while it runs, and no SIGKILL before EXIT_WAIT_MS.
    await vi.advanceTimersByTimeAsync(EXIT_WAIT_MS - 100)
    expect(child.signals).toEqual([])
    expect(log).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(child.signals).toEqual(['SIGKILL'])
    await vi.advanceTimersByTimeAsync(KILL_EXIT_MS)
    await left
    expect(log).toEqual(['record quit', 'quit'])
  })
})
