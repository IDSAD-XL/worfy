// A Session over the Claude driver's SessionHandle (worfy-multi-vendor ticket 14), on the fake agent:
// the handle of a failed Session is closed, so the next message starts one live process, not a
// second one beside it (ADR-0064); and a start check (accountInfo) that fails once a message went to
// Claude Code or a turn began does not fail the running Session. A closed process may outlive its
// close by seconds (the SDK's close() sends SIGTERM 2 s after it, SIGKILL 5 s after that): a message
// to the Session in `error` starts the next process only once the old one has exited, or was killed
// at the limit exited() keeps (audit-code-2026-11-07 ticket 01).
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryFactory } from '../../src/main/agent/session'
import { EXIT_WAIT_MS } from '../../src/main/agent/session/process'
import type { AgentProcess } from '../../src/main/vendors/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { ms } from '../time-scale'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

// The limit before SIGKILL, small so no test waits 7.5 s; the order of starts and exits is checked.
vi.mock('../../src/main/agent/session/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/agent/session/process')>()),
  EXIT_WAIT_MS: 500,
}))

/**
 * A Claude Code process as the Session watches it, with nothing behind it: its pid is the test's own,
 * so the system says it runs and only its exit event ends it. It ignores SIGTERM and the close of its
 * query, as a process the SDK has not yet ended; SIGKILL ends it.
 */
class FakeProcess implements AgentProcess {
  readonly pid = process.pid
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  private readonly events = new EventEmitter()

  constructor(
    private readonly n: number,
    private readonly log: Log,
  ) {}

  kill(signal: NodeJS.Signals): boolean {
    this.log.add(`${signal} ${this.n}`)
    if (signal === 'SIGKILL') this.exit(signal)
    return true
  }

  once(event: 'exit', listener: () => void): unknown {
    return this.events.once(event, listener)
  }

  /** The process ends: by itself, or by `signal`. */
  exit(signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    if (signal === null) this.exitCode = 0
    else this.signalCode = signal
    this.log.add(`exit ${this.n}`)
    this.events.emit('exit', this.exitCode, this.signalCode)
  }
}

/** What happened to the agent's processes, in order (`start 1`, `close 1`, `SIGKILL 1`, `exit 1`), and when. */
class Log {
  readonly entries: string[] = []
  private readonly times = new Map<string, number>()

  add(entry: string): void {
    this.entries.push(entry)
    this.times.set(entry, Date.now())
  }

  at(entry: string): number {
    const time = this.times.get(entry)
    if (time === undefined) throw new Error(`no ${entry} in ${this.entries.join(', ')}`)
    return time
  }
}

/**
 * The fake agent with a FakeProcess behind each query: `start n` when the driver starts or resumes
 * the n-th query, its process handed to the Session as Claude Code's is (QueryRequest.spawned), and
 * `close n` when the query is closed, which leaves the process running. A start refused() fails
 * after its `start n`, with no process.
 */
class FakeProcesses {
  readonly log = new Log()
  private readonly processes: FakeProcess[] = []
  private readonly refusals = new Map<number, string>()

  /** The driver's n-th start fails with `message`. */
  refuse(n: number, message: string): void {
    this.refusals.set(n, message)
  }

  /** The n-th process, from 1. */
  process(n: number): FakeProcess {
    const found = this.processes[n - 1]
    if (found === undefined) throw new Error(`no process ${n}`)
    return found
  }

  wrap(factory: QueryFactory): QueryFactory {
    return async (request) => {
      const n = this.processes.length + 1
      const child = new FakeProcess(n, this.log)
      this.processes.push(child)
      this.log.add(`start ${n}`)
      const refused = this.refusals.get(n)
      if (refused !== undefined) throw new Error(refused)
      request.spawned?.(child)
      const query = await factory(request)
      const close = query.close.bind(query)
      query.close = () => {
        this.log.add(`close ${n}`)
        close()
      }
      return query
    }
  }
}

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

