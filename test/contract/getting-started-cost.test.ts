// The cost switch of the demo (worfy-onboarding ticket 09; spec, decision 5): `gettingStarted.setCost`
// over the real Layout store, Session settings, Getting started state and Orchestrators on the fake
// agent, wired as the app wires them (liveOrchestratorSession, orchestratorNodeOf of
// src/main/ipc/getting-started.ts). "More expensive" saves Opus with the model's default effort for
// the demo's Orchestrator Node, "cheaper" Sonnet with effort medium; a live Session gets the change
// as `agent.configure` gives it, in force from its next turn. Nothing here starts a real agent or
// writes to ~/.claude.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SESSION_SETTINGS_FILE, SessionSettingsStore } from '../../src/main/agent/session-settings'
import { CHEAPER_SETTINGS, costNotAppliedReason, DemoCostSwitch, type CostDeps, type CostSession } from '../../src/main/getting-started/demo'
import { GettingStartedState } from '../../src/main/getting-started/state'
import { LayoutStore } from '../../src/main/layout/store'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { SessionSettings } from '../../src/shared/agent/settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { DemoCost, GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import { APP_URL } from '../app-url'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const DEMO = 'demo-0000000d'

/** A turn that stands until the test releases `turn`: the Orchestrator is busy meanwhile. */
const SCRIPT = [
  { fake: 'wait_message' },
  { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'from-the-script', permissionMode: 'bypassPermissions', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000000001' },
  { fake: 'wait_release', name: 'turn' },
  { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.001, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', stop_reason: 'end_turn', session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000002' },
]

let scratch: string
let repo: string
let data: string
let scripts: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-gs-cost-')))
  repo = join(scratch, 'worfy-demo')
  data = join(scratch, 'data')
  scripts = join(scratch, 'scripts')
  for (const dir of [repo, join(data, DEMO), scripts]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(scripts, 'cost.jsonl'), SCRIPT.map((line) => JSON.stringify(line)).join('\n'))
  // The user's model and effort come from <Claude home>/settings.json: an empty home of the test's own.
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(() => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

/** One run of the app over the test's folders, with the demo created (its record, its cheaper Orchestrator Node). */
async function app(options: { failStarts?: number; savedSession?: string } = {}) {
  if (options.savedSession !== undefined) {
    // The Orchestrator Node of an earlier run, with its SDK session: opening it reads the transcript first.
    writeFileSync(
      join(data, DEMO, 'layout.json'),
      JSON.stringify({ nodes: [{ id: 'orch', kind: 'orchestrator', x: 40, y: 40, w: 300, h: 180, locked: true, data: { sessionId: options.savedSession } }] }),
    )
  }
  const layout = new LayoutStore((projectId) => join(data, projectId), { delayMs: 0 })
  const settings = new SessionSettingsStore((projectId) => join(data, projectId))
  const calls: FakeCall[] = []
  const inputs: string[] = []
  const events: AgentEvent[] = []
  const releases = new FakeReleases()
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts, script: 'cost', record: (call) => calls.push(call), releases }))
  registries.push(registry)
  registry.observeInput((_session, what) => inputs.push(what))
  /** How many Session starts the Orchestrators asked for; the first `failStarts` of them throw, as a resume of a session already live elsewhere does. */
  let starts = 0
  const orchestrators = new Orchestrators({
    layout,
    projectPath: () => repo,
    registry: {
      start: (...args: Parameters<SessionRegistry['start']>) => {
        starts += 1
        if (starts <= (options.failStarts ?? 0)) throw new Error('the session is already live in another Session')
        return registry.start(...args)
      },
    },
    settings,
    transcript: () => Promise.resolve(null),
    broadcast: (_sessionId, event) => events.push(event),
    publish: () => undefined,
  })
  const state = new GettingStartedState(data)
  state.setDemo({ projectId: DEMO, path: repo, profile: 'worfy-demo', cost: 'cheaper' })

  const { gettingStartedHandlers, liveOrchestratorSession, orchestratorNodeOf } = await import('../../src/main/ipc/getting-started')
  const costSwitch = new DemoCostSwitch(() => ({
    state,
    orchestratorNode: (projectId) => orchestratorNodeOf(layout, projectId),
    settings,
    liveSession: liveOrchestratorSession(orchestrators, registry),
  }))
  const { registerIpc } = await import('../../src/main/ipc/index')
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc(
    { handle: (name, listener) => handlers.set(name, listener) },
    {
      modules: { './getting-started.ts': () => Promise.resolve(gettingStartedHandlers(() => Promise.reject(new Error('not here')), () => state, (cost) => costSwitch.set(cost))) },
      isTrustedSender: (url) => url === APP_URL,
    },
  )
  const call = async (cost: DemoCost): Promise<IpcResult<GettingStartedSnapshot>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}gettingStarted.setCost`)
    if (!listener) throw new Error('gettingStarted.setCost is not registered')
    return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, { cost })) as IpcResult<GettingStartedSnapshot>
  }
  const setCost = async (cost: DemoCost): Promise<GettingStartedSnapshot> => {
    const result = await call(cost)
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  /** The demo's Orchestrator opened as createDemo opens it: on the cheaper settings, saved for its Node. */
  const openOrchestrator = () => orchestrators.open(DEMO, { firstSettings: CHEAPER_SETTINGS })
  const nodeId = (): string => {
    const id = orchestratorNodeOf(layout, DEMO)
    if (id === null) throw new Error('no Orchestrator Node')
    return id
  }
  /** What session-settings.json keeps for the Orchestrator Node. */
  const saved = (): unknown => (JSON.parse(readFileSync(join(data, DEMO, SESSION_SETTINGS_FILE), 'utf8')) as { nodes: Record<string, unknown> }).nodes[nodeId()]
  const controls = () => calls.filter((each) => each.kind === 'setModel' || each.kind === 'applyFlagSettings')
  const inits = () => events.flatMap((event) => (event.type === 'init' ? [event.model] : []))
  return { layout, orchestrators, registry, state, calls, controls, inputs, inits, releases, call, setCost, openOrchestrator, nodeId, saved, starts: () => starts }
}

describe('gettingStarted.setCost', () => {
  it('saves Opus with the default effort for "more expensive" and Sonnet with medium for "cheaper", keeps the mode, and records the cost', async () => {
    const h = await app()
    await h.openOrchestrator()
    // The Orchestrator is closed: only its saved picks change, and no Session is started for it.
    h.registry.closeAll()
    await vi.waitFor(() => expect(h.orchestrators.view(h.nodeId())?.state).toBe('closed'))
    const starts = h.calls.filter((each) => each.kind === 'start').length

    const expensive = await h.setCost('more-expensive')
    expect(h.saved()).toEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(expensive.demo).toMatchObject({ projectId: DEMO, cost: 'more-expensive' })
    expect(h.state.demo()?.cost).toBe('more-expensive')

    const cheaper = await h.setCost('cheaper')
    expect(h.saved()).toEqual({ model: 'sonnet', effort: 'medium', permissionMode: 'bypassPermissions' })
    expect(cheaper.demo?.cost).toBe('cheaper')
    expect(h.calls.filter((each) => each.kind === 'start')).toHaveLength(starts)

    // The next start of the Orchestrator starts with what was saved.
    await h.setCost('more-expensive')
    await h.openOrchestrator()
    expect(h.calls.filter((each) => each.kind === 'start').at(-1)).toMatchObject({ settings: { model: 'opus', effort: null } })
  })

  it('changes the live Session of the demo Orchestrator as agent.configure does, and the saved picks with it', async () => {
    const h = await app()
    const view = await h.openOrchestrator()
    expect(h.calls.find((each) => each.kind === 'start')).toMatchObject({ settings: CHEAPER_SETTINGS })

    await h.setCost('more-expensive')
    expect(h.controls()).toEqual([
      { kind: 'setModel', model: 'opus' },
      { kind: 'applyFlagSettings', settings: { effortLevel: null } },
    ])
    expect(h.registry.get(view.sessionId ?? '').settings).toEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(h.saved()).toEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(h.inputs).toEqual(['changed the model and effort (Getting started)'])
    // No second Session: the open Orchestrator's own one changed.
    expect(h.calls.filter((each) => each.kind === 'start')).toHaveLength(1)

    await h.setCost('cheaper')
    expect(h.registry.get(view.sessionId ?? '').settings).toEqual(CHEAPER_SETTINGS)
    expect(h.saved()).toEqual(CHEAPER_SETTINGS)
  })

  it('takes effect from the next turn when switched during a turn', async () => {
    const h = await app()
    const view = await h.openOrchestrator()
    const session = h.registry.get(view.sessionId ?? '')
    session.send('What is planned in this project?')
    await vi.waitFor(() => expect(h.inits()).toEqual(['sonnet']))
    expect(session.state).toBe('busy')

    await h.setCost('more-expensive')
    // The turn that runs goes on as it started.
    expect(session.state).toBe('busy')
    expect(h.inits()).toEqual(['sonnet'])

    h.releases.release('turn')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('/worfy:ship-ticket todo 01')
    await vi.waitFor(() => expect(h.inits()).toEqual(['sonnet', 'opus']))
    h.releases.release('turn')
  })

  it('lets the second of two calls in a row win everywhere: the live Session, the saved picks, the record', async () => {
    const h = await app()
    const view = await h.openOrchestrator()
    const [first, second] = await Promise.all([h.setCost('more-expensive'), h.setCost('cheaper')])
    expect(first.demo?.cost).toBe('more-expensive')
    expect(second.demo?.cost).toBe('cheaper')
    expect(h.registry.get(view.sessionId ?? '').settings).toEqual(CHEAPER_SETTINGS)
    expect(h.saved()).toEqual(CHEAPER_SETTINGS)
    expect(h.state.demo()?.cost).toBe('cheaper')
    expect(h.controls()).toEqual([
      { kind: 'setModel', model: 'opus' },
      { kind: 'applyFlagSettings', settings: { effortLevel: null } },
      { kind: 'setModel', model: 'sonnet' },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'medium' } },
    ])
  })

  it('keeps the order of two calls when the first one waits longer for the live Session', async () => {
    // The first call finds the Orchestrator starting and waits for it; the second finds it closed meanwhile.
    const state = new GettingStartedState(data)
    state.setDemo({ projectId: DEMO, path: repo, profile: 'worfy-demo', cost: 'cheaper' })
    const saved = new Map<string, unknown>()
    const configured: unknown[] = []
    let started = (): void => undefined
    const session: CostSession = {
      configure: (change) => {
        configured.push(change)
        return Promise.resolve({ ...CHEAPER_SETTINGS, ...change })
      },
    }
    const waits = [new Promise<CostSession | null>((resolve) => (started = () => resolve(session))), Promise.resolve(null)]
    const costSwitch = new DemoCostSwitch(() => ({
      state,
      orchestratorNode: () => 'orchestrator-node',
      settings: { read: (_projectId, nodeId) => saved.get(nodeId) as SessionSettings | undefined, write: (_projectId, nodeId, settings) => void saved.set(nodeId, settings) },
      liveSession: () => waits.shift() ?? Promise.resolve(null),
    }))
    const first = costSwitch.set('more-expensive')
    const second = costSwitch.set('cheaper')
    // The Orchestrator the first call waits for has started.
    started()
    await Promise.all([first, second])
    expect(configured).toEqual([{ model: 'opus', effort: null }])
    expect(saved.get('orchestrator-node')).toEqual(CHEAPER_SETTINGS)
    expect(state.demo()?.cost).toBe('cheaper')
  })

  it('starts no new Session for an Orchestrator whose start failed; the saved picks change', async () => {
    // The start fails after the transcript is read: the Orchestrator is left with its error and no Session.
    const h = await app({ failStarts: 1, savedSession: '11111111-1111-4111-8111-111111111111' })
    const view = await h.openOrchestrator()
    expect(view.state).toBe('error')
    expect(h.starts()).toBe(1)
    await h.setCost('more-expensive')
    expect(h.starts()).toBe(1)
    expect(h.calls.filter((each) => each.kind === 'start')).toEqual([])
    expect(h.saved()).toEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(h.state.demo()?.cost).toBe('more-expensive')
  })

  /** A switch over in-memory picks and a live Session given by the test; the demo record in the test's state file. */
  function stubSwitch(liveSession: CostDeps['liveSession'], withDemo = true) {
    const state = new GettingStartedState(data)
    if (withDemo) state.setDemo({ projectId: DEMO, path: repo, profile: 'worfy-demo', cost: 'cheaper' })
    const saved = new Map<string, SessionSettings>()
    const costSwitch = new DemoCostSwitch(() => ({
      state,
      orchestratorNode: () => 'orchestrator-node',
      settings: { read: (_projectId, nodeId) => saved.get(nodeId), write: (_projectId, nodeId, settings) => void saved.set(nodeId, settings) },
      liveSession: (projectId, nodeId) => liveSession(projectId, nodeId),
    }))
    return { state, saved, costSwitch }
  }

  it('answers the refusal of the live Session with its reason, the pick saved and recorded all the same', async () => {
    const refusing: CostSession = { configure: () => Promise.reject(new Error('setModel failed')) }
    const { state, saved, costSwitch } = stubSwitch(() => Promise.resolve(refusing))
    await expect(costSwitch.set('more-expensive')).rejects.toThrow(costNotAppliedReason('setModel failed'))
    expect(saved.get('orchestrator-node')).toEqual({ model: 'opus', effort: null, permissionMode: 'bypassPermissions' })
    expect(state.demo()?.cost).toBe('more-expensive')
  })

  it('takes the next call after one that was refused', async () => {
    const { state, saved, costSwitch } = stubSwitch(() => Promise.resolve(null), false)
    await expect(costSwitch.set('more-expensive')).rejects.toThrow('there is no demo project')
    state.setDemo({ projectId: DEMO, path: repo, profile: 'worfy-demo', cost: 'cheaper' })
    expect((await costSwitch.set('more-expensive')).demo?.cost).toBe('more-expensive')
    expect(saved.get('orchestrator-node')).toMatchObject({ model: 'opus', effort: null })
  })

  it('saves the pick before it looks for the live Session', async () => {
    const seen: unknown[] = []
    const { saved, costSwitch } = stubSwitch(() => {
      seen.push(saved.get('orchestrator-node'))
      return Promise.resolve(null)
    })
    await costSwitch.set('more-expensive')
    expect(seen).toEqual([{ model: 'opus', effort: null, permissionMode: 'bypassPermissions' }])
  })

  it('refuses without a demo and changes nothing', async () => {
    const h = await app()
    await h.openOrchestrator()
    h.state.setDemo(null)
    const result = await h.call('more-expensive')
    expect(result).toMatchObject({ ok: false })
    expect(h.saved()).toEqual(CHEAPER_SETTINGS)
    expect(h.controls()).toEqual([])
  })
})

describe('gettingStarted.hintSeen', () => {
  it('answers first: true once per hint, also for a new instance over the same file (a restart)', async () => {
    const h = await app()
    expect(h.state.hintSeen('implementing')).toBe(true)
    expect(h.state.hintSeen('implementing')).toBe(false)
    expect(h.state.hintSeen('rework')).toBe(true)
    const restarted = new GettingStartedState(data)
    expect(restarted.hintSeen('implementing')).toBe(false)
    expect(restarted.hintSeen('done')).toBe(true)
    // The demo record and the rest of the file stay.
    expect(restarted.demo()).toMatchObject({ projectId: DEMO, cost: 'cheaper' })
  })
})
