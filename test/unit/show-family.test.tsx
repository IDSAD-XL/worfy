// "Show family" in the selection toolbar (worfy-canvas ticket 03): only for one selected Node that
// has a Family; a click fits the camera to the Family, never zooming in past the current zoom, and
// without the camera's animation when the system asks for less motion. React Flow's camera is a
// stand-in that records the call.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEdgeFocus, setEdgeFocus } from '../../src/renderer/canvas/edge-focus'
import { drawnUnderTagFilter, setTagFilter } from '../../src/renderer/find/canvas-requests'
import type { FamilyLinks } from '../../src/renderer/canvas/family'
import { FamilySection } from '../../src/renderer/canvas/overlays/SelectionToolbar'
import { epicNodeId, ticketNodeId } from '../../src/shared/layout/derived'
import type { LayoutNode } from '../../src/shared/layout/types'

// `getNode` answers with the Nodes the Canvas draws, each with its Layout tags (`drawn`).
const camera = vi.hoisted(() => ({
  fitView: vi.fn<(options?: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  getZoom: () => 0.7,
  drawn: new Map<string, string[]>(),
  getNode(id: string) {
    const tags = this.drawn.get(id)
    return tags === undefined ? undefined : { id, data: { node: { id, tags } } }
  },
}))
vi.mock('@xyflow/react', async (importOriginal) => ({ ...(await importOriginal<typeof import('@xyflow/react')>()), useReactFlow: () => camera }))
// The Canvas of Project `p` is the one on screen: FamilySection reads the active Project itself.
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

const node = (id: string, kind: string): LayoutNode => ({ id, kind, x: 0, y: 0, w: 100, h: 40, hidden: false, locked: false, pinned: false, tags: [], data: {} })
const button = () => screen.queryByRole('button', { name: 'Show family' })

beforeEach(() => {
  camera.fitView.mockClear()
  camera.drawn.clear()
  setTagFilter(null)
  setEdgeFocus([], [], links)
})
afterEach(() => {
  cleanup()
  clearEdgeFocus()
  vi.unstubAllGlobals()
})

describe('Show family', () => {
  it('is not there for a Node without a Family, nor for two selected Nodes', () => {
    render(<FamilySection nodes={[node('note-1', 'note')]} />)
    expect(button()).toBeNull()
    cleanup()
    render(<FamilySection nodes={[node(A, 'session'), node(ticketNodeId('e', 1), 'ticket')]} />)
    expect(button()).toBeNull()
    expect(camera.fitView).not.toHaveBeenCalled()
  })

  it('fits the camera to the selected Session’s Family, zooming in no further than now', () => {
    render(<FamilySection nodes={[node(A, 'session')]} />)
    fireEvent.click(button()!)
    expect(camera.fitView).toHaveBeenCalledTimes(1)
    const options = camera.fitView.mock.calls[0]![0] as { nodes: { id: string }[]; maxZoom: number; duration: number }
    expect(options.nodes.map(({ id }) => id).sort()).toEqual([A, A1, epicNodeId('e'), ticketNodeId('e', 1)].sort())
    expect(options.maxZoom).toBe(0.7)
    expect(options.duration).toBe(250)
  })

  it('with Reduce motion the camera jumps', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    render(<FamilySection nodes={[node(ticketNodeId('e', 1), 'ticket')]} />)
    fireEvent.click(button()!)
    expect((camera.fitView.mock.calls[0]![0] as { duration: number }).duration).toBe(0)
  })

  it('with the tag filter on, takes in only the Family members the filter leaves drawn (review of PR #538)', () => {
    for (const [id, tags] of [[A, ['x']], [A1, []], [epicNodeId('e'), ['x']], [ticketNodeId('e', 1), ['y']]] as const) camera.drawn.set(id, [...tags])
    setTagFilter({ projectId: 'p', tag: 'x' })
    render(<FamilySection nodes={[node(A, 'session')]} />)
    fireEvent.click(button()!)
    const options = camera.fitView.mock.calls[0]![0] as { nodes: { id: string }[] }
    expect(options.nodes.map(({ id }) => id).sort()).toEqual([A, epicNodeId('e')].sort())
  })

  it('a filter of another Project leaves the Family whole; a filter that leaves no member drawn moves no camera', () => {
    for (const id of [A, A1, epicNodeId('e'), ticketNodeId('e', 1)]) camera.drawn.set(id, [])
    setTagFilter({ projectId: 'other', tag: 'x' })
    render(<FamilySection nodes={[node(A, 'session')]} />)
    fireEvent.click(button()!)
    expect((camera.fitView.mock.calls[0]![0] as { nodes: unknown[] }).nodes).toHaveLength(4)
    setTagFilter({ projectId: 'p', tag: 'x' })
    fireEvent.click(button()!)
    expect(camera.fitView).toHaveBeenCalledTimes(1)
  })
})

describe('drawnUnderTagFilter: the one rule of "Show only tag" and of Show family', () => {
  it('draws every Node without a filter for the Project, and only the Nodes with its tag under one', () => {
    expect(drawnUnderTagFilter(null, 'p', [])).toBe(true)
    expect(drawnUnderTagFilter({ projectId: 'other', tag: 'x' }, 'p', [])).toBe(true)
    expect(drawnUnderTagFilter({ projectId: 'p', tag: 'x' }, 'p', ['y', 'x'])).toBe(true)
    expect(drawnUnderTagFilter({ projectId: 'p', tag: 'x' }, 'p', ['y'])).toBe(false)
    expect(drawnUnderTagFilter({ projectId: 'p', tag: 'x' }, 'p', undefined)).toBe(false)
    expect(drawnUnderTagFilter({ projectId: 'p', tag: 'x' }, undefined, [])).toBe(true)
  })
})
