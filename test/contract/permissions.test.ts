// Permission requests of a Session through the `agent.*` IPC channels, on the fake agent (ticket 21):
// canUseTool asks the renderer (`permission_request`), `agent.permission` answers it. "Allow" lets
// one call through, "Always allow" the tool until the end of this Session only, "Deny" tells the
// model the user refused; Interrupt, closing the Session and a crash of Claude Code refuse a request
// nobody answered.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { CANCELLED_MESSAGE, DENIED_MESSAGE, PermissionGate, UNATTENDED_DENIED_MESSAGE } from '../../src/main/agent/permissions'
import { UNATTENDED_MODE_MESSAGE } from '../../src/main/agent/session-settings'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { agentHandlers } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../src/shared/agent/settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL } from '../app-url'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type PermissionCall = Extract<FakeCall, { kind: 'permission' }>

let cwd: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-permissions-'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function harness(script: string | ((request: QueryRequest) => string), settingsHome?: string, scriptsDir = fixtures) {
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script, record: (call) => calls.push(call), settingsHome }))
  registries.push(registry)
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, undefined, (send) => send(sender))) }, isTrustedSender: (url) => url === APP_URL })
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  const call = async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown): Promise<T> => {
    const result = await call(channel, input)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  /** Events of one Session (by any of its ids), or of all. */
  const events = (sessionIds?: readonly string[]): AgentEvent[] =>
    received.filter((each) => sessionIds === undefined || sessionIds.includes(each.sessionId)).map((each) => each.event)
  const ofType = <T extends AgentEvent['type']>(type: T, sessionIds?: readonly string[]) =>
    events(sessionIds).filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  const permissions = () => calls.filter((each): each is PermissionCall => each.kind === 'permission')
  /** Starts a Session in `default` mode, where Claude Code asks before tools; answers its first id. */
  const start = async (resume?: string) => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', resume === undefined ? { cwd } : { cwd, resume })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    await ok('agent.configure', { sessionId, change: { permissionMode: 'default' } })
    return sessionId
  }
  /**
   * Starts a Session the way Autopilot does (worfy-daily ticket 02): unattended, over the picks
   * saved for its Node (`default` mode unless given); answers its first id.
   */
  const startUnattended = async (settings: SessionSettings = { ...DEFAULT_SETTINGS, permissionMode: 'default' }) => {
    const session = registry.start(cwd, undefined, (sessionId, event) => received.push({ sessionId, event }), settings, { unattended: true })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    return session.id
  }
  /** The ids a Session's events came under: its temporary id and, after its first turn, its SDK id. */
  const idsOf = (sessionId: string): string[] => {
    const session = registry.get(sessionId)
    return [...new Set([sessionId, session.id])]
  }
  return { call, ok, calls, permissions, registry, events, ofType, start, startUnattended, idsOf, received }
}

/**
 * The text of every user message each Claude Code process got, one list per process in start
 * order. The processes of one Session run one after another, so a `start` opens the next list.
 */
function messagesPerProcess(calls: readonly FakeCall[]): string[][] {
  const processes: string[][] = []
  for (const call of calls) {
    if (call.kind === 'start') processes.push([])
    else if (call.kind === 'message') processes.at(-1)?.push(call.text)
  }
  return processes
}

/**
 * A scripts folder of the test's own, in the Session's temporary cwd: `permission` as in the
 * fixtures, and `permission-then-crash` — the same turn with its two Bash calls, after whose
 * `result` Claude Code dies while idle, between turns.
 */
async function scriptsWithCrashAfterTurn(): Promise<string> {
  const dir = join(cwd, 'scripts')
  await mkdir(dir)
  const permission = await readFile(join(fixtures, 'permission.jsonl'), 'utf8')
  await writeFile(join(dir, 'permission.jsonl'), permission)
  const lines = permission.split('\n').filter((line) => line.trim() !== '')
  await writeFile(join(dir, 'permission-then-crash.jsonl'), [...lines, JSON.stringify({ fake: 'crash', error: 'Claude Code process exited with code 1' })].join('\n') + '\n')
  return dir
}

