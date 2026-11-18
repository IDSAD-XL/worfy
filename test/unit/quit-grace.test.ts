// The quit's coordinator (src/main/quit-grace.ts, worfy-continuity ticket 04): the order of its steps, the grace
// for the external calls on the test's clock, Quit now, the shutdown of the system on each platform, and the halt
// of the registry — every Session interrupted, closed, and its process killed with SIGKILL after EXIT_WAIT_MS
// (ADR-0064) before the records are written.
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXIT_WAIT_MS, KILL_EXIT_MS } from '../../src/main/agent/session/process'
import { SessionRegistry } from '../../src/main/agent/session/registry'
import { followShutdown, GRACE_MS, OpenCalls, QuitGrace, quitSteps, SUBAGENT_LOOK_MS, subagentOpenCalls, type OpenCall, type QuitClock, type QuitGraceDeps } from '../../src/main/quit-grace'
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
function coordinator(options: { halt?: () => Promise<void>; subagentCalls?: () => Promise<OpenCall[]> } = {}) {
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
    ...(options.subagentCalls === undefined ? {} : { subagentCalls: options.subagentCalls }),
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

  it('a Session whose process is gone in the middle of a call (state error) drops it: no result comes any more, so the quit does not wait for it', () => {
    const calls = new OpenCalls()
    const changes = vi.fn()
    calls.observe(changes)
    calls.sink('s1', use('t1', 'git push'))
    calls.sink('s1', { type: 'state', state: 'busy', error: null })
    expect(calls.open()).toHaveLength(1)
    calls.sink('s1', { type: 'state', state: 'error', error: 'The agent exited' })
    expect(calls.open()).toEqual([])
    // The change ends a grace that waits for it.
    expect(changes).toHaveBeenCalledTimes(2)
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
      autopilot: {
        suspendAll: () => void log.push('suspendAll'),
        recordKilled: async () => void log.push('recordKilled'),
        recordQuit: async (cause) => void log.push(`recordQuit ${cause}`),
      },
      continuer: { stop: () => void log.push('continue stop') },
      haltTurnMs: 50,
    }))
    steps.depart()
    await steps.halt()
    await steps.record('update')
    // The background tasks of a stopped Run are journaled as killed before any Session is halted and closed.
    expect(log).toEqual(['registry depart', 'suspendAll', 'continue stop', 'recordKilled', 'live stop', 'live settled', 'haltAll 50', 'recordQuit update'])
  })

  it('a failure to journal the killed tasks does not keep the Sessions from being halted', async () => {
    const log: string[] = []
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const steps = quitSteps(() => ({
      registry: { depart: () => undefined, haltAll: async () => void log.push('haltAll') },
      autopilot: { suspendAll: () => undefined, recordKilled: () => Promise.reject(new Error('disk full')), recordQuit: async () => undefined },
    }))
    await steps.halt()
    expect(log).toEqual(['haltAll'])
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

/**
 * A Vendor's session part whose events the test sends (`emit`), which records what goes into the process (`sent`),
 * each interrupt asked and whether it was closed. No process: nothing to wait for at the close.
 */
function controlledPart() {
  const sent: string[] = []
  let interrupts = 0
  let closed = false
  const queued: AgentEvent[] = []
  let waiter: ((next: IteratorResult<AgentEvent>) => void) | null = null
  const emit = (event: AgentEvent): void => {
    if (waiter === null) return void queued.push(event)
    const take = waiter
    waiter = null
    take({ value: event, done: false })
  }
  const handle: SessionHandle = {
    send: (message) => {
      sent.push(message.text)
      return Promise.resolve()
    },
    interrupt: () => {
      interrupts += 1
      return Promise.resolve()
    },
    close: () => {
      closed = true
    },
    setModel: () => Promise.resolve(),
    setEffort: () => Promise.resolve(),
    setPermissionPreset: () => Promise.resolve(),
    models: () => Promise.resolve([]),
    commands: () => Promise.resolve([]),
    events: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const event = queued.shift()
          return event !== undefined ? Promise.resolve({ value: event, done: false }) : new Promise<IteratorResult<AgentEvent>>((take) => (waiter = take))
        },
      }),
    },
  }
  const part: SessionPart = { start: () => Promise.resolve(handle), resume: () => Promise.resolve(handle) }
  return { part, sent, emit, interrupts: () => interrupts, closed: () => closed }
}

