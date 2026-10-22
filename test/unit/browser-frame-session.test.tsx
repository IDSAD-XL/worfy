// The frame of a Browser and the Session that opened it (worfy-browser ticket 06), drawn in React
// Flow in jsdom with the real frame; main (ipc) and the Project are faked:
// - the frame is marked (`data-family="lit"`) while it is in the lit Family of a hovered or selected
//   Node (src/renderer/canvas/edge-focus.ts, family.ts), and only then;
// - main's word that nobody drives the Browser any more (`browser.control.changed` with mode null:
//   its Session left the Canvas) takes «Claude is driving» off the frame
//   (src/renderer/browser/control.ts).
import { act, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEdgeFocus, setEdgeFocus } from '../../src/renderer/canvas/edge-focus'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = 'one-0a0a0a0a'
const PROFILE = 'admin-0a0a0a'

// main: the Project's one profile, a Session driving the Browser; the window's subscriptions are kept.
const main = vi.hoisted(() => ({ handlers: new Map<string, Set<(payload: unknown) => void>>() }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string) => {
    if (channel === 'browser.profiles.list') return Promise.resolve({ ok: true, value: { profiles: [{ id: PROFILE, name: 'admin', origins: [], autopilot: false } satisfies BrowserProfile] } })
    if (channel === 'browser.control.list') return Promise.resolve({ ok: true, value: { controls: [{ nodeId: 'browser-1', mode: 'claude' }] } })
    return Promise.resolve({ ok: false, error: `${channel} is not faked` })
  },
  subscribe: (channel: string, handler: (payload: unknown) => void) => {
    const set = main.handlers.get(channel) ?? new Set()
    set.add(handler)
    main.handlers.set(channel, set)
    return () => set.delete(handler)
  },
}))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: PROJECT, projects: [{ id: PROJECT, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => null,
}))

function drawBrowser(): void {
  const node: LayoutNode = { id: 'browser-1', kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: PROFILE, openedBy: 'sess-a' } }
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

/** main tells the window an event, as `browser.control.changed` arrives. */
function tell(channel: string, payload: unknown): void {
  act(() => {
    for (const handler of main.handlers.get(channel) ?? []) handler(payload)
  })
}

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
  main.handlers.clear()
  clearEdgeFocus()
})

const links = { epics: [], tickets: [], sessions: ['session:a'], subagents: [], bindings: [], browsers: [{ nodeId: 'browser-1', sessionNodeId: 'session:a' }] }

describe('the frame of a Browser a Session opened', () => {
  it('is marked while it is in the lit Family of a hovered Node, and not otherwise', async () => {
    drawBrowser()
    const frame = await screen.findByTestId('browser-frame')
    expect(frame.getAttribute('data-family')).toBeNull()
    act(() => setEdgeFocus(['session:a'], [], links))
    expect(frame.getAttribute('data-family')).toBe('lit')
    // Another Session hovered: not its Family.
    act(() => setEdgeFocus(['session:b'], [], { ...links, sessions: ['session:a', 'session:b'] }))
    expect(frame.getAttribute('data-family')).toBeNull()
    act(() => setEdgeFocus(['browser-1'], [], links))
    expect(frame.getAttribute('data-family')).toBe('lit')
    act(() => setEdgeFocus([], [], links))
    expect(frame.getAttribute('data-family')).toBeNull()
  })

  it('loses «Claude is driving» when main says nobody drives it any more', async () => {
    drawBrowser()
    const frame = await screen.findByTestId('browser-frame')
    await waitFor(() => expect(frame.getAttribute('data-control')).toBe('claude'))
    expect(screen.getByTestId('browser-claude-drives')).toBeTruthy()
    tell('browser.control.changed', { projectId: PROJECT, nodeId: 'browser-1', mode: null })
    expect(frame.getAttribute('data-control')).toBeNull()
    expect(screen.queryByTestId('browser-claude-drives')).toBeNull()
  })
})
