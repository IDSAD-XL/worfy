// The pieces between the workflow model and the Canvas: the delta applied in the renderer, the
// Epic node source (what it builds and what it keeps from the Layout), and the blocking arrows.
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider, type EdgeProps } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout, LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import RoutedEdge from '../../src/renderer/canvas/edge-types/RoutedEdge'
import blockingEdges from '../../src/renderer/canvas/edges/blocking'
import { setElkEngine, useElkAnswers } from '../../src/renderer/canvas/elk/client'
import { layoutEpicElk, type ElkEngine } from '../../src/renderer/canvas/elk/layout'
import { collectEdgeTypes, edgeTypes } from '../../src/renderer/canvas/extensions'
import EpicFrameNode from '../../src/renderer/canvas/nodes/EpicFrameNode'
import TicketNode from '../../src/renderer/canvas/nodes/TicketNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import epicSource, { buildEpicNodes, epicNodeId, requestEpicLayouts, ticketNodeId, type EpicFrameData, type TicketNodeData } from '../../src/renderer/canvas/sources/epics'
import { applyWorkflowDelta } from '../../src/renderer/workflow/useWorkflow'
import { headerWidth, layoutEpic, MIN_FRAME_WIDTH, orthogonalPath, placeRoute } from '../../src/renderer/canvas/epic-layout'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// The Layout operations the source sends to main, recorded instead of sent; each one succeeds.
const applied = vi.hoisted(() => [] as { projectId: string; op: unknown }[])
vi.mock('../../src/renderer/canvas/useLayout', async (original) => ({
  ...(await original<typeof import('../../src/renderer/canvas/useLayout')>()),
  applyLayoutOp: (projectId: string, op: unknown) => {
    applied.push({ projectId, op })
    return Promise.resolve(undefined)
  },
}))

function ticket(epic: string, num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic,
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}
const epic = (name: string): Epic => ({ epic: name, hasSpec: true, hasMap: false, title: `${name} title` })

function model(tickets: Ticket[], epics = ['a', 'b']): WorkflowModel {
  return { root: '/repo', epics: epics.map(epic), tickets, error: null, branchErrors: [] }
}

const layoutWith = (nodes: Partial<LayoutNode>[] = []): Layout => ({
  nodes: nodes.map((n) => ({ id: 'x', kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: {}, ...n })),
  viewport: { x: 0, y: 0, zoom: 1 },
})

let project = 0
const freshProject = () => `p-${(project += 1)}`

describe('applyWorkflowDelta', () => {
  it('replaces, adds and removes only what the delta names and keeps every other object', () => {
    const before = model([ticket('a', 1), ticket('a', 2), ticket('b', 1)])
    const changed = ticket('a', 2, { state: 'work', statusRaw: 'claimed' })
    const added = ticket('b', 2)
    const after = applyWorkflowDelta(before, {
      root: '/repo',
      epics: [epic('c')],
      tickets: [changed, added],
      removedEpics: [],
      removedTickets: [{ epic: 'b', num: 1 }],
      error: null,
      branchErrors: [],
    })
    expect(after.tickets).toEqual([before.tickets[0], changed, added])
    expect(after.tickets[0]).toBe(before.tickets[0])
    expect(after.epics.map((e) => e.epic)).toEqual(['a', 'b', 'c'])
    expect(after.epics[0]).toBe(before.epics[0])
  })
})

describe('applyWorkflowDelta, an Epic removed', () => {
  it('drops the Epic the delta removes and keeps the others', () => {
    const before = model([ticket('a', 1), ticket('b', 1)])
    const after = applyWorkflowDelta(before, {
      root: '/repo',
      epics: [],
      tickets: [],
      removedEpics: ['b'],
      removedTickets: [{ epic: 'b', num: 1 }],
      error: null,
      branchErrors: [],
    })
    expect(after.epics.map((e) => e.epic)).toEqual(['a'])
    expect(after.epics[0]).toBe(before.epics[0])
    expect(after.tickets).toEqual([before.tickets[0]])
    // Its frame is gone from the Canvas too.
    expect(buildEpicNodes(freshProject(), '/repo', after, layoutWith(), {}).map((n) => n.id)).toEqual([epicNodeId('a'), ticketNodeId('a', 1)])
  })
})