describe('a permission request', () => {
  it('Interrupt refuses the open request, and the Session goes idle', async () => {
    const h = await harness('permission-interrupt')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'clean up' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('needs_permission'))
    const [request] = h.ofType('permission_request')
    expect(request).toMatchObject({ toolName: 'Bash', input: { command: 'rm -rf build' } })

    expect(await h.ok('agent.interrupt', { sessionId: id })).toEqual({ interrupted: true })

    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    expect(h.ofType('permission_resolved')).toEqual([{ type: 'permission_resolved', requestId: request?.requestId, decision: 'cancelled' }])
    expect(h.permissions()).toEqual([
      { kind: 'permission', toolName: 'Bash', input: { command: 'rm -rf build', description: 'Remove the build folder' }, result: { behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true } },
    ])
    const [result] = h.ofType('result')
    expect(result?.interrupted).toBe(true)
    // Answering a request that is gone changes nothing.
    expect(await h.ok('agent.permission', { sessionId: id, requestId: request?.requestId, decision: 'allow' })).toEqual({ answered: false })
  })

  it('"Allow" lets one call through, "Deny" tells the model the user refused; the turn goes on', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    const first = h.ofType('permission_request')[0]
    expect(first).toMatchObject({ toolName: 'Bash', input: { command: 'mkdir -p build/one', description: 'Create the build folder' }, alwaysAllow: true })
    expect(h.registry.get(id).state).toBe('needs_permission')

    expect(await h.ok('agent.permission', { sessionId: id, requestId: first?.requestId, decision: 'allow' })).toEqual({ answered: true })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(2))
    const second = h.ofType('permission_request')[1]
    expect(second).toMatchObject({ toolName: 'Bash', input: { command: 'ls -la build' } })

    expect(await h.ok('agent.permission', { sessionId: id, requestId: second?.requestId, decision: 'deny' })).toEqual({ answered: true })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))

    expect(h.permissions().map((each) => each.result)).toEqual([
      // The input goes on unchanged; nothing is written to the permission settings.
      { behavior: 'allow', updatedInput: { command: 'mkdir -p build/one', description: 'Create the build folder' } },
      { behavior: 'deny', message: DENIED_MESSAGE },
    ])
    expect(h.ofType('permission_resolved').map((each) => each.decision)).toEqual(['allow', 'deny'])
    // The model gets the refusal as the tool's error.
    const denied = h.ofType('tool_result').find((each) => each.toolUseId === 'toolu_fake_perm_2')
    expect(denied).toMatchObject({ isError: true, content: DENIED_MESSAGE })
    expect(h.ofType('result')).toHaveLength(1)
    // The state went busy → needs_permission → busy → needs_permission → busy → idle.
    const states = h.ofType('state').map((each) => each.state)
    expect(states.slice(states.indexOf('busy'))).toEqual(['busy', 'needs_permission', 'busy', 'needs_permission', 'busy', 'idle'])
  })

  it('"Always allow" covers the tool for the rest of this Session only: not another Session, not after Resume', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    const first = h.ofType('permission_request')[0]
    await h.ok('agent.permission', { sessionId: id, requestId: first?.requestId, decision: 'always_allow' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    // The second Bash call, another command, went through without a request.
    expect(h.ofType('permission_request')).toHaveLength(1)
    expect(h.permissions().map((each) => each.result.behavior)).toEqual(['allow', 'allow'])
    expect(h.permissions().every((each) => !('updatedPermissions' in each.result))).toBe(true)

    // The next turn of the same Session asks for nothing either.
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(2))
    expect(h.ofType('permission_request')).toHaveLength(1)
    const sdkId = h.registry.get(id).sdkId
    expect(sdkId).not.toBeNull()

    // Another Session asks again.
    const other = await h.start()
    await h.ok('agent.send', { sessionId: other, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request', h.idsOf(other))).toHaveLength(1))
    await h.ok('agent.close', { sessionId: other })

    // So does the first Session, resumed after it was closed.
    await h.ok('agent.close', { sessionId: id })
    const resumed = await h.start(sdkId ?? undefined)
    await h.ok('agent.send', { sessionId: resumed, text: 'build it' })
    await vi.waitFor(() => expect(h.registry.get(resumed).state).toBe('needs_permission'))
    expect(h.registry.get(resumed).sdkId).toBe(sdkId)
  })

  it('"Always allow" changes no settings file of the Project or of ~/.claude (mtime)', async () => {
    // The fake agent writes these files the way Claude Code would if an answer carried
    // `updatedPermissions` (fake-query.ts); its ~/.claude is a temporary directory.
    const home = join(cwd, 'claude-home')
    await mkdir(join(cwd, '.claude'))
    await mkdir(home)
    const files = [join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json'), join(home, 'settings.json'), join(home, 'settings.local.json')]
    for (const file of files) await writeFile(file, '{}\n')
    const mtimes = async () => Promise.all(files.map(async (file) => [(await stat(file)).mtimeMs, await readFile(file, 'utf8')]))
    const before = await mtimes()

    const h = await harness('permission', home)
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    await h.ok('agent.permission', { sessionId: id, requestId: h.ofType('permission_request')[0]?.requestId, decision: 'always_allow' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))

    expect(await mtimes()).toEqual(before)
  })

  it('closing the Session refuses the open request', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    await h.ok('agent.close', { sessionId: id })
    await vi.waitFor(() => expect(h.permissions()).toHaveLength(1))
    expect(h.permissions()[0]?.result).toEqual({ behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true })
    expect(h.ofType('permission_resolved').map((each) => each.decision)).toEqual(['cancelled'])
    expect(h.ofType('state').at(-1)?.state).toBe('closed')
  })

  it('"Always allow" covers only the tool it was given: Write in the same Session still asks', async () => {
    const h = await harness('permission-two-tools')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build and write notes' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    await h.ok('agent.permission', { sessionId: id, requestId: h.ofType('permission_request')[0]?.requestId, decision: 'always_allow' })

    // The second Bash call goes through; the Write call after it asks.
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(2))
    const write = h.ofType('permission_request')[1]
    expect(write).toMatchObject({ toolName: 'Write', input: { content: 'done' } })
    expect(h.registry.get(id).state).toBe('needs_permission')
    expect(h.permissions().map((each) => [each.toolName, each.result.behavior])).toEqual([
      ['Bash', 'allow'],
      ['Bash', 'allow'],
    ])

    await h.ok('agent.permission', { sessionId: id, requestId: write?.requestId, decision: 'allow' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    expect(h.permissions().map((each) => each.toolName)).toEqual(['Bash', 'Bash', 'Write'])
  })

  it('in bypassPermissions Claude Code asks nothing', async () => {
    const h = await harness('permission')
    const { sessionId } = await h.ok<{ sessionId: string }>('agent.start', { cwd })
    await vi.waitFor(() => expect(h.registry.get(sessionId).state).toBe('idle'))
    await h.ok('agent.send', { sessionId, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(1))
    expect(h.ofType('permission_request')).toEqual([])
    expect(h.permissions()).toEqual([])
  })
})

// The real SDK is not known to abort canUseTool's signal on interrupt, close or a crash (ticket 06
// did not check it). Here the fake agent leaves the signal alone, so only the Session's own refusal
// (PermissionGate.cancelAll in session.ts) can end the request.
describe('the Session refuses an open request itself, whatever Claude Code does with the signal', () => {
  const cancelled = { behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true }

  it('on Interrupt: the request is cancelled and the Session goes idle', async () => {
    const h = await harness('permission-kept-signal')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'clean up' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('needs_permission'))
    const requestId = h.ofType('permission_request')[0]?.requestId

    expect(await h.ok('agent.interrupt', { sessionId: id })).toEqual({ interrupted: true })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    expect(h.ofType('permission_resolved')).toEqual([{ type: 'permission_resolved', requestId, decision: 'cancelled' }])
    expect(h.permissions().map((each) => each.result)).toEqual([cancelled])
  })

  it('on close: the request is cancelled before the Session closes', async () => {
    const h = await harness('permission-kept-signal')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'clean up' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('needs_permission'))

    await h.ok('agent.close', { sessionId: id })
    await vi.waitFor(() => expect(h.permissions()).toHaveLength(1))
    expect(h.permissions()[0]?.result).toEqual(cancelled)
    expect(h.ofType('permission_resolved').map((each) => each.decision)).toEqual(['cancelled'])
    expect(h.ofType('state').at(-1)?.state).toBe('closed')
  })

  it('when Claude Code dies: the request is cancelled and the Session shows the error', async () => {
    const h = await harness('permission-crash')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'release' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    expect(h.ofType('permission_request')).toHaveLength(1)
    expect(h.ofType('permission_resolved').map((each) => each.decision)).toEqual(['cancelled'])
    await vi.waitFor(() => expect(h.permissions().map((each) => each.result)).toEqual([cancelled]))
    const states = h.ofType('state').map((each) => each.state)
    expect(states.slice(states.indexOf('busy'))).toEqual(['busy', 'needs_permission', 'error'])
  })
})

