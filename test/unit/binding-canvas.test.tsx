// Bindings on the Canvas and in the Session rail (ticket 16): the anchors the lines start and end at
// (canvas/sources/workflow-bindings.ts), the lines (edges/bindings.ts), the drop targets of a
// manual Binding (binding/drop.ts), the Bindings of every agent (binding/store.ts) and the rail's
// block (session/rail/BindingRail.tsx).
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { agentOfNode, dropTargetAt, type DropCandidate } from '../../src/renderer/binding/drop'
import { bindingTargetTitle, launchOf, manualOf, resolveAgentBindings } from '../../src/renderer/binding/store'
import bindingEdges from '../../src/renderer/canvas/edges/bindings'
import { TICKET_WIDTH } from '../../src/renderer/canvas/epic-layout'
import type { CanvasFlowNode } from '../../src/renderer/canvas/nodes/index'
import { agentAnchorId, buildBindingAnchors, epicAnchorId, ticketAnchorId } from '../../src/renderer/canvas/sources/workflow-bindings'
import { BindingCard } from '../../src/renderer/session/rail/BindingRail'
import { EMPTY_AGENT_SIGNALS, type Binding, type BindingWorkflow } from '../../src/shared/binding/resolve'
import type { ManualBinding, SessionBindingSignals } from '../../src/shared/ipc/bindings'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import type { WorkflowModel } from '../../src/shared/workflow/types'

const PROJECT = 'demo-0000000d'
const node = (id: string, kind: string, data: Record<string, unknown> = {}, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  kind,
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data,
  ...extra,
})
const layout = (nodes: LayoutNode[]): Layout => ({ nodes, viewport: { x: 0, y: 0, zoom: 1 } })

const claim7: Binding = { target: { kind: 'ticket', epic: 'e', num: 7 }, source: 'claim', detail: 'ticket claim e 07' }
const wave: Binding = { target: { kind: 'epic', epic: 'e' }, source: 'skill', detail: '/epic-wave e' }
const task12: Binding = { target: { kind: 'ticket', epic: 'e', num: 12 }, source: 'task', detail: null }

describe('buildBindingAnchors and bindingEdges', () => {
  const sessions = layout([
    node('session:s1', 'session', { sessionId: 's1' }),
    node('orchestrator', 'orchestrator', { sessionId: 's2' }),
    node('session:s3', 'session', { sessionId: 's3' }, { pinned: true }),
    node('note', 'note', { text: '' }),
  ])
  const bindings = new Map([
    ['s1', claim7],
    ['s2', wave],
    ['s2/a1', task12],
    ['s3', claim7],
  ])

  it('anchors a line at each bound agent and at its Ticket, or at the frame when the Ticket is not shown', () => {
    const nodes = buildBindingAnchors({
      projectId: PROJECT,
      layout: sessions,
      bindings,
      epics: new Set(['e']),
      tickets: new Set(['ticket:e/7']),
      subagents: [{ nodeId: 'subagent:s2/toolu_1', sessionId: 's2', agentId: 'a1' }],
    })
    const byId = new Map(nodes.map((each) => [each.id, each]))
    // Targets come before the agents; a pinned Session gets no line.
    expect(nodes.map((each) => each.id)).toEqual([
      epicAnchorId('e'),
      ticketAnchorId('e', 7),
      agentAnchorId('session:s1'),
      agentAnchorId('orchestrator'),
      agentAnchorId('subagent:s2/toolu_1'),
    ])
    expect(byId.get(ticketAnchorId('e', 7))).toMatchObject({ parentId: 'ticket:e/7', position: { x: TICKET_WIDTH, y: 18 }, selectable: false, draggable: false })
    expect(byId.get(epicAnchorId('e'))).toMatchObject({ parentId: 'epic:e', position: { x: 24, y: 0 } })
    expect(byId.get(agentAnchorId('session:s1'))?.data.node.data).toMatchObject({ variant: 'agent', targetId: ticketAnchorId('e', 7), binding: claim7, agentId: null })
    expect(byId.get(agentAnchorId('orchestrator'))?.data.node.data).toMatchObject({ targetId: epicAnchorId('e') })
    // Ticket 12 is folded away: the Subagent's line ends at the frame.
    expect(byId.get(agentAnchorId('subagent:s2/toolu_1'))).toMatchObject({ parentId: 'subagent:s2/toolu_1', data: { node: { data: { targetId: epicAnchorId('e'), agentId: 'a1' } } } })

    const edges = bindingEdges(nodes.map((each) => each.data.node))
    expect(edges.map(({ id, source, target, ariaLabel }) => ({ id, source, target, ariaLabel }))).toEqual([
      { id: 'binding:session:s1', source: agentAnchorId('session:s1'), target: ticketAnchorId('e', 7), ariaLabel: 'bound to e/07 · ticket claim' },
      { id: 'binding:orchestrator', source: agentAnchorId('orchestrator'), target: epicAnchorId('e'), ariaLabel: 'bound to e · /epic-wave' },
      { id: 'binding:subagent:s2/toolu_1', source: agentAnchorId('subagent:s2/toolu_1'), target: epicAnchorId('e'), ariaLabel: 'bound to e/12 · task' },
    ])
    expect(edges[0]).toMatchObject({ selectable: false, deletable: false, style: { strokeDasharray: '5 4' }, className: 'w-edge-binding' })
  })

  it('draws nothing to an Epic the Canvas has no frame for, and no line whose end is missing', () => {
    expect(buildBindingAnchors({ projectId: PROJECT, layout: sessions, bindings, epics: new Set(), tickets: new Set(), subagents: [] })).toEqual([])
    const nodes = buildBindingAnchors({ projectId: PROJECT, layout: sessions, bindings: new Map([['s1', { ...claim7, source: 'manual' as const }]]), epics: new Set(['e']), tickets: new Set(['ticket:e/7']), subagents: [] })
    const layoutNodes = nodes.map((each) => each.data.node)
    expect(bindingEdges(layoutNodes)[0]?.className).toBe('w-edge-binding w-edge-binding--manual')
    expect(bindingEdges(layoutNodes.filter((each) => each.id !== ticketAnchorId('e', 7)))).toEqual([])
    expect(bindingEdges([node('session:s1', 'session', { sessionId: 's1' })])).toEqual([])
  })
})