describe('the Epic node source', () => {
  it('builds a frame per Epic and its Tickets as children, stacked top to bottom', () => {
    const nodes = buildEpicNodes(freshProject(), '/repo', model([ticket('a', 1), ticket('a', 2, { blockedNums: [1] }), ticket('b', 1)]), layoutWith(), {})
    expect(nodes.map((n) => n.id)).toEqual([epicNodeId('a'), ticketNodeId('a', 1), ticketNodeId('a', 2), epicNodeId('b'), ticketNodeId('b', 1)])
    const [frameA, , , frameB] = nodes
    expect(frameA!.position).toEqual({ x: 0, y: 0 })
    expect(frameB!.position.y).toBeGreaterThan(frameA!.height!)
    for (const n of nodes) expect(n.deletable).toBe(false)
    expect(nodes[1]!.parentId).toBe(epicNodeId('a'))
    expect((nodes[2]!.data.node.data as TicketNodeData).waitingOn).toEqual([1])
  })

  it('keeps the objects of an Epic that did not change and returns the same array when nothing changed', () => {
    const id = freshProject()
    const layout = layoutWith()
    const first = model([ticket('a', 1), ticket('a', 2), ticket('b', 1)])
    const nodes = buildEpicNodes(id, '/repo', first, layout, {})
    expect(buildEpicNodes(id, '/repo', { ...first }, layoutWith(), {})).toBe(nodes)

    // Only a Ticket of Epic b changes: Epic a's frame and Tickets are the same objects.
    const second = { ...first, tickets: [first.tickets[0]!, first.tickets[1]!, ticket('b', 1, { state: 'work', statusRaw: 'claimed' })] }
    const next = buildEpicNodes(id, '/repo', second, layout, {})
    expect(next).not.toBe(nodes)
    expect(next.slice(0, 3)).toEqual(nodes.slice(0, 3))
    next.slice(0, 3).forEach((node, index) => expect(node).toBe(nodes[index]))
    expect(next[4]).not.toBe(nodes[4])
  })

  it('reads only the frame offset and the collapsed flag from the Epic’s Layout Node; a Ticket offset left by an older version moves nothing', () => {
    const id = freshProject()
    const saved = layoutWith([{ id: epicNodeId('a'), x: 30, y: -20, data: { 'offset:2': { dx: 15, dy: 25 }, 'offset:1': 'junk' } }])
    const tickets = [ticket('a', 1), ticket('a', 2)]
    const plain = buildEpicNodes(id, '/repo', model(tickets, ['a']), layoutWith(), {})
    const moved = buildEpicNodes(id, '/repo', model(tickets, ['a']), saved, {})
    expect(moved[0]!.position).toEqual({ x: 30, y: -20 })
    expect((moved[0]!.data.node.data as EpicFrameData).auto).toEqual({ x: 0, y: 0 })
    expect(moved[0]!.data.node.data.saved).toBe(true)
    // The Tickets sit where the layout puts them, relative to the frame.
    expect(moved[1]!.position).toEqual(plain[1]!.position)
    expect(moved[2]!.position).toEqual(plain[2]!.position)

    const collapsed = buildEpicNodes(id, '/repo', model(tickets, ['a']), layoutWith([{ id: epicNodeId('a'), data: { collapsed: true } }]), {})
    expect(collapsed.map((n) => n.id)).toEqual([epicNodeId('a')])
  })

  it('collapses an Epic whose every Ticket is done unless the user opened it, and folds done Tickets until the stack is opened', () => {
    const id = freshProject()
    const allDone = [ticket('a', 1, { state: 'done' }), ticket('a', 2, { state: 'done' })]
    expect(buildEpicNodes(id, '/repo', model(allDone, ['a']), layoutWith(), {}).map((n) => n.id)).toEqual([epicNodeId('a')])
    const opened = layoutWith([{ id: epicNodeId('a'), data: { collapsed: false } }])
    expect(buildEpicNodes(id, '/repo', model(allDone, ['a']), opened, {}).map((n) => n.id)).toEqual([epicNodeId('a')])
    expect(buildEpicNodes(id, '/repo', model(allDone, ['a']), opened, { [`${id}|a`]: true }).map((n) => n.id)).toEqual([
      epicNodeId('a'),
      ticketNodeId('a', 1),
      ticketNodeId('a', 2),
    ])
  })

  it('draws nothing without a root, a model, or when the model failed to read', () => {
    const id = freshProject()
    expect(buildEpicNodes(id, undefined, model([ticket('a', 1)]), layoutWith(), {})).toEqual([])
    expect(buildEpicNodes(id, '/repo', undefined, layoutWith(), {})).toEqual([])
    const failed = { ...model([]), error: { code: 'not-found' as const, message: 'epic-status not found' } }
    expect(buildEpicNodes(id, '/repo', failed, layoutWith(), {})).toEqual([])
  })
  // worfy-daily ticket 11: the header shows the Epic's whole name, also when it has no Tickets.
  it('makes a frame wide enough for its Epic name, also for an Epic without Tickets', () => {
    const name = 'audit-2026-09-25-with-a-long-epic-name'
    const nodes = buildEpicNodes(freshProject(), '/repo', model([ticket('a', 1)], ['a', name]), layoutWith(), {})
    const frame = nodes.find((n) => n.id === epicNodeId(name))!
    expect(frame.width).toBe(headerWidth(name))
    expect(frame.width).toBeGreaterThan(MIN_FRAME_WIDTH)
  })
})

