// The JSON-RPC client of the Codex app-server (src/main/vendors/codex/rpc.ts, worfy-multi-vendor ticket
// 19), as a pure module: lines in through receive(), lines out through `write`. Incoming messages are
// checked against the real JSON Schema of the pinned Codex; the valid ones are lines of the fake's
// scripts (test/fixtures/codex-scripts/), which test/contract/codex-fake.test.ts checks against it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexRpc, CodexRpcError, type CodexRpcEvent, INVALID_PARAMS, METHOD_NOT_FOUND, REQUEST_TIMEOUT_MS } from '../../src/main/vendors/codex/rpc'

const TURN_STARTED = { method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_1', items: [], status: 'inProgress', startedAt: 1793000000 } } }
const DELTA = { method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'Hello' } }
const APPROVAL = {
  id: 7,
  method: 'item/commandExecution/requestApproval',
  params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'cmd_1', startedAtMs: 1793000000000, command: 'pnpm test', cwd: '/p', reason: 'The command runs outside the sandbox.' },
}
const INITIALIZE_RESULT = { codexHome: '/codex-home', platformFamily: 'unix', platformOs: 'macos', userAgent: 'codex/0.166.0' }
const TURN_START_RESULT = { turn: { id: 'turn_1', items: [], status: 'inProgress' } }

interface Harness {
  rpc: CodexRpc
  /** The messages the client sent so far, parsed. */
  sent: () => Record<string, unknown>[]
  /** The raw lines the client sent. */
  lines: string[]
  events: CodexRpcEvent[]
  logged: string[]
  /** Gives the client one line of the server. */
  feed: (message: unknown) => void
}

