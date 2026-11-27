// A Ticket Node and an Epic frame draw again only when their data changes (worfy-week ticket 14):
// dragging a frame gives each of its Tickets a new place on every mouse move, and redrawing them
// all, with the Run wave and Autopilot buttons in their action slots, froze a large Canvas. The
// action slot here holds a component that counts how often its Node drew it.
import { act, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import type { Layout } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import type { SlotProps } from '../../src/renderer/canvas/badges'
import EpicFrameNode from '../../src/renderer/canvas/nodes/EpicFrameNode'
import TicketNode from '../../src/renderer/canvas/nodes/TicketNode'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { buildEpicNodes, epicNodeId, ticketNodeId, type TicketNodeData } from '../../src/renderer/canvas/sources/epics'

const drawn = vi.hoisted(() => ({ ticket: 0, epic: 0 }))

vi.mock('../../src/renderer/canvas/badges', () => ({
  badges: [],
  actions: [
    {
      id: 'count',
      order: 0,
      Component: ({ subject }: SlotProps) => {
        if (subject.kind === 'ticket' || subject.kind === 'epic') drawn[subject.kind] += 1
        return null
      },
    },
  ],
}))

function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'a',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
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

const model = (tickets: Ticket[]): WorkflowModel => ({ root: '/repo', epics: [{ epic: 'a', hasSpec: true, hasMap: false, title: 'a title' }], tickets, error: null, branchErrors: [] })
const emptyLayout: Layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }

/** The frame and the Tickets of Epic a, as the Epic node source builds them. */
const nodesOf = (tickets: Ticket[]): readonly CanvasFlowNode[] => buildEpicNodes('memo-0000000a', '/repo', model(tickets), emptyLayout, {})
const nodeOf = (tickets: Ticket[], id: string): CanvasFlowNode => {
  const found = nodesOf(tickets).find((node) => node.id === id)
  if (found === undefined) throw new Error(`no Node ${id}`)
  return found
}

/** The props React Flow hands a Node component, at a place on the Canvas. */
function propsOf(node: CanvasFlowNode, at: { x: number; y: number; selected?: boolean; dragging?: boolean }): CanvasNodeProps {
  return {
    id: node.id,
    type: node.type,
    data: node.data,
    selected: at.selected ?? false,
    dragging: at.dragging ?? false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: at.x,
    positionAbsoluteY: at.y,
    draggable: true,
    selectable: true,
    deletable: false,
  } as unknown as CanvasNodeProps
}

const inFlow = (element: ReactElement) => <ReactFlowProvider>{element}</ReactFlowProvider>

beforeEach(() => {
  drawn.ticket = 0
  drawn.epic = 0
})

describe('TicketNode and EpicFrameNode draw again only for new data', () => {
  it('a Ticket Node: a new place, selection or drag state with the same data does not draw it again; new data does', () => {
    const tickets = [ticket(1), ticket(2, { blockedNums: [1] })]
    const node = nodeOf(tickets, ticketNodeId('a', 2))
    const { rerender } = render(inFlow(<TicketNode {...propsOf(node, { x: 0, y: 0 })} />))
    expect(drawn.ticket).toBe(1)

    rerender(inFlow(<TicketNode {...propsOf(node, { x: 40, y: 25 })} />))
    rerender(inFlow(<TicketNode {...propsOf(node, { x: 80, y: 50, selected: true })} />))
    rerender(inFlow(<TicketNode {...propsOf(node, { x: 120, y: 75, selected: true, dragging: true })} />))
    expect(drawn.ticket).toBe(1)

    const claimed = nodeOf([ticket(1), ticket(2, { blockedNums: [1], state: 'work', statusRaw: 'claimed — 2026-10-07' })], ticketNodeId('a', 2))
    expect((claimed.data.node.data as TicketNodeData).ticket.state).toBe('work')
    rerender(inFlow(<TicketNode {...propsOf(claimed, { x: 120, y: 75 })} />))
    expect(drawn.ticket).toBe(2)
    expect(screen.getByTestId('ticket-node').getAttribute('data-state')).toBe('work')
  })

  it('an Epic frame: a new place, selection or drag state with the same data does not draw it again; new data does', () => {
    const node = nodeOf([ticket(1), ticket(2)], epicNodeId('a'))
    const { rerender } = render(inFlow(<EpicFrameNode {...propsOf(node, { x: 0, y: 0 })} />))
    expect(drawn.epic).toBe(1)

    rerender(inFlow(<EpicFrameNode {...propsOf(node, { x: 40, y: 25 })} />))
    rerender(inFlow(<EpicFrameNode {...propsOf(node, { x: 80, y: 50, selected: true })} />))
    rerender(inFlow(<EpicFrameNode {...propsOf(node, { x: 120, y: 75, selected: true, dragging: true })} />))
    expect(drawn.epic).toBe(1)

    const grown = nodeOf([ticket(1), ticket(2), ticket(3, { state: 'done', statusRaw: 'done' })], epicNodeId('a'))
    rerender(inFlow(<EpicFrameNode {...propsOf(grown, { x: 120, y: 75 })} />))
    expect(drawn.epic).toBe(2)
    expect(screen.getByTestId('epic-progress').textContent).toBe('1/3')
  })
})