describe('dropping an Epic frame', () => {
  beforeEach(() => {
    applied.length = 0
  })

  it('saves the frame’s offset from its automatic place, and the offset puts it back there', async () => {
    const id = freshProject()
    const tickets = [ticket('a', 1), ticket('a', 2, { blockedNums: [1] }), ticket('b', 1)]
    const nodes = buildEpicNodes(id, '/repo', model(tickets), layoutWith(), {})
    // The second frame: its automatic place is below the first one, not at the origin.
    const frameB = nodes.find((n) => n.id === epicNodeId('b'))!
    const auto = (frameB.data.node.data as EpicFrameData).auto
    expect(auto.y).toBeGreaterThan(0)

    // First drop: the Layout has no Node for the Epic yet, so it is created with the offset.
    epicSource.moved({ projectId: id, layout: layoutWith() }, { ...frameB, position: { x: auto.x + 40.4, y: auto.y + 24.6 } })
    await vi.waitFor(() => expect(applied).toHaveLength(1))
    expect(applied[0]).toEqual({
      projectId: id,
      op: { op: 'create', node: { id: epicNodeId('b'), kind: 'epic-frame', x: 40, y: 25, w: 1, h: 1, locked: true, data: {} } } satisfies LayoutOpInput,
    })

    // A later drop moves the Node that is already there.
    const saved = layoutWith([{ id: epicNodeId('b'), x: 40, y: 25 }])
    const placed = buildEpicNodes(id, '/repo', model(tickets), saved, {}).find((n) => n.id === epicNodeId('b'))!
    expect(placed.position).toEqual({ x: auto.x + 40, y: auto.y + 25 })
    epicSource.moved({ projectId: id, layout: saved }, { ...placed, position: { x: placed.position.x - 10, y: placed.position.y + 5 } })
    await vi.waitFor(() => expect(applied).toHaveLength(2))
    expect(applied[1]).toEqual({ projectId: id, op: { op: 'move', id: epicNodeId('b'), x: 30, y: 30 } })
  })

  it('does not let a Ticket be dragged, and saves nothing for one that is dropped anyway', async () => {
    const id = freshProject()
    const saved = layoutWith([{ id: epicNodeId('a') }])
    const nodes = buildEpicNodes(id, '/repo', model([ticket('a', 1), ticket('a', 2, { blockedNums: [1] })], ['a']), saved, {})
    const two = nodes.find((n) => n.id === ticketNodeId('a', 2))!
    expect(two.draggable).toBe(false)
    // Still selectable: Ticket 05 of worfy-week shows a selected Ticket's chain.
    expect(two.selectable).not.toBe(false)
    // The frame is dragged by its header.
    expect(nodes[0]!.draggable).not.toBe(false)
    expect(nodes[0]!.dragHandle).toBe('.w-epic__drag')
    // Dropped anyway: the source keeps no place for it, so the Canvas puts it back (Canvas.tsx).
    expect(epicSource.moved({ projectId: id, layout: saved }, { ...two, position: { x: two.position.x + 7, y: two.position.y - 3 } })).toBe(false)
    await new Promise((wake) => setTimeout(wake, 10))
    expect(applied).toEqual([])
  })
})

