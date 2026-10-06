// Sessions worfy runs on Session Nodes (ticket 18, src/main/agent/node-sessions.ts) over the real
// Layout store and Session registry, on the fake agent: "New session" makes a new live Node, two of
// them run side by side, Resume continues a finished Session on its Node in the cwd its transcript
// records and is refused for a running one or a gone folder, the Node's data keeps identifiers only
// (ADR-0010), a busy Session is not closed, "New conversation" of the Orchestrator, and the
// `sessions.*` channels at the IPC boundary.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { NodeSessions } from '../../src/main/agent/node-sessions'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { LayoutStore } from '../../src/main/layout/store'
import type { AgentEventEnvelope } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import { LIVE_SESSION_HEIGHT, LIVE_SESSION_WIDTH, type SessionNodeView } from '../../src/shared/ipc/sessions'
import type { LayoutNode } from '../../src/shared/layout/types'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-0000000d'
const FINISHED = 'f0000000-0000-4000-8000-0000000000f1'

let scratch: string
let repo: string
let worktree: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-node-sessions-')))
  repo = join(scratch, 'repo')
  worktree = join(repo, '.claude', 'worktrees', '07')
  mkdirSync(worktree, { recursive: true })
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  // The user's model and effort come from <Claude home>/settings.json: an empty home of the test's
  // own, never the real ~/.claude.
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface Claude {
  live: LiveSession[]
  history: { sessionId: string; cwd?: string }[]
}

/** One run of the app: a Layout store over the data folder, a registry on the fake agent, the Node Sessions. */
function harness(options: { script?: string | ((request: QueryRequest) => string); claude?: Claude } = {}) {
  const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
  const requests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir, script: options.script ?? 'turn' })
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return fake(request)
  })
  registries.push(registry)
  const claude: Claude = options.claude ?? { live: [], history: [] }
  const broadcast: AgentEventEnvelope[] = []
  const published: SessionNodeView[] = []
  const settings = new SessionSettingsStore((projectId) => join(scratch, 'data', projectId))
  const sessions = new NodeSessions({
    layout,
    projectPath: () => repo,
    registry,
    settings,
    claude: () => Promise.resolve(claude),
    isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
    broadcast: (sessionId, event) => broadcast.push({ sessionId, event }),
    publish: (view) => published.push(view),
  })
  const nodes = (): LayoutNode[] => layout.get(PROJECT).layout.nodes
  const node = (id: string): LayoutNode => {
    const found = nodes().find((each) => each.id === id)
    if (!found) throw new Error(`no Node ${id}`)
    return found
  }
  const view = (nodeId: string): SessionNodeView => {
    const found = sessions.list(PROJECT).find((each) => each.nodeId === nodeId)
    if (!found) throw new Error(`no view of ${nodeId}`)
    return found
  }
  const until = (nodeId: string, state: SessionNodeView['state']) => vi.waitFor(() => expect(view(nodeId).state).toBe(state), { timeout: 2000 })
  return { layout, registry, requests, claude, broadcast, published, settings, sessions, nodes, node, view, until }
}

/** A read-only Node of ticket 14 for a Session started in a terminal. */
function externalNode(sessionId: string, cwd: string): Record<string, unknown> {
  return { id: `session:${sessionId}`, kind: 'session', x: 700, y: 80, w: 300, h: 120, data: { sessionId, origin: 'external', source: 'terminal', cwd, name: 'From the terminal' } }
}

function savedLayout(nodes: Record<string, unknown>[]): void {
  writeFileSync(join(scratch, 'data', PROJECT, 'layout.json'), JSON.stringify({ nodes }))
}

