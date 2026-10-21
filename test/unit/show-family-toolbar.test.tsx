// "Show family" inside the whole selection toolbar (src/renderer/canvas/overlays/SelectionToolbar.tsx)
// on a React Flow Canvas, with "Show only tag" on for the active Project (review of PR #680): the
// camera takes in only the Family members the filter leaves drawn. FamilySection reads the active
// Project itself; here the Project list is a stand-in, and React Flow's fitView is recorded.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEdgeFocus, setEdgeFocus } from '../../src/renderer/canvas/edge-focus'
import type { FamilyLinks } from '../../src/renderer/canvas/family'
import SelectionToolbar from '../../src/renderer/canvas/overlays/SelectionToolbar'
import { setTagFilter } from '../../src/renderer/find/canvas-requests'
import { epicNodeId, ticketNodeId } from '../../src/shared/layout/derived'
import type { LayoutNode } from '../../src/shared/layout/types'

const fitView = vi.hoisted(() => vi.fn<(options?: unknown) => Promise<boolean>>(() => Promise.resolve(true)))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return { ...actual, useReactFlow: () => ({ ...actual.useReactFlow(), fitView }) }
})
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ projects: [{ id: 'p', name: 'p', path: '/p', branch: 'main' }], activeId: 'p', revision: 1 }),
}))

const A = 'session:A'
const A1 = 'subagent:A/a1'
const links: FamilyLinks = {
  epics: ['e'],
  tickets: [{ epic: 'e', num: 1 }],
  sessions: [A],
  subagents: [{ nodeId: A1, sessionNodeId: A }],
  bindings: [{ agentNodeId: A, target: { kind: 'ticket', epic: 'e', num: 1 } }],
}

const layoutNode = (id: string, kind: string, tags: string[]): LayoutNode => ({ id, kind, x: 0, y: 0, w: 200, h: 100, hidden: false, locked: false, pinned: false, tags, data: {} })
const flowNode = (id: string, kind: string, tags: string[], x: number, selected = false): Node => ({
  id,
  position: { x, y: 0 },
  width: 200,
  height: 100,
  selected,
  data: { node: layoutNode(id, kind, tags) },
})

// React Flow observes the sizes of its Nodes; jsdom has no ResizeObserver.
let hadObserver = false
beforeEach(() => {
  const globals = globalThis as { ResizeObserver?: unknown }
  hadObserver = 'ResizeObserver' in globals
  globals.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  fitView.mockClear()
  setEdgeFocus([], [], links)
})
afterEach(() => {
  cleanup()
  clearEdgeFocus()
  setTagFilter(null)
  if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

describe('Show family in the selection toolbar, with the tag filter on', () => {
  it('fits the camera to the members the filter leaves drawn; with the filter off, to the whole Family', () => {
    const nodes = [
      flowNode(A, 'session', ['x'], 0, true),
      flowNode(A1, 'subagent', [], 300),
      flowNode(epicNodeId('e'), 'epic-frame', ['x'], 600),
      flowNode(ticketNodeId('e', 1), 'ticket', ['y'], 900),
    ]
    render(
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]}>
          <SelectionToolbar />
        </ReactFlow>
      </ReactFlowProvider>,
    )
    setTagFilter({ projectId: 'p', tag: 'x' })
    fireEvent.click(screen.getByRole('button', { name: 'Show family' }))
    const shown = (call: number) => (fitView.mock.calls[call]![0] as { nodes: { id: string }[] }).nodes.map(({ id }) => id).sort()
    expect(shown(0)).toEqual([A, epicNodeId('e')].sort())

    setTagFilter(null)
    fireEvent.click(screen.getByRole('button', { name: 'Show family' }))
    expect(shown(1)).toEqual([A, A1, epicNodeId('e'), ticketNodeId('e', 1)].sort())
  })
})
