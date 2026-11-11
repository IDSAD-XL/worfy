// The MCP servers of a Claude Session (worfy-mcp-live ticket 02), on the fake agent: main asks
// Claude Code mcpServerStatus() after each system/init, after each turn's `result`, after an action
// and when a window asks (agent.mcp), and sends the rows as an `mcp` event. A failed ask is "no data",
// never a failed turn. agent.mcpAction does Reconnect (reconnectMcpServer); Turn off, Turn on and any
// other action are refused, and worfy never calls toggleMcpServer: it writes the user's .claude.json
// (the spike of ticket 01). The rows go to the Session's windows only: not into the Autopilot journal,
// not to the console, and the server's config not even there. The fake agent answers with the
// answers the spike recorded (test/fixtures/mcp-live/). Never the real Claude Code.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryHandle } from '../../src/main/agent/session'
import { agentHandlers } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL } from '../app-url'
import { AGENT_SCRIPTS, faultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let cwd: string
let emptyHome: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-mcp-status-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-mcp-status-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A Session on the fake agent playing `script`, through the `agent.*` channels; `wrap` may change the query. */
async function harness(script: string, dir = scriptsDir, wrap: (query: QueryHandle) => QueryHandle = (query) => query) {
  const calls: FakeCall[] = []
  const fake = fakeQueryFactory({ scriptsDir: dir, script, record: (call) => calls.push(call) })
  const registry = new SessionRegistry(async (request) => wrap(await fake(request)))
  registries.push(registry)
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, undefined, (send) => send(sender))) }, isTrustedSender: (url) => url === APP_URL })
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
  const events = (): AgentEvent[] => received.map((each) => each.event)
  const ofType = <T extends AgentEvent['type']>(type: T) => events().filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  const start = async () => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', { cwd })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    return sessionId
  }
  const turn = async (id: string, text: string) => {
    const before = ofType('result').length
    await ok('agent.send', { sessionId: id, text })
    await vi.waitFor(() => expect(ofType('result')).toHaveLength(before + 1))
    await vi.waitFor(() => expect(registry.get(id).state).toBe('idle'))
  }
  /** The calls of MCP servers the fake agent got: reconnectMcpServer and toggleMcpServer. */
  const mcpCalls = () => calls.filter((each) => each.kind === 'reconnectMcpServer' || each.kind === 'toggleMcpServer')
  return { call, ok, calls, mcpCalls, registry, events, ofType, start, turn }
}

const row = (name: string, fields: Partial<McpServerRow> = {}): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: [], ...fields })

const WORFY_CANVAS = row('worfy-canvas', { source: 'worfy' })
const NOTES = row('example-notes')

describe('the mcp event of a Claude Session', () => {
  it('comes after system/init and after the turn: the rows of mcpServerStatus()', async () => {
    const h = await harness('mcp-status')
    const id = await h.start()
    // No turn yet, no system/init: nothing was asked.
    expect(h.ofType('mcp')).toEqual([])

    await h.turn(id, 'one')
    await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(2))
    // After system/init: the servers of the Session after its start (F:restart-status).
    expect(h.ofType('mcp')[0]).toEqual({ type: 'mcp', servers: [NOTES, WORFY_CANVAS] })
    // After the turn: one server failed (F:locked-keychain-status); a failed server offers Reconnect.
    const failed = h.ofType('mcp')[1]?.servers
    expect(failed).toEqual([row('example-oauth', { status: 'failed', tools: null, error: expect.stringMatching(/^Couldn't read the stored credentials/) as unknown as string, actions: ['reconnect'] })])
    // Every mcp event comes after the init that started its turn.
    const types = h.events().map((event) => event.type)
    expect(types.indexOf('mcp')).toBeGreaterThan(types.indexOf('init'))
    expect(h.mcpCalls()).toEqual([])
  })

  it('a failed mcpServerStatus() is "no data", and the turn goes on', async () => {
    const h = await harness('mcp-status')
    const id = await h.start()
    await h.turn(id, 'one')
    await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(2))

    await h.turn(id, 'two')
    await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(3))
    expect(h.ofType('mcp')[2]).toEqual({ type: 'mcp', servers: null })
    expect(h.ofType('result').at(-1)?.isError).toBe(false)
    expect(h.registry.get(id).state).toBe('idle')
    // "No data" twice in a row — after the init and after the result — is sent once.
    await new Promise((done) => setTimeout(done, 50))
    expect(h.ofType('mcp')).toHaveLength(3)
  })

  it('agent.mcp answers the rows now, and sends no event when they did not change', async () => {
    const h = await harness('mcp-status')
    const id = await h.start()
    // Before any turn the query answers already (F:restart-status); a window that opens asks.
    expect(await h.ok('agent.mcp', { sessionId: id })).toEqual({ servers: [NOTES, WORFY_CANVAS] })
    await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(1))
    expect(await h.ok('agent.mcp', { sessionId: id })).toEqual({ servers: [NOTES, WORFY_CANVAS] })
    await new Promise((done) => setTimeout(done, 50))
    expect(h.ofType('mcp')).toHaveLength(1)
  })

  it('a script that sets no MCP answer reports nothing, and the turn goes on as before', async () => {
    const h = await harness('turn')
    const id = await h.start()
    await h.turn(id, 'hello')
    await new Promise((done) => setTimeout(done, 50))
    expect(h.ofType('mcp')).toEqual([])
    expect(await h.ok('agent.mcp', { sessionId: id })).toEqual({ servers: null })
  })

  it('a query without mcpServerStatus() reports the servers of its system/init, without tool counts', async () => {
    const h = await harness('mcp-status', scriptsDir, (query) => {
      const handle = query as QueryHandle & { mcpServerStatus?: unknown }
      handle.mcpServerStatus = undefined
      return handle
    })
    const id = await h.start()
    await h.turn(id, 'one')
    await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(1))
    expect(h.ofType('mcp')[0]).toEqual({ type: 'mcp', servers: [row('example-notes', { tools: null }), row('worfy-canvas', { source: 'worfy', tools: null })] })
  })
})

