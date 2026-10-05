// The Session lifecycle through the `agent.*` IPC channels, on the fake agent
// (test/fixtures/agent-scripts/): what the renderer sends and the events it gets back.
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { agentHandlers, windowSink } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-project-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/**
 * The agent handlers registered on a fake ipcMain, over a registry with the fake agent. `script`
 * picks the scenario for each query the registry starts (a resumed Session starts a new one).
 */
async function harness(script: string | ((request: QueryRequest) => string)) {
  const requests: QueryRequest[] = []
  const factory = fakeQueryFactory({ scriptsDir, script })
  /** close() of each query the registry started, in start order. */
  const closes: MockInstance<() => void>[] = []
  const registry = new SessionRegistry(async (request) => {
    requests.push(request)
    const query = await factory(request)
    closes.push(vi.spyOn(query, 'close'))
    return query
  })
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry)) }, isTrustedSender: (url) => url === APP_URL })

  const received: AgentEventEnvelope[] = []
  /** A window's webContents: it gets events and can be destroyed. */
  const makeWindow = () => {
    const window = Object.assign(new EventEmitter(), {
      destroyed: false,
      isDestroyed: () => window.destroyed,
      send: (channel: string, payload: unknown) => {
        expect(channel).toBe(`${IPC_CHANNEL_PREFIX}agent.event`)
        received.push(payload as AgentEventEnvelope)
      },
      destroy: () => {
        window.destroyed = true
        window.emit('destroyed')
      },
    })
    return window
  }
  const sender = makeWindow()
  const call = async (channel: string, input?: unknown, from: ReturnType<typeof makeWindow> = sender): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown, from?: ReturnType<typeof makeWindow>): Promise<T> => {
    const result = await call(channel, input, from)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  /** Events of one Session, whichever of its ids (temporary or final) they were sent under. */
  const eventsOf = (ids: string[]): AgentEvent[] => {
    const known = new Set(ids)
    for (const { sessionId, event } of received) if (event.type === 'renamed' && known.has(event.from)) known.add(sessionId)
    return received.filter((e) => known.has(e.sessionId)).map((e) => e.event)
  }
  const states = (ids: string[]) => eventsOf(ids).flatMap((e) => (e.type === 'state' ? [e.state] : []))
  const start = async () => (await ok<{ sessionId: string }>('agent.start', { cwd })).sessionId
  return { call, ok, received, eventsOf, states, start, requests, closes, registry, sender, makeWindow }
}

const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)