let scratch: string
let cwd: string
let ownScripts: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-handle-')))
  cwd = join(scratch, 'repo')
  mkdirSync(cwd)
  ownScripts = join(scratch, 'scripts')
  mkdirSync(ownScripts)
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000014001' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000014002' })
  const release = (name: string) => JSON.stringify({ fake: 'wait_release', name })
  // A turn the user's message starts; its init waits for the test.
  writeFileSync(join(ownScripts, 'held.jsonl'), [JSON.stringify({ fake: 'wait_message' }), release('init'), init, result].join('\n'))
  // A turn Claude Code begins with no message from worfy; its result waits for the test.
  writeFileSync(join(ownScripts, 'own-turn.jsonl'), [release('init'), init, release('result'), result].join('\n'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Rejects or answers accountInfo() when the test says so. */
function heldAccount() {
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail
  })
  // A rejection nobody has asked for yet is not an unhandled one.
  promise.catch(() => undefined)
  return { promise, reject }
}

/**
 * A registry over the fake agent playing `script` from `scriptsDir`. `closes`: a spy on close() of
 * each query, in start order. `account`: what accountInfo() of the first query returns in its place.
 * `throwOn`: the sink throws once, on the first event it matches (a subscriber that fails).
 * `processes`: a FakeProcess behind each query.
 */
function rig(scriptsDir: string, script: string, opts: { account?: Promise<never>; throwOn?: (event: AgentEvent) => boolean; processes?: FakeProcesses } = {}) {
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const fake = fakeQueryFactory({ scriptsDir, script, releases, record: (call) => calls.push(call) })
  const factory = opts.processes?.wrap(fake) ?? fake
  const closes: MockInstance<() => void>[] = []
  const registry = new SessionRegistry(async (request) => {
    const query = await factory(request)
    closes.push(vi.spyOn(query, 'close'))
    if (opts.account !== undefined && closes.length === 1) {
      const account = opts.account
      query.accountInfo = () => account
    }
    return query
  })
  registries.push(registry)
  const events: AgentEvent[] = []
  let thrown = false
  const session = registry.start(cwd, undefined, (_id, event) => {
    events.push(event)
    if (!thrown && opts.throwOn?.(event) === true) {
      thrown = true
      throw new Error('a subscriber failed')
    }
  })
  const states = () => events.flatMap((event) => (event.type === 'state' ? [event.state] : []))
  const results = () => events.filter((event) => event.type === 'result')
  /** The messages the n-th query got (from 1), by their text: the calls after its start, before the next start. */
  const messages = (n: number) => {
    const got: string[][] = []
    for (const call of calls) {
      if (call.kind === 'start') got.push([])
      else if (call.kind === 'message') got.at(-1)?.push(call.text)
    }
    return got[n - 1] ?? []
  }
  /** What resumed each query: null for a new Vendor session. */
  const resumes = () => calls.flatMap((call) => (call.kind === 'start' ? [call.resume] : []))
  return { session, events, calls, closes, releases, states, results, messages, resumes }
}

/** Lets every pending callback run: the account rejection reaches the handle and the Session. */
const settle = () => new Promise((done) => setTimeout(done, 50))

describe('a failed Session closes its process', () => {
  it('a subscriber that throws fails the Session and closes its query; the next message starts the only live one', async () => {
    const r = rig(fixtures, 'turn', { throwOn: (event) => event.type === 'result' })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    expect(r.closes).toHaveLength(1)
    expect(r.closes[0]).toHaveBeenCalled()
    r.session.send('again')
    await vi.waitFor(() => expect(r.results()).toHaveLength(2))
    // The second process resumed the Vendor session of the first, which no longer runs.
    expect(r.calls.filter((call) => call.kind === 'start').map((call) => (call.kind === 'start' ? call.resume : null))).toEqual([null, expect.any(String)])
    expect(r.closes).toHaveLength(2)
    expect(r.closes[1]).not.toHaveBeenCalled()
    expect(r.session.state).toBe('idle')
  })
})