describe('resolveAgentBindings', () => {
  const workflow: BindingWorkflow = { epics: ['e'], tickets: [7, 12, 16].map((num) => ({ epic: 'e', num, state: 'open' })) }
  const signals = new Map<string, SessionBindingSignals>([
    [
      's1',
      {
        found: true,
        session: { ...EMPTY_AGENT_SIGNALS, skill: { name: 'epic-wave', args: 'e' } },
        subagents: [
          { agentId: 'a1', signals: { ...EMPTY_AGENT_SIGNALS, task: { epic: 'e', num: 16 } } },
          { agentId: 'a2', signals: EMPTY_AGENT_SIGNALS },
        ],
      },
    ],
  ])

  it('binds the Session, each Subagent with a signal, and each Subagent bound by hand; the manual Binding wins', () => {
    const manual: ManualBinding[] = [
      { sessionId: 's1', agentId: 'a1', target: { kind: 'ticket', epic: 'e', num: 12 } },
      { sessionId: 's1', agentId: 'a9', target: { kind: 'ticket', epic: 'e', num: 7 } },
      { sessionId: 'other', agentId: null, target: { kind: 'epic', epic: 'e' } },
    ]
    const result = resolveAgentBindings({ sessionIds: ['s1'], signals, manual, workflow })
    expect(Object.fromEntries(result)).toEqual({
      s1: { target: { kind: 'epic', epic: 'e' }, source: 'skill', detail: '/epic-wave e' },
      's1/a1': { target: { kind: 'ticket', epic: 'e', num: 12 }, source: 'manual', detail: null },
      's1/a9': { target: { kind: 'ticket', epic: 'e', num: 7 }, source: 'manual', detail: null },
    })
    expect(Object.fromEntries(resolveAgentBindings({ sessionIds: ['s1'], signals, manual: [], workflow }))['s1/a1']).toMatchObject({ source: 'task' })
  })

  it('a launch Binding (ticket 23) binds its Session over the signals, under the manual one; it is not a manual Binding', () => {
    const launch: ManualBinding = { sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 7 }, source: 'launch' }
    expect(resolveAgentBindings({ sessionIds: ['s1', 's2'], signals, manual: [launch, { ...launch, sessionId: 's2' }], workflow }).get('s1')).toEqual({ target: launch.target, source: 'launch', detail: null })
    expect(resolveAgentBindings({ sessionIds: ['s2'], signals, manual: [{ ...launch, sessionId: 's2' }], workflow }).get('s2')).toMatchObject({ source: 'launch' })
    const byHand: ManualBinding = { sessionId: 's1', agentId: null, target: { kind: 'ticket', epic: 'e', num: 12 } }
    expect(resolveAgentBindings({ sessionIds: ['s1'], signals, manual: [launch, byHand], workflow }).get('s1')).toEqual({ target: byHand.target, source: 'manual', detail: null })
    expect(manualOf([launch], { sessionId: 's1', agentId: null })).toBeUndefined()
    expect(manualOf([launch, byHand], { sessionId: 's1', agentId: null })).toBe(byHand)
    expect(launchOf([launch, byHand], { sessionId: 's1', agentId: null })).toBe(launch)
  })
})

