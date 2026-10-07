// The items of the Canvas context menu (src/renderer/canvas/overlays/): each comes from a Node
// type file that exports `createLabel`. The menu itself is driven in test/e2e/terminal.spec.ts;
// here it is drawn in React Flow in jsdom, with "Tidy up" (canvas/tidy.ts) and the Projects faked.
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeType } from '../../src/renderer/canvas/nodes/index'
import { createItems } from '../../src/renderer/canvas/overlays/create-items'
import { TERMINAL_NODE_KIND } from '../../src/shared/ipc/terminal'

const tidyUp = vi.hoisted(() => ({ run: vi.fn(() => Promise.resolve()), projects: [] as [string, string | undefined][] }))

vi.mock('../../src/renderer/canvas/tidy', () => ({
  useTidyUp: (projectId: string, root: string | undefined) => {
    if (!tidyUp.projects.some(([id]) => id === projectId)) tidyUp.projects.push([projectId, root])
    return tidyUp.run
  },
}))

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: 'p1', projects: [{ id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }] }),
}))

const Dummy = () => null
const type = (kind: string): NodeType => ({ kind, Component: Dummy, defaultWidth: 100, defaultHeight: 50 })
const types = new Map([
  ['note', type('note')],
  ['terminal', type('terminal')],
  ['session', type('session')],
])

describe('createItems', () => {
  it('makes an item for each Node type with a createLabel, sorted by label', () => {
    const items = createItems(
      {
        './NoteNode.tsx': { kind: 'note', default: Dummy },
        './TerminalNode.tsx': { kind: 'terminal', default: Dummy, createLabel: 'New terminal' },
        './SessionNode.tsx': { kind: 'session', default: Dummy, createLabel: 'New session' },
      },
      types,
    )
    expect(items.map(({ label, type: { kind } }) => [label, kind])).toEqual([
      ['New session', 'session'],
      ['New terminal', 'terminal'],
    ])
  })

  it.each([
    ['an empty label', { './TerminalNode.tsx': { kind: 'terminal', createLabel: ' ' } }, /`createLabel` must be a non-empty string/],
    ['a label that is not a string', { './TerminalNode.tsx': { kind: 'terminal', createLabel: 1 } }, /`createLabel` must be a non-empty string/],
    ['a kind that is not registered', { './OtherNode.tsx': { kind: 'other', createLabel: 'New other' } }, /OtherNode.tsx: `createLabel` needs/],
  ])('throws on %s', (_name, modules, message) => {
    expect(() => createItems(modules, types)).toThrow(message)
  })
})

describe('the Terminal Node type', () => {
  it('is registered under the kind main starts shells for, with the "New terminal" item', async () => {
    const terminal = await import('../../src/renderer/canvas/nodes/TerminalNode')
    const { nodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    expect(terminal.kind).toBe(TERMINAL_NODE_KIND)
    expect(nodeTypes.get(TERMINAL_NODE_KIND)?.Component).toBe(terminal.default)
    expect(createItems({ './TerminalNode.tsx': terminal }, nodeTypes).map((item) => item.label)).toEqual(['New terminal'])
  })
})

describe('the Canvas menu', () => {
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
  })

  it('opens on a right click on the empty plane with the New items, a separator, then Tidy up, which runs the Canvas’s Tidy up (worfy-week/07)', async () => {
    const { default: CanvasMenu } = await import('../../src/renderer/canvas/overlays/CanvasMenu')
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={[]} edges={[]}>
            <CanvasMenu />
          </ReactFlow>
        </ReactFlowProvider>
      </div>,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(container.querySelector('.react-flow__pane')!, { clientX: 100, clientY: 120 })
    const menu = await screen.findByRole('menu', { name: 'Canvas' })
    const rows = [...menu.children].map((child) => (child.getAttribute('role') === 'separator' ? '—' : child.textContent))
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.slice(-2)).toEqual(['—', 'Tidy up'])
    expect(rows.slice(0, -2).every((label) => label?.startsWith('New '))).toBe(true)
    expect(tidyUp.projects).toEqual([['p1', '/repo/one']])

    fireEvent.click(screen.getByRole('menuitem', { name: 'Tidy up' }))
    expect(tidyUp.run).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
