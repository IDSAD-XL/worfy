// The frame of a Browser a Session drives (src/renderer/canvas/nodes/BrowserNode.tsx, worfy-browser
// ticket 04): a press on it takes the Browser over (`browser.control.take`), except on a read-only
// Linked machine, which may not change who drives it. Drawn in React Flow in jsdom with the real
// frame; main (ipc) and the Project are faked.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = 'one-0a0a0a0a'
const PROFILE = 'admin-0a0a0a'

// main: the Project's one profile, and a Session driving the Browser; every call is logged.
const main = vi.hoisted(() => ({ calls: [] as [string, unknown][], readOnly: null as string | null }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { nodeId?: string }) => {
    main.calls.push([channel, input])
    if (channel === 'browser.profiles.list') return Promise.resolve({ ok: true, value: { profiles: [{ id: PROFILE, name: 'admin', origins: [], autopilot: false } satisfies BrowserProfile] } })
    if (channel === 'browser.control.list') return Promise.resolve({ ok: true, value: { controls: [{ nodeId: 'browser-1', mode: 'claude' }] } })
    if (channel === 'browser.control.take') return Promise.resolve({ ok: true, value: { taken: true } })
    return Promise.resolve({ ok: false, error: `${channel} is not faked` })
  },
  subscribe: () => () => undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: PROJECT, projects: [{ id: PROJECT, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => main.readOnly,
}))

function drawBrowser(): void {
  const node: LayoutNode = { id: 'browser-1', kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: PROFILE } }
  const nodes: Node[] = [{ id: node.id, type: 'browser', position: { x: 0, y: 0 }, data: { node } }]
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={{ apply: () => Promise.resolve() }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ browser: BrowserNode }} />
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
}

const takes = (): unknown[] => main.calls.filter(([channel]) => channel === 'browser.control.take').map(([, input]) => input)

describe('a press on the frame of a Browser a Session drives', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    main.calls = []
    main.readOnly = null
  })

  it('takes it over on the Machine of the Project', async () => {
    drawBrowser()
    const frame = await screen.findByTestId('browser-frame')
    await waitFor(() => expect(frame.getAttribute('data-control')).toBe('claude'))
    fireEvent.pointerDown(frame)
    expect(takes()).toEqual([{ projectId: PROJECT, nodeId: 'browser-1' }])
  })

  it('takes nothing over on a read-only Linked machine', async () => {
    main.readOnly = 'Read-only: this Project is on another Machine'
    drawBrowser()
    const frame = await screen.findByTestId('browser-frame')
    await waitFor(() => expect(frame.getAttribute('data-control')).toBe('claude'))
    fireEvent.pointerDown(frame)
    fireEvent.keyDown(frame, { key: 'a' })
    expect(takes()).toEqual([])
  })
})