describe('the registry while worfy quits', () => {
  it('a turn that ends after depart — its git push result came — sends nothing of the queue: the message stays queued, not held', async () => {
    const agent = controlledPart()
    const registry = new SessionRegistry(agent.part)
    const session = registry.start('/tmp', undefined, () => undefined)
    await flush()
    expect(session.send('push the branch')).toBe('sent')
    expect(session.state).toBe('busy')
    // A message of a person's while the turn runs waits in the queue, as always.
    expect(session.send('then open the PR')).toBe('queued')
    registry.depart()
    // The turn's git push gets its result and the turn ends.
    agent.emit(use('t1', 'git push'))
    agent.emit(done('t1'))
    agent.emit(result())
    await flush()
    expect(session.state).toBe('idle')
    // Nothing more went into the process: the queued message stays for the start after the quit.
    expect(agent.sent).toEqual(['push the branch'])
    expect(session.queued()).toMatchObject({ items: [{ text: 'then open the PR' }], paused: false })
    registry.closeAll()
  })

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
  it('interrupts a running turn and waits for its end, haltTurnMs at most, before the Session is closed', async () => {
    vi.useFakeTimers()
    const agent = controlledPart()
    const registry = new SessionRegistry(agent.part)
    const session = registry.start('/tmp', undefined, () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(session.send('push the branch')).toBe('sent')
    let halted = false
    const halt = registry.haltAll(500).then(() => void (halted = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(agent.interrupts()).toBe(1)
    // The interrupted turn has not ended: up to the last millisecond of haltTurnMs the Session stays open.
    await vi.advanceTimersByTimeAsync(499)
    expect(agent.closed()).toBe(false)
    expect(session.state).toBe('busy')
    expect(halted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await halt
    expect(agent.closed()).toBe(true)
    expect(session.state).toBe('closed')
  })

  it("the interrupted turn's end closes the Session at once, before haltTurnMs", async () => {
    vi.useFakeTimers()
    const agent = controlledPart()
    const registry = new SessionRegistry(agent.part)
    const session = registry.start('/tmp', undefined, () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    session.send('push the branch')
    const halt = registry.haltAll(500)
    await vi.advanceTimersByTimeAsync(100)
    expect(agent.closed()).toBe(false)
    agent.emit(result())
    await vi.advanceTimersByTimeAsync(0)
    await halt
    expect(agent.closed()).toBe(true)
  })

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
      ...quitSteps(() => ({ registry, autopilot: { suspendAll: () => undefined, recordKilled: async () => undefined, recordQuit: async (cause) => void log.push(`record ${cause}`) } })),
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

describe('the calls of the Subagents (worfy-continuity ticket 07)', () => {
  const MERGE: OpenCall = { sessionId: 's1', toolUseId: 't-merge', description: 'gh pr merge 41' }

  it('the grace waits for a Subagent call, reads the transcripts again every SUBAGENT_LOOK_MS, and goes on once the call has its result', async () => {
    let open = [MERGE]
    const reads = vi.fn(() => Promise.resolve(open))
    const { grace, clock, log, views } = coordinator({ subagentCalls: reads })
    const left = grace.leave('quit')
    await flush()
    expect(log).toEqual(['depart'])
    expect(views.at(-1)).toEqual({ stage: 'waiting', calls: [{ id: 't-merge', description: 'gh pr merge 41' }], total: 1, leftMs: GRACE_MS })
    clock.advance(SUBAGENT_LOOK_MS)
    await flush()
    expect(reads).toHaveBeenCalledTimes(2)
    expect(log).toEqual(['depart'])
    open = []
    clock.advance(SUBAGENT_LOOK_MS)
    await left
    expect(log).toEqual(['depart', 'halt', 'halted', 'record quit', 'quit'])
    expect(views.at(-1)).toBeNull()
  })

  it('a Subagent call that never gets its result is waited for GRACE_MS at most; a read that fails counts as none', async () => {
    const { grace, clock, log } = coordinator({ subagentCalls: () => Promise.resolve([MERGE]) })
    const left = grace.leave('quit')
    await flush()
    clock.advance(GRACE_MS - 1)
    await flush()
    expect(log).toEqual(['depart'])
    clock.advance(1)
    await left
    expect(log.at(-1)).toBe('quit')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = coordinator({ subagentCalls: () => Promise.reject(new Error('no folder')) })
    await failing.grace.leave('quit')
    expect(failing.views).toEqual([])
  })

  /**
   * subagentOpenCalls over fake files in the projects folder `projects`, with the paths of `paths` — this system's
   * (node:path), or Windows' (path.win32), whose separator is a backslash: quit-grace.ts and held-tickets.ts join theirs
   * with node:path, so the test builds its own with the same module.
   */
  function openCallsOver(open: typeof subagentOpenCalls, paths: typeof path.posix, projects: string, root: string): Promise<OpenCall[]> {
    const line = (agentId: string, content: object[], role = 'assistant') => JSON.stringify({ type: role, isSidechain: true, agentId, sessionId: 'sdk-1', timestamp: '2026-11-18T10:00:00.000Z', message: { id: `m-${agentId}`, role, content } })
    const folder = paths.join(projects, 'sdk-1', 'subagents')
    const files: Record<string, { lines: string[]; at: number }> = {
      [paths.join(folder, 'agent-a.jsonl')]: { lines: [line('a', [{ type: 'tool_use', id: 't-a', name: 'Bash', input: { command: 'gh pr merge 41 --squash' } }])], at: 2_000 },
      [paths.join(folder, 'agent-b.jsonl')]: {
        lines: [line('b', [{ type: 'tool_use', id: 't-b', name: 'Bash', input: { command: 'git push origin main' } }]), line('b', [{ type: 'tool_result', tool_use_id: 't-b', content: 'ok' }], 'user')],
        at: 2_000,
      },
      // Cut off by an earlier process of worfy: it never gets a result now.
      [paths.join(folder, 'agent-old.jsonl')]: { lines: [line('old', [{ type: 'tool_use', id: 't-old', name: 'Bash', input: { command: 'git push origin old' } }])], at: 500 },
    }
    return open({
      sessions: () => [
        { sessionId: 's1', sdkSessionId: 'sdk-1', cwd: root },
        { sessionId: 's2', sdkSessionId: null, cwd: root },
        { sessionId: 's3', sdkSessionId: 'sdk-gone', cwd: root },
      ],
      transcriptPath: (_root, id) => Promise.resolve(id === 'sdk-1' ? paths.join(projects, 'sdk-1.jsonl') : null),
      since: 1_000,
      listFiles: (dir) => Promise.resolve(dir === folder ? ['agent-a.jsonl', 'agent-b.jsonl', 'agent-old.jsonl', 'notes.txt'] : []),
      readLines: (file) => Promise.resolve(files[file]?.lines ?? null),
      modifiedAt: (file) => Promise.resolve(files[file]?.at ?? null),
    })
  }
  const OPEN_MERGE: OpenCall[] = [{ sessionId: 's1', toolUseId: 't-a', description: 'gh pr merge 41' }]

  it('subagentOpenCalls: the calls without a result of each Session\'s Subagents written since the start; an older file, a finished call and a Session without a transcript give none', async () => {
    expect(await openCallsOver(subagentOpenCalls, path, path.join(path.sep, 'p'), path.join(path.sep, 'work', 'demo'))).toEqual(OPEN_MERGE)
  })

  it('subagentOpenCalls on Windows: the Subagents\' folder is found beside a transcript path with backslashes', async () => {
    vi.resetModules()
    vi.doMock('node:path', () => ({ ...path.win32, default: path.win32 }))
    try {
      const { subagentOpenCalls: onWindows } = await import('../../src/main/quit-grace')
      expect(await openCallsOver(onWindows, path.win32, 'D:\\data\\claude\\projects\\demo', 'D:\\work\\demo')).toEqual(OPEN_MERGE)
    } finally {
      vi.doUnmock('node:path')
      vi.resetModules()
    }
  })
})