describe('blocking edges', () => {
  const layoutNodes = (nodes: ReturnType<typeof buildEpicNodes>) => nodes.map((n) => n.data.node)

  it('draws one arrow per blocker from the blocker to the blocked Ticket, dashed while the blocker is not done', () => {
    const tickets = [
      ticket('a', 1, { state: 'done' }),
      ticket('a', 2, { blockedNums: [1] }),
      ticket('a', 3, { blockedNums: [1, 2, 2] }),
      ticket('b', 1, { blockedNums: [2] }),
    ]
    const nodes = buildEpicNodes(freshProject(), '/repo', model(tickets), layoutWith(), { [`x|a`]: false })
    // The done stack is folded: 01 is not on the Canvas, so no arrow starts at it.
    const folded = blockingEdges(layoutNodes(nodes))
    expect(folded.map((e) => [e.source, e.target, e.className])).toEqual([[ticketNodeId('a', 2), ticketNodeId('a', 3), 'w-edge-blocking w-edge-blocking--waits']])

    const id = freshProject()
    const open = blockingEdges(layoutNodes(buildEpicNodes(id, '/repo', model(tickets), layoutWith(), { [`${id}|a`]: true })))
    expect(open.map((e) => e.id).sort()).toEqual(['blocks:a/1->2', 'blocks:a/1->3', 'blocks:a/2->3'])
    expect(open.find((e) => e.id === 'blocks:a/1->2')?.className).toContain('--done')
    expect(open.every((e) => e.markerEnd !== undefined)).toBe(true)
  })

  it('ignores Nodes that are not Tickets', () => {
    expect(blockingEdges(layoutWith([{ id: 'n', kind: 'note', data: { ticket: { blockedNums: [1] } } }]).nodes)).toEqual([])
  })
})