// A crash of Claude Code and the next send start a new process for the same Session (session.ts,
// begin()), with the same PermissionGate. What the user refused stays refused there; the new
// process asks again and runs nothing until the user answers.
describe('after Claude Code died and the Session was started again by the next send', () => {
  const cancelled = { behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true }
  const starts = (calls: readonly FakeCall[]) => calls.filter((each): each is Extract<FakeCall, { kind: 'start' }> => each.kind === 'start')
  /** What a tool of the fake agent reported as run, rather than refused. */
  const ran = (h: Awaited<ReturnType<typeof harness>>) => h.ofType('tool_result').filter((each) => !each.isError)

  it('a call refused because Claude Code died does not run in the new process: the next call asks, in the mode the user picked', async () => {
    const h = await harness((request) => (request.resume === undefined ? 'permission-crash' : 'permission'))
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'release' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    await vi.waitFor(() => expect(h.permissions().map((each) => each.result)).toEqual([cancelled]))

    await h.ok('agent.send', { sessionId: id, text: 'go on' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('needs_permission'))
    // The new process resumes the SDK session in the user's mode, gets only the new message, and
    // its first Bash call waits for the user: no answer was given for it.
    expect(starts(h.calls).map((each) => [each.resume, each.settings.permissionMode])).toEqual([
      [null, 'bypassPermissions'],
      [h.registry.get(id).sdkId, 'default'],
    ])
    expect(messagesPerProcess(h.calls)).toEqual([['release'], ['go on']])
    expect(h.ofType('permission_request').map((each) => each.input)).toMatchObject([{ command: 'make release' }, { command: 'mkdir -p build/one' }])
    expect(h.permissions().map((each) => each.result)).toEqual([cancelled])
    expect(ran(h)).toEqual([])

    // Deny refuses it, and the next call asks again.
    const [, second] = h.ofType('permission_request')
    await h.ok('agent.permission', { sessionId: id, requestId: second?.requestId, decision: 'deny' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(3))
    expect(h.permissions().map((each) => each.result)).toEqual([cancelled, { behavior: 'deny', message: DENIED_MESSAGE }])
    expect(ran(h)).toEqual([])
  })

  it('"Deny" is not remembered as anything else: after a crash between turns the same tool asks again, and nothing runs by itself', async () => {
    const scripts = await scriptsWithCrashAfterTurn()
    const h = await harness((request) => (request.resume === undefined ? 'permission-then-crash' : 'permission'), undefined, scripts)
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'push the release' })
    for (const count of [1, 2]) {
      await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(count))
      await h.ok('agent.permission', { sessionId: id, requestId: h.ofType('permission_request')[count - 1]?.requestId, decision: 'deny' })
    }
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    expect(h.ofType('result')).toHaveLength(1)

    await h.ok('agent.send', { sessionId: id, text: 'try again' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('needs_permission'))
    expect(h.ofType('permission_request')).toHaveLength(3)
    expect(h.permissions().map((each) => each.result.behavior)).toEqual(['deny', 'deny'])
    expect(messagesPerProcess(h.calls)).toEqual([['push the release'], ['try again']])
    expect(ran(h)).toEqual([])
  })

  // Decided in this ticket (worfy-reliability 01): "Always allow" lasts until the Session ends, as the
  // permission card says; a crash does not end the Session, so the list stays (permissions.ts).
  // Closing the Session and resuming it starts with an empty list (the test of "Always allow" above).
  it('"Always allow" given before the crash still covers the tool in the new process of the same Session, and no other tool', async () => {
    const scripts = await scriptsWithCrashAfterTurn()
    const h = await harness((request) => (request.resume === undefined ? 'permission-then-crash' : 'permission'), undefined, scripts)
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    await h.ok('agent.permission', { sessionId: id, requestId: h.ofType('permission_request')[0]?.requestId, decision: 'always_allow' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))

    await h.ok('agent.send', { sessionId: id, text: 'build it again' })
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(2))
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    expect(h.ofType('permission_request')).toHaveLength(1)
    expect(h.permissions().map((each) => [each.toolName, each.result.behavior])).toEqual([
      ['Bash', 'allow'],
      ['Bash', 'allow'],
      ['Bash', 'allow'],
      ['Bash', 'allow'],
    ])
    expect(messagesPerProcess(h.calls)).toEqual([['build it'], ['build it again']])
    // The Session's own gate holds Bash alone: any other tool still asks.
    const session = h.registry.get(id) as unknown as { permissions: PermissionGate }
    expect(session.permissions.alwaysAllowed()).toEqual(['Bash'])
  })

  it('an unattended Session started again after a crash still refuses every call at once', async () => {
    const requests: QueryRequest[] = []
    const h = await harness((request) => {
      requests.push(request)
      return request.resume === undefined ? 'crash' : 'turn'
    })
    const id = await h.startUnattended()
    await h.ok('agent.send', { sessionId: id, text: 'work' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('error'))
    await h.ok('agent.send', { sessionId: id, text: 'again' })
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(1))

    expect(requests.map((request) => [request.unattended, request.settings.permissionMode])).toEqual([
      [true, 'bypassPermissions'],
      [true, 'bypassPermissions'],
    ])
    const answer = await requests[1]?.canUseTool('Bash', { command: 'git push' }, { signal: new AbortController().signal })
    expect(answer).toEqual({ behavior: 'deny', message: UNATTENDED_DENIED_MESSAGE })
    expect(h.ofType('permission_request')).toEqual([])
    expect(h.ofType('refused_dialog')).toMatchObject([{ dialog: 'permission_request', subject: 'Bash' }])
  })
})

