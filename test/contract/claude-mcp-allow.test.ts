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
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeInventoryStarter, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryHandle, type QueryRequest } from '../../src/main/agent/session'
import { agentHandlers } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { ProfileSetRunner } from '../../src/main/ipc/pipeline'
import { ALLOW_CONFLICT, allowMcpServer, PROFILE_SET_TOO_OLD } from '../../src/main/ipc/profile-edit'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import { McpInventory } from '../../src/main/vendors/claude/mcp-inventory'
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
  let refuse: { code: number; stderr: string } | null = null
  /** A write of someone else between Allow's read and its write. */
  let between: (() => void) | null = null
  const runner: ProfileSetRunner = (args, stdin) => {
    calls.push({ args: [...args], ...(stdin === undefined ? {} : { stdin }) })
    const done = (run: Partial<ProfileRun>): Promise<ProfileRun> => Promise.resolve({ code: 0, stdout: '', stderr: '', ...run })
    if (refuse !== null) return done({ code: refuse.code, stderr: refuse.stderr })
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
    refuseWith: (code: number, stderr: string) => (refuse = { code, stderr }),
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
async function harness(initial: readonly string[] | null, wrap: (query: QueryHandle, process: number) => QueryHandle = (query) => query) {
  const set = profileSetStub(initial)
  const calls: FakeCall[] = []
  const starts: SdkStart[] = []
  const requests = new Map<unknown, QueryRequest>()
  const allowedOf = new Map<unknown, readonly string[]>()
  const fake = fakeQueryFactory({
    scriptsDir: AGENT_SCRIPTS,
    script: 'mcp-allow',
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
      return fake(requests.get(prompt) as QueryRequest).then((query) => wrap(query, process))
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
  const inventory = new McpInventory(fakeInventoryStarter({ scriptsDir: AGENT_SCRIPTS, script: 'mcp-allow', record: (call) => calls.push(call) }))
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
  const processStarts = () => calls.filter((each) => each.kind === 'start')
  return { set, calls, starts, stub, registry, session, events, ofType, turn, allow, processStarts }
}

const row = (name: string, fields: Partial<McpServerRow> = {}): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: ['turn-off'], ...fields })
const NOTES = row('example-notes')
const CANVAS = row(CANVAS_SERVER_NAME, { source: 'worfy' })
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

describe('a write the Profile refuses leaves the Session as it was', () => {
  const unchanged = (h: Awaited<ReturnType<typeof harness>>) => {
    expect(h.processStarts()).toHaveLength(1)
    expect(h.stub.order().map((each) => each.split(' ')[0])).toEqual(['spawn'])
    expect(h.session.state).toBe('idle')
    expect(h.ofType('mcp').at(-1)?.servers).toEqual([NOTES, CANVAS, TRACKER_NOT_ALLOWED])
  }

  it('a list changed between the read and the write: the conflict, as Edit profile has it, and no Restart', async () => {
    const h = await harness(LIST)
    await withTrackerOutside(h)
    h.set.writeBetween(() => (h.set.profile.allowed = [...LIST, 'example-other']))
    const refused = await h.allow('example-tracker')
    expect(refused).toEqual({ ok: false, error: expect.stringContaining(ALLOW_CONFLICT) as unknown as string })
    expect(h.set.profile.allowed).toEqual([...LIST, 'example-other'])
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