describe('agent channels on the fake agent', () => {
  it('start → send gives busy … result … idle, with the id Claude Code assigned', async () => {
    const h = await harness('turn')
    const tempId = await h.start()
    expect(tempId).toMatch(/^pending-/)
    await vi.waitFor(() => expect(h.states([tempId])).toEqual(['starting', 'idle']))
    expect(ofType(h.eventsOf([tempId]), 'account')).toEqual([{ type: 'account', loggedIn: true, subscriptionType: 'Claude Max', apiProvider: 'firstParty', tokenSource: 'claude.ai' }])

    await h.ok('agent.send', { sessionId: tempId, text: 'hello' })
    await vi.waitFor(() => expect(h.states([tempId])).toEqual(['starting', 'idle', 'busy', 'idle']))

    const events = h.eventsOf([tempId])
    const types = events.map((e) => e.type)
    expect(types.slice(types.indexOf('renamed'))).toEqual(['renamed', 'init', 'status', 'delta', 'delta', 'text', 'result', 'state'])
    expect(types.indexOf('state', types.indexOf('account') + 2)).toBeLessThan(types.indexOf('result'))
    const [init] = ofType(events, 'init')
    const finalId = init?.sdkSessionId ?? ''
    expect(finalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(init?.slashCommands).toContain('ship-ticket')
    expect(init?.cwd).toBe(cwd)
    // Everything from `renamed` on carries the final id; everything before it, the temporary one.
    const renamedAt = h.received.findIndex((e) => e.event.type === 'renamed')
    expect(h.received[renamedAt]).toEqual({ sessionId: finalId, event: { type: 'renamed', from: tempId } })
    expect(new Set(h.received.slice(0, renamedAt).map((e) => e.sessionId))).toEqual(new Set([tempId]))
    expect(new Set(h.received.slice(renamedAt).map((e) => e.sessionId))).toEqual(new Set([finalId]))
    expect(ofType(events, 'result')).toMatchObject([{ isError: false, text: 'Hello from the fake agent', costUsd: 0.0021, interrupted: false }])

    // Both ids reach the Session; the list shows it once, under its final id.
    expect(await h.ok('agent.list')).toStrictEqual([{ sessionId: finalId, cwd, state: 'idle' }])
    await h.ok('agent.send', { sessionId: finalId, text: 'again' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([tempId]), 'result')).toHaveLength(2))
    expect(h.states([tempId]).at(-1)).toBe('idle')
    expect(h.requests).toHaveLength(1)
  })

  // `interrupt-no-reason` ends the turn without terminal_reason: the mark then comes from the
  // Session, which knows it asked for the interruption.
  it.each(['interrupt', 'interrupt-no-reason'])('interrupt in the middle of a turn (%s) ends it with an interrupted result and idle', async (script) => {
    const h = await harness(script)
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'count to ten' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'delta')).toHaveLength(1))
    expect(h.states([id]).at(-1)).toBe('busy')

    expect(await h.ok('agent.interrupt', { sessionId: id })).toEqual({ interrupted: true })
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('idle'))
    const events = h.eventsOf([id])
    expect(ofType(events, 'result')).toMatchObject([{ isError: true, interrupted: true }])
    expect(ofType(events, 'notice')).toEqual([{ type: 'notice', kind: 'user', text: '[Request interrupted by user]' }])
    // Nothing to interrupt while idle.
    expect(await h.ok('agent.interrupt', { sessionId: id })).toEqual({ interrupted: false })
  })

  it('two Sessions in one Project live independently: their events do not mix', async () => {
    let started = 0
    const h = await harness(() => (started++ === 0 ? 'turn' : 'stop-hook'))
    const first = await h.start()
    const second = await h.start()
    await vi.waitFor(() => expect([h.states([first]).at(-1), h.states([second]).at(-1)]).toEqual(['idle', 'idle']))
    await Promise.all([h.ok('agent.send', { sessionId: first, text: 'one' }), h.ok('agent.send', { sessionId: second, text: 'two' })])
    await vi.waitFor(() => expect([h.states([first]).at(-1), h.states([second]).at(-1)]).toEqual(['idle', 'idle']))

    const a = h.eventsOf([first])
    const b = h.eventsOf([second])
    const [initA] = ofType(a, 'init')
    const [initB] = ofType(b, 'init')
    expect(initA?.sdkSessionId).not.toBe(initB?.sdkSessionId)
    expect(ofType(a, 'text').map((e) => e.text)).toEqual(['Hello from the fake agent'])
    expect(ofType(b, 'text').map((e) => e.text)).toEqual(['ok', 'Running the gate to see what is failing.', 'The gate is still red; here is what failed.'])
    expect(ofType(a, 'hook')).toEqual([])
    expect(ofType(b, 'hook')).toHaveLength(2)
    expect(ofType(a, 'result')).toHaveLength(1)
    expect(ofType(b, 'result')).toHaveLength(1)
    expect((await h.ok<{ sessionId: string; cwd: string }[]>('agent.list')).map((s) => s.cwd)).toEqual([cwd, cwd])

    // Closing one leaves the other running.
    await h.ok('agent.close', { sessionId: initA?.sdkSessionId })
    expect(h.states([first]).at(-1)).toBe('closed')
    expect(await h.ok('agent.list')).toStrictEqual([{ sessionId: initB?.sdkSessionId, cwd, state: 'idle' }])
    await h.ok('agent.send', { sessionId: second, text: 'still here' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([second]), 'result')).toHaveLength(2))
    const closedSend = await h.call('agent.send', { sessionId: first, text: 'gone' })
    expect(closedSend.ok).toBe(false)
  })

  it('a message sent during a turn runs as the next turn: busy again until its own result', async () => {
    const h = await harness('turn')
    const id = await h.start()
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('idle'))
    await h.ok('agent.send', { sessionId: id, text: 'first' })
    await h.ok('agent.send', { sessionId: id, text: 'second, queued' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(2))
    expect(h.states([id])).toEqual(['starting', 'idle', 'busy', 'idle', 'busy', 'idle'])
  })

  it('a turn the Stop hook continues twice stays busy until its only result, then idle', async () => {
    const h = await harness('stop-hook')
    const id = await h.start()
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('idle'))
    await h.ok('agent.send', { sessionId: id, text: 'say ok' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(1))

    const events = h.eventsOf([id])
    const hooks = ofType(events, 'hook')
    expect(hooks).toHaveLength(2)
    for (const hook of hooks) expect(hook).toMatchObject({ hookEvent: 'Stop', exitCode: 2, stderr: expect.stringContaining('Гейт качества красный') as string })
    expect(ofType(events, 'notice').filter((n) => n.kind === 'synthetic')).toHaveLength(2)
    // From the send on, exactly busy then idle: no idle between the continuations.
    expect(h.states([id])).toEqual(['starting', 'idle', 'busy', 'idle'])
    const types = events.map((e) => e.type)
    expect(types.lastIndexOf('hook')).toBeLessThan(types.indexOf('result'))
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle', error: null })
    expect(ofType(events, 'result')).toMatchObject([{ isError: false, numTurns: 3 }])
  })

  it('a failed turn shows its error and leaves the Session usable; no login shows in account', async () => {
    const h = await harness('error')
    const id = await h.start()
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'account')).toHaveLength(1))
    expect(ofType(h.eventsOf([id]), 'account')).toEqual([{ type: 'account', loggedIn: false, subscriptionType: null, apiProvider: 'firstParty', tokenSource: 'none' }])
    await h.ok('agent.send', { sessionId: id, text: 'hi' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(1))
    expect(ofType(h.eventsOf([id]), 'result')).toMatchObject([{ isError: true, error: 'Not logged in · Please run /login' }])
    expect(ofType(h.eventsOf([id]), 'text')).toMatchObject([{ synthetic: true }])
    expect(h.states([id]).at(-1)).toBe('idle')
  })

  it('a crash of Claude Code puts the Session in error with the text; the next send resumes it', async () => {
    const h = await harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'work' })
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('error'))
    const crashed = h.eventsOf([id]).at(-1)
    // The text ends with what Claude Code wrote to stderr before it died.
    expect(crashed).toEqual({ type: 'state', state: 'error', error: 'Claude Code process exited with code 1\nError: ENOSPC: no space left on device' })
    const [init] = ofType(h.eventsOf([id]), 'init')

    await h.ok('agent.send', { sessionId: id, text: 'try again' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(1))
    expect(h.requests.map((r) => r.resume)).toEqual([undefined, init?.sdkSessionId])
    expect(h.states([id]).slice(-3)).toEqual(['error', 'busy', 'idle'])
    // The resumed query reports the same SDK session: no second rename.
    expect(ofType(h.eventsOf([id]), 'renamed')).toHaveLength(1)
  })

  it('Claude Code exiting without agent.close puts the Session in error', async () => {
    const h = await harness((request) => (request.resume === undefined ? 'exit' : 'turn'))
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'work' })
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('error'))
    expect(h.eventsOf([id]).at(-1)).toEqual({ type: 'state', state: 'error', error: 'Claude Code exited' })
    // Not a dead end: the next send resumes the same SDK session.
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(1))
    expect(h.requests).toHaveLength(2)
  })

  it('a start whose account request fails puts the Session in error, not starting forever', async () => {
    const h = await harness('account-error')
    const id = await h.start()
    await vi.waitFor(() => expect(h.states([id])).toEqual(['starting', 'error']))
    expect(h.eventsOf([id]).at(-1)).toEqual({ type: 'state', state: 'error', error: 'Claude Code did not answer the account request' })
    expect(ofType(h.eventsOf([id]), 'account')).toEqual([])
  })

  it('refuses to start a second live Session on the SDK session another one already runs', async () => {
    const h = await harness('turn')
    const resumed = await h.ok<{ sessionId: string }>('agent.start', { cwd, resume: 'sdk-x' })
    // Still under its temporary id: the SDK id is known from `resume` alone.
    const twice = await h.call('agent.start', { cwd, resume: 'sdk-x' })
    expect(!twice.ok && twice.error).toMatch(/sdk-x is already live/)

    const fresh = await h.start()
    await h.ok('agent.send', { sessionId: fresh, text: 'hello' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([fresh]), 'init')).toHaveLength(1))
    const finalId = ofType(h.eventsOf([fresh]), 'init')[0]?.sdkSessionId ?? ''
    const onLive = await h.call('agent.start', { cwd, resume: finalId })
    expect(!onLive.ok && onLive.error).toMatch(/is already live/)
    expect(h.requests).toHaveLength(2)
    expect((await h.ok<{ sessionId: string }[]>('agent.list')).map((s) => s.sessionId).sort()).toEqual([finalId, resumed.sessionId].sort())
    // Once the first one is closed, its SDK session can be resumed again.
    await h.ok('agent.close', { sessionId: resumed.sessionId })
    expect((await h.call('agent.start', { cwd, resume: 'sdk-x' })).ok).toBe(true)
  })

  it('closing a window closes the Sessions it started and stops their Claude Code; other windows keep theirs', async () => {
    const h = await harness('turn')
    const other = h.makeWindow()
    const mine = await h.start()
    const theirs = (await h.ok<{ sessionId: string }>('agent.start', { cwd }, other)).sessionId
    await vi.waitFor(() => expect([h.states([mine]).at(-1), h.states([theirs]).at(-1)]).toEqual(['idle', 'idle']))
    expect(h.closes).toHaveLength(2)

    other.destroy()
    expect(await h.ok('agent.list')).toStrictEqual([{ sessionId: mine, cwd, state: 'idle' }])
    expect((await h.call('agent.send', { sessionId: theirs, text: 'anyone?' })).ok).toBe(false)
    // Its Claude Code is stopped; the other window's is not.
    expect(h.closes[1]).toHaveBeenCalledOnce()
    expect(h.closes[0]).not.toHaveBeenCalled()
    await h.ok('agent.send', { sessionId: mine, text: 'hello' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([mine]), 'result')).toHaveLength(1))
  })

  it('a window that throws on send while it is destroyed still gets all its Sessions closed', async () => {
    const h = await harness('turn')
    const window = h.makeWindow()
    // Electron may not report isDestroyed() yet inside 'destroyed'; send then throws.
    window.isDestroyed = () => false
    const send = window.send
    window.send = (channel, payload) => {
      if (window.destroyed) throw new Error('Object has been destroyed')
      send(channel, payload)
    }
    await h.ok('agent.start', { cwd }, window)
    await h.ok('agent.start', { cwd }, window)
    await vi.waitFor(() => expect(h.closes).toHaveLength(2))
    window.destroy()
    expect(await h.ok('agent.list')).toEqual([])
    for (const close of h.closes) expect(close).toHaveBeenCalledOnce()
  })

  it('an unknown SDK message becomes an unknown event and the turn goes on', async () => {
    const h = await harness('turn')
    const id = await h.start()
    await vi.waitFor(() => expect(h.states([id]).at(-1)).toBe('idle'))
    // Feed one message the fake script does not have, through the same path a real one takes.
    const session = h.registry.get(id) as unknown as { handle(message: unknown): void }
    session.handle({ type: 'brand_new_message', session_id: 'x' })
    expect(h.eventsOf([id]).at(-1)).toEqual({ type: 'unknown', sdkType: 'brand_new_message' })
    await h.ok('agent.send', { sessionId: id, text: 'hello' })
    await vi.waitFor(() => expect(ofType(h.eventsOf([id]), 'result')).toHaveLength(1))
  })
})