describe('the Epic node source and the Nodes on the plane (ADR-0032)', () => {
  const ORCHESTRATOR = { id: 'o', kind: 'orchestrator', x: 40, y: 40, w: 360, h: 200 }

  it('puts the frames right of the Layout Nodes on the plane and of the Nodes other sources publish', () => {
    const tickets = model([ticket('a', 1)], ['a'])
    expect(buildEpicNodes(freshProject(), '/repo', tickets, layoutWith([ORCHESTRATOR]), {})[0]!.position).toEqual({ x: 40 + 360 + 48, y: 0 })
    // Hidden and pinned Nodes take no room on the plane.
    expect(buildEpicNodes(freshProject(), '/repo', tickets, layoutWith([{ ...ORCHESTRATOR, hidden: true }]), {})[0]!.position).toEqual({ x: 0, y: 0 })
    expect(buildEpicNodes(freshProject(), '/repo', tickets, layoutWith([{ ...ORCHESTRATOR, pinned: true }]), {})[0]!.position).toEqual({ x: 0, y: 0 })
    // A Subagent Node right of the Orchestrator, where the column would start.
    const subagent = { x: 456, y: 58, w: 260, h: 84 }
    expect(buildEpicNodes(freshProject(), '/repo', tickets, layoutWith([ORCHESTRATOR]), {}, [subagent])[0]!.position).toEqual({ x: 456 + 260 + 48, y: 0 })
  })

  it('keeps room for the open done stack, so opening it does not move the frame', () => {
    const done = { state: 'done' as const, statusRaw: 'done' }
    const tickets = model([ticket('a', 1, done), ticket('a', 2, done), ticket('a', 3, done), ticket('a', 4)], ['a'])
    // Below the folded frame (268 tall) and its gap, above the bottom of the open one (612 tall).
    const between = { id: 'n', kind: 'note', x: 100, y: 400, w: 50, h: 50 }
    const id = freshProject()
    const folded = buildEpicNodes(id, '/repo', tickets, layoutWith([between]), {})[0]!
    const open = buildEpicNodes(id, '/repo', tickets, layoutWith([between]), { [`${id}|a`]: true })[0]!
    expect(open.height).toBeGreaterThan(between.y + between.h)
    expect(folded.height! + 48).toBeLessThan(between.y)
    expect(folded.position).toEqual({ x: 100 + 50 + 48, y: 0 })
    expect(open.position).toEqual(folded.position)
  })
})

// ── ELK, Ready chips and routed Edges (ADR-0037) ────────────────────────────