describe('a message to a Session in error waits for the process it closed', () => {
  const failOnResult = (event: AgentEvent): boolean => event.type === 'result'
  /** The Vendor session the first process ran, as its init named it. */
  const firstSdkId = (events: readonly AgentEvent[]): string | undefined => events.flatMap((event) => (event.type === 'init' ? [event.sdkSessionId] : []))[0]

  it('the process lives on after its close: the next one resumes its Vendor session only once it has exited, and gets the message', async () => {
    const processes = new FakeProcesses()
    const r = rig(fixtures, 'turn', { throwOn: failOnResult, processes })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    expect(processes.log.entries).toEqual(['start 1', 'close 1'])
    r.session.send('again')
    // Process 1 still runs 300 ms after the message: no second process is started beside it.
    await new Promise((done) => setTimeout(done, 300))
    expect(processes.log.entries).toEqual(['start 1', 'close 1'])
    expect(r.resumes()).toEqual([null])
    processes.process(1).exit()
    await vi.waitFor(() => expect(r.results()).toHaveLength(2))
    // It exited by itself, within the limit: nothing killed it.
    expect(processes.log.entries).toEqual(['start 1', 'close 1', 'exit 1', 'start 2'])
    expect(r.resumes()).toEqual([null, firstSdkId(r.events)])
    expect(r.messages(1)).toEqual(['hello'])
    expect(r.messages(2)).toEqual(['again'])
    expect(r.session.state).toBe('idle')
  })

  it('a process that does not exit gets SIGKILL at the limit; then the next one starts and gets the message', async () => {
    const processes = new FakeProcesses()
    const r = rig(fixtures, 'turn', { throwOn: failOnResult, processes })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    const sent = Date.now()
    r.session.send('again')
    await vi.waitFor(() => expect(r.results()).toHaveLength(2), { timeout: ms(5_000) })
    expect(processes.log.entries).toEqual(['start 1', 'close 1', 'SIGKILL 1', 'exit 1', 'start 2'])
    // At the limit, not at once (a timer may fire a millisecond early).
    expect(processes.log.at('SIGKILL 1') - sent).toBeGreaterThanOrEqual(EXIT_WAIT_MS - 5)
    expect(r.resumes()).toEqual([null, firstSdkId(r.events)])
    expect(r.messages(1)).toEqual(['hello'])
    expect(r.messages(2)).toEqual(['again'])
    expect(r.session.state).toBe('idle')
  })

  // The handle of a start check that failed before anything was sent no longer holds its query
  // (src/main/vendors/claude/session.ts, finish()), so the Session's close of it does not reach the
  // process: the wait and SIGKILL at the limit still keep the next one from running beside it.
  it('a failed start check whose close does not reach the process: the next process starts after its SIGKILL', async () => {
    const processes = new FakeProcesses()
    const account = heldAccount()
    const r = rig(ownScripts, 'held', { account: account.promise, processes })
    account.reject(new Error('Claude Code did not answer the account request'))
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    expect(processes.log.entries).toEqual(['start 1'])
    r.session.send('hello')
    await vi.waitFor(() => expect(processes.log.entries).toEqual(['start 1', 'SIGKILL 1', 'exit 1', 'start 2']), { timeout: ms(5_000) })
    await vi.waitFor(() => expect(r.messages(2)).toEqual(['hello']))
    r.releases.release('init')
    await vi.waitFor(() => expect(r.results()).toHaveLength(1))
    expect(r.messages(1)).toEqual([])
    expect(r.session.state).toBe('idle')
  })

  it('a start that fails after the wait fails the Session with its reason', async () => {
    const processes = new FakeProcesses()
    processes.refuse(2, 'Claude Code could not be started')
    const r = rig(fixtures, 'turn', { throwOn: failOnResult, processes })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    const failures = () => r.events.flatMap((event) => (event.type === 'state' && event.state === 'error' ? [event.error ?? ''] : []))
    expect(failures()).toHaveLength(1)
    r.session.send('again')
    expect(r.session.state).toBe('busy')
    processes.process(1).exit()
    await vi.waitFor(() => expect(failures()).toHaveLength(2))
    expect(failures()[1]).toContain('Claude Code could not be started')
    expect(processes.log.entries).toEqual(['start 1', 'close 1', 'exit 1', 'start 2'])
    expect(r.session.state).toBe('error')
  })

  // The Orchestrator's relaunch takes the queue of the Session it closes (handOverQueue): a message
  // that waits for the old process is in no process yet, and is handed over with it.
  it('a message that waits for the old process is handed over with the queue; the closed Session starts nothing', async () => {
    const processes = new FakeProcesses()
    const r = rig(fixtures, 'turn', { throwOn: failOnResult, processes })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    r.session.send('again')
    r.session.send('and more')
    expect(r.session.queued().items.map((item) => item.text)).toEqual(['and more'])
    expect(r.session.handOverQueue()).toEqual({
      items: [expect.objectContaining({ text: 'again', attachments: [] }), expect.objectContaining({ text: 'and more', attachments: [] })],
      paused: false,
    })
    expect(r.session.queued().items).toEqual([])
    r.session.close()
    processes.process(1).exit()
    await r.session.exited()
    await settle()
    expect(processes.log.entries).toEqual(['start 1', 'close 1', 'exit 1'])
    expect(r.messages(1)).toEqual(['hello'])
  })

  it('a Session closed while it waits starts no process', async () => {
    const processes = new FakeProcesses()
    const r = rig(fixtures, 'turn', { throwOn: failOnResult, processes })
    await vi.waitFor(() => expect(r.session.state).toBe('idle'))
    r.session.send('hello')
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    r.session.send('again')
    r.session.close()
    processes.process(1).exit()
    await r.session.exited()
    await settle()
    expect(processes.log.entries).toEqual(['start 1', 'close 1', 'exit 1'])
    expect(r.resumes()).toEqual([null])
  })
})