describe('drop targets', () => {
  const ticket: DropCandidate = { kind: 'ticket', target: { kind: 'ticket', epic: 'e', num: 7 }, rect: { x: 20, y: 60, w: 200, h: 100 } }
  const frame: DropCandidate = { kind: 'epic', target: { kind: 'epic', epic: 'e' }, rect: { x: 0, y: 0, w: 600, h: 400 } }

  it('prefers a Ticket to the frame around it, takes the frame elsewhere inside it, nothing outside', () => {
    expect(dropTargetAt({ x: 100, y: 100 }, [frame, ticket])).toBe(ticket)
    expect(dropTargetAt({ x: 400, y: 300 }, [frame, ticket])).toBe(frame)
    expect(dropTargetAt({ x: 700, y: 100 }, [frame, ticket])).toBeNull()
  })

  it('knows which Nodes show an agent', () => {
    const flow = (type: string, data: Record<string, unknown>, kind = type) => ({ type, data: { node: node('n', kind, data) } }) as Pick<CanvasFlowNode, 'type' | 'data'>
    expect(agentOfNode(flow('session', { sessionId: 's1' }))).toMatchObject({ agent: { sessionId: 's1', agentId: null }, subagent: null })
    expect(agentOfNode(flow('orchestrator', { sessionId: 's2' }))?.agent).toEqual({ sessionId: 's2', agentId: null })
    expect(agentOfNode(flow('subagent', { variant: 'agent', sessionId: 's2', agent: { agentId: 'a1' } }))?.agent).toEqual({ sessionId: 's2', agentId: 'a1' })
    expect(agentOfNode(flow('subagent', { variant: 'fold', sessionId: 's2', agent: null }))).toBeNull()
    expect(agentOfNode(flow('subagent', { variant: 'agent', sessionId: 's2', agent: { agentId: null } }))).toBeNull()
    expect(agentOfNode(flow('note', { text: '' }))).toBeNull()
    expect(agentOfNode(flow('orchestrator', { sessionId: null }))).toBeNull()
    expect(agentOfNode(flow('binding-anchor', { sessionId: 's1' }))).toBeNull()
  })
})

describe('BindingCard', () => {
  it('shows the target, its kind and title and why; "Remove binding" only for a manual Binding', () => {
    const onRemove = vi.fn()
    const { rerender } = render(<BindingCard binding={{ target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 }, source: 'branch', detail: 'worfy-mvp/07' }} title="07 — Движок" onRemove={onRemove} />)
    expect(screen.getByTestId('binding-target').textContent).toBe('worfy-mvp/07')
    expect(screen.getByText('Ticket')).toBeTruthy()
    expect(screen.getByText('07 — Движок')).toBeTruthy()
    expect(screen.getByTestId('binding-reason').textContent).toBe('branch worfy-mvp/07')
    expect(screen.queryByTestId('binding-remove')).toBeNull()

    rerender(<BindingCard binding={{ target: { kind: 'epic', epic: 'worfy-mvp' }, source: 'manual', detail: null }} title={null} onRemove={onRemove} />)
    expect(screen.getByText('Epic')).toBeTruthy()
    expect(screen.getByTestId('binding-reason').textContent).toBe('manual')
    fireEvent.click(screen.getByTestId('binding-remove'))
    expect(onRemove).toHaveBeenCalledOnce()

    rerender(<BindingCard binding={null} title={null} />)
    expect(screen.getByTestId('binding-none').textContent).toContain('Not bound')
  })

  it('takes the title from the workflow model', () => {
    const model = {
      epics: [{ epic: 'e', title: 'Epic E' }],
      tickets: [{ epic: 'e', num: 7, title: '07 — Seven' }],
    } as unknown as WorkflowModel
    expect(bindingTargetTitle(claim7, model)).toBe('07 — Seven')
    expect(bindingTargetTitle(wave, model)).toBe('Epic E')
    expect(bindingTargetTitle(task12, model)).toBeNull()
    expect(bindingTargetTitle(claim7, undefined)).toBeNull()
    expect(bindingTargetTitle(null, model)).toBeNull()
  })
})