describe('the Epic node source and ELK in a worker (ADR-0037)', () => {
  afterEach(() => setElkEngine(null))

  // By number, 02 → 04, 03 → 05 and 01 → 06 cross; ELK orders Level 2 differently.
  const six = [
    ticket('a', 1),
    ticket('a', 2),
    ticket('a', 3),
    ticket('a', 4, { blockedNums: [2], blockedRaw: '2' }),
    ticket('a', 5, { blockedNums: [3], blockedRaw: '3' }),
    ticket('a', 6, { blockedNums: [1], blockedRaw: '1' }),
  ]
  const markDone = (tickets: Ticket[], num: number) => tickets.map((t) => (t.num === num ? { ...t, state: 'done' as const, statusRaw: 'done' } : t))
  /** Where each drawn Ticket is, relative to its frame. */
  const places = (nodes: ReturnType<typeof buildEpicNodes>) => Object.fromEntries(nodes.filter((n) => n.type === 'ticket').map((n) => [n.id, n.position]))
  const elkPlaces = async (tickets: Ticket[]) =>
    Object.fromEntries((await layoutEpicElk({ tickets, doneExpanded: false, name: 'a' }, new ELK())).tickets.map((t) => [ticketNodeId('a', t.num), { x: t.x, y: t.y }]))

  it('shows the synchronous places until the first answer, the last answer’s places while a newer request is out, and drops a stale answer', async () => {
    const real = new ELK()
    // ELK that answers only when the test lets it.
    const held: (() => void)[] = []
    const slow: ElkEngine = { layout: (graph) => new Promise((resolve, reject) => held.push(() => void real.layout(graph).then(resolve, reject))) }
    setElkEngine(slow)
    const id = freshProject()
    const build = (tickets: Ticket[]) => buildEpicNodes(id, '/repo', model(tickets, ['a']), layoutWith(), {}, [], useElkAnswers.getState()[id])
    const answered = (count: number) => vi.waitFor(() => expect(Object.keys(useElkAnswers.getState()[id] ?? {}).length === count && useElkAnswers.getState()[id]!.a!.key).toBeTruthy())

    // Before any answer: the synchronous layout, Tickets by number.
    const sync = places(build(six))
    expect(sync).toEqual(Object.fromEntries(layoutEpic({ tickets: six, collapsed: false, doneExpanded: false }).tickets.map((t) => [ticketNodeId('a', t.num), { x: t.x, y: t.y }])))
    requestEpicLayouts(id)
    // Nothing is done: one layout, with the done stack folded.
    expect(held).toHaveLength(1)
    // The same inputs are not asked again.
    requestEpicLayouts(id)
    expect(held).toHaveLength(1)
    expect(places(build(six))).toEqual(sync)
    held.shift()!()
    await answered(1)
    const first = places(build(six))
    expect(first).toEqual(await elkPlaces(six))
    expect(first).not.toEqual(sync)

    // 01 is done: until the answer, every Ticket keeps the first answer's place, 01 included.
    const after = markDone(six, 1)
    expect(places(build(after))).toEqual(first)
    requestEpicLayouts(id)
    // A done Ticket: the folded and the open stack are asked for together.
    expect(held).toHaveLength(2)
    const stale = useElkAnswers.getState()[id]!.a
    // 02 is done too before ELK answered: a newer request replaces the one for `after`.
    const later = markDone(after, 2)
    expect(places(build(later))).toEqual(first)
    requestEpicLayouts(id)
    expect(held).toHaveLength(4)

    // The answer for `after` comes first and is dropped: still the first answer's places.
    held.shift()!()
    held.shift()!()
    await new Promise((wake) => setTimeout(wake, 50))
    expect(useElkAnswers.getState()[id]!.a).toBe(stale)
    expect(places(build(later))).toEqual(first)

    // The answer for `later` replaces the places at once.
    held.shift()!()
    held.shift()!()
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]!.a).not.toBe(stale))
    const final = places(build(later))
    expect(final).toEqual(await elkPlaces(later))
    expect(final).not.toEqual(first)
  })

  it('gives every blocking Edge the route ELK made for it, drawn by the routed Edge type', async () => {
    setElkEngine(new ELK())
    const id = freshProject()
    buildEpicNodes(id, '/repo', model(six, ['a']), layoutWith(), {})
    requestEpicLayouts(id)
    await vi.waitFor(() => expect(useElkAnswers.getState()[id]?.a).toBeDefined())
    const answer = useElkAnswers.getState()[id]!.a!
    const edges = blockingEdges(buildEpicNodes(id, '/repo', model(six, ['a']), layoutWith(), {}, [], useElkAnswers.getState()[id]).map((n) => n.data.node))
    expect(edges.map((e) => e.id).sort()).toEqual(['blocks:a/1->6', 'blocks:a/2->4', 'blocks:a/3->5'])
    for (const edge of edges) {
      expect(edge.type).toBe('routed')
      const { blocker, blocked, route } = edge.data as { blocker: number; blocked: number; route: unknown }
      expect(route).toEqual(answer.folded.routes[`${blocker}->${blocked}`])
    }
    // Before ELK's answer an Edge has no route: drawn between the handles.
    const before = blockingEdges(buildEpicNodes(freshProject(), '/repo', model(six, ['a']), layoutWith(), {}).map((n) => n.data.node))
    expect(before.every((e) => e.type === 'routed' && (e.data as { route?: unknown }).route === undefined)).toBe(true)
  })

  it('asks nothing for a collapsed frame', () => {
    const held: unknown[] = []
    setElkEngine({ layout: (graph) => (held.push(graph), new Promise(() => undefined)) })
    const id = freshProject()
    buildEpicNodes(id, '/repo', model(six, ['a']), layoutWith([{ id: epicNodeId('a'), data: { collapsed: true } }]), {})
    requestEpicLayouts(id)
    expect(held).toEqual([])
  })
})