describe('New session', () => {
  it('makes a live Node in the Project root whose data keeps only identifiers, then the SDK session id', async () => {
    const h = harness()
    const created = h.sessions.create(PROJECT)
    expect(h.node(created.nodeId)).toMatchObject({ kind: 'session', w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT, locked: false })
    expect(h.node(created.nodeId).data).toStrictEqual({ origin: 'worfy' })
    expect(h.requests).toMatchObject([{ cwd: repo, resume: undefined }])
    await h.until(created.nodeId, 'idle')

    h.registry.get(h.view(created.nodeId).sessionId).send('hello')
    await vi.waitFor(() => expect(h.view(created.nodeId).sdkSessionId).not.toBeNull())
    await h.until(created.nodeId, 'idle')
    const sdk = h.view(created.nodeId).sdkSessionId
    // ADR-0010: no model, cwd, state or cost in the Layout — they come from the Session or its transcript.
    expect(h.node(created.nodeId).data).toStrictEqual({ origin: 'worfy', sessionId: sdk })
    expect(h.view(created.nodeId)).toMatchObject({ projectId: PROJECT, sessionId: sdk, cwd: repo, model: 'claude-haiku-4-5-20251001', error: null })
    // The Session's events go to the windows under its id.
    expect(h.broadcast.some(({ sessionId, event }) => sessionId === sdk && event.type === 'result')).toBe(true)
  })

  it('a second New session is a second Node and Session; both answer side by side', async () => {
    const h = harness()
    const a = h.sessions.create(PROJECT)
    const b = h.sessions.create(PROJECT)
    expect(a.nodeId).not.toBe(b.nodeId)
    const [na, nb] = [h.node(a.nodeId), h.node(b.nodeId)]
    // Placed apart: the second does not cover the first.
    expect(na.x !== nb.x || na.y !== nb.y).toBe(true)
    await Promise.all([h.until(a.nodeId, 'idle'), h.until(b.nodeId, 'idle')])
    h.registry.get(h.view(a.nodeId).sessionId).send('one')
    h.registry.get(h.view(b.nodeId).sessionId).send('two')
    await vi.waitFor(() => {
      expect(h.view(a.nodeId).sdkSessionId).not.toBeNull()
      expect(h.view(b.nodeId).sdkSessionId).not.toBeNull()
    })
    await Promise.all([h.until(a.nodeId, 'idle'), h.until(b.nodeId, 'idle')])
    expect(h.view(a.nodeId).sdkSessionId).not.toBe(h.view(b.nodeId).sdkSessionId)
    expect(h.registry.list()).toHaveLength(2)
  })
})

