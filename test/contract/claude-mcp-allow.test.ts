// Allow in Project (worfy-mcp-live ticket 05). A server of the user that the Profile's list keeps out of a
// Claude Session is a row `not-allowed` offering Allow (the MCP inventory, claude-mcp-inventory.test.ts).
// agent.mcpAction `allow` puts its name on the list `mcp.allowed` through bin/profile-set — a --read, then
// one --set with --expect of the fingerprint read, as Edit profile writes it — and restarts the Session with
// the same conversation (ADR-0064, ticket 03): the new process starts with the new list, and the answer
// already shows the server, with no other turn. A refused write (a stranger fingerprint, a Harness too old,
// a busy Profile) answers the reason Edit profile would give and leaves the Session as it was. In an
// unattended Session (Autopilot) Allow writes the list but the Session's set of servers does not change: the
// server joins from the next Wave.
//
// The chain runs from the IPC channel through the Session registry and the Claude driver down to the
// options of query() (sdkQueryFactory); query() is the test's and answers the fake agent's query, which
// leaves out what the managedSettings of that process do not allow, as Claude Code's policy tier does
// (F:cut-status-start). bin/profile-set is a stub over a Profile in memory: no Harness, no ~/.claude.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeInventoryStarter, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { allowAllNotStarted, allowNotStarted, SessionRegistry, type QueryHandle, type QueryRequest } from '../../src/main/agent/session'
import { agentHandlers, allowQueueKey } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { ProfileSetRunner } from '../../src/main/ipc/pipeline'
import { ALLOW_BUSY, ALLOW_CONFLICT, ALLOW_TRIES, allowMcpServer, allowMcpServers, PROFILE_SET_TOO_OLD } from '../../src/main/ipc/profile-edit'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import { MCP_NOT_STARTED, McpInventory, notStartedRows } from '../../src/main/vendors/claude/mcp-inventory'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { ProfileRun } from '../../src/main/workflow/profile'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL } from '../app-url'
import { AGENT_SCRIPTS, faultRun } from './autopilot-faults-setup'
import { StubProcesses } from './claude-process-stub'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: sdkQueryFactory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkQueryFactory } = await import('../../src/main/vendors/claude/query')

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let scratch: string
let home: string
let cwd: string
let registries: SessionRegistry[] = []
let stubs: StubProcesses[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-mcp-allow-')))
  home = join(scratch, 'home')
  cwd = join(scratch, 'repo')
  mkdirSync(join(home, '.claude'), { recursive: true })
  mkdirSync(cwd)
  // The user's .claude.json, in the test's HOME: Allow writes the Profile, never this.
  writeFileSync(join(home, '.claude.json'), '{"projects":{}}\n')
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

const fingerprintOf = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`

/**
 * bin/profile-set over a Profile in memory, for `--field mcp.allowed` only: --read prints the field and its
 * fingerprint, --set writes it when --expect is the fingerprint now (exit 5 otherwise). `refuse`: answer
 * every call with this exit code and stderr instead.
 */
function profileSetStub(initial: readonly string[] | null) {
  const profile = { allowed: initial === null ? null : [...initial] }
  const calls: { args: readonly string[]; stdin?: string }[] = []
  let refuse: { code: number; stderr: string; onSet: boolean } | null = null
  /** A write of someone else between Allow's read and its write. */
  let between: (() => void) | null = null
  const runner: ProfileSetRunner = async (args, stdin) => {
    // A real bin/profile-set is a process of its own: each run answers in a later turn of the event loop.
    await new Promise((settle) => setImmediate(settle))
    calls.push({ args: [...args], ...(stdin === undefined ? {} : { stdin }) })
    const done = (run: Partial<ProfileRun>): Promise<ProfileRun> => Promise.resolve({ code: 0, stdout: '', stderr: '', ...run })
    if (refuse !== null && (!refuse.onSet || args.includes('--set'))) return done({ code: refuse.code, stderr: refuse.stderr })
    if (args.includes('--read')) {
      const read = done({ stdout: JSON.stringify({ name: 'alpha', fields: { 'mcp.allowed': profile.allowed }, fingerprint: fingerprintOf(profile.allowed) }) })
      between?.()
      return read
    }
    const expected = args[args.indexOf('--expect') + 1]
    if (expected !== fingerprintOf(profile.allowed)) return done({ code: 5, stderr: 'profile-set: the profile changed since it was read' })
    profile.allowed = (JSON.parse(stdin ?? '{}') as { 'mcp.allowed': string[] })['mcp.allowed']
    return done({ stdout: JSON.stringify({ ok: true, fingerprint: fingerprintOf(profile.allowed) }) })
  }
  const sets = () => calls.filter((call) => call.args.includes('--set'))
  return {
    profile,
    calls,
    sets,
    runner,
    refuseWith: (code: number, stderr: string, onSet = false) => (refuse = { code, stderr, onSet }),
    writeBetween: (write: () => void) => (between = write),
  }
}

/** What query() was given for each process, in start order. */
interface SdkStart {
  resume?: string
  managedSettings?: { allowedMcpServers?: { serverName: string }[] }
}

/**
 * The app's chain over the fake agent and the stub bin/profile-set: the Profile's list is the stub's (null:
 * a Profile with no list — the default one applies), read at each process start as the app reads it. The
 * fake agent of each process leaves out what its managedSettings do not allow. The canvas attaches
 * worfy-canvas. A stub process stands behind each query, so a Restart waits for the old one's exit.
 */
async function harness(
  initial: readonly string[] | null,
  wrap: (query: QueryHandle, process: number) => QueryHandle = (query) => query,
  script = 'mcp-allow',
  /** Holds the start of process `process` until it settles: a Restart under way. */
  hold: (process: number) => Promise<void> = () => Promise.resolve(),
) {
  const set = profileSetStub(initial)
  const calls: FakeCall[] = []
  const starts: SdkStart[] = []
  const requests = new Map<unknown, QueryRequest>()
  const allowedOf = new Map<unknown, readonly string[]>()
  const fake = fakeQueryFactory({
    scriptsDir: AGENT_SCRIPTS,
    script,
    record: (call) => calls.push(call),
    mcpAllowlist: (request) => Promise.resolve(allowedOf.get(request.prompt) ?? null),
  })
  const attached: CanvasSession = {
    attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: join(scratch, 'cards'), instructions: 'canvas' },
    observe: (query) => query,
  }
  const sdk = {
    query: ({ prompt, options }: { prompt: unknown; options: object }) => {
      const start = options as SdkStart
      starts.push(start)
      allowedOf.set(prompt, (start.managedSettings?.allowedMcpServers ?? []).map((each) => each.serverName))
      const process = starts.length
      return hold(process).then(() => fake(requests.get(prompt) as QueryRequest).then((query) => wrap(query, process)))
    },
  }
  const listNow = (): readonly string[] => set.profile.allowed ?? ['plugin_worfy_qmd', CANVAS_SERVER_NAME]
  const factory = sdkQueryFactory(() => Promise.resolve(attached), () => Promise.resolve(listNow()), {
    loadSdk: () => Promise.resolve(sdk),
    autoCompactWindow: () => null,
    browser: () => Promise.resolve(null),
    skills: () => Promise.resolve(null),
    privateSkills: () => Promise.resolve(null),
  })
  const stub = new StubProcesses(() => 'exit-at-once')
  stubs.push(stub)
  const remembered: typeof factory = (request) => {
    requests.set(request.prompt, request)
    return factory(request)
  }
  const inventory = new McpInventory(fakeInventoryStarter({ scriptsDir: AGENT_SCRIPTS, script, record: (call) => calls.push(call) }))
  const registry = new SessionRegistry(claudeSessions(stub.wrap(remembered), {}, inventory))
  registries.push(registry)
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  await registerIpc(ipc, {
    modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, undefined, (send) => send(sender), () => [], undefined, () => set.runner)) },
    isTrustedSender: (url) => url === APP_URL,
  })
  const call = async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
  const ofType = <T extends AgentEvent['type']>(type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  const turn = async (text: string) => {
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    const before = ofType('result').length
    session.send(text)
    await vi.waitFor(() => expect(ofType('result')).toHaveLength(before + 1))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
  }
  const allow = (name: string) => call('agent.mcpAction', { sessionId: session.id, name, action: 'allow' })
  const allowAll = (names: readonly string[]) => call('agent.mcpAllowAll', { sessionId: session.id, names })
  const processStarts = () => calls.filter((each) => each.kind === 'start')
  return { set, calls, starts, stub, registry, session, events, ofType, turn, allow, allowAll, call, processStarts }
}

const row = (name: string, fields: Partial<McpServerRow> = {}): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: ['turn-off'], ...fields })
const NOTES = row('example-notes')
// worfy's own server: status only, no Turn off (ticket 09).
const CANVAS = row(CANVAS_SERVER_NAME, { source: 'worfy', actions: [] })
const TRACKER = row('example-tracker', { tools: 2 })
const TRACKER_NOT_ALLOWED = row('example-tracker', { status: 'not-allowed', tools: 2, actions: ['allow'] })
const LIST = ['example-notes', CANVAS_SERVER_NAME]

/** The rows of the Session once the inventory of its start has answered: example-tracker is outside the list. */
async function withTrackerOutside(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
  await h.turn('one')
  await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers).toEqual([NOTES, CANVAS, TRACKER_NOT_ALLOWED]))
}

describe('Allow of a server outside the Profile’s list', () => {
  it('writes mcp.allowed with one profile-set --set and shows the server in the same Session, with no other turn', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    const sdkId = h.session.sdkId
    const id = h.session.id

    const result = await h.allow('example-tracker')
    expect(result).toEqual({ ok: true, value: { servers: [NOTES, TRACKER, CANVAS], error: null } })
    // One write, of the list with the name added, over the fingerprint read just before.
    expect(h.set.sets()).toHaveLength(1)
    expect(h.set.sets()[0]?.args).toEqual(['-C', cwd, '--field', 'mcp.allowed', '--expect', expect.stringMatching(/^sha256:/u) as unknown as string, '--set', '-'])
    expect(JSON.parse(h.set.sets()[0]?.stdin ?? '')).toEqual({ 'mcp.allowed': [...LIST, 'example-tracker'] })
    expect(h.set.profile.allowed).toEqual([...LIST, 'example-tracker'])
    // A Restart with the same conversation: the old process exited before the new one started, with the new list.
    expect(h.stub.order().map((each) => each.split(' ').slice(0, 2).join(' '))).toEqual(['spawn 1', 'exit 1', 'spawn 2'])
    expect(h.starts.map((start) => start.resume)).toEqual([undefined, sdkId])
    expect(h.starts[1]?.managedSettings?.allowedMcpServers?.map((each) => each.serverName)).toContain('example-tracker')
    expect(h.session.id).toBe(id)
    // The windows got the server too, out of the group of those not allowed, with no turn since.
    expect(h.ofType('result')).toHaveLength(1)
    expect(h.ofType('mcp').at(-1)?.servers).toEqual([NOTES, TRACKER, CANVAS])
    // Neither the user's .claude.json nor Claude Code's toggle: only the Profile.
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe('{"projects":{}}\n')
    expect(h.calls.filter((each) => each.kind === 'toggleMcpServer')).toEqual([])
    await h.turn('two')
    expect(h.ofType('init').at(-1)?.sdkSessionId).toBe(sdkId)
  })

  it('waits while the allowed server is still pending after the Restart, and answers its final row', async () => {
    let pendingServed = 0
    const h = await harness(LIST, (query, process) => {
      if (process !== 2) return query
      const status = query.mcpServerStatus!.bind(query)
      // The new process brings example-tracker up slowly: its first two answers have it pending.
      return Object.assign(query, {
        mcpServerStatus: async () => {
          const rows = (await status()) as { name: string; status: string }[]
          if (pendingServed >= 2 || !rows.some((each) => each.name === 'example-tracker')) return rows
          pendingServed += 1
          return rows.map((each) => (each.name === 'example-tracker' ? { ...each, status: 'pending' } : each))
        },
      })
    })
    await withTrackerOutside(h)
    const result = await h.allow('example-tracker')
    expect(pendingServed).toBe(2)
    expect(result).toEqual({ ok: true, value: { servers: [NOTES, TRACKER, CANVAS], error: null } })
  })

  it('a second Allow of a name the Profile lists already reads the list and writes nothing', async () => {
    const set = profileSetStub([...LIST, 'example-tracker'])
    await allowMcpServer(set.runner, cwd, 'example-tracker')
    expect(set.calls.map((each) => each.args.includes('--read'))).toEqual([true])
    expect(set.sets()).toEqual([])
    expect(set.profile.allowed).toEqual([...LIST, 'example-tracker'])
  })

  it('a Profile with no list gets the default list with the name added', async () => {
    const h = await harness(null)
    await h.turn('one')
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers?.find((each) => each.name === 'example-tracker')?.status).toBe('not-allowed'))
    expect((await h.allow('example-tracker')).ok).toBe(true)
    expect(JSON.parse(h.set.sets()[0]?.stdin ?? '')).toEqual({ 'mcp.allowed': ['plugin_worfy_qmd', CANVAS_SERVER_NAME, 'example-tracker'] })
  })

  it('a server whose row does not offer Allow is refused, nothing written', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    const refused = await h.allow('example-notes')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toMatch(/not available/)
    expect(h.set.calls).toEqual([])
    expect(h.processStarts()).toHaveLength(1)
  })
})

describe('several Allows, and an Allow Claude Code does not follow', () => {
  it('nine Allows at once all land on the list, none refused: the Allows of a Project take turns', async () => {
    const set = profileSetStub(LIST)
    const names = Array.from({ length: 9 }, (_each, index) => `example-server-${index + 1}`)
    const answers = await Promise.allSettled(names.map((name) => allowMcpServer(set.runner, cwd, name)))
    expect(answers.filter((answer) => answer.status === 'rejected')).toEqual([])
    expect(set.profile.allowed).toEqual([...LIST, ...names])
    // Each read the list after the write before it: one write each, no conflict.
    expect(set.sets()).toHaveLength(9)
  })

  it('the Allows of Sessions in two folders of one Project take turns too', async () => {
    const set = profileSetStub(LIST)
    const worktree = join(cwd, '.claude', 'worktrees', 'example')
    await Promise.all([allowMcpServer(set.runner, cwd, 'example-tracker', cwd), allowMcpServer(set.runner, worktree, 'example-docs', cwd)])
    expect(set.profile.allowed).toEqual([...LIST, 'example-tracker', 'example-docs'])
    expect(set.sets()).toHaveLength(2)
  })

  it('two Allows at once in one Session: both servers join it, neither answer an error', async () => {
    const h = await harness(LIST, undefined, 'mcp-allow-two')
    await h.turn('one')
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers?.filter((each) => each.status === 'not-allowed').map((each) => each.name)).toEqual(['example-tracker', 'example-docs']))
    const [tracker, docs] = await Promise.all([h.allow('example-tracker'), h.allow('example-docs')])
    expect(tracker).toEqual({ ok: true, value: expect.objectContaining({ error: null }) as unknown })
    expect(docs).toEqual({ ok: true, value: expect.objectContaining({ error: null }) as unknown })
    expect(h.set.profile.allowed).toEqual([...LIST, 'example-tracker', 'example-docs'])
    const last = h.ofType('mcp').at(-1)?.servers ?? []
    expect(last.filter((each) => each.name === 'example-tracker' || each.name === 'example-docs').map((each) => each.status)).toEqual(['connected', 'connected'])
  })

  it('an Allow whose write ends while another Allow’s Restart is starting the process: it waits for that start and restarts again, not a silent «not allowed»', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => (release = done))
    const h = await harness(LIST, undefined, 'mcp-allow-two', (process) => (process === 2 ? held : Promise.resolve()))
    await h.turn('one')
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers?.filter((each) => each.status === 'not-allowed')).toHaveLength(2))
    const tracker = h.allow('example-tracker')
    // The first Allow's new process has read the list (without example-docs) and waits to start.
    await vi.waitFor(() => expect(h.starts).toHaveLength(2))
    await vi.waitFor(() => expect(h.session.state).toBe('starting'))
    const docs = h.allow('example-docs')
    const early = await Promise.race([docs.then(() => 'answered'), new Promise((done) => setTimeout(() => done('waits for the start'), 300))])
    expect(early).toBe('waits for the start')
    release()
    const answers = await Promise.all([tracker, docs])
    for (const answer of answers) expect(answer).toEqual({ ok: true, value: expect.objectContaining({ error: null }) as unknown })
    const last = h.ofType('mcp').at(-1)?.servers ?? []
    expect(last.filter((each) => each.name === 'example-tracker' || each.name === 'example-docs').map((each) => each.status)).toEqual(['connected', 'connected'])
  })

  it('a write that profile-set refuses as busy or as a bad value: the reason, after the read went through', async () => {
    const set = profileSetStub(LIST)
    set.refuseWith(6, 'profile-set: the profile is being written', true)
    await expect(allowMcpServer(set.runner, cwd, 'example-tracker')).rejects.toThrow(ALLOW_BUSY)
    set.refuseWith(1, 'profile-set: mcp.allowed: not a list of names', true)
    await expect(allowMcpServer(set.runner, cwd, 'example-tracker')).rejects.toThrow('mcp.allowed: not a list of names')
    set.refuseWith(9, 'profile-set: something else', true)
    await expect(allowMcpServer(set.runner, cwd, 'example-tracker')).rejects.toThrow(/--set failed \(exit 9\)/u)
    expect(set.calls.filter((each) => each.args.includes('--read'))).toHaveLength(3)
    expect(set.profile.allowed).toEqual(LIST)
  })

  it('a list another write changed once between the read and the write: Allow reads it again and keeps both changes', async () => {
    const set = profileSetStub(LIST)
    let once = false
    set.writeBetween(() => {
      if (once) return
      once = true
      set.profile.allowed = [...LIST, 'example-other']
    })
    await allowMcpServer(set.runner, cwd, 'example-tracker')
    expect(set.profile.allowed).toEqual([...LIST, 'example-other', 'example-tracker'])
  })

  it('a server the restarted process does not have: the answer says Allow did not take, and the row stays as not started', async () => {
    // Claude Code leaves example-tracker out of the new process although the list names it (a claude.ai
    // connector in the owner's live case): the Restart brings no row of it at all.
    const h = await harness(LIST, (query, process) => {
      if (process === 1) return query
      const status = query.mcpServerStatus!.bind(query)
      return Object.assign(query, { mcpServerStatus: async () => ((await status()) as { name: string }[]).filter((each) => each.name !== 'example-tracker') })
    })
    await withTrackerOutside(h)
    const answer = await h.session.mcpAction('example-tracker', 'allow', { allow: (name) => allowMcpServer(h.set.runner, cwd, name), settleMs: 300 })
    expect(h.set.profile.allowed).toEqual([...LIST, 'example-tracker'])
    expect(answer.error).toBe(allowNotStarted('example-tracker'))
    const tracker = { ...TRACKER, status: 'not-started' as const, tools: null, error: MCP_NOT_STARTED, actions: ['restart' as const] }
    expect(answer.servers).toEqual([NOTES, CANVAS, tracker])
    expect(h.ofType('mcp').at(-1)?.servers).toEqual([NOTES, CANVAS, tracker])
  })
})

describe('Allow all: every server of «Not allowed in this Project» at once (ticket 09)', () => {
  const THREE = ['example-tracker', 'example-docs', 'example-wiki']
  /** The rows once the inventory of the Session's start has answered: three servers outside the list. */
  async function withThreeOutside(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
    await h.turn('one')
    await vi.waitFor(() => expect(h.ofType('mcp').at(-1)?.servers?.filter((each) => each.status === 'not-allowed').map((each) => each.name)).toEqual(THREE))
  }

  it('writes every name with one profile-set --set, restarts the Session once, and the answer has every server in it', async () => {
    const h = await harness(LIST, undefined, 'mcp-allow-three')
    await withThreeOutside(h)
    const sdkId = h.session.sdkId
    const answer = await h.allowAll(THREE)
    expect(answer).toEqual({ ok: true, value: { servers: expect.any(Array) as unknown, error: null } })
    // One read and one write of the list, with all three names added in their order.
    expect(h.set.sets()).toHaveLength(1)
    expect(JSON.parse(h.set.sets()[0]?.stdin ?? '')).toEqual({ 'mcp.allowed': [...LIST, ...THREE] })
    expect(h.set.profile.allowed).toEqual([...LIST, ...THREE])
    // One Restart with the same conversation: two processes in all, the second with the whole new list.
    expect(h.stub.order().map((each) => each.split(' ').slice(0, 2).join(' '))).toEqual(['spawn 1', 'exit 1', 'spawn 2'])
    expect(h.starts.map((start) => start.resume)).toEqual([undefined, sdkId])
    expect(h.starts[1]?.managedSettings?.allowedMcpServers?.map((each) => each.serverName)).toEqual([...LIST, ...THREE])
    const rows = answer.ok ? ((answer.value as { servers: McpServerRow[] }).servers ?? []) : []
    expect(THREE.map((name) => rows.find((each) => each.name === name)?.status)).toEqual(['connected', 'connected', 'connected'])
    expect(rows.filter((each) => each.status === 'not-allowed')).toEqual([])
    expect(h.calls.filter((each) => each.kind === 'toggleMcpServer')).toEqual([])
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe('{"projects":{}}\n')
  })

  it('a write the Profile refuses: the reason, nothing written, no Restart', async () => {
    const h = await harness(LIST, undefined, 'mcp-allow-three')
    await withThreeOutside(h)
    h.set.refuseWith(1, 'profile-set: mcp.allowed: not a list of names', true)
    const refused = await h.allowAll(THREE)
    expect(refused).toEqual({ ok: false, error: expect.stringContaining('mcp.allowed: not a list of names') as unknown as string })
    expect(h.set.profile.allowed).toEqual(LIST)
    expect(h.processStarts()).toHaveLength(1)
    expect(h.session.state).toBe('idle')
    expect(h.ofType('mcp').at(-1)?.servers?.filter((each) => each.status === 'not-allowed').map((each) => each.name)).toEqual(THREE)
  })

  it('refuses before writing: a name whose row offers no Allow, a name twice, no names', async () => {
    const h = await harness(LIST, undefined, 'mcp-allow-three')
    await withThreeOutside(h)
    for (const names of [['example-tracker', 'example-notes'], ['example-tracker', 'example-tracker'], [CANVAS_SERVER_NAME, 'example-docs']]) {
      const refused = await h.allowAll(names)
      expect(refused.ok, names.join(' ')).toBe(false)
    }
    expect((await h.allowAll([])).ok).toBe(false)
    expect(h.set.calls).toEqual([])
    expect(h.processStarts()).toHaveLength(1)
  })

  it('servers the restarted process lacks are named in the error', async () => {
    const h = await harness(LIST, (query, process) => {
      if (process === 1) return query
      const status = query.mcpServerStatus!.bind(query)
      return Object.assign(query, { mcpServerStatus: async () => ((await status()) as { name: string }[]).filter((each) => each.name !== 'example-docs' && each.name !== 'example-wiki') })
    }, 'mcp-allow-three')
    await withThreeOutside(h)
    const answer = await h.session.mcpAllowAll(THREE, { allowAll: (names) => allowMcpServers(h.set.runner, cwd, names), settleMs: 300 })
    expect(answer.error).toBe(allowAllNotStarted(['example-docs', 'example-wiki']))
    expect(allowAllNotStarted(['example-docs'])).toBe(allowNotStarted('example-docs'))
    expect(h.set.profile.allowed).toEqual([...LIST, ...THREE])
  })

  it('names already on the list write nothing; the others are added with one --set', async () => {
    const set = profileSetStub([...LIST, 'example-docs'])
    await allowMcpServers(set.runner, cwd, ['example-docs'])
    expect(set.sets()).toEqual([])
    await allowMcpServers(set.runner, cwd, ['example-tracker', 'example-docs', 'example-wiki'])
    expect(set.sets()).toHaveLength(1)
    expect(set.profile.allowed).toEqual([...LIST, 'example-docs', 'example-tracker', 'example-wiki'])
  })

  it('takes its turn in the queue of the Project with the Allows of one server', async () => {
    const set = profileSetStub(LIST)
    await Promise.all([allowMcpServer(set.runner, cwd, 'example-tracker'), allowMcpServers(set.runner, cwd, ['example-docs', 'example-wiki']), allowMcpServer(set.runner, cwd, 'example-notes-2')])
    expect(set.profile.allowed).toEqual([...LIST, 'example-tracker', 'example-docs', 'example-wiki', 'example-notes-2'])
    expect(set.sets()).toHaveLength(3)
  })
})

describe('Allow all in an unattended Session (Autopilot)', () => {
  it('writes the Profile with every name, and the Session’s set of servers does not change: no Restart in the middle of a Wave', async () => {
    const set = profileSetStub(['example-notes', CANVAS_SERVER_NAME])
    const read = (script: string) =>
      readFileSync(join(AGENT_SCRIPTS, `${script}.jsonl`), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    const h = faultRun({ scripts: [[read('mcp-allow-three')[0]!, ...read('autopilot-waves')]], mcpAllowlist: ['example-notes', CANVAS_SERVER_NAME] })
    const seen = new Map<string, McpServerRow[] | null>()
    h.registry.observe((id, event) => {
      if (event.type === 'mcp') seen.set(id, event.servers)
    })
    expect(await h.start()).toEqual({ refusal: null })
    const names = ['example-tracker', 'example-docs', 'example-wiki']
    const unattended = await vi.waitFor(() => {
      const found = h.registry.list().find((info) => h.registry.get(info.sessionId).unattended && seen.get(info.sessionId)?.filter((each) => each.status === 'not-allowed').length === names.length)
      expect(found).toBeDefined()
      return found!
    })
    const session = h.registry.get(unattended.sessionId)
    const queriesBefore = h.queries().length
    const answer = await session.mcpAllowAll(names, { allowAll: (all) => allowMcpServers(set.runner, session.cwd, all) })
    expect(answer.error).toBeNull()
    expect(set.sets()).toHaveLength(1)
    expect(set.profile.allowed).toEqual(['example-notes', CANVAS_SERVER_NAME, ...names])
    expect(h.queries()).toHaveLength(queriesBefore)
    expect(names.map((name) => answer.servers?.find((each) => each.name === name)?.status)).toEqual(['not-allowed', 'not-allowed', 'not-allowed'])
    await h.stopped(1)
  })
})

describe('worfy’s own servers over IPC (ticket 09)', () => {
  it('agent.mcpAction turn-off of worfy-canvas is refused, and the Session does not restart', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    const refused = await h.call('agent.mcpAction', { sessionId: h.session.id, name: CANVAS_SERVER_NAME, action: 'turn-off' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toMatch(/not available/)
    expect(h.processStarts()).toHaveLength(1)
    expect(h.ofType('mcp').at(-1)?.servers?.find((each) => each.name === CANVAS_SERVER_NAME)).toEqual(CANVAS)
  })
})

describe('the queue of Allow writes (review of #1826)', () => {
  it('a rejected write releases the queue: the Allow after it writes', async () => {
    const set = profileSetStub(LIST)
    let refusals = 1
    const runner: ProfileSetRunner = (args, stdin) => {
      if (args.includes('--set') && refusals > 0) {
        refusals -= 1
        return Promise.resolve({ code: 1, stdout: '', stderr: 'profile-set: mcp.allowed: not a list of names', signal: null } as ProfileRun)
      }
      return set.runner(args, stdin)
    }
    const [first, second] = await Promise.allSettled([allowMcpServer(runner, cwd, 'example-tracker'), allowMcpServer(runner, cwd, 'example-docs')])
    expect(first.status).toBe('rejected')
    expect(second.status).toBe('fulfilled')
    expect(set.profile.allowed).toEqual([...LIST, 'example-docs'])
  })

  it('the queue key of a Session in a real git worktree of a Project is the Project’s folder; outside every Project, the folder itself', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('commit', '-q', '--allow-empty', '-m', 'first')
    const worktree = join(cwd, '.claude', 'worktrees', 'example')
    git('worktree', 'add', '-q', worktree)
    const outside = join(scratch, 'elsewhere')
    mkdirSync(outside)
    expect(allowQueueKey(worktree, [{ path: cwd }])).toBe(cwd)
    expect(allowQueueKey(cwd, [{ path: cwd }])).toBe(cwd)
    expect(allowQueueKey(outside, [{ path: cwd }])).toBe(outside)
    // A Project added under a link to its folder: the Session's real folder still finds it.
    const link = join(scratch, 'link-to-repo')
    symlinkSync(cwd, link)
    expect(allowQueueKey(worktree, [{ path: link }])).toBe(link)
    // Allows of Sessions in the main checkout and in the worktree, each with its key, take turns: both land, no conflict.
    const set = profileSetStub(LIST)
    const projects = [{ path: link }]
    await Promise.all([
      allowMcpServer(set.runner, cwd, 'example-tracker', allowQueueKey(cwd, projects)),
      allowMcpServer(set.runner, worktree, 'example-docs', allowQueueKey(worktree, projects)),
    ])
    expect(set.profile.allowed).toEqual([...LIST, 'example-tracker', 'example-docs'])
    expect(set.sets()).toHaveLength(2)
  })
})

describe('Session.allow around another Restart (review of #1826)', () => {
  it('no second Restart when the Restart under way already started the server', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    // The write ends, then another action's Restart starts a process that reads the list with the server on it.
    const answer = await h.session.mcpAction('example-tracker', 'allow', {
      allow: async (name) => {
        await allowMcpServer(h.set.runner, cwd, name)
        void h.session.mcpAction('example-tracker', 'restart')
      },
    })
    expect(answer.error).toBeNull()
    expect(answer.servers?.find((each) => each.name === 'example-tracker')?.status).toBe('connected')
    // Two processes in all: the one before and the Restart's; Allow did not restart again.
    expect(h.processStarts()).toHaveLength(2)
  })

  it('no process after the wait — the other Restart failed to start one: the error, not a silent success', async () => {
    const h = await harness(LIST, undefined, 'mcp-allow', (process) => (process === 2 ? Promise.reject(new Error('Claude Code did not start')) : Promise.resolve()))
    await withTrackerOutside(h)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const answer = await h.session.mcpAction('example-tracker', 'allow', {
      allow: async (name) => {
        await allowMcpServer(h.set.runner, cwd, name)
        void h.session.mcpAction('example-tracker', 'restart').catch(() => undefined)
      },
    })
    expect(answer).toEqual({ servers: null, error: allowNotStarted('example-tracker') })
    expect(h.set.profile.allowed).toEqual([...LIST, 'example-tracker'])
  })
})

describe('the rows of servers the list names but the Session lacks (notStartedRows)', () => {
  const inventory = [NOTES, TRACKER, CANVAS, row('example-plugin', { source: 'worfy' })]
  const set = { listed: [...LIST, 'example-tracker', 'example-plugin'], rows: [NOTES, CANVAS], off: [] as string[] }

  it('a listed server of the user the Session lacks: not started, with Restart in an attended Session', () => {
    expect(notStartedRows(inventory, { ...set, attended: true })).toEqual([{ ...TRACKER, status: 'not-started', tools: null, error: MCP_NOT_STARTED, actions: ['restart'] }])
  })

  it('no Restart in an unattended Session: its set of servers is fixed for the Wave', () => {
    expect(notStartedRows(inventory, { ...set, attended: false }).map((each) => each.actions)).toEqual([[]])
  })

  it('none for worfy’s own servers or a plugin’s, none for a server turned off for this Session, none without an inventory', () => {
    expect(notStartedRows(inventory, { ...set, attended: true }).map((each) => each.name)).not.toContain('example-plugin')
    expect(notStartedRows(inventory, { ...set, off: ['example-tracker'], attended: true })).toEqual([])
    expect(notStartedRows(inventory, { ...set, rows: [NOTES, CANVAS, TRACKER], attended: true })).toEqual([])
    expect(notStartedRows(inventory, { ...set, listed: LIST, attended: true })).toEqual([])
    expect(notStartedRows(null, { ...set, attended: true })).toEqual([])
  })
})

describe('a write the Profile refuses leaves the Session as it was', () => {
  const unchanged = (h: Awaited<ReturnType<typeof harness>>) => {
    expect(h.processStarts()).toHaveLength(1)
    expect(h.stub.order().map((each) => each.split(' ')[0])).toEqual(['spawn'])
    expect(h.session.state).toBe('idle')
    expect(h.ofType('mcp').at(-1)?.servers).toEqual([NOTES, CANVAS, TRACKER_NOT_ALLOWED])
  }

  it('a list changed between every read and its write: the conflict, as Edit profile has it, after ALLOW_TRIES tries, and no Restart', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    let other = 0
    h.set.writeBetween(() => (h.set.profile.allowed = [...LIST, `example-other-${++other}`]))
    const refused = await h.allow('example-tracker')
    expect(refused).toEqual({ ok: false, error: expect.stringContaining(ALLOW_CONFLICT) as unknown as string })
    expect(h.set.sets()).toHaveLength(ALLOW_TRIES)
    expect(h.set.profile.allowed).toEqual([...LIST, `example-other-${ALLOW_TRIES}`])
    unchanged(h)
  })

  it('a Harness whose profile-set writes no such field: the reason Edit profile gives, and no Restart', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    h.set.refuseWith(2, 'profile-set: --field takes workflow.agents or agents')
    const refused = await h.allow('example-tracker')
    expect(refused).toEqual({ ok: false, error: expect.stringContaining(PROFILE_SET_TOO_OLD) as unknown as string })
    unchanged(h)
  })
})

describe('Allow in an unattended Session (Autopilot)', () => {
  it('writes the Profile, and the Session’s set of servers does not change: no Restart in the middle of a Wave', async () => {
    const set = profileSetStub(['example-notes', CANVAS_SERVER_NAME])
    const read = (script: string) =>
      readFileSync(join(AGENT_SCRIPTS, `${script}.jsonl`), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    const h = faultRun({ scripts: [[read('mcp-allow')[0]!, ...read('autopilot-waves')]], mcpAllowlist: ['example-notes', CANVAS_SERVER_NAME] })
    const seen = new Map<string, McpServerRow[] | null>()
    h.registry.observe((id, event) => {
      if (event.type === 'mcp') seen.set(id, event.servers)
    })
    expect(await h.start()).toEqual({ refusal: null })
    const unattended = await vi.waitFor(() => {
      const found = h.registry.list().find((info) => h.registry.get(info.sessionId).unattended && seen.get(info.sessionId)?.some((each) => each.status === 'not-allowed'))
      expect(found).toBeDefined()
      return found!
    })
    const session = h.registry.get(unattended.sessionId)
    const queriesBefore = h.queries().length
    const answer = await session.mcpAction('example-tracker', 'allow', { allow: async (name) => (await import('../../src/main/ipc/profile-edit')).allowMcpServer(set.runner, session.cwd, name) })
    expect(set.sets()).toHaveLength(1)
    expect(set.profile.allowed).toEqual(['example-notes', CANVAS_SERVER_NAME, 'example-tracker'])
    // The same process goes on with the same servers: the row stays outside the list until the next Wave.
    expect(h.queries()).toHaveLength(queriesBefore)
    expect(answer.servers?.find((each) => each.name === 'example-tracker')?.status).toBe('not-allowed')
    await h.stopped(1)
  })
})
