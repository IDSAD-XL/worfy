import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import { layoutNodeSchema, type LayoutNode } from '../../src/shared/layout/types'
import {
  planSessionNodes,
  readSessionNodeData,
  sessionNodeId,
  SESSION_KIND,
  sessionRow,
  sessionSourceLabel,
  sessionStatus,
  worfySessionIds,
  worfySessions,
  worfySessionTitle,
} from '../../src/renderer/claude-home/session-nodes'
import { answerReadOnly } from '../../src/renderer/projects/read-only-now'
import { bindingSpots } from '../../src/renderer/canvas/overlays/session-spots'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import { sessionSpot, stripKeepOut, type DrawnNode } from '../../src/renderer/canvas/session-spot'
import { EMPTY_AGENT_SIGNALS } from '../../src/shared/binding/resolve'
import { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId } from '../../src/shared/layout/derived'
import { openSession } from '../../src/renderer/session/navigation'

// openSession() tells main through layout.apply; the channel is a stand-in here.
const ipc = vi.hoisted(() => ({ invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(() => Promise.resolve({ ok: true, value: {} })) }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/ipc')>()), invoke: ipc.invoke }))

// Which Session Nodes the Canvas needs for the Project's live Sessions (ticket 14): one Node per
// Session id, wherever the Session was started; a Session worfy runs keeps its own Node.

const live = (sessionId: string, extra: Partial<LiveSession> = {}): LiveSession => ({
  pid: 100,
  sessionId,
  cwd: '/Users/test/projects/demo',
  status: 'idle',
  entrypoint: 'cli',
  ...extra,
})

const node = (fields: Partial<LayoutNode> & { id: string; kind: string }): LayoutNode => layoutNodeSchema.parse({ x: 0, y: 0, w: 300, h: 120, ...fields })

const orchestrator = (sessionId: string | null) => node({ id: 'orch', kind: 'orchestrator', w: 360, h: 200, data: { sessionId } })
const external = (sessionId: string, fields: Partial<LayoutNode> = {}) =>
  node({ id: sessionNodeId(sessionId), kind: SESSION_KIND, data: { sessionId, origin: 'external', source: 'terminal', cwd: '/x' }, ...fields })

describe('deduplication by session id', () => {
  it('gives no external Node to a Session that the Orchestrator Node names', () => {
    const nodes = [orchestrator('S-worfy')]
    const plan = planSessionNodes({ live: [live('S-worfy')], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan).toEqual({ create: [], remove: [] })
  })

  it('gives no external Node to a Session that worfy runs, even before its Node names it', () => {
    const nodes = [orchestrator(null)]
    const plan = planSessionNodes({ live: [live('S-running')], nodes, worfyIds: worfySessionIds(nodes, ['S-running']), seen: new Set() })
    expect(plan.create).toEqual([])
  })

  it('removes the external Node of a Session that turns out to be worfy’s own', () => {
    const nodes = [orchestrator('S-worfy'), external('S-worfy'), external('S-other')]
    const plan = planSessionNodes({ live: [live('S-worfy'), live('S-other')], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan).toEqual({ create: [], remove: [sessionNodeId('S-worfy')] })
  })

  it('creates one Node per Session id, and none for a Session that already has one', () => {
    const nodes = [external('S-1')]
    const plan = planSessionNodes({ live: [live('S-1'), live('S-2'), live('S-2', { pid: 101 })], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan.remove).toEqual([])
    expect(plan.create.map((op) => op.node.id)).toEqual([sessionNodeId('S-2')])
  })

  it('does not bring back a Node the user removed while the app runs', () => {
    const plan = planSessionNodes({ live: [live('S-1')], nodes: [], worfyIds: new Set(), seen: new Set(['S-1']) })
    expect(plan.create).toEqual([])
  })

  it('counts an external Node as no claim of worfy’s', () => {
    expect([...worfySessionIds([external('S-1'), orchestrator('S-2'), node({ id: 'n', kind: 'note', data: { sessionId: 'S-3' } })], ['S-4'])].sort()).toEqual([
      'S-2',
      'S-3',
      'S-4',
    ])
  })
})

describe('a new Session Node', () => {
  it('is a read-only Session Node with where it was started', () => {
    const [op] = planSessionNodes({ live: [live('S-1', { cwd: '/Users/test/projects/demo/sub', name: 'fix-tests' })], nodes: [], worfyIds: new Set(), seen: new Set() }).create
    expect(op?.op).toBe('create')
    expect(op?.node).toMatchObject({
      id: 'session:S-1',
      kind: 'session',
      data: { sessionId: 'S-1', origin: 'external', source: 'terminal', cwd: '/Users/test/projects/demo/sub', name: 'fix-tests' },
    })
    expect(layoutNodeSchema.safeParse(op?.node).success).toBe(true)
  })

  it('stands right of the Nodes there are, and under the last Session Node', () => {
    const nodes = [node({ id: 'a', kind: 'note', x: 10, y: 40, w: 200, h: 100 }), node({ id: 'b', kind: 'note', x: 300, y: -20, w: 100, h: 50 })]
    const [first, second] = planSessionNodes({ live: [live('S-1'), live('S-2')], nodes, worfyIds: new Set(), seen: new Set() }).create
    expect(first?.node).toMatchObject({ x: 448, y: -20 })
    expect(second?.node.x).toBe(448)
    expect(second?.node.y).toBeGreaterThan((first?.node.y ?? 0) + (first?.node.h ?? 0))
  })

  it('names a Claude desktop Session as such', () => {
    const [op] = planSessionNodes({ live: [live('S-1', { entrypoint: 'claude-desktop' })], nodes: [], worfyIds: new Set(), seen: new Set() }).create
    expect(op?.node.data).toMatchObject({ source: 'desktop' })
    const data = readSessionNodeData(op?.node.data ?? {})
    expect(data && sessionSourceLabel(data)).toBe('Claude desktop')
    expect(sessionSourceLabel({ sessionId: 'S', origin: 'external', source: 'terminal', cwd: '/a/b' })).toBe('terminal · /a/b')
  })
})

describe('the status of a Session Node', () => {
  it('follows the live Session and is finished once its process is gone', () => {
    expect(sessionStatus(live('S', { status: 'busy' }))).toEqual({ status: 'working', label: 'busy' })
    expect(sessionStatus(live('S', { status: 'idle' }))).toEqual({ status: 'ready', label: 'idle' })
    expect(sessionStatus(live('S', { status: 'unknown' }))).toEqual({ status: 'ready', label: 'live' })
    expect(sessionStatus(undefined)).toEqual({ status: 'done', label: 'finished' })
  })

  it('reads the Node data it wrote and refuses what it did not', () => {
    expect(readSessionNodeData({ sessionId: 'S', origin: 'external', source: 'desktop', cwd: '/a', extra: 1 })).toEqual({ sessionId: 'S', origin: 'external', source: 'desktop', cwd: '/a' })
    expect(readSessionNodeData({ sessionId: 5 })).toBeNull()
  })
})

// worfy-daily ticket 24: worfy's own Sessions in the sidebar and on the Canvas.
describe('a Session worfy runs, before Claude Code reports it in system/init', () => {
  it('gets no read-only Node from its registry entry: its id is known to worfy from the start', () => {
    // A new Session Node does not name its Session yet; main's view already has the id worfy gave it.
    const nodes = [orchestrator(null), node({ id: 'n-live', kind: SESSION_KIND, data: { origin: 'worfy' } })]
    const own = worfySessions({
      nodes,
      orchestrators: [{ projectId: 'p', nodeId: 'orch', sessionId: 'S-orch', state: 'idle' }],
      sessionNodes: [{ projectId: 'p', nodeId: 'n-live', sessionId: 'S-new', sdkSessionId: null, state: 'idle' }],
      projectId: 'p',
      history: [],
    })
    const worfyIds = worfySessionIds(nodes, [...own.keys()])
    const plan = planSessionNodes({ live: [live('S-orch', { entrypoint: 'sdk-ts' }), live('S-new', { entrypoint: 'sdk-ts' })], nodes, worfyIds, seen: new Set() })
    expect(plan).toEqual({ create: [], remove: [] })
  })
})

describe('the sidebar row of a live Session', () => {
  const history = [{ sessionId: 'S-saved', title: 'Fix the tests' }]
  const nodes = [
    orchestrator('S-orch-saved'),
    node({ id: 'n-new', kind: SESSION_KIND, data: { origin: 'worfy' } }),
    node({ id: 'n-saved', kind: SESSION_KIND, data: { origin: 'worfy', sessionId: 'S-saved' } }),
    node({ id: 'n-other', kind: 'ticket', data: { sessionId: 'S-ticket' } }),
    external('S-cli'),
  ]
  const own = worfySessions({
    nodes,
    orchestrators: [
      { projectId: 'p', nodeId: 'orch', sessionId: 'pending-orch', state: 'needs_permission' },
      { projectId: 'other', nodeId: 'orch-2', sessionId: 'S-elsewhere', state: 'idle' },
    ],
    sessionNodes: [
      { projectId: 'p', nodeId: 'n-new', sessionId: 'S-new', sdkSessionId: null, state: 'busy' },
      { projectId: 'p', nodeId: 'n-saved', sessionId: 'pending-saved', sdkSessionId: 'S-saved', state: 'idle' },
      { projectId: 'p', nodeId: 'n-gone', sessionId: 'S-closed', sdkSessionId: 'S-closed', state: 'closed' },
    ],
    projectId: 'p',
    history,
  })
  const worfyIds = worfySessionIds(nodes, [...own.keys()])
  const row = (session: LiveSession, title = 'auto-name') => sessionRow(session, worfyIds, own, title)

  it('says «worfy» and the name on its Node for a Session worfy runs, whichever of its ids the registry has', () => {
    expect(row(live('S-orch-saved', { entrypoint: 'sdk-ts' }))).toMatchObject({ source: 'worfy', name: 'Orchestrator' })
    expect(row(live('pending-orch', { entrypoint: 'sdk-ts' }))).toMatchObject({ source: 'worfy', name: 'Orchestrator' })
    expect(row(live('S-new', { entrypoint: 'sdk-ts' }))).toMatchObject({ source: 'worfy', name: 'New session' })
    expect(row(live('S-saved', { entrypoint: 'sdk-ts' }))).toMatchObject({ source: 'worfy', name: 'Fix the tests' })
    // Named by a Node that is neither: worfy's, under the registry's name.
    expect(row(live('S-ticket', { entrypoint: 'sdk-ts' }))).toMatchObject({ source: 'worfy', name: 'auto-name' })
  })

  it('shows the state its Node shows, not the registry’s status', () => {
    // Claude Code writes no idle/busy for an SDK Session: the registry says `unknown`, which reads «live».
    expect(row(live('S-orch-saved', { status: 'unknown' })).chip).toEqual({ status: 'blocked', label: 'needs permission' })
    expect(row(live('S-new', { status: 'unknown' })).chip).toEqual({ status: 'working', label: 'busy' })
    // No view of it in this window: the registry's status.
    expect(row(live('S-ticket', { status: 'idle' })).chip).toEqual({ status: 'ready', label: 'idle' })
  })

  it('does not make an `sdk-ts` Session worfy’s that worfy does not run', () => {
    expect(row(live('S-script', { entrypoint: 'sdk-ts', status: 'unknown' }), 'my-script')).toEqual({ source: 'terminal', name: 'my-script', chip: { status: 'ready', label: 'live' } })
    // A Session of another Project's Orchestrator, or a closed one, is not counted either.
    expect(row(live('S-elsewhere', { entrypoint: 'sdk-ts' })).source).toBe('terminal')
    expect(row(live('S-closed', { entrypoint: 'sdk-ts' })).source).toBe('terminal')
  })

  it('says «terminal» for a Session from a terminal and «desktop» for one from Claude desktop', () => {
    expect(row(live('S-cli', { entrypoint: 'cli' }), 'fix-tests')).toMatchObject({ source: 'terminal', name: 'fix-tests' })
    expect(row(live('S-desk', { entrypoint: 'claude-desktop' }))).toMatchObject({ source: 'desktop' })
    expect(row(live('S-none', {}))).toMatchObject({ source: 'terminal' })
  })

  it('takes the worfy ids from the Nodes and from main’s views alike', () => {
    expect([...own.keys()].sort()).toEqual(['S-new', 'S-orch-saved', 'S-saved', 'S-ticket', 'pending-orch', 'pending-saved'])
  })
})

describe('the name of a Session worfy runs on a Session Node', () => {
  it('is its transcript’s title, «New session» before it has an id, «Session <id>» otherwise', () => {
    const history = [{ sessionId: 'S-1', title: 'Fix the tests' }, { sessionId: 'S-2' }]
    expect(worfySessionTitle('S-1', history)).toBe('Fix the tests')
    expect(worfySessionTitle('S-2abcdefgh', history)).toBe('Session S-2abcde')
    expect(worfySessionTitle(undefined, history)).toBe('New session')
  })
})

describe('an archived Session Node (worfy-canvas ticket 07, ADR-0076)', () => {
  const archived = { at: 1, rule: 'idle' as const, batch: 'b1' }

  it('is not made again while its Session is in the registry: the Node is still in the Layout, main brings it back', () => {
    const nodes = [external('S-1', { archived })]
    expect(planSessionNodes({ live: [live('S-1')], nodes, worfyIds: new Set(), seen: new Set() }).create).toEqual([])
  })

  it('is not where the next new Session Node is placed from: it is not on the Canvas', () => {
    const nodes = [node({ id: 'a', kind: 'note', x: 0, y: 0, w: 200, h: 100 }), external('S-old', { x: 0, y: 5000, archived })]
    const [op] = planSessionNodes({ live: [live('S-new')], nodes, worfyIds: new Set(), seen: new Set() }).create
    expect(op?.node).toMatchObject({ x: 248, y: 0 })
  })
})

describe('opening a Session view touches its Node (worfy-canvas ticket 07)', () => {
  afterEach(() => {
    ipc.invoke.mockClear()
    answerReadOnly(() => null)
  })

  it('sends `touch` for the Node, without a screen', () => {
    openSession({ nodeId: 'session:S-1', projectId: 'p1', external: { sessionId: 'S-1' } })
    expect(ipc.invoke).toHaveBeenCalledWith('layout.apply', { projectId: 'p1', op: { op: 'touch', id: 'session:S-1' } })
  })

  it('sends nothing for a Subagent, whose Node the Layout does not keep, or from a read-only screen', () => {
    openSession({ nodeId: 'subagent:S-1/a1', projectId: 'p1', external: { sessionId: 'S-1', agentId: 'a1' } })
    answerReadOnly(() => 'beta gives this Machine read-only access')
    openSession({ nodeId: 'session:S-1', projectId: 'p1' })
    expect(ipc.invoke).not.toHaveBeenCalled()
  })
})

describe('a new Session with a Binding (worfy-canvas ticket 11)', () => {
  // The strip of Epic frames: one frame of `alpha`, 600 wide, from x = 0; its spot is right of it.
  const strip = { x: 0, right: 600, top: 0, bottom: 900 }
  const frames = [{ epic: 'alpha', y: 300, tickets: new Map<number, number>() }]
  const spot = sessionSpot({ kind: 'epic', epic: 'alpha' }, frames, strip)!
  const keepOut = [stripKeepOut(strip)]

  it('stands by its Epic, right of the strip; one without a Binding goes under the last Session Node', () => {
    const nodes = [external('S-old', { x: 2000, y: 0 })]
    const { create } = planSessionNodes({ live: [live('S-bound'), live('S-free')], nodes, worfyIds: new Set(), seen: new Set(), near: new Map([['S-bound', spot]]), keepOut })
    const bound = create.find((op) => op.node.id === sessionNodeId('S-bound'))
    const free = create.find((op) => op.node.id === sessionNodeId('S-free'))
    expect(bound?.node).toMatchObject({ x: 600 + FRAME_GAP, y: 300 })
    // Under the lowest Session Node, which is now the bound one.
    expect(free?.node).toMatchObject({ x: 600 + FRAME_GAP, y: 300 + 120 + 16 })
  })

  it('takes the nearest clear place from its spot, never one in the strip’s band', () => {
    const taken = node({ id: 'n', kind: 'note', x: 600 + FRAME_GAP, y: 300, w: 300, h: 120 })
    const [op] = planSessionNodes({ live: [live('S-bound')], nodes: [taken], worfyIds: new Set(), seen: new Set(), near: new Map([['S-bound', spot]]), keepOut }).create
    expect(op?.node.x).toBeGreaterThanOrEqual(600 + FRAME_GAP)
    const clear = op!.node.y >= 300 + 120 + 16 || op!.node.y + 120 + 16 <= 300 || op!.node.x >= 600 + FRAME_GAP + 300 + 16
    expect(clear).toBe(true)
  })

  it('does not move a Node made before its Binding was known', () => {
    const nodes = [external('S-1', { x: 2000, y: 700 })]
    const plan = planSessionNodes({ live: [live('S-1')], nodes, worfyIds: new Set(), seen: new Set(['S-1']), near: new Map([['S-1', spot]]), keepOut })
    expect(plan).toEqual({ create: [], remove: [] })
  })

  describe('its spot from the Binding it has when its Node is made', () => {
    const frameNode = {
      id: epicNodeId('alpha'),
      type: EPIC_FRAME_KIND,
      width: 600,
      height: 900,
      internals: { positionAbsolute: { x: 0, y: 40 } },
      data: { node: { data: { epic: { epic: 'alpha' }, auto: { x: 0, y: 40 } } } },
    } satisfies DrawnNode & { id: string }
    const signals = (sessionId: string) => ({
      found: true,
      session: sessionId === 'S-claimed' ? { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'alpha', num: 3, command: 'ticket claim alpha 03' } } : EMPTY_AGENT_SIGNALS,
      subagents: [],
    })
    afterEach(() => ipc.invoke.mockReset())

    it('reads each new Session’s signals and puts the bound one at its Epic, not the unbound one', async () => {
      ipc.invoke.mockImplementation((channel, input) =>
        Promise.resolve(channel === 'bindings.signals' ? { ok: true, value: signals((input as { sessionId: string }).sessionId) } : { ok: true, value: {} }),
      )
      const ticketNode = {
        id: 'ticket:alpha/3',
        type: TICKET_KIND,
        internals: { positionAbsolute: { x: 40, y: 220.6 } },
        data: { node: { data: { ticket: { epic: 'alpha', num: 3 } } } },
      } satisfies DrawnNode & { id: string }
      const epicBound = { sessionId: 'S-epic', target: { kind: 'epic' as const, epic: 'alpha' }, agentId: null }
      const { near, keepOut: kept } = await bindingSpots({ root: '/p', sessionIds: ['S-claimed', 'S-epic', 'S-none'], manual: [epicBound], model: undefined, nodes: () => [frameNode, ticketNode] })
      expect(ipc.invoke).toHaveBeenCalledWith('bindings.signals', { projectRoot: '/p', sessionId: 'S-claimed' })
      // `ticket claim alpha 03` in its transcript: by its Ticket. A manual Binding to the Epic: by the frame's header.
      expect([...near]).toEqual([
        ['S-claimed', { x: 600 + FRAME_GAP, y: 221 }],
        ['S-epic', { x: 600 + FRAME_GAP, y: 40 }],
      ])
      expect(kept).toEqual([stripKeepOut({ x: 0, right: 600, top: 40, bottom: 940 })])
    })

    it('asks nothing without a strip on the Canvas, and gives no spot when the signals cannot be read', async () => {
      ipc.invoke.mockImplementation(() => Promise.reject(new Error('main is gone')))
      expect(await bindingSpots({ root: '/p', sessionIds: ['S-claimed'], manual: [], model: undefined, nodes: () => [] })).toEqual({ near: new Map(), keepOut: [] })
      expect(ipc.invoke).not.toHaveBeenCalled()
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { near } = await bindingSpots({ root: '/p', sessionIds: ['S-claimed'], manual: [], model: undefined, nodes: () => [frameNode] })
      expect(near.size).toBe(0)
      expect(error).toHaveBeenCalled()
      error.mockRestore()
    })
  })
})