describe('Resume', () => {
  it('turns the read-only Node of a finished terminal Session live, in the worktree its transcript records', async () => {
    savedLayout([{ ...externalNode(FINISHED, worktree), pinned: true, tags: ['ops', 'night'] }])
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: worktree }] } })
    const resumed = await h.sessions.resume(PROJECT, FINISHED)
    expect(resumed.nodeId).toBe(`session:${FINISHED}`)
    expect(h.requests).toMatchObject([{ resume: FINISHED, cwd: worktree }])
    // Same Node, same place, live size, its pin and tags kept, identifiers only.
    expect(h.nodes()).toHaveLength(1)
    expect(h.node(resumed.nodeId)).toMatchObject({ x: 700, y: 80, w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT, pinned: true, tags: ['ops', 'night'] })
    expect(h.node(resumed.nodeId).data).toStrictEqual({ origin: 'worfy', sessionId: FINISHED })
    await h.until(resumed.nodeId, 'idle')
    h.registry.get(h.view(resumed.nodeId).sessionId).send('go on')
    await vi.waitFor(() => expect(h.view(resumed.nodeId).sessionId).toBe(FINISHED))
    // Claude Code reports the resumed session and the worktree as its cwd: the new turn goes into that transcript.
    expect(h.view(resumed.nodeId)).toMatchObject({ sdkSessionId: FINISHED, cwd: worktree })
    expect(h.node(resumed.nodeId).data).toStrictEqual({ origin: 'worfy', sessionId: FINISHED })
  })

  it('makes a new Node for a Session of the history that has none; a second Resume returns the same run', async () => {
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: repo }] } })
    const first = await h.sessions.resume(PROJECT, FINISHED)
    expect(h.node(first.nodeId).data).toStrictEqual({ origin: 'worfy', sessionId: FINISHED })
    const again = await h.sessions.resume(PROJECT, FINISHED)
    expect(again.nodeId).toBe(first.nodeId)
    expect(h.requests).toHaveLength(1)
  })

  it.each([
    ['a live terminal process', { live: [{ pid: 4242, sessionId: FINISHED, cwd: '', status: 'busy' as const, entrypoint: 'cli' }], history: [{ sessionId: FINISHED }] }, 'Still running in terminal'],
    ['a gone worktree', { live: [], history: [{ sessionId: FINISHED, cwd: '.claude/worktrees/09' }] }, 'Folder no longer exists'],
    ['no transcript', { live: [], history: [] }, 'No transcript of this Session'],
  ])('is refused for %s: no Session starts and the Node stays read-only', async (_label, claude, label) => {
    savedLayout([externalNode(FINISHED, repo)])
    // History cwds are relative to the repository, which exists only once the test runs.
    const history = claude.history.map((each) => ('cwd' in each ? { ...each, cwd: join(repo, each.cwd) } : each))
    const h = harness({ claude: { live: claude.live.map((each) => ({ ...each, cwd: repo })), history } })
    await expect(h.sessions.resume(PROJECT, FINISHED)).rejects.toThrow(label)
    expect(h.requests).toEqual([])
    expect(h.node(`session:${FINISHED}`).data).toMatchObject({ origin: 'external' })
  })

  it('a worfy Node keeps its Session across a restart and resumes it with Start, in the recorded cwd', async () => {
    savedLayout([{ id: 'live-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', sessionId: FINISHED } }])
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: worktree }] } })
    const started = await h.sessions.start(PROJECT, 'live-1')
    expect(started.nodeId).toBe('live-1')
    expect(h.requests).toMatchObject([{ resume: FINISHED, cwd: worktree }])
    // Starting a running Node changes nothing.
    await h.sessions.start(PROJECT, 'live-1')
    expect(h.requests).toHaveLength(1)
    // While it runs, the rule refuses another Resume of it.
    expect(await h.sessions.resumable(PROJECT, [FINISHED])).toStrictEqual({ [FINISHED]: { resumable: false, reason: 'open', label: 'Already open in worfy' } })
  })

  it('a worfy Node without a session yet starts a new one in the root; a Node of another kind is refused', async () => {
    savedLayout([
      { id: 'fresh', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy' } },
      { id: 'note', kind: 'note', x: 400, y: 0, w: 200, h: 100, data: {} },
    ])
    const h = harness()
    await h.sessions.start(PROJECT, 'fresh')
    expect(h.requests).toMatchObject([{ resume: undefined, cwd: repo }])
    await expect(h.sessions.start(PROJECT, 'note')).rejects.toThrow(/not a Session Node of worfy/)
  })

  it('resumable answers a verdict per Session from one read of the Claude home', async () => {
    const h = harness({
      claude: {
        live: [{ pid: 1, sessionId: 'running-1', cwd: repo, status: 'idle', entrypoint: 'claude-desktop' }],
        history: [{ sessionId: FINISHED, cwd: worktree }, { sessionId: 'running-1', cwd: repo }],
      },
    })
    expect(await h.sessions.resumable(PROJECT, [FINISHED, 'running-1', 'nowhere'])).toStrictEqual({
      [FINISHED]: { resumable: true, cwd: worktree },
      'running-1': { resumable: false, reason: 'desktop', label: 'Still running in Claude desktop' },
      nowhere: { resumable: false, reason: 'unknown', label: 'No transcript of this Session' },
    })
  })
})