// ── answers that come after the first frame (worfy-polish 152) ──────────────
// On the macOS runner the start of a 682-Ticket Project drew every card on screen three times: once with the
// workflow, again when the Pipeline came, and again when the Project's repositories came. Each time every card drew
// all of its badges and actions again, and the Nodes were new objects although no card changed its place or height.

const PIPELINE: PipelineColumn[] = [
  { kind: 'queued', id: 'queued', title: 'Queued' },
  { kind: 'implementing', id: 'implementing', title: 'Implementing' },
  { kind: 'done', id: 'done', title: 'Done' },
]

function onStage(num: number): PipelineTicket {
  return { epic: 'a', num, stage: 'implementing', index: 1, kind: 'implementing', passed: ['queued'], skipped: [], blocked: null, rework: false, sub: null, waits: 'agent', enteredAt: null, statusAt: null }
}

/** A bridge whose `pipeline.get` and `checks.repos` answer when the test says so. */
function lateBridge(): { pipeline: (snapshot: PipelineSnapshot) => void; repos: () => void } {
  let pipeline!: (value: unknown) => void
  let repos!: (value: unknown) => void
  const pipelineAnswer = new Promise((done) => (pipeline = done))
  const reposAnswer = new Promise((done) => (repos = done))
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
      if (channel === 'pipeline.get') return pipelineAnswer
      if (channel === 'checks.repos') return reposAnswer
      return Promise.resolve({ ok: false, error: 'not in this test' })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  return {
    pipeline: (snapshot) => pipeline({ ok: true, value: snapshot }),
    repos: () => repos({ ok: true, value: { mode: 'full', repos: [{ name: 'repo', path: '/repo' }] } }),
  }
}

describe('answers that come after the first frame do not draw the cards again for nothing (worfy-polish 152)', () => {
  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  it("the Pipeline and the Project's repositories coming draw the card's stepper, not its badges and actions again", async () => {
    const late = lateBridge()
    const node = nodeOf([ticket(1, { state: 'work', statusRaw: 'claimed 2026-11-27T09:00Z' })], ticketNodeId('a', 1))
    render(inFlow(<TicketNode {...propsOf(node, { x: 0, y: 0 })} />))
    expect(drawn.ticket).toBe(1)

    await act(async () => late.repos())
    await act(async () => late.pipeline({ root: '/repo', pipeline: PIPELINE, tickets: [onStage(1)], error: null }))
    expect(screen.getByTestId('ticket-stepper').dataset.stage).toBe('implementing')
    expect(drawn.ticket).toBe(1)
  })

  it('a new card context that changes no height keeps every Node object: React Flow draws nothing again', () => {
    const tickets = [ticket(1), ticket(2, { blockedNums: [1] }), ticket(3, { state: 'done', statusRaw: 'done' })]
    const projectId = 'memo-0000000b'
    // The same workflow model: only the context of the cards is new, as when main answers checks.repos.
    const read = model(tickets)
    const first = buildEpicNodes(projectId, '/repo', read, emptyLayout, {}, [], {}, undefined)
    const known = buildEpicNodes(projectId, '/repo', read, emptyLayout, {}, [], {}, { severalRepos: false, repoNames: ['repo'], reviewChips: {}, sideEffects: {} })
    expect(known).toBe(first)
  })
})