describe('agent.mcpAction', () => {
  /** A Session whose example-oauth failed (after its first turn). */
  async function failedServer() {
    const h = await harness('mcp-status')
    const id = await h.start()
    await h.turn(id, 'one')
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers?.[0]?.status).toBe('failed'))
    return { h, id }
  }

  it('reconnect calls reconnectMcpServer of the live query, and the rows after it come back and go out', async () => {
    const { h, id } = await failedServer()
    const answer = await h.ok('agent.mcpAction', { sessionId: id, name: 'example-oauth', action: 'reconnect' })
    const connected = [row('example-oauth', { tools: null })]
    expect(answer).toEqual({ servers: connected, error: null })
    expect(h.mcpCalls()).toEqual([{ kind: 'reconnectMcpServer', name: 'example-oauth' }])
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)).toEqual({ type: 'mcp', servers: connected }))
    // No new process: the same Claude Code.
    expect(h.calls.filter((each) => each.kind === 'start')).toHaveLength(1)
  })

  it("a reconnect Claude Code refuses answers its error, and the Session goes on", async () => {
    const { h, id } = await failedServer()
    const answer = await h.ok<{ error: string | null }>('agent.mcpAction', { sessionId: id, name: 'example-unknown', action: 'reconnect' })
    // F:allowed-reconnect-unknown.
    expect(answer.error).toBe('Server not found: example-unknown')
    expect(h.registry.get(id).state).toBe('idle')
  })

  it('turn-off, turn-on and the actions of later tickets are refused, and the Session does not change', async () => {
    const { h, id } = await failedServer()
    const before = h.events().length
    for (const action of ['turn-off', 'turn-on', 'allow', 'sign-in', 'restart']) {
      const result = await h.call('agent.mcpAction', { sessionId: id, name: 'example-oauth', action })
      expect(result.ok, action).toBe(false)
      if (!result.ok) expect(result.error, action).toMatch(/not available/)
    }
    expect(h.mcpCalls()).toEqual([])
    expect(h.calls.filter((each) => each.kind === 'start')).toHaveLength(1)
    expect(h.events().length).toBe(before)
    expect(h.registry.get(id).state).toBe('idle')
  })

  it('an unknown action is refused by the channel before it reaches the Session', async () => {
    const { h, id } = await failedServer()
    const before = h.events().length
    for (const action of ['toggle', 'disable', '']) {
      const result = await h.call('agent.mcpAction', { sessionId: id, name: 'example-oauth', action })
      expect(result.ok, action).toBe(false)
      if (!result.ok) expect(result.error, action).toMatch(/^agent\.mcpAction: invalid input/)
    }
    expect(h.mcpCalls()).toEqual([])
    expect(h.events().length).toBe(before)
  })

  it('never calls toggleMcpServer: not for a turn, not for any action, not for a failed reconnect', async () => {
    const { h, id } = await failedServer()
    await h.call('agent.mcpAction', { sessionId: id, name: 'example-oauth', action: 'turn-off' })
    await h.call('agent.mcpAction', { sessionId: id, name: 'example-oauth', action: 'turn-on' })
    await h.call('agent.mcpAction', { sessionId: id, name: 'example-unknown', action: 'reconnect' })
    await h.call('agent.mcpAction', { sessionId: id, name: 'example-oauth', action: 'reconnect' })
    await h.turn(id, 'two')
    expect(h.calls.filter((each) => each.kind === 'toggleMcpServer')).toEqual([])
    expect(h.mcpCalls()).toEqual([
      { kind: 'reconnectMcpServer', name: 'example-unknown' },
      { kind: 'reconnectMcpServer', name: 'example-oauth' },
    ])
  })
})