describe('agent.permission at the IPC boundary', () => {
  it('refuses a decision it does not know and a request id of the wrong type', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    const requestId = h.ofType('permission_request')[0]?.requestId

    for (const input of [
      { sessionId: id, requestId, decision: 'maybe' },
      { sessionId: id, requestId, decision: 1 },
      { sessionId: id, requestId: 42, decision: 'allow' },
      { sessionId: id, requestId: '', decision: 'allow' },
    ]) {
      expect((await h.call('agent.permission', input)).ok).toBe(false)
    }
    expect(h.registry.get(id).state).toBe('needs_permission')
  })

  it('gives the Session only the parsed request id and decision, extra keys dropped', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    const requestId = h.ofType('permission_request')[0]?.requestId
    const session = h.registry.get(id)
    const answer = vi.spyOn(session, 'answerPermission')

    const result = await h.call('agent.permission', { sessionId: id, requestId, decision: 'allow', updatedPermissions: [{ destination: 'userSettings' }] })
    expect(result).toEqual({ ok: true, value: { answered: true } })
    expect(answer).toHaveBeenCalledWith(requestId, 'allow')
  })

  it('sends the renderer the request without the SDK keys it does not describe', async () => {
    const h = await harness('permission')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toHaveLength(1))
    const request = h.ofType('permission_request')[0]
    expect(Object.keys(request ?? {}).sort()).toEqual(['alwaysAllow', 'blockedPath', 'description', 'input', 'requestId', 'suggestions', 'title', 'toolName', 'toolUseId', 'type'])
    // Only what a suggestion is and where it would write: worfy applies none of them.
    expect(request?.suggestions).toEqual([
      { type: 'addRules', destination: 'localSettings' },
      { type: 'setMode', destination: 'session' },
    ])
  })
})