describe('the start check of a handle already under way', () => {
  it('a message sent during the start: a failed accountInfo leaves the Session busy, and the turn ends with its result', async () => {
    const account = heldAccount()
    const r = rig(ownScripts, 'held', { account: account.promise })
    // Sent while the process is being started: the handle gets it before anything is read.
    expect(r.session.send('hello')).toBe('sent')
    await vi.waitFor(() => expect(r.calls.some((call) => call.kind === 'message')).toBe(true))
    // No init has come yet: only the message sent says the start is under way.
    expect(r.events.some((event) => event.type === 'init')).toBe(false)
    account.reject(new Error('Claude Code did not answer the account request'))
    await settle()
    expect(r.session.state).toBe('busy')
    r.releases.release('init')
    await vi.waitFor(() => expect(r.results()).toHaveLength(1))
    expect(r.session.state).toBe('idle')
    expect(r.states()).not.toContain('error')
    expect(r.closes[0]).not.toHaveBeenCalled()
  })

  it('a turn Claude Code began by itself: a failed accountInfo after its init leaves the Session busy until its result', async () => {
    const account = heldAccount()
    const r = rig(ownScripts, 'own-turn', { account: account.promise })
    expect(r.session.state).toBe('starting')
    r.releases.release('init')
    await vi.waitFor(() => expect(r.session.state).toBe('busy'))
    // worfy sent nothing: only the init says a turn began.
    expect(r.calls.some((call) => call.kind === 'message')).toBe(false)
    account.reject(new Error('Claude Code did not answer the account request'))
    await settle()
    expect(r.session.state).toBe('busy')
    r.releases.release('result')
    await vi.waitFor(() => expect(r.results()).toHaveLength(1))
    expect(r.session.state).toBe('idle')
    expect(r.states()).not.toContain('error')
  })

  it('nothing sent and no turn: a failed accountInfo fails the start', async () => {
    const account = heldAccount()
    const r = rig(ownScripts, 'held', { account: account.promise })
    expect(r.session.state).toBe('starting')
    account.reject(new Error('Claude Code did not answer the account request'))
    await vi.waitFor(() => expect(r.session.state).toBe('error'))
    const failed = r.events.find((event) => event.type === 'state' && event.state === 'error')
    expect(failed?.type === 'state' ? failed.error : null).toContain('Claude Code did not answer the account request')
  })
})