describe('ready Tickets', () => {
  const tickets = [ticket('a', 1), ticket('a', 2), ticket('a', 3, { blockedNums: [1], blockedRaw: '1' })]

  it('marks each ready Ticket with a "Ready" chip, and the frame has no ready-Wave box, only its "Ready wave · N" chip', () => {
    const nodes = buildEpicNodes(freshProject(), '/repo', model(tickets, ['a']), layoutWith(), {})
    const props = (node: (typeof nodes)[number]) => ({ id: node.id, data: node.data, selected: false }) as unknown as CanvasNodeProps
    for (const node of nodes.filter((n) => n.type === 'ticket')) {
      const { unmount } = render(
        <ReactFlowProvider>
          <TicketNode {...props(node)} />
        </ReactFlowProvider>,
      )
      const ready = (node.data.node.data as TicketNodeData).placed.ready
      expect(screen.getByTestId('ticket-node').getAttribute('data-ready')).toBe(ready ? 'true' : null)
      expect(screen.queryByTestId('ticket-ready')?.textContent ?? null).toBe(ready ? 'Ready' : null)
      unmount()
    }
    expect(nodes.filter((n) => n.type === 'ticket' && (n.data.node.data as TicketNodeData).placed.ready).map((n) => n.id)).toEqual([ticketNodeId('a', 1), ticketNodeId('a', 2)])

    render(
      <ReactFlowProvider>
        <EpicFrameNode {...props(nodes[0]!)} />
      </ReactFlowProvider>,
    )
    expect(screen.queryByTestId('ready-wave')).toBeNull()
    expect(screen.getByText(/Ready wave ·/).textContent).toBe('Ready wave · 2')
  })
})

describe('edge types', () => {
  it('finds each edge type by its file and refuses a module without a component or a kind', () => {
    expect(Object.keys(edgeTypes)).toContain('routed')
    const Dummy = () => null
    expect(collectEdgeTypes({ './edge-types/AEdge.tsx': { kind: 'a', default: Dummy } })).toEqual({ a: Dummy })
    expect(() => collectEdgeTypes({ './edge-types/AEdge.tsx': { kind: 'a' } })).toThrow(/must default-export/)
    expect(() => collectEdgeTypes({ './edge-types/AEdge.tsx': { kind: 'Not A Kind', default: Dummy } })).toThrow(/must export a `kind`/)
    expect(() => collectEdgeTypes({ './edge-types/AEdge.tsx': { kind: 'a', default: Dummy }, './edge-types/BEdge.tsx': { kind: 'a', default: Dummy } })).toThrow(/both declare edge kind 'a'/)
  })

  it('draws a route moved to where the source handle is, with rounded corners; without a route, a curve between the handles', () => {
    const route = [
      { x: 220, y: 172 },
      { x: 236, y: 172 },
      { x: 236, y: 344 },
      { x: 244, y: 344 },
    ]
    const edgeProps = (data: Record<string, unknown>) =>
      ({ id: 'e', source: 's', target: 't', sourceX: 1220, sourceY: 1172, targetX: 1244, targetY: 1344, sourcePosition: 'right', targetPosition: 'left', data, markerEnd: 'url(#m)' }) as unknown as EdgeProps
    const { container } = render(
      <svg>
        <RoutedEdge {...edgeProps({ route })} />
      </svg>,
    )
    const path = container.querySelector('path.react-flow__edge-path')!
    expect(path.getAttribute('data-routed')).toBe('true')
    // The frame is at (1000, 1000): the route is shifted by it, as a dragged frame's would be.
    expect(path.getAttribute('d')).toBe(orthogonalPath(route.map((p) => ({ x: p.x + 1000, y: p.y + 1000 }))))
    expect(path.getAttribute('d')).toContain('Q')
    expect(path.getAttribute('marker-end')).toBe('url(#m)')

    const { container: plain } = render(
      <svg>
        <RoutedEdge {...edgeProps({})} />
      </svg>,
    )
    expect(plain.querySelector('path.react-flow__edge-path')!.getAttribute('data-routed')).toBe('false')
  })

  it('keeps the last segment straight when the handle is a little off the route’s end', () => {
    const moved = placeRoute(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 50 },
        { x: 30, y: 50 },
      ],
      { x: 100, y: 100 },
      { x: 127, y: 152 },
    )
    expect(moved).toEqual([
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 152 },
      { x: 127, y: 152 },
    ])
    // Two points whose ends no longer line up get an elbow, not a slant.
    expect(placeRoute([{ x: 0, y: 0 }, { x: 20, y: 0 }], { x: 0, y: 0 }, { x: 20, y: 4 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 20, y: 4 },
    ])
  })
})