/** Names, an error and a config of servers that must stay on the user's screen. */
const PRIVATE = ['example-tracker', 'https://example-tracker.invalid/mcp', 'Bearer example-secret', 'example-tracker refused the handshake']

/** The servers a fake agent's `mcp` line answers: one failed, with a config of an HTTP server. */
const PRIVATE_SERVERS = {
  fake: 'mcp',
  servers: [
    {
      name: 'example-tracker',
      status: 'failed',
      source: 'user',
      scope: 'user',
      error: 'example-tracker refused the handshake',
      config: { type: 'http', url: 'https://example-tracker.invalid/mcp', headers: { Authorization: 'Bearer example-secret' } },
    },
  ],
}

/** The lines of a fixture script of the fake agent with the `mcp` line of PRIVATE_SERVERS first. */
const withPrivateServers = (script: string): Record<string, unknown>[] => [
  PRIVATE_SERVERS,
  ...readFileSync(join(AGENT_SCRIPTS, `${script}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>),
]

/** Everything the console got, as text. */
function consoleText(spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies.flatMap((spy) => spy.mock.calls.map((args: unknown[]) => args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))).join('\n')
}

describe('the rows stay on the user’s screen', () => {
  it('the mcp event has no config of a server: its URL and headers stay in main', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worfy-mcp-status-scripts-'))
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dir, 'private.jsonl'), withPrivateServers('turn').map((line) => JSON.stringify(line)).join('\n') + '\n')
      const h = await harness('private', dir)
      const id = await h.start()
      await h.turn(id, 'hello')
      await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(1))
      const sent = JSON.stringify(h.ofType('mcp'))
      expect(sent).toContain('example-tracker refused the handshake')
      expect(sent).not.toMatch(/example-tracker\.invalid|example-secret|"config"|"scope"/)
      expect(JSON.stringify(await h.ok('agent.mcp', { sessionId: id }))).not.toMatch(/example-tracker\.invalid|example-secret|"config"/)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('nothing of the rows reaches the console: no name, no error, no config — a failed ask and a refused reconnect included', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined))
    const dir = await mkdtemp(join(tmpdir(), 'worfy-mcp-status-scripts-'))
    try {
      const { writeFile } = await import('node:fs/promises')
      // The second turn asks after the ask failed: "no data".
      const lines = [...withPrivateServers('turn'), { fake: 'mcp', error: 'the fake agent could not read its MCP servers' }, ...withPrivateServers('turn').slice(1)]
      await writeFile(join(dir, 'private.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
      const h = await harness('private', dir)
      const id = await h.start()
      await h.turn(id, 'hello')
      await vi.waitFor(() => expect(h.ofType('mcp')).toHaveLength(1))
      await h.ok('agent.mcpAction', { sessionId: id, name: 'example-tracker', action: 'reconnect' })
      await h.ok('agent.mcpAction', { sessionId: id, name: 'example-tracker-unknown', action: 'reconnect' })
      await h.call('agent.mcpAction', { sessionId: id, name: 'example-tracker', action: 'turn-off' })
      await h.turn(id, 'again')
      await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers).toBeNull())
      const logged = consoleText(spies)
      for (const secret of PRIVATE) expect(logged, secret).not.toContain(secret)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('an Autopilot run journals nothing of them: its Session gets the rows, its journal has none', async () => {
    const h = faultRun({ scripts: [withPrivateServers('autopilot-waves')] })
    const seen: AgentEvent[] = []
    h.registry.observe((_id, event) => {
      if (event.type === 'mcp') seen.push(event)
    })
    expect(await h.start()).toEqual({ refusal: null })
    await h.stopped(1)
    // The unattended Session did get the rows: the journal had them to write, and wrote none.
    expect(seen.some((event) => event.type === 'mcp' && event.servers?.some((server) => server.name === 'example-tracker'))).toBe(true)
    const journals = h.journals().join('\n')
    expect(journals).toContain('run-started')
    for (const secret of PRIVATE) expect(journals, secret).not.toContain(secret)
    expect(journals).not.toMatch(/"kind":"mcp/)
  })
})
