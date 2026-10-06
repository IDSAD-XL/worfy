// The pieces between the workflow model and the Canvas: the delta applied in the renderer, the
// Epic node source (what it builds and what it keeps from the Layout), and the blocking arrows.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout, LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import blockingEdges from '../../src/renderer/canvas/edges/blocking'
import epicSource, { buildEpicNodes, epicNodeId, ticketNodeId, type EpicFrameData, type TicketNodeData } from '../../src/renderer/canvas/sources/epics'
import { applyWorkflowDelta } from '../../src/renderer/workflow/useWorkflow'
import { headerWidth, MIN_FRAME_WIDTH } from '../../src/renderer/canvas/epic-layout'

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

  it('reads the frame offset, collapsed flag and Ticket offsets from the Epic’s Layout Node', () => {
    const id = freshProject()
    const saved = layoutWith([{ id: epicNodeId('a'), x: 30, y: -20, data: { 'offset:2': { dx: 15, dy: 25 }, 'offset:x': { dx: 1, dy: 1 }, 'offset:1': 'junk' } }])
    const tickets = [ticket('a', 1), ticket('a', 2)]
    const plain = buildEpicNodes(id, '/repo', model(tickets, ['a']), layoutWith(), {})
    const moved = buildEpicNodes(id, '/repo', model(tickets, ['a']), saved, {})
    expect(moved[0]!.position).toEqual({ x: 30, y: -20 })
    expect((moved[0]!.data.node.data as EpicFrameData).auto).toEqual({ x: 0, y: 0 })
    expect(moved[0]!.data.node.data.saved).toBe(true)
    expect(moved[2]!.position).toEqual({ x: plain[2]!.position.x + 15, y: plain[2]!.position.y + 25 })
    // A malformed entry is ignored, not a crash.
    expect(moved[1]!.position).toEqual(plain[1]!.position)

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

  it('saves a dropped Ticket’s offset from its automatic place in the Epic’s Node', async () => {
    const id = freshProject()
    const saved = layoutWith([{ id: epicNodeId('a') }])
    const nodes = buildEpicNodes(id, '/repo', model([ticket('a', 1), ticket('a', 2, { blockedNums: [1] })], ['a']), saved, {})
    const two = nodes.find((n) => n.id === ticketNodeId('a', 2))!
    const auto = (two.data.node.data as TicketNodeData).placed.auto
    expect(auto.x).toBeGreaterThan(0)
    epicSource.moved({ projectId: id, layout: saved }, { ...two, position: { x: auto.x + 7, y: auto.y - 3 } })
    await vi.waitFor(() => expect(applied).toHaveLength(1))
    expect(applied[0]).toEqual({ projectId: id, op: { op: 'patchData', id: epicNodeId('a'), data: { 'offset:2': { dx: 7, dy: -3 } } } })
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
