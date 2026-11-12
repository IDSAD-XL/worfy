// Restart with the same conversation, Turn off and Turn on for this Session (worfy-mcp-live ticket 03).
//
// `restart`, `turn-off` and `turn-on` of agent.mcpAction restart the Session's Claude Code: the old
// process is closed, a running turn interrupted first, and the new one resumes the same conversation
// once the old one has exited (ADR-0064) — in the same Session, so its id, its window and its owner
// stay. Turn off leaves the server out of the new process's managedSettings: out of the Profile's
// list, or with no list named in `deniedMcpServers`; worfy's own server is not passed in `mcpServers`.
// Claude Code's toggleMcpServer is never called: it writes the user's .claude.json (the spike of
// ticket 01), so the test's .claude.json, in a temporary HOME, must stay byte for byte as it was.
// The Session keeps what it turned off; a new Session gets every server again.
//
// The chain runs for real from the Session registry through the Claude driver down to the options of
// query() (sdkQueryFactory); query() is the test's, and answers the fake agent's query, so the
// rows come from the answers the spike recorded (test/fixtures/mcp-live/). Behind each query stands
// a real child process (claude-process-stub.ts), so the order of the processes is what Claude Code's
// would be. No Claude Code can start: the SDK module is mocked to throw, query() never reaches it.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'
import { StubProcesses } from './claude-process-stub'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: sdkQueryFactory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkQueryFactory } = await import('../../src/main/vendors/claude/query')

/** The user's .claude.json in the test's HOME: a Project's record with a server of the user, as Claude Code keeps them. */
const CLAUDE_JSON = `${JSON.stringify({ projects: { '/somewhere/repo': { allowedTools: [], mcpServers: { 'example-notes': { type: 'stdio', command: 'example-notes' } } } } }, null, 2)}\n`

/** The spike's turn off with a deny list (F:turnoff-restart-denied): the form of its entries. */
const RECORDED_DENIED = (JSON.parse(readFileSync(join(AGENT_SCRIPTS, '..', 'mcp-live', 'mcp-live-turnoff-restart-denied.json'), 'utf8')) as { managedSettings: { deniedMcpServers: unknown[] } }).managedSettings.deniedMcpServers

let scratch: string
let home: string
let cwd: string
let registries: SessionRegistry[] = []
let stubs: StubProcesses[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-mcp-turn-off-')))
  home = join(scratch, 'home')
  cwd = join(scratch, 'repo')
  mkdirSync(join(home, '.claude'), { recursive: true })
  mkdirSync(cwd)
  writeFileSync(join(home, '.claude.json'), CLAUDE_JSON)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('WORFY_CLAUDE_HOME', join(home, '.claude'))
  vi.stubEnv('WORFY_HARNESS_HOME', join(scratch, 'no-harness'))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: home, PATH: '/usr/bin:/bin' }, from: 'login-shell' })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const stub of stubs) await stub.stopAll()
  stubs = []
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** What query() was given for each process, in start order. */
interface SdkStart {
  resume?: string
  sessionId?: string
  managedSettings?: { allowManagedMcpServersOnly?: boolean; allowedMcpServers?: { serverName: string }[]; deniedMcpServers?: { serverName: string }[] }
  mcpServers?: Record<string, unknown>
}

/**
 * The app's chain over the fake agent: `allowlist` is the Profile's list, and the canvas attaches
 * worfy-canvas. null: a Session outside every Project — no canvas, so no list and no worfy server, the
 * one case worfy passes no managedSettings. `script` picks the fake agent's script for the n-th process.
 */
function harness(allowlist: readonly string[] | null, script: (n: number) => string = () => 'mcp-restart') {
  const calls: FakeCall[] = []
  const starts: SdkStart[] = []
  const requests = new Map<unknown, QueryRequest>()
  const fake = fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: () => script(starts.length), record: (call) => calls.push(call) })
  const attached: CanvasSession = {
    attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: join(scratch, 'cards'), instructions: 'canvas' },
    observe: (query) => query,
  }
  const sdk = {
    query: ({ prompt, options }: { prompt: unknown; options: object }) => {
      starts.push(options as SdkStart)
      // The fake agent's query, a promise: the factory is async, so its answer is the query itself.
      return fake(requests.get(prompt) as QueryRequest)
    },
  }
  const factory = sdkQueryFactory(() => Promise.resolve(allowlist === null ? null : attached), () => Promise.resolve(allowlist ?? []), {
    loadSdk: () => Promise.resolve(sdk),
    autoCompactWindow: () => null,
    browser: () => Promise.resolve(null),
    skills: () => Promise.resolve(null),
    privateSkills: () => Promise.resolve(null),
  })
  const stub = new StubProcesses(() => 'exit-at-once')
  stubs.push(stub)
  const registry = new SessionRegistry(
    stub.wrap((request) => {
      requests.set(request.prompt, request)
      return factory(request)
    }),
  )
  registries.push(registry)
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
  const ofType = <T extends AgentEvent['type']>(type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  /** One whole turn: a message, its result, idle again. */
  const turn = async (text: string) => {
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    const before = ofType('result').length
    session.send(text)
    await vi.waitFor(() => expect(ofType('result')).toHaveLength(before + 1))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
  }
  const toggles = () => calls.filter((call) => call.kind === 'toggleMcpServer')
  const processStarts = () => calls.filter((call) => call.kind === 'start')
  return { calls, starts, stub, registry, session, events, ofType, turn, toggles, processStarts }
}

