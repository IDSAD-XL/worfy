// Edge visibility (worfy-week ticket 05): "Blocked by" Edges are thin and pale by default, the one
// from a done blocker is not drawn, and hovering or selecting a Ticket lights up its chain — every
// Edge on a path through it, up and down. The Edges are drawn by React Flow in jsdom, with the
// overlay that watches the pointer and the selection (overlays/EdgeFocus.tsx).
import { act, fireEvent, render } from '@testing-library/react'
import { Profiler } from 'react'
import { ReactFlow, ReactFlowProvider, type Edge, type EdgeProps, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chainOf, clearEdgeFocus, setEdgeFocus, useEdgeFocus } from '../../src/renderer/canvas/edge-focus'
import RoutedEdge, { kind as ROUTED } from '../../src/renderer/canvas/edge-types/RoutedEdge'
import blockingEdges from '../../src/renderer/canvas/edges/blocking'
import EdgeFocus from '../../src/renderer/canvas/overlays/EdgeFocus'
import { TICKET_KIND, ticketNodeId } from '../../src/shared/layout/derived'
import type { LayoutNode } from '../../src/shared/layout/types'
import type { Ticket } from '../../src/shared/workflow/types'

const EPIC = 'e'

const ticketNode = (num: number, state: Ticket['state'], blockedNums: number[] = []): LayoutNode => ({
  id: ticketNodeId(EPIC, num),
  kind: TICKET_KIND,
  x: 0,
  y: 0,
  w: 100,
  h: 40,
  hidden: false,
  locked: true,
  pinned: false,
  tags: [],
  data: { ticket: { epic: EPIC, num, state, blockedNums } as unknown as Ticket },
})

/** React Flow Nodes with their handles given, so jsdom (which measures nothing) still draws the Edges. */
const flowNodes = (nodes: readonly LayoutNode[], selected: ReadonlySet<string> = new Set()): Node[] =>
  nodes.map((node, index) => ({
    id: node.id,
    type: 'plain',
    position: { x: (index % 4) * 200, y: Math.floor(index / 4) * 100 },
    width: 100,
    height: 40,
    selected: selected.has(node.id),
    data: {},
    handles: [
      { type: 'source', position: 'right', x: 100, y: 20, width: 1, height: 1 },
      { type: 'target', position: 'left', x: 0, y: 20, width: 1, height: 1 },
    ],
  })) as Node[]

const Plain = () => <div />

/** How many times each Edge's component rendered, counted by a React Profiler around it. */
let renders = new Map<string, number>()
const CountedRouted = (props: EdgeProps) => (
  <Profiler id={props.id} onRender={(id) => renders.set(id, (renders.get(id) ?? 0) + 1)}>
    <RoutedEdge {...props} />
  </Profiler>
)