describe('Starts that overlap, and a start that fails', () => {
  const liveNode = { id: 'live-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', sessionId: FINISHED } }

  it('two Starts of one Node at once (a double click on Resume) start one Session and both get its view', async () => {
    savedLayout([liveNode])
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: repo }] } })
    const [a, b] = await Promise.all([h.sessions.start(PROJECT, 'live-1'), h.sessions.start(PROJECT, 'live-1')])
    expect(h.requests).toHaveLength(1)
    expect(h.registry.list()).toHaveLength(1)
    expect(b).toStrictEqual(a)
    await h.until('live-1', 'idle')
    // The Node still owns its Session: Close reaches it.
    h.sessions.close('live-1')
    expect(h.view('live-1').state).toBe('closed')
    expect(h.registry.list()).toEqual([])
    // Once the first Start is over, a later one starts again.
    await h.sessions.start(PROJECT, 'live-1')
    expect(h.requests).toHaveLength(2)
  })

  it('a Start and a Resume of the same Session at once start it once', async () => {
    savedLayout([liveNode])
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: repo }] } })
    const [a, b] = await Promise.all([h.sessions.start(PROJECT, 'live-1'), h.sessions.resume(PROJECT, FINISHED)])
    expect(h.requests).toHaveLength(1)
    expect(b.nodeId).toBe(a.nodeId)
  })

  it('two Resumes of a Session with no Node at once make one Node', async () => {
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: repo }] } })
    const [a, b] = await Promise.all([h.sessions.resume(PROJECT, FINISHED), h.sessions.resume(PROJECT, FINISHED)])
    expect(b.nodeId).toBe(a.nodeId)
    expect(h.nodes()).toHaveLength(1)
    expect(h.requests).toHaveLength(1)
  })

  it('a Session resumed elsewhere in worfy that has not reported its id yet is already open', async () => {
    const h = harness({ claude: { live: [], history: [{ sessionId: FINISHED, cwd: repo }] } })
    // The Orchestrator after a restart: resumed, waiting for its first turn, listed under a temporary id.
    const other = h.registry.start(repo, FINISHED, () => undefined)
    expect(other.id).not.toBe(FINISHED)
    expect(await h.sessions.resumable(PROJECT, [FINISHED])).toStrictEqual({ [FINISHED]: { resumable: false, reason: 'open', label: 'Already open in worfy' } })
    await expect(h.sessions.resume(PROJECT, FINISHED)).rejects.toThrow('Already open in worfy')
    expect(h.nodes()).toEqual([])
    expect(h.requests).toHaveLength(1)
  })

  it('a Session that fails to start leaves its Node closed, so it can be removed, with the reason', async () => {
    const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
    const published: SessionNodeView[] = []
    const sessions = new NodeSessions({
      layout,
      projectPath: () => repo,
      registry: {
        start: () => {
          throw new Error('Claude Code is not installed')
        },
        list: () => [],
      },
      settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
      claude: () => Promise.resolve({ live: [], history: [] }),
      isDirectory: () => Promise.resolve(true),
      broadcast: () => undefined,
      publish: (view) => published.push(view),
    })
    expect(() => sessions.create(PROJECT)).toThrow('Claude Code is not installed')
    const [view] = sessions.list(PROJECT)
    expect(view).toMatchObject({ state: 'closed', error: 'Claude Code is not installed' })
    expect(published.at(-1)).toStrictEqual(view)
    expect(() => sessions.close(view?.nodeId ?? '')).toThrow(/No live Session/)
  })
})