const row = (name: string, fields: Partial<McpServerRow> = {}): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: ['turn-off'], ...fields })
const NOTES = row('example-notes')
const CANVAS = row(CANVAS_SERVER_NAME, { source: 'worfy' })
const NOTES_OFF = row('example-notes', { status: 'disabled', tools: null, actions: ['turn-on'] })
const CANVAS_OFF = row(CANVAS_SERVER_NAME, { status: 'disabled', tools: null, source: 'worfy', actions: ['turn-on'] })

const LIST = ['example-notes', CANVAS_SERVER_NAME]
const allowedNames = (start: SdkStart | undefined) => start?.managedSettings?.allowedMcpServers?.map((each) => each.serverName)

describe('restart: the same conversation in a new Claude Code process', () => {
  it('resumes the same sdkId once the old process has exited, in the same Session, with no "already live" error', async () => {
    const h = harness(LIST)
    await h.turn('one')
    const sdkId = h.session.sdkId
    const id = h.session.id
    expect(sdkId).not.toBeNull()

    const answer = await h.session.mcpAction('example-notes', 'restart')
    expect(answer.error).toBeNull()
    expect(answer.servers).toEqual([NOTES, CANVAS])
    // The old process exited before the new one started; never two at once.
    expect(h.stub.order().map((each) => each.split(' ').slice(0, 2).join(' '))).toEqual(['spawn 1', 'exit 1', 'spawn 2'])
    expect(h.stub.maxAlive()).toBe(1)
    expect(h.starts.map((start) => start.resume)).toEqual([undefined, sdkId])
    // The same Session goes on: its id, the registry's one live Session, no error on the way.
    expect(h.session.id).toBe(id)
    expect(h.registry.list()).toEqual([expect.objectContaining({ sessionId: id, sdkSessionId: sdkId }) as unknown])
    expect(h.ofType('state').some((event) => event.state === 'error' || event.state === 'closed')).toBe(false)
    expect(h.ofType('renamed')).toEqual([])
    await vi.waitFor(() => expect(h.session.state).toBe('idle'))
    await h.turn('two')
    expect(h.ofType('init').at(-1)?.sdkSessionId).toBe(sdkId)
  })

  it('a running turn is interrupted, as an Interrupt does, and the queue held; the new process takes no message by itself', async () => {
    const h = harness(LIST, (n) => (n === 1 ? 'mcp-restart-long' : 'mcp-restart'))
    await vi.waitFor(() => expect(h.session.state).toBe('idle'))
    h.session.send('long')
    await vi.waitFor(() => expect(h.ofType('init')).toHaveLength(1))
    expect(h.session.send('queued meanwhile')).toBe('queued')

    await h.session.mcpAction('example-notes', 'restart')
    // The turn ended interrupted, before the old process was closed.
    expect(h.ofType('result')).toEqual([expect.objectContaining({ interrupted: true }) as unknown])
    expect(h.processStarts()).toHaveLength(2)
    await vi.waitFor(() => expect(h.session.state).toBe('idle'))
    // Held, as after an Interrupt: "Send queued" sends it.
    expect(h.session.queued()).toMatchObject({ paused: true, items: [{ text: 'queued meanwhile' }] })
    expect(h.calls.filter((call) => call.kind === 'message').map((call) => call.kind === 'message' && call.text)).toEqual(['long'])
  })

  it('a message sent while the new process starts waits for it and reaches it, not the old one', async () => {
    const h = harness(LIST)
    await h.turn('one')
    const restarting = h.session.mcpAction('example-notes', 'restart')
    expect(h.session.state).toBe('starting')
    h.session.send('during the restart')
    await restarting
    await vi.waitFor(() => expect(h.ofType('result')).toHaveLength(2))
    const perProcess: string[][] = []
    for (const call of h.calls) {
      if (call.kind === 'start') perProcess.push([])
      else if (call.kind === 'message') perProcess.at(-1)?.push(call.text)
    }
    expect(perProcess).toEqual([['one'], ['during the restart']])
  })
})