describe('PermissionGate', () => {
  const options = (signal = new AbortController().signal, extra: Record<string, unknown> = {}) => ({ signal, ...extra })

  it('refuses at once a request whose signal is already aborted, and one aborted while open', async () => {
    const events: AgentEvent[] = []
    const gate = new PermissionGate((event) => events.push(event), () => undefined)
    const aborted = new AbortController()
    aborted.abort()
    expect(await gate.canUseTool('Bash', { command: 'ls' }, options(aborted.signal))).toEqual({ behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true })
    expect(events).toEqual([])

    const later = new AbortController()
    const answer = gate.canUseTool('Bash', { command: 'ls' }, options(later.signal))
    expect(gate.pending).toBe(1)
    later.abort()
    expect(await answer).toEqual({ behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true })
    expect(gate.pending).toBe(0)
    expect(events.map((event) => event.type)).toEqual(['permission_request', 'permission_resolved'])
  })

  it('"Always allow" also allows the requests for the same tool already open, and no other tool\'s', async () => {
    const events: AgentEvent[] = []
    const counts: number[] = []
    const gate = new PermissionGate((event) => events.push(event), (pending) => counts.push(pending))
    const first = gate.canUseTool('Bash', { command: 'ls' }, options())
    const second = gate.canUseTool('Bash', { command: 'pwd' }, options())
    const write = gate.canUseTool('Write', { file_path: '/tmp/x' }, options())
    const ids = events.flatMap((event) => (event.type === 'permission_request' ? [event.requestId] : []))
    expect(gate.pending).toBe(3)

    expect(gate.answer(ids[0] ?? '', 'always_allow')).toBe(true)
    expect(await first).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(await second).toEqual({ behavior: 'allow', updatedInput: { command: 'pwd' } })
    expect(gate.pending).toBe(1)
    expect(events.filter((event) => event.type === 'permission_resolved')).toEqual([
      { type: 'permission_resolved', requestId: ids[0], decision: 'always_allow' },
      { type: 'permission_resolved', requestId: ids[1], decision: 'always_allow' },
    ])
    expect(counts.at(-1)).toBe(1)
    // The Write request still waits for its own answer.
    expect(gate.answer(ids[1] ?? '', 'allow')).toBe(false)
    expect(gate.answer(ids[2] ?? '', 'deny')).toBe(true)
    expect(await write).toEqual({ behavior: 'deny', message: DENIED_MESSAGE })
  })

  it('does not offer "Always allow" when Claude Code says it must not, and refuses that answer', async () => {
    const events: AgentEvent[] = []
    const gate = new PermissionGate((event) => events.push(event), () => undefined)
    const answer = gate.canUseTool('Bash', { command: 'ls' }, options(undefined, { suppressAlwaysAllowRule: true }))
    const request = events[0]
    expect(request).toMatchObject({ type: 'permission_request', alwaysAllow: false })
    const requestId = request?.type === 'permission_request' ? request.requestId : ''
    expect(() => gate.answer(requestId, 'always_allow')).toThrow(/Always allow/)
    expect(gate.answer(requestId, 'allow')).toBe(true)
    expect(await answer).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    // The tool is not remembered: the next call asks again.
    void gate.canUseTool('Bash', { command: 'pwd' }, options())
    expect(gate.pending).toBe(1)
    gate.cancelAll()
  })
})