describe('agent channel inputs', () => {
  it.each([
    ['a cwd of the wrong type', 'agent.start', { cwd: 42 }, /expected string/],
    ['a relative cwd', 'agent.start', { cwd: 'projects/demo' }, /absolute path/],
    ['an empty message', 'agent.send', { sessionId: 'x', text: '' }, /agent\.send: invalid input/],
    ['a session id of the wrong type', 'agent.interrupt', { sessionId: 7 }, /expected string/],
  ])('rejects %s before the handler runs', async (_label, channel, input, error) => {
    const h = await harness('turn')
    const result = await h.call(channel, input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(error)
    expect(h.requests).toEqual([])
  })

  it('refuses a cwd that is not an existing directory', async () => {
    const h = await harness('turn')
    const result = await h.call('agent.start', { cwd: join(cwd, 'missing') })
    expect(!result.ok && result.error).toMatch(/is not a directory/)
    expect(h.requests).toEqual([])
  })

  it('answers a call for a Session that does not exist with an error', async () => {
    const h = await harness('turn')
    const result = await h.call('agent.send', { sessionId: 'pending-nope', text: 'hi' })
    expect(!result.ok && result.error).toMatch(/No live Session pending-nope/)
  })

  it('passes only the parsed input to the registry: extra keys never reach it', async () => {
    const h = await harness('turn')
    const start = vi.spyOn(h.registry, 'start')
    await h.ok('agent.start', { cwd, resume: undefined, admin: true })
    expect(start).toHaveBeenCalledWith(cwd, undefined, expect.any(Function))
  })
})

describe('agent.event payloads', () => {
  it('sends the parsed envelope: undeclared keys are stripped', () => {
    const sent: unknown[] = []
    const sink = windowSink({ send: (_channel, payload) => sent.push(payload) })
    sink('s1', { type: 'state', state: 'idle', error: null, debug: 'leak' } as AgentEvent)
    expect(sent).toStrictEqual([{ sessionId: 's1', event: { type: 'state', state: 'idle', error: null } }])
  })

  it('refuses to send an event outside the contract', () => {
    const sent: unknown[] = []
    const sink = windowSink({ send: (_channel, payload) => sent.push(payload) })
    expect(() => sink('s1', { type: 'state', state: 'sleeping', error: null } as unknown as AgentEvent)).toThrow(/invalid event payload/)
    expect(sent).toEqual([])
  })

  it('sends nothing to a window that is gone', () => {
    const send = vi.fn()
    windowSink({ send, isDestroyed: () => true })('s1', { type: 'state', state: 'idle', error: null })
    expect(send).not.toHaveBeenCalled()
  })
})
