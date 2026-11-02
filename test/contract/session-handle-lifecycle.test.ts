// A Session over the Claude driver's SessionHandle (worfy-multi-vendor ticket 14), on the fake agent:
// the handle of a failed Session is closed, so the next message starts one live process, not a
// second one beside it (ADR-0064); and a start check (accountInfo) that fails once a message went to
// Claude Code or a turn began does not fail the running Session.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

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
 * each query, in start order. `account`: what accountInfo() of every query returns in its place.
 * `throwOn`: the sink throws once, on the first event it matches (a subscriber that fails).
 */
function rig(scriptsDir: string, script: string, opts: { account?: Promise<never>; throwOn?: (event: AgentEvent) => boolean } = {}) {
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const factory = fakeQueryFactory({ scriptsDir, script, releases, record: (call) => calls.push(call) })
  const closes: MockInstance<() => void>[] = []
  const registry = new SessionRegistry(async (request) => {
    const query = await factory(request)
    closes.push(vi.spyOn(query, 'close'))
    if (opts.account !== undefined) {
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
  return { session, events, calls, closes, releases, states, results }
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