describe('turn-off and turn-on for this Session', () => {
  it('turn-off restarts without the server in the Profile list; turn-on brings it back; toggleMcpServer never; .claude.json byte for byte the same', async () => {
    const h = harness(LIST)
    await h.turn('one')
    const sdkId = h.session.sdkId
    expect(allowedNames(h.starts[0])).toEqual(LIST)

    const off = await h.session.mcpAction('example-notes', 'turn-off')
    expect(off).toEqual({ servers: [CANVAS, NOTES_OFF], error: null })
    // After the old process exited, the same conversation, and no example-notes in the list (F:turnoff-restart-allowlist-without).
    expect(h.stub.order().map((each) => each.split(' ').slice(0, 2).join(' '))).toEqual(['spawn 1', 'exit 1', 'spawn 2'])
    expect(h.starts[1]?.resume).toBe(sdkId)
    expect(h.starts[1]?.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: CANVAS_SERVER_NAME }] })
    expect(Object.keys(h.starts[1]?.mcpServers ?? {})).toEqual([CANVAS_SERVER_NAME])
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)).toEqual({ type: 'mcp', servers: [CANVAS, NOTES_OFF] }))

    const on = await h.session.mcpAction('example-notes', 'turn-on')
    expect(on).toEqual({ servers: [NOTES, CANVAS], error: null })
    expect(h.starts[2]?.resume).toBe(sdkId)
    expect(allowedNames(h.starts[2])).toEqual(LIST)
    expect(h.toggles()).toEqual([])
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe(CLAUDE_JSON)
  })

  it("turn-off of worfy's own server: not passed in mcpServers, out of the list; the system prompt drops its instructions", async () => {
    const h = harness(LIST)
    await h.turn('one')
    const off = await h.session.mcpAction(CANVAS_SERVER_NAME, 'turn-off')
    expect(off.servers).toEqual([NOTES, CANVAS_OFF])
    expect(h.starts[1]?.mcpServers).toBeUndefined()
    expect(allowedNames(h.starts[1])).toEqual(['example-notes'])
    expect(h.toggles()).toEqual([])
  })

  it('with no Profile list (a Session outside every Project) the server is named in deniedMcpServers, in the form the spike recorded, and no list is added', async () => {
    const h = harness(null)
    await h.turn('one')
    expect(h.starts[0]?.managedSettings).toBeUndefined()
    await h.session.mcpAction('example-notes', 'turn-off')
    const denied = h.starts[1]?.managedSettings
    expect(denied).toEqual({ deniedMcpServers: [{ serverName: 'example-notes' }] })
    // The entry has the shape of the recorded one (F:turnoff-restart-denied).
    expect(Object.keys(denied?.deniedMcpServers?.[0] ?? {})).toEqual(Object.keys(RECORDED_DENIED[0] as object))
    expect(h.starts[1]?.mcpServers).toBeUndefined()
    await h.session.mcpAction('example-notes', 'turn-on')
    expect(h.starts[2]?.managedSettings).toBeUndefined()
    expect(h.toggles()).toEqual([])
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe(CLAUDE_JSON)
  })

  it('the Session keeps the server off across its next processes; a new Session (not a Restart) gets it again', async () => {
    const h = harness(LIST)
    await h.turn('one')
    await h.session.mcpAction('example-notes', 'turn-off')
    await h.session.mcpAction(CANVAS_SERVER_NAME, 'restart')
    expect(allowedNames(h.starts[2])).toEqual([CANVAS_SERVER_NAME])
    expect(await h.session.mcp()).toEqual([CANVAS, NOTES_OFF])

    const fresh = h.registry.start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(fresh.state).toBe('idle'))
    expect(h.starts[3]?.resume).toBeUndefined()
    expect(allowedNames(h.starts[3])).toEqual(LIST)
    expect(await fresh.mcp()).toEqual([NOTES, CANVAS])
  })

  it('refuses what the rows do not offer, before anything restarts: turn-off of a server not connected, turn-on of one not off', async () => {
    const h = harness(LIST)
    await h.turn('one')
    await expect(h.session.mcpAction('example-unknown', 'turn-off')).rejects.toThrow(/not available/)
    await expect(h.session.mcpAction('example-notes', 'turn-on')).rejects.toThrow(/not available/)
    expect(h.processStarts()).toHaveLength(1)
    expect(h.session.state).toBe('idle')
  })
})
