// A server added while a Claude Session runs (worfy-mcp-live ticket 03), on the fake agent. The spike
// of ticket 01 found that Claude Code does not take in a server written into the user's config by
// itself (F:allowed-status-5s-after-write-no-call), and that reloadPlugins() takes in one the
// Project's list allows, in the same query (F:allowed-reload-plugins). The Claude driver calls it when
// a person asks for the status — the chip's popover opens: agent.mcp with `pickUp` — and no turn runs;
// a window's plain read takes in nothing. The new server then comes in the `mcp`
// event, with no new Session and no new process. A Session of Autopilot (unattended) takes in nothing
// in the middle of a Wave, and its rows offer no Restart, Turn off or Turn on. Never the real Claude Code.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import type { SessionLaunch } from '../../src/main/agent/session-settings'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerAction, McpServerRow } from '../../src/shared/agent/mcp-status'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

let cwd: string
let emptyHome: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-mcp-pickup-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-mcp-pickup-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A Session on the fake agent playing mcp-pickup: worfy-canvas only, until reloadPlugins() takes in example-notes. */
function harness(launch?: SessionLaunch) {
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'mcp-pickup', releases, record: (call) => calls.push(call) }))
  registries.push(registry)
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event), undefined, launch)
  const mcpEvents = () => events.filter((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp')
  const reloads = () => calls.filter((call) => call.kind === 'reloadPlugins')
  /** Sends a message and waits until the turn stands at its wait_release, its init played. */
  const midTurn = async () => {
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('one')
    await vi.waitFor(() => expect(mcpEvents().length).toBeGreaterThan(0))
  }
  const endTurn = async () => {
    releases.release('turn')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'result')).toBe(true))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
  }
  return { calls, session, events, mcpEvents, reloads, midTurn, endTurn }
}

const row = (name: string, fields: Partial<McpServerRow> = {}): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: [], ...fields })

const ATTENDED_ACTIONS: McpServerAction[] = ['turn-off']

describe('a server added while a Claude Session runs', () => {
  it('is not there by itself, nor after a plain read; a read with pickUp between turns takes it in with reloadPlugins(), in the same process', async () => {
    const h = harness()
    await h.midTurn()
    await h.endTurn()
    // After system/init and after the turn: what Claude Code had without a call (F:allowed-status-5s-after-write-no-call).
    const before = [row('worfy-canvas', { source: 'worfy', actions: ATTENDED_ACTIONS })]
    expect(h.mcpEvents().at(-1)).toEqual({ type: 'mcp', servers: before })
    expect(h.reloads()).toEqual([])
    // A window's plain read (the chip before its first event) is cheap: no reloadPlugins().
    expect(await h.session.mcp()).toEqual(before)
    expect(h.reloads()).toEqual([])

    const servers = await h.session.mcp({ pickUp: true })
    // reloadPlugins() took it in (F:allowed-reload-plugins): `dynamic`, shown as user config.
    const picked = [row('example-notes', { actions: ATTENDED_ACTIONS }), row('worfy-canvas', { source: 'worfy', actions: ATTENDED_ACTIONS })]
    expect(servers).toEqual(picked)
    expect(h.mcpEvents().at(-1)).toEqual({ type: 'mcp', servers: picked })
    expect(h.reloads()).toHaveLength(1)
    // No new Session, no new process: one start, the Session's id as it was.
    expect(h.calls.filter((call) => call.kind === 'start')).toHaveLength(1)
    expect(h.events.some((event) => event.type === 'renamed')).toBe(false)
    expect(h.session.state).toBe('idle')
  })

  it('a status read while a turn runs takes in nothing: the tools of a running turn stay as they are', async () => {
    const h = harness()
    await h.midTurn()
    expect(await h.session.mcp({ pickUp: true })).toEqual([row('worfy-canvas', { source: 'worfy', actions: ATTENDED_ACTIONS })])
    expect(h.reloads()).toEqual([])
    await h.endTurn()
    expect((await h.session.mcp({ pickUp: true }))?.map((server) => server.name)).toEqual(['example-notes', 'worfy-canvas'])
    expect(h.reloads()).toHaveLength(1)
  })

  it('a plain read asked while a read with pickUp takes the server in answers after it: neither hides the new server (ticket 05)', async () => {
    let open: () => void = () => undefined
    const gate = new Promise<void>((done) => (open = done))
    const calls: FakeCall[] = []
    const fake = fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'mcp-pickup', record: (call) => calls.push(call) })
    // reloadPlugins() of this query answers only once the test opens the gate: a slow take-in.
    const registry = new SessionRegistry(async (request) => {
      const query = await fake(request)
      const reload = query.reloadPlugins?.bind(query)
      query.reloadPlugins = async () => {
        await gate
        return reload?.()
      }
      return query
    })
    registries.push(registry)
    const events: AgentEvent[] = []
    const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    const picking = session.mcp({ pickUp: true })
    const plain = session.mcp()
    await new Promise((done) => setTimeout(done, 20))
    open()
    const names = (rows: McpServerRow[] | null) => rows?.map((each) => each.name)
    expect(names(await picking)).toEqual(['example-notes', 'worfy-canvas'])
    expect(names(await plain)).toEqual(['example-notes', 'worfy-canvas'])
    const last = events.filter((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp').at(-1)
    expect(names(last?.servers ?? null)).toEqual(['example-notes', 'worfy-canvas'])
    expect(calls.filter((call) => call.kind === 'reloadPlugins')).toHaveLength(1)
  })

  it('a read with pickUp right after a message is sent, before its turn begins, takes in nothing either', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.session.state).toBe('idle'))
    h.session.send('one')
    // Asked in the same tick: Claude Code has not begun the turn (no system/init yet), but the message is with it.
    await h.session.mcp({ pickUp: true })
    expect(h.reloads()).toEqual([])
    await vi.waitFor(() => expect(h.mcpEvents().length).toBeGreaterThan(0))
    await h.endTurn()
  })
})

describe('an unattended Session (Autopilot)', () => {
  it('takes in no server in the middle of a Wave, and its rows offer no Restart, Turn off or Turn on', async () => {
    const h = harness({ unattended: true })
    await h.midTurn()
    await h.endTurn()
    expect(await h.session.mcp({ pickUp: true })).toEqual([row('worfy-canvas', { source: 'worfy' })])
    expect(await h.session.mcp({ pickUp: true })).toEqual([row('worfy-canvas', { source: 'worfy' })])
    expect(h.reloads()).toEqual([])
    for (const event of h.mcpEvents()) for (const server of event.servers ?? []) expect(server.actions).toEqual([])
  })

  it('refuses turn-off, turn-on and restart before anything changes; reconnect works', async () => {
    const h = harness({ unattended: true })
    await h.midTurn()
    await h.endTurn()
    const before = h.events.length
    for (const action of ['turn-off', 'turn-on', 'restart'] as const) {
      await expect(h.session.mcpAction('worfy-canvas', action), action).rejects.toThrow(/not available/)
    }
    expect(h.events.length).toBe(before)
    expect(h.calls.filter((call) => call.kind === 'start')).toHaveLength(1)
    expect(await h.session.mcpAction('worfy-canvas', 'reconnect')).toEqual({ servers: [row('worfy-canvas', { source: 'worfy' })], error: null })
    expect(h.calls.filter((call) => call.kind === 'reconnectMcpServer')).toEqual([{ kind: 'reconnectMcpServer', name: 'worfy-canvas' }])
    expect(h.session.state).toBe('idle')
  })
})
