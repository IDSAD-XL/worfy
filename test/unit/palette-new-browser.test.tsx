// The palette's "New browser" (createCanvasNode, carried out by CanvasFind.tsx in the Canvas;
// worfy-browser ticket 14): the new Browser Node gets the Browser profile of the Project the Canvas
// shows — the only one, or null with several. Drawn in React Flow in jsdom, with the Project, its
// profiles and the Canvas's size faked.
import { act, render, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import { createCanvasNode } from '../../src/renderer/find/canvas-requests'
import type { LayoutOpInput } from '../../src/shared/layout/types'

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: 'p1', projects: [{ id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }] }),
}))

vi.mock('../../src/renderer/canvas/tidy', () => ({ useTidyUp: () => () => Promise.resolve() }))

// The profiles of each Project as this window knows them (renderer/browser/profiles.ts).
const known = vi.hoisted(() => ({ byProject: {} as Record<string, { id: string; name: string; origins: string[]; autopilot: boolean }[]> }))
vi.mock('../../src/renderer/browser/profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/browser/profiles')>()),
  browserProfilesNow: (projectId: string) => known.byProject[projectId],
}))

const profile = (id: string) => ({ id, name: id, origins: [], autopilot: false })

describe('the palette\'s "New browser"', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    // The Canvas has a size: CanvasFind waits for one before it creates the Node in its middle.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) })
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    vi.restoreAllMocks()
    known.byProject = {}
  })

  async function newBrowser(): Promise<LayoutOpInput> {
    const { default: CanvasFind } = await import('../../src/renderer/find/CanvasFind')
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    render(
      <div style={{ width: 800, height: 600 }}>
        <LayoutOpsContext.Provider value={{ apply }}>
          <ReactFlowProvider>
            <ReactFlow nodes={[]} edges={[]}>
              <CanvasFind />
            </ReactFlow>
          </ReactFlowProvider>
        </LayoutOpsContext.Provider>
      </div>,
    )
    act(() => createCanvasNode('p1', 'browser'))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    return apply.mock.calls[0]![0]
  }

  it('gives the new Browser the only Browser profile of the Project the Canvas shows', async () => {
    known.byProject = { p1: [profile('admin-aaaaaa')], other: [profile('default')] }
    const op = await newBrowser()
    expect(op).toMatchObject({ op: 'create', node: { kind: 'browser', w: 640, h: 440 } })
    expect(op).toHaveProperty('node.data', { profile: 'admin-aaaaaa' })
  })

  it('gives it `profile: null` when that Project has several', async () => {
    known.byProject = { p1: [profile('default'), profile('admin-aaaaaa')], other: [profile('default')] }
    expect(await newBrowser()).toHaveProperty('node.data', { profile: null })
  })
})
