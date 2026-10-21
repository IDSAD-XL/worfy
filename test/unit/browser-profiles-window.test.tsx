// The window «Browser profiles…» (src/renderer/browser/BrowserProfiles.tsx, worfy-browser ticket 03),
// drawn in React Flow in jsdom with the profiles and main faked (worfy-browser ticket 14): it takes
// the focus when it opens, so Escape closes it before anything is clicked, and the question before a
// delete names how many Browser Nodes of the Canvas use the profile — Browser Nodes only.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = { id: 'p1', name: 'alpha' }
const profiles: BrowserProfile[] = [
  { id: 'default', name: 'Default', origins: [], autopilot: false },
  { id: 'admin-aaaaaa', name: 'admin', origins: [], autopilot: false },
]

vi.mock('../../src/renderer/browser/profiles', () => ({
  useBrowserProfiles: (projectId: string | undefined) => (projectId === PROJECT.id ? profiles : undefined),
}))

const main = vi.hoisted(() => ({ invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(() => Promise.resolve({ ok: true, value: {} })) }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/ipc')>()), invoke: main.invoke }))

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => null,
}))

const Dummy = () => null
const nodeTypes = { browser: Dummy, note: Dummy }

/** A Node of the Canvas as React Flow holds it: its Layout Node in `data.node`. */
function canvasNode(id: string, kind: string, data: Record<string, unknown>): Node {
  const node: LayoutNode = { id, kind, x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data }
  return { id, type: kind, position: { x: 0, y: 0 }, data: { node } }
}

async function openWindow(nodes: Node[], onClose = vi.fn()) {
  const { BrowserProfiles } = await import('../../src/renderer/browser/BrowserProfiles')
  render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes}>
          <BrowserProfiles project={PROJECT} selected="admin-aaaaaa" onClose={onClose} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>,
  )
  return { window: screen.getByTestId('browser-profiles'), onClose }
}

describe('the window «Browser profiles…»', () => {
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
    main.invoke.mockClear()
  })

  it('takes the focus when it opens, so Escape closes it before anything is clicked', async () => {
    const { window, onClose } = await openWindow([])
    expect(document.activeElement).toBe(window)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('names in the question before a delete how many Browsers of the Canvas use the profile: Browser Nodes only', async () => {
    const { window } = await openWindow([
      canvasNode('b1', 'browser', { profile: 'admin-aaaaaa', url: 'http://127.0.0.1:3000/one.html' }),
      canvasNode('b2', 'browser', { profile: 'admin-aaaaaa' }),
      canvasNode('b3', 'browser', { profile: 'default' }),
      // A Node of another kind with the same `data.profile` is no Browser and counts for none.
      canvasNode('n1', 'note', { profile: 'admin-aaaaaa' }),
    ])
    const rows = within(window).getAllByTestId('browser-profile-row')
    expect(rows.map((row) => [row.dataset.profile, row.textContent])).toEqual([
      ['default', 'Default1 Browser'],
      ['admin-aaaaaa', 'admin2 Browsers'],
    ])
    fireEvent.click(within(window).getByTestId('browser-profile-delete'))
    const question = within(window).getByTestId('browser-profile-delete-question')
    expect(within(question).getByTestId('browser-profile-delete-usage').textContent).toBe('2 Browsers on this Canvas use it and will ask for another Browser profile.')
    expect(main.invoke).not.toHaveBeenCalled()
  })

  it('names the Browser profile in its subtitle', async () => {
    const { window } = await openWindow([])
    expect(window.textContent).toContain('alpha · each Browser profile keeps its own cookies and logins.')
  })
})
