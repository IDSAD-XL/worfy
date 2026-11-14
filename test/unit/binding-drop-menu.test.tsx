// The menu of a Binding made by hand (src/renderer/canvas/overlays/BindingDrop.tsx) and a window of
// the kit (worfy-ui-kit tickets 07 and 12). The menu is the kit's ContextMenu: like every popup of the
// kit it closes when the focus goes elsewhere and leaves the focus there. With the menu open, "?"
// opens Keyboard shortcuts (⌘, opens Settings): the window takes the focus, so the menu closes and
// does not pull the focus back; an Escape pressed in the window is the window's — one press closes
// it. Outside a window the menu still closes on Escape, marked handled.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode } from '../../src/shared/layout/types'
import { Dialog } from '../../src/renderer/theme/kit/Dialog'
import { flush } from './kit-window'

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => undefined,
  activeProject: () => ({ id: 'p1', name: 'alpha' }),
  useReadOnly: () => null,
}))

// Every Session is bound by hand: its Node opens the menu on a right click.
vi.mock('../../src/renderer/binding/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/binding/store')>()),
  useManualBindings: () => [],
  manualOf: () => ({ agent: { sessionId: 's1', agentId: null }, target: { kind: 'ticket', epic: 'demo', num: 1 } }),
}))

const layoutNode: LayoutNode = { id: 'n1', kind: 'session', x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: { sessionId: 's1' } }
const nodes: Node[] = [{ id: 'n1', type: 'session', position: { x: 0, y: 0 }, data: { node: layoutNode } }]
const nodeTypes = { session: () => <div>Session</div> }

/** The Canvas with the overlay, and a window of the kit the test opens over it as "?" would. */
function Page({ BindingDrop }: { BindingDrop: () => React.JSX.Element | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ width: 800, height: 600 }}>
      <button type="button" onClick={() => setOpen(true)}>
        Keyboard shortcuts
      </button>
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes}>
          <BindingDrop />
        </ReactFlow>
      </ReactFlowProvider>
      <Dialog open={open} onClose={() => setOpen(false)} label="Keyboard shortcuts" className="">
        <button type="button">Inside</button>
      </Dialog>
    </div>
  )
}

/** Opens the menu with a right click on the Session's Node. */
async function openMenu(): Promise<void> {
  const { default: BindingDrop } = await import('../../src/renderer/canvas/overlays/BindingDrop')
  const { container } = render(<Page BindingDrop={BindingDrop} />)
  const node = container.querySelector('.react-flow__node[data-id="n1"]')
  if (node === null) throw new Error('no Node n1')
  fireEvent.contextMenu(node)
  expect(screen.getByTestId('binding-menu')).toBeTruthy()
}

describe('the menu of a Binding made by hand', () => {
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
  afterEach(async () => {
    cleanup()
    await flush()
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  })

  it('a window of the kit opened over it takes the focus: the menu closes and leaves the focus there; one Escape in the window closes the window', async () => {
    await openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    await flush()
    const window = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(window.contains(document.activeElement)).toBe(true)
    expect(screen.queryByTestId('binding-menu')).toBeNull()
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    expect(screen.queryByTestId('binding-menu')).toBeNull()
  })

  it('with no window over it, Escape closes the menu', async () => {
    await openMenu()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(event)
    })
    expect(screen.queryByTestId('binding-menu')).toBeNull()
    expect(event.defaultPrevented).toBe(true)
  })
})