function flow(nodes: readonly LayoutNode[], edges: readonly Edge[], selected?: ReadonlySet<string>) {
  return (
    <div style={{ width: 1000, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow nodes={flowNodes(nodes, selected)} edges={[...edges]} nodeTypes={{ plain: Plain }} edgeTypes={{ [ROUTED]: CountedRouted }}>
          <EdgeFocus />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

const drawn = (container: HTMLElement, id: string): Element | null => container.querySelector(`[data-testid="rf__edge-${id}"] path.react-flow__edge-path`)
const lit = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-testid^="rf__edge-"] path.react-flow__edge-path[data-focus="lit"]')].map((path) => path.getAttribute('id')!).sort()
const nodeElement = (container: HTMLElement, num: number): Element => container.querySelector(`.react-flow__node[data-id="${ticketNodeId(EPIC, num)}"]`)!
const pane = (container: HTMLElement): Element => container.querySelector('.react-flow__pane')!
const flowRoot = (container: HTMLElement): Element => container.querySelector('.react-flow')!

let hadObserver = false
beforeEach(() => {
  const globals = globalThis as { ResizeObserver?: unknown }
  hadObserver = 'ResizeObserver' in globals
  globals.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  renders = new Map()
  clearEdgeFocus()
})
afterEach(() => {
  if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

describe('the default view of "Blocked by" Edges', () => {
  // 1 is done and blocks 2; 2 is open and blocks 3.
  const epic = [ticketNode(1, 'done'), ticketNode(2, 'open', [1]), ticketNode(3, 'open', [2])]

  it('does not draw the Edge from a done blocker; the others are 1 px and pale', () => {
    const { container } = render(flow(epic, blockingEdges(epic)))
    // Both Edges are in the list; only the component decides what is drawn.
    expect(container.querySelector('[data-testid="rf__edge-blocks:e/1->2"]')).not.toBeNull()
    expect(drawn(container, 'blocks:e/1->2')).toBeNull()
    const waiting = drawn(container, 'blocks:e/2->3')
    expect(waiting).not.toBeNull()
    expect(waiting!.getAttribute('data-focus')).toBe('pale')
    expect(waiting!.classList.contains('w-edge-path--pale')).toBe(true)
    // 1 px and the pale token: the Edge's class on the wrapper, the width and colour in epic-frame.css.
    expect(waiting!.closest('.react-flow__edge')!.classList.contains('w-edge-blocking')).toBe(true)
  })
})

describe('the chain of a Ticket', () => {
  // A→B→C, D→B, C→E, F→G (an arrow: "blocks"): A=1, B=2, C=3, D=4, E=5, F=6, G=7. A is done.
  const epic = [
    ticketNode(1, 'done'),
    ticketNode(2, 'open', [1, 4]),
    ticketNode(3, 'open', [2]),
    ticketNode(4, 'open'),
    ticketNode(5, 'open', [3]),
    ticketNode(6, 'open'),
    ticketNode(7, 'open', [6]),
  ]
  const edges = blockingEdges(epic)
  const chainOfB = ['blocks:e/1->2', 'blocks:e/2->3', 'blocks:e/3->5', 'blocks:e/4->2']

  it('walks up and down from a Ticket, and stops at a cycle', () => {
    expect([...chainOf([ticketNodeId(EPIC, 2)], edges)].sort()).toEqual(chainOfB)
    expect([...chainOf([ticketNodeId(EPIC, 6)], edges)]).toEqual(['blocks:e/6->7'])
    expect([...chainOf(['note'], edges)]).toEqual([])
    const cycle = [
      { id: 'x', source: 'a', target: 'b' },
      { id: 'y', source: 'b', target: 'a' },
    ]
    expect([...chainOf(['a'], cycle)].sort()).toEqual(['x', 'y'])
  })

  it('hovering B lights A→B, D→B, B→C, C→E and leaves F→G; the done blocker’s Edge is drawn while lit; leaving restores the default', () => {
    const { container } = render(flow(epic, edges))
    expect(drawn(container, 'blocks:e/1->2')).toBeNull()

    fireEvent.pointerOver(nodeElement(container, 2))
    expect(lit(container)).toEqual(chainOfB)
    expect(drawn(container, 'blocks:e/1->2')!.getAttribute('data-focus')).toBe('lit')
    expect(drawn(container, 'blocks:e/6->7')!.getAttribute('data-focus')).toBe('pale')
    // A lit Edge points with its own arrowhead, in the lit colour.
    expect(drawn(container, 'blocks:e/2->3')!.getAttribute('marker-end')).toMatch(/^url\('#w-edge-arrow-lit-blocks_e_2-_3'\)$/)
    expect(container.querySelector('marker#w-edge-arrow-lit-blocks_e_2-_3 .w-edge-arrow--lit')).not.toBeNull()

    // The pointer leaves for the empty plane, then leaves the Canvas.
    fireEvent.pointerOver(pane(container))
    expect(lit(container)).toEqual([])
    expect(drawn(container, 'blocks:e/1->2')).toBeNull()
    fireEvent.pointerOver(nodeElement(container, 2))
    expect(lit(container)).toEqual(chainOfB)
    fireEvent.pointerLeave(flowRoot(container))
    expect(lit(container)).toEqual([])
    expect(drawn(container, 'blocks:e/1->2')).toBeNull()
    expect(drawn(container, 'blocks:e/2->3')!.getAttribute('marker-end')).toMatch(/^url\('#1__color=var\(--border-strong\)/)
  })

  it('a selected Ticket keeps its chain lit while selected; hovering another adds that one’s chain', () => {
    const selectedB = new Set([ticketNodeId(EPIC, 2)])
    const { container, rerender } = render(flow(epic, edges, selectedB))
    expect(lit(container)).toEqual(chainOfB)
    // Hovering and leaving another Ticket does not take the selected one's chain away.
    fireEvent.pointerOver(nodeElement(container, 7))
    expect(lit(container)).toEqual([...chainOfB, 'blocks:e/6->7'].sort())
    fireEvent.pointerOver(pane(container))
    expect(lit(container)).toEqual(chainOfB)
    // Unselected: back to the default.
    rerender(flow(epic, edges, new Set()))
    expect(lit(container)).toEqual([])
  })

  it('a change of hover draws again only the Edges whose state changed', () => {
    const { container } = render(flow(epic, edges))
    // Edge 1→2 is not drawn yet, but its component renders (to null).
    expect([...renders.keys()].sort()).toEqual(edges.map((edge) => edge.id).sort())
    const counted = () => new Map(renders)
    const changedSince = (before: Map<string, number>) => [...renders].filter(([id, count]) => count !== before.get(id)).map(([id]) => id).sort()

    let before = counted()
    fireEvent.pointerOver(nodeElement(container, 2))
    expect(changedSince(before)).toEqual(chainOfB)

    // C's chain is B's: nothing changes, nothing is drawn again.
    before = counted()
    fireEvent.pointerOver(nodeElement(container, 3))
    expect(lit(container)).toEqual(chainOfB)
    expect(changedSince(before)).toEqual([])

    // A's chain is B's without D→B: only D→B is drawn again.
    before = counted()
    fireEvent.pointerOver(nodeElement(container, 1))
    expect(lit(container)).toEqual(['blocks:e/1->2', 'blocks:e/2->3', 'blocks:e/3->5'])
    expect(changedSince(before)).toEqual(['blocks:e/4->2'])
  })

  it('keeps the same sets in the store when nothing changed', () => {
    setEdgeFocus([ticketNodeId(EPIC, 2)], edges)
    const first = useEdgeFocus.getState()
    act(() => setEdgeFocus([ticketNodeId(EPIC, 2)], edges))
    expect(useEdgeFocus.getState().lit).toBe(first.lit)
    expect(useEdgeFocus.getState().focused).toBe(first.focused)
  })
})