describe('the picks of a Session Node (worfy-daily ticket 23)', () => {
  const settingsFile = () => join(scratch, 'data', PROJECT, 'session-settings.json')
  const savedPicks = (): unknown => JSON.parse(readFileSync(settingsFile(), 'utf8'))
  const PICKS = { model: 'sonnet', effort: 'low', permissionMode: 'acceptEdits' } as const

  it('a change of model, effort or mode on a New session Node is saved under the Node id', async () => {
    const h = harness()
    const created = h.sessions.create(PROJECT)
    await h.until(created.nodeId, 'idle')
    // The start's own settings event carries the defaults: nothing to save yet.
    expect(existsSync(settingsFile())).toBe(false)

    const session = h.registry.get(h.view(created.nodeId).sessionId)
    await session.configure({ model: 'sonnet' })
    expect(savedPicks()).toStrictEqual({ nodes: { [created.nodeId]: { model: 'sonnet', effort: null, permissionMode: 'bypassPermissions' } } })
    await session.configure({ effort: 'low', permissionMode: 'acceptEdits' })
    expect(savedPicks()).toStrictEqual({ nodes: { [created.nodeId]: PICKS } })

    // A second Node keeps its own picks beside the first one's.
    const other = h.sessions.create(PROJECT)
    await h.until(other.nodeId, 'idle')
    await h.registry.get(h.view(other.nodeId).sessionId).configure({ model: 'opus' })
    expect(savedPicks()).toStrictEqual({
      nodes: { [created.nodeId]: PICKS, [other.nodeId]: { model: 'opus', effort: null, permissionMode: 'bypassPermissions' } },
    })
  })

  it('Start after Close, and Start after a restart of worfy, run the Session with the saved picks', async () => {
    const h = harness()
    const created = h.sessions.create(PROJECT)
    await h.until(created.nodeId, 'idle')
    const session = h.registry.get(h.view(created.nodeId).sessionId)
    await session.configure(PICKS)
    session.send('hello')
    await vi.waitFor(() => expect(h.view(created.nodeId).sdkSessionId).not.toBeNull())
    await h.until(created.nodeId, 'idle')
    const sdk = h.view(created.nodeId).sdkSessionId ?? ''
    h.claude.history.push({ sessionId: sdk, cwd: repo })
    h.sessions.close(created.nodeId)

    await h.sessions.start(PROJECT, created.nodeId)
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1]).toMatchObject({ resume: sdk, settings: PICKS })
    await h.until(created.nodeId, 'idle')
    expect(h.registry.get(h.view(created.nodeId).sessionId).settings).toStrictEqual(PICKS)

    // A new run of the app: a new Layout store, registry and Node Sessions over the same data folder.
    h.layout.flushAll()
    h.registry.closeAll()
    const next = harness({ claude: { live: [], history: [{ sessionId: sdk, cwd: repo }] } })
    await next.sessions.start(PROJECT, created.nodeId)
    expect(next.requests).toMatchObject([{ resume: sdk, settings: PICKS }])
  })

  it('a saved haiku starts on the default model, and the corrected picks are saved', async () => {
    savedLayout([{ id: 'fresh', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy' } }])
    writeFileSync(settingsFile(), JSON.stringify({ nodes: { fresh: { model: 'haiku', effort: 'high', permissionMode: 'plan' } } }))
    const h = harness()
    await h.sessions.start(PROJECT, 'fresh')
    const corrected = { model: null, effort: null, permissionMode: 'plan' }
    expect(h.requests.map((request) => request.settings)).toStrictEqual([corrected])
    expect(savedPicks()).toStrictEqual({ nodes: { fresh: corrected } })
  })

  it('picks that cannot be read leave the start on the defaults', async () => {
    savedLayout([{ id: 'fresh', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy' } }])
    // A directory where the file should be: reading it fails with something other than "missing".
    mkdirSync(settingsFile())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness()
    await h.sessions.start(PROJECT, 'fresh')
    expect(h.requests.map((request) => request.settings)).toStrictEqual([DEFAULT_SETTINGS])
    await h.until('fresh', 'idle')
    // Saving fails the same way: the live Session keeps the pick.
    const session = h.registry.get(h.view('fresh').sessionId)
    await session.configure({ model: 'opus' })
    expect(session.settings.model).toBe('opus')
    expect(warn).toHaveBeenCalled()
  })
})

describe('Close', () => {
  it('is refused during a turn and allowed after Interrupt; the Node stays and shows the Session closed', async () => {
    const h = harness({ script: 'interrupt' })
    const created = h.sessions.create(PROJECT)
    await h.until(created.nodeId, 'idle')
    const session = h.registry.get(h.view(created.nodeId).sessionId)
    session.send('count')
    await h.until(created.nodeId, 'busy')
    expect(() => h.sessions.close(created.nodeId)).toThrow(/Interrupt/)
    expect(session.state).toBe('busy')
    await session.interrupt()
    await h.until(created.nodeId, 'idle')
    h.sessions.close(created.nodeId)
    expect(h.view(created.nodeId).state).toBe('closed')
    expect(h.nodes().map((each) => each.id)).toContain(created.nodeId)
    expect(() => h.sessions.close(created.nodeId)).toThrow(/No live Session/)
  })

  it('agent.close refuses a busy Session too, and closes an idle one', async () => {
    const h = harness({ script: 'interrupt' })
    const { agentHandlers } = await import('../../src/main/ipc/agent')
    const handlers = new Map(agentHandlers(() => h.registry).map((handler) => [handler.channel.name, handler]))
    const close = handlers.get('agent.close')
    if (!close) throw new Error('agent.close has no handler')
    const created = h.sessions.create(PROJECT)
    await h.until(created.nodeId, 'idle')
    const session = h.registry.get(h.view(created.nodeId).sessionId)
    session.send('count')
    await h.until(created.nodeId, 'busy')
    expect(() => close.handle({ sessionId: session.id }, { event: {} as IpcMainInvokeEvent })).toThrow(/Interrupt/)
    await session.interrupt()
    await h.until(created.nodeId, 'idle')
    await close.handle({ sessionId: session.id }, { event: {} as IpcMainInvokeEvent })
    expect(session.state).toBe('closed')
  })
})

describe('New conversation of the Orchestrator', () => {
  it('closes the current Session, forgets its id and cost, and makes a new Session the Orchestrator; refused during a turn', async () => {
    const layout = new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 })
    const requests: QueryRequest[] = []
    const fake = fakeQueryFactory({ scriptsDir, script: 'turn' })
    const registry = new SessionRegistry((request) => {
      requests.push(request)
      return fake(request)
    })
    registries.push(registry)
    const orchestrators = new Orchestrators({
      layout,
      projectPath: () => repo,
      registry,
      settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
      transcript: () => Promise.resolve({ model: null, statusBlock: null }),
      broadcast: () => undefined,
      publish: () => undefined,
    })
    const opened = await orchestrators.open(PROJECT)
    const data = () => layout.get(PROJECT).layout.nodes.find((node) => node.id === opened.nodeId)?.data
    const state = () => orchestrators.view(opened.nodeId)?.state
    await vi.waitFor(() => expect(state()).toBe('idle'))
    const first = registry.get(orchestrators.view(opened.nodeId)?.sessionId ?? '')
    first.send('hello')
    await vi.waitFor(() => expect(data()?.sessionId).toEqual(expect.any(String)))
    await vi.waitFor(() => expect(state()).toBe('idle'))
    const oldId = data()?.sessionId
    expect(data()?.costUsd).toBeGreaterThan(0)

    const next = await orchestrators.newConversation(PROJECT)
    expect(first.state).toBe('closed')
    expect(next.nodeId).toBe(opened.nodeId)
    expect(next.costUsd).toBe(0)
    expect(data()).toStrictEqual({ sessionId: null, costUsd: 0 })
    expect(requests.at(-1)).toMatchObject({ resume: undefined, cwd: repo })
    await vi.waitFor(() => expect(state()).toBe('idle'))
    registry.get(orchestrators.view(opened.nodeId)?.sessionId ?? '').send('again')
    await vi.waitFor(() => expect(data()?.sessionId).toEqual(expect.any(String)))
    expect(data()?.sessionId).not.toBe(oldId)
    await vi.waitFor(() => expect(state()).toBe('idle'))

    // During a turn: refused, nothing changes.
    const busyRegistry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script: 'interrupt' }))
    registries.push(busyRegistry)
    const busy = new Orchestrators({
      layout,
      projectPath: () => repo,
      registry: busyRegistry,
      settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
      transcript: () => Promise.resolve({ model: null, statusBlock: null }),
      broadcast: () => undefined,
      publish: () => undefined,
    })
    const other = 'other-0000000e'
    mkdirSync(join(scratch, 'data', other), { recursive: true })
    const view = await busy.open(other)
    await vi.waitFor(() => expect(busy.view(view.nodeId)?.state).toBe('idle'))
    busyRegistry.get(busy.view(view.nodeId)?.sessionId ?? '').send('count')
    await vi.waitFor(() => expect(busy.view(view.nodeId)?.state).toBe('busy'))
    await expect(busy.newConversation(other)).rejects.toThrow(/Interrupt/)
    expect(busy.view(view.nodeId)?.state).toBe('busy')
  })
})