describe('an unattended Session (Autopilot, worfy-daily ticket 02)', () => {
  it('refuses a change of its permission mode with a reason over IPC; the mode stays bypassPermissions', async () => {
    const h = await harness('permission')
    const id = await h.startUnattended()

    const refused = await h.call('agent.configure', { sessionId: id, change: { permissionMode: 'default' } })
    expect(refused).toEqual({ ok: false, error: `agent.configure failed: ${UNATTENDED_MODE_MESSAGE}` })
    expect(h.registry.get(id).settings.permissionMode).toBe('bypassPermissions')
    // A change that carries a mode is refused whole: its model is not applied either.
    expect(await h.call('agent.configure', { sessionId: id, change: { model: 'opus', permissionMode: 'plan' } })).toEqual({ ok: false, error: `agent.configure failed: ${UNATTENDED_MODE_MESSAGE}` })
    expect(h.registry.get(id).settings).toEqual({ model: null, effort: null, permissionMode: 'bypassPermissions' })
    expect(h.calls.filter((each) => each.kind === 'setPermissionMode' || each.kind === 'setModel')).toEqual([])
  })

  it('starts in bypassPermissions even when its Node saved another mode, and asks nothing in a turn', async () => {
    const h = await harness('permission')
    const id = await h.startUnattended({ model: 'sonnet', effort: 'high', permissionMode: 'plan' })
    expect(h.registry.get(id).unattended).toBe(true)
    expect(h.registry.get(id).settings).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'bypassPermissions' })
    expect(h.calls.filter((each) => each.kind === 'start')).toEqual([{ kind: 'start', resume: null, settings: { model: 'sonnet', effort: 'high', permissionMode: 'bypassPermissions' } }])
    expect(h.ofType('settings')[0]?.settings.permissionMode).toBe('bypassPermissions')

    await h.ok('agent.send', { sessionId: id, text: 'build it' })
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(1))
    expect(h.ofType('permission_request')).toEqual([])
    expect(h.permissions()).toEqual([])
    expect(h.ofType('refused_dialog')).toEqual([])
  })

  it('still takes a change of model or effort, and a change to bypassPermissions itself', async () => {
    const h = await harness('turn')
    const id = await h.startUnattended()
    expect(await h.ok('agent.configure', { sessionId: id, change: { model: 'opus', effort: 'low' } })).toEqual({ model: 'opus', effort: 'low', permissionMode: 'bypassPermissions' })
    expect(await h.ok('agent.configure', { sessionId: id, change: { permissionMode: 'bypassPermissions' } })).toEqual({ model: 'opus', effort: 'low', permissionMode: 'bypassPermissions' })
  })

  it('leaves an ordinary Session free to change its mode, as before', async () => {
    const h = await harness('turn')
    const id = await h.start()
    expect(h.registry.get(id).unattended).toBe(false)
    expect(h.registry.get(id).settings.permissionMode).toBe('default')
    expect(h.calls).toContainEqual({ kind: 'setPermissionMode', mode: 'default' })
  })

  it('answers canUseTool with a refusal at once: the gate opens no request, subscribers get refused_dialog', async () => {
    const requests: QueryRequest[] = []
    const h = await harness((request) => {
      requests.push(request)
      return 'turn'
    })
    const observed: AgentEvent[] = []
    h.registry.observe((_sessionId, event) => observed.push(event))
    const id = await h.startUnattended()
    const [request] = requests
    expect(request?.unattended).toBe(true)

    const answer = await request?.canUseTool('Bash', { command: 'rm -rf build' }, { signal: new AbortController().signal })
    expect(answer).toEqual({ behavior: 'deny', message: UNATTENDED_DENIED_MESSAGE })
    const refused = { type: 'refused_dialog', dialog: 'permission_request', subject: 'Bash', message: UNATTENDED_DENIED_MESSAGE }
    expect(h.ofType('refused_dialog')).toEqual([refused])
    expect(observed.filter((each) => each.type === 'refused_dialog')).toEqual([refused])
    expect(h.ofType('permission_request')).toEqual([])
    expect(h.ofType('state').map((each) => each.state)).not.toContain('needs_permission')
    expect(h.registry.get(id).state).toBe('idle')
  })

  it('tells the model why Claude Code asked, and gives refused_dialog the Subagent and the reason', async () => {
    const requests: QueryRequest[] = []
    const h = await harness((request) => {
      requests.push(request)
      return 'turn'
    })
    await h.startUnattended()
    const [request] = requests
    const reason = 'rm -rf with a target that cannot be resolved; this requires explicit approval and cannot be auto-allowed by permission rules'
    const options = { signal: new AbortController().signal, decisionReason: reason, agentID: 'agent-a1b2c3' }

    const answer = await request?.canUseTool('Bash', { command: 'rm -rf "$TARGET"' }, options)
    const message = `${UNATTENDED_DENIED_MESSAGE}\nrefused because: ${reason}; rewrite the command so this check does not fire`
    expect(answer).toEqual({ behavior: 'deny', message })
    expect(h.ofType('refused_dialog')).toEqual([{ type: 'refused_dialog', dialog: 'permission_request', subject: 'Bash', message, agent: 'agent-a1b2c3', reason }])
  })

  it('keeps the old refusal word for word when Claude Code gives no reason: no reason and no agent in refused_dialog', async () => {
    const requests: QueryRequest[] = []
    const h = await harness((request) => {
      requests.push(request)
      return 'turn'
    })
    await h.startUnattended()
    const [request] = requests
    // A blank reason is no reason; an agent without a reason is still named.
    const answer = await request?.canUseTool('Bash', { command: 'rm -rf build' }, { signal: new AbortController().signal, decisionReason: '  ', agentID: 'agent-x' })
    expect(answer).toEqual({ behavior: 'deny', message: UNATTENDED_DENIED_MESSAGE })
    expect(h.ofType('refused_dialog')).toStrictEqual([{ type: 'refused_dialog', dialog: 'permission_request', subject: 'Bash', message: UNATTENDED_DENIED_MESSAGE, agent: 'agent-x' }])
  })

  it('gives an ordinary Session the gate: its canUseTool waits for the user', async () => {
    const requests: QueryRequest[] = []
    const h = await harness((request) => {
      requests.push(request)
      return 'turn'
    })
    const id = await h.start()
    const [request] = requests
    expect(request?.unattended).toBe(false)
    void request?.canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal })
    await vi.waitFor(() => expect(h.ofType('permission_request')).toMatchObject([{ toolName: 'Bash', input: { command: 'ls' } }]))
    expect(h.ofType('refused_dialog')).toEqual([])
    // Closing the Session refuses the open request, so nothing is left waiting.
    await h.ok('agent.close', { sessionId: id })
  })
})