function harness(timeoutMs?: number): Harness {
  const lines: string[] = []
  const events: CodexRpcEvent[] = []
  const logged: string[] = []
  const rpc = new CodexRpc({ write: (line) => lines.push(line), onEvent: (event) => events.push(event), log: (line) => logged.push(line), timeoutMs })
  return {
    rpc,
    lines,
    sent: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    events,
    logged,
    feed: (message) => rpc.receive(typeof message === 'string' ? message : JSON.stringify(message)),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('rpc.ts: requests and answers', () => {
  it('writes one JSON line per message, without the "jsonrpc" field', () => {
    const { rpc, lines } = harness()
    void rpc.request('initialize', { clientInfo: { name: 'worfy', title: null, version: '1.0.0' }, capabilities: null })
    rpc.notify('initialized')
    expect(lines).toEqual([
      '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"worfy","title":null,"version":"1.0.0"},"capabilities":null}}\n',
      '{"method":"initialized"}\n',
    ])
  })

  it('settles each request with its own answer while notifications come between them, in any order', async () => {
    const { rpc, sent, feed, events } = harness()
    const first = rpc.request('initialize', { clientInfo: { name: 'worfy', title: null, version: '1' }, capabilities: null })
    const second = rpc.request('turn/start', { threadId: 'thr_1', input: [{ type: 'text', text: 'Hi', text_elements: [] }] })
    const [one, two] = sent().map((message) => message.id)
    expect(one).not.toBe(two)
    feed(TURN_STARTED)
    feed({ id: two, result: TURN_START_RESULT })
    feed(DELTA)
    feed({ id: one, result: INITIALIZE_RESULT })
    await expect(first).resolves.toEqual(INITIALIZE_RESULT)
    await expect(second).resolves.toEqual(TURN_START_RESULT)
    expect(events).toEqual([
      { type: 'notification', notification: TURN_STARTED },
      { type: 'notification', notification: DELTA },
    ])
    expect(rpc.waiting).toBe(0)
  })

  it('rejects a request the server answers with a JSON-RPC error, with its code and message', async () => {
    const { rpc, feed } = harness()
    const answer = rpc.request('thread/resume', { threadId: 'thr_x' })
    feed({ id: 1, error: { code: -32600, message: 'no rollout found for thread id thr_x' } })
    const error = await answer.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CodexRpcError)
    expect(error).toMatchObject({ method: 'thread/resume', code: -32600, rpcMessage: 'no rollout found for thread id thr_x' })
    expect((error as Error).message).toBe('Codex app-server refused thread/resume: no rollout found for thread id thr_x (code -32600)')
  })

  it('rejects a request the server does not answer in time, with a text that names the method and the limit', async () => {
    vi.useFakeTimers()
    const { rpc, feed, events } = harness(5_000)
    const answer = rpc.request('turn/interrupt', { threadId: 'thr_1', turnId: 'turn_1' })
    const late = rpc.request('turn/interrupt', { threadId: 'thr_1', turnId: 'turn_1' }, 20_000)
    const caught = answer.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(rpc.waiting).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(((await caught) as Error).message).toBe('Codex app-server did not answer turn/interrupt (request 1) within 5000 ms')
    expect(rpc.waiting).toBe(1)
    // The answer that comes after the limit finds no request: it is reported, not taken for another.
    feed({ id: 1, result: {} })
    expect(events).toEqual([expect.objectContaining({ type: 'unknown', method: null, problems: ['an answer to 1, which no request waits for'] })])
    feed({ id: 2, result: {} })
    await expect(late).resolves.toEqual({})
  })

  it('waits REQUEST_TIMEOUT_MS by default', async () => {
    vi.useFakeTimers()
    const { rpc } = harness()
    const caught = rpc.request('account/read', { refreshToken: false }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
    expect(rpc.waiting).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(((await caught) as Error).message).toMatch(/did not answer account\/read/)
  })

  it('rejects every waiting request when the server is gone, and every later one at once', async () => {
    const { rpc, lines } = harness()
    const one = rpc.request('thread/start', {})
    const two = rpc.request('account/read', { refreshToken: false })
    const gone = new Error('Codex app-server exited with code 3')
    rpc.fail(gone)
    await expect(one).rejects.toBe(gone)
    await expect(two).rejects.toBe(gone)
    expect(rpc.waiting).toBe(0)
    await expect(rpc.request('thread/start', {})).rejects.toBe(gone)
    rpc.fail(new Error('again'))
    await expect(rpc.request('thread/start', {})).rejects.toBe(gone)
    rpc.notify('initialized')
    rpc.respond(1, {})
    expect(lines).toHaveLength(2)
  })
})

describe('rpc.ts: server→client requests', () => {
  it('passes a request of the server on and sends worfy\'s answer back with its id', () => {
    const { rpc, feed, events, sent } = harness()
    feed(APPROVAL)
    expect(events).toEqual([{ type: 'request', request: APPROVAL }])
    rpc.respond(7, { decision: 'accept' })
    rpc.respondError('ask-2', -32000, 'declined')
    expect(sent()).toEqual([{ id: 7, result: { decision: 'accept' } }, { id: 'ask-2', error: { code: -32000, message: 'declined' } }])
  })

  it('refuses a request the pinned Codex does not have, or cannot be read, so the server does not wait for an answer', () => {
    const { feed, events, sent, logged } = harness()
    feed({ id: 8, method: 'item/teleport/requestApproval', params: {} })
    feed({ id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr_1' } })
    expect(events.map((event) => event.type === 'unknown' && event.method)).toEqual(['item/teleport/requestApproval', 'item/commandExecution/requestApproval'])
    expect(sent()).toEqual([
      { id: 8, error: { code: METHOD_NOT_FOUND, message: 'worfy does not know item/teleport/requestApproval' } },
      { id: 9, error: { code: INVALID_PARAMS, message: expect.stringContaining("must have required property 'turnId'") } },
    ])
    expect(logged).toHaveLength(2)
  })
})

describe('rpc.ts: what the schema refuses, and broken lines', () => {
  it('turns a notification that fails the schema into an `unknown` event and a log line, not an exception', () => {
    const { rpc, events, logged } = harness()
    const line = JSON.stringify({ method: 'turn/started', params: { threadId: 'thr_1' } })
    expect(() => rpc.receive(line)).not.toThrow()
    expect(events).toEqual([{ type: 'unknown', method: 'turn/started', problems: ["/params must have required property 'turn'"], line }])
    expect(logged).toEqual(["a message of the app-server is not in the schema of the pinned Codex (turn/started): /params must have required property 'turn'"])
  })

  it('turns a notification of a method the pinned Codex does not have into an `unknown` event', () => {
    const { feed, events } = harness()
    feed({ method: 'turn/teleported', params: {} })
    expect(events).toEqual([expect.objectContaining({ type: 'unknown', method: 'turn/teleported', problems: ['turn/teleported is not a notification of the pinned Codex'] })])
  })

  it('names at most five problems of one message and counts the rest', () => {
    const { feed, events } = harness()
    feed({ method: 'item/commandExecution/requestApproval', id: 3, params: { threadId: 1, turnId: 2, itemId: 3, startedAtMs: 'x', command: 5, cwd: 6, reason: 7 } })
    const [event] = events
    expect(event?.type === 'unknown' && event.problems.at(-1)).toMatch(/^and \d+ more$/)
    expect(event?.type === 'unknown' && event.problems).toHaveLength(6)
  })

  it('rejects the request whose result fails the schema of its response, and reports the message', async () => {
    const { rpc, feed, events } = harness()
    const answer = rpc.request('turn/start', { threadId: 'thr_1', input: [] })
    feed({ id: 1, result: { turn: { id: 'turn_1' } } })
    await expect(answer).rejects.toThrow(/^Codex app-server answered turn\/start with a result the pinned Codex does not have: \/turn must have required property/)
    expect(events).toEqual([expect.objectContaining({ type: 'unknown', method: 'turn/start' })])
  })

  it('rejects the request whose error is not a JSON-RPC error', async () => {
    const { rpc, feed, events } = harness()
    const answer = rpc.request('thread/start', {})
    feed({ id: 1, error: 'broken' })
    await expect(answer).rejects.toThrow('Codex app-server answered thread/start with an error worfy cannot read: {"id":1,"error":"broken"}')
    expect(events).toEqual([expect.objectContaining({ type: 'unknown', method: 'thread/start' })])
  })

  it('takes any result of a method the bundle has no response schema for', async () => {
    const { rpc, feed } = harness()
    const answer = rpc.request('account/logout', undefined)
    feed({ id: 1, result: { anything: true } })
    await expect(answer).resolves.toEqual({ anything: true })
  })

  it('turns a line that is not JSON into an `error` event, and goes on with the next line', async () => {
    const { rpc, feed, events } = harness()
    const answer = rpc.request('thread/start', {})
    expect(() => rpc.receive('{"id":1,"result":')).not.toThrow()
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/^not JSON: /), line: '{"id":1,"result":' }])
    feed(DELTA)
    feed({ id: 1, result: { anything: 'goes for thread/start? no' } })
    // thread/start has a response schema: this result fails it, and the request learns so at once.
    await expect(answer).rejects.toThrow(/thread\/start with a result the pinned Codex does not have/)
    expect(events[1]).toEqual({ type: 'notification', notification: DELTA })
  })

  it('reports JSON that is not a JSON-RPC message, and skips empty lines', () => {
    const { rpc, feed, events } = harness()
    rpc.receive('   ')
    rpc.receive('\r')
    feed('[1,2]')
    feed({ id: 4 })
    expect(events).toEqual([
      { type: 'unknown', method: null, problems: ['not a JSON-RPC message: not an object'], line: '[1,2]' },
      { type: 'unknown', method: null, problems: ['not a JSON-RPC message: no method, and not an answer'], line: '{"id":4}' },
    ])
  })
})