describe('sessions.* channels', () => {
  const view: SessionNodeView = {
    projectId: PROJECT,
    nodeId: 'node-1',
    sessionId: 'pending-1',
    sdkSessionId: null,
    state: 'idle',
    error: null,
    cwd: '/repo',
    model: null,
    version: 2,
  }

  async function channels(answers: { view?: unknown; verdicts?: unknown } = {}) {
    const { sessionsHandlers } = await import('../../src/main/ipc/sessions')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    const answer = answers.view ?? { ...view, internal: 'leak' }
    const spies = {
      create: vi.fn(() => answer),
      start: vi.fn(() => Promise.resolve(answer)),
      resume: vi.fn(() => Promise.resolve(answer)),
      resumable: vi.fn(() => Promise.resolve(answers.verdicts ?? { [FINISHED]: { resumable: true, cwd: '/repo', extra: 1 } })),
      list: vi.fn(() => [answer]),
      close: vi.fn(),
    }
    await registerIpc(
      { handle: (name, listener) => handlers.set(name, listener) },
      { modules: { './sessions.ts': () => Promise.resolve(sessionsHandlers(() => spies as unknown as NodeSessions)) }, isTrustedSender: (url) => url === APP_URL },
    )
    const call = async <T,>(channel: string, input: unknown) => {
      const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
      if (!listener) throw new Error(`${channel} is not registered`)
      return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
    }
    return { call, spies }
  }

  it.each([
    ['sessions.new', { projectId: 7 }, 'create'],
    ['sessions.start', { projectId: PROJECT, nodeId: '' }, 'start'],
    ['sessions.resume', { projectId: PROJECT, sessionId: '../../etc/passwd' }, 'resume'],
    ['sessions.resume', { projectId: PROJECT, sessionId: 42 }, 'resume'],
    ['sessions.resumable', { projectId: PROJECT, sessionIds: ['ok', 'not/ok'] }, 'resumable'],
    ['sessions.resumable', { projectId: PROJECT, sessionIds: 'one' }, 'resumable'],
    ['sessions.views', {}, 'list'],
    ['sessions.close', { nodeId: null }, 'close'],
  ] as const)('%s rejects %j before the handler runs', async (channel, input, spy) => {
    const { call, spies } = await channels()
    const result = await call(channel, input)
    expect(!result.ok && result.error).toMatch(new RegExp(`${channel.replace('.', '\\.')}: invalid input`))
    expect(spies[spy]).not.toHaveBeenCalled()
  })

  it('passes only the declared input and answers only the declared keys', async () => {
    const { call, spies } = await channels()
    expect(await call('sessions.new', { projectId: PROJECT, admin: true })).toStrictEqual({ ok: true, value: view })
    expect(spies.create).toHaveBeenCalledWith(PROJECT)
    expect(await call('sessions.start', { projectId: PROJECT, nodeId: 'node-1', resume: 'x' })).toStrictEqual({ ok: true, value: view })
    expect(spies.start).toHaveBeenCalledWith(PROJECT, 'node-1')
    expect(await call('sessions.resume', { projectId: PROJECT, sessionId: FINISHED, cwd: '/elsewhere' })).toStrictEqual({ ok: true, value: view })
    expect(spies.resume).toHaveBeenCalledWith(PROJECT, FINISHED)
    expect(await call('sessions.resumable', { projectId: PROJECT, sessionIds: [FINISHED] })).toStrictEqual({
      ok: true,
      value: { verdicts: { [FINISHED]: { resumable: true, cwd: '/repo' } } },
    })
    expect(await call('sessions.views', { projectId: PROJECT })).toStrictEqual({ ok: true, value: { views: [view] } })
    expect(await call('sessions.close', { nodeId: 'node-1', force: true })).toStrictEqual({ ok: true, value: undefined })
    expect(spies.close).toHaveBeenCalledWith('node-1')
  })

  it('refuses an answer outside the contract', async () => {
    const { call } = await channels({ view: { ...view, state: 'sleeping' }, verdicts: { [FINISHED]: { resumable: false, reason: 'tired', label: 'x' } } })
    expect((await call('sessions.new', { projectId: PROJECT })).ok).toBe(false)
    expect((await call('sessions.resumable', { projectId: PROJECT, sessionIds: [FINISHED] })).ok).toBe(false)
  })
})
