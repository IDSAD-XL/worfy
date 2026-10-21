// @vitest-environment jsdom
// The Binding anchors' hook (sources/workflow-bindings.ts) reads which Epics have a frame from the
// Nodes React Flow has, not from the workflow model: an Epic of the model on the done shelf has no
// frame, and a line to it ends at its chip on the shelf Node; one with neither gets no line.
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { Binding } from '../../src/shared/binding/resolve'
import { agentKey } from '../../src/shared/ipc/bindings'
import { DONE_SHELF_ID, DONE_SHELF_KIND, epicNodeId } from '../../src/shared/layout/derived'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import { SHELF_CHIP_HEIGHT } from '../../src/renderer/canvas/epic-layout'
import source, { epicAnchorId } from '../../src/renderer/canvas/sources/workflow-bindings'

const fixed = vi.hoisted(() => ({
  projects: { projects: [{ id: 'p', path: '/repo' }] },
  home: { live: [] },
  manual: [],
  signals: new Map(),
  model: {
    root: '/repo',
    epics: [
      { epic: 'a', hasSpec: true, hasMap: false, title: null },
      { epic: 'b', hasSpec: true, hasMap: false, title: null },
    ],
    tickets: [],
    error: null,
    branchErrors: [],
  },
  bindings: new Map<string, unknown>(),
}))
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => fixed.projects,
  useReadOnly: () => null,
}))
// No live list for the arrangement's activity: this window has no main to ask.
vi.mock('../../src/renderer/claude-home/useClaudeHome', () => ({ useClaudeHome: () => fixed.home, liveSessionsNow: () => Promise.resolve(undefined) }))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({ useWorkflow: () => ({ model: fixed.model as WorkflowModel }) }))
vi.mock('../../src/renderer/binding/store', async (original) => ({
  ...(await original<typeof import('../../src/renderer/binding/store')>()),
  useManualBindings: () => fixed.manual,
  useSessionSignals: () => fixed.signals,
  resolveAgentBindings: () => fixed.bindings,
}))

const wave: Binding = { target: { kind: 'epic', epic: 'a' }, source: 'skill', detail: '/epic-wave a' }
fixed.bindings.set(agentKey('s1', null), wave)

const session: LayoutNode = { id: 'session:s1', kind: 'session', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: false, pinned: false, tags: [], data: { sessionId: 's1' } }
const layout: Layout = { nodes: [session], viewport: { x: 0, y: 0, zoom: 1 } }

// The shelf Node as sources/epics.ts draws it: its chips are in data.node.data.
const shelfNode = (chips: { epic: string; x: number; y: number }[]): Node => ({
  id: DONE_SHELF_ID,
  type: DONE_SHELF_KIND,
  position: { x: 0, y: 600 },
  data: { node: { id: DONE_SHELF_ID, kind: DONE_SHELF_KIND, data: { projectId: 'p', chips } } },
})
const frameNode = (epic: string): Node => ({ id: epicNodeId(epic), type: 'epic-frame', position: { x: 0, y: 0 }, data: { node: { id: epicNodeId(epic), kind: 'epic-frame', data: {} } } })

function anchorsWith(nodes: Node[]) {
  const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider initialNodes={nodes}>{children}</ReactFlowProvider>
  return renderHook(() => source.useNodes({ projectId: 'p', layout } as Parameters<typeof source.useNodes>[0]), { wrapper }).result.current
}

describe('the Binding anchors read the frames React Flow has, not the workflow model', () => {
  it('an Epic of the model on the shelf, without a frame Node: the line ends at its chip, not at `epic:<epic>`', () => {
    const anchors = anchorsWith([frameNode('b'), shelfNode([{ epic: 'a', x: 12, y: 36 }])])
    const target = anchors.find((n) => n.id === epicAnchorId('a'))!
    expect(target).toMatchObject({ parentId: DONE_SHELF_ID, position: { x: 12, y: 36 + SHELF_CHIP_HEIGHT / 2 } })
    expect(anchors.some((n) => n.parentId === epicNodeId('a'))).toBe(false)
  })

  it('an Epic of the model with neither a frame Node nor a chip gets no line: no anchor under a Node that is not there', () => {
    const anchors = anchorsWith([frameNode('b')])
    expect(anchors).toEqual([])
  })

  it('with its frame Node, the line ends at the frame', () => {
    const anchors = anchorsWith([frameNode('a')])
    expect(anchors.find((n) => n.id === epicAnchorId('a'))).toMatchObject({ parentId: epicNodeId('a') })
  })
})
