// The items of the Canvas context menu (src/renderer/canvas/overlays/): each comes from a Node
// type file that exports `createLabel`. The menu itself is driven in test/e2e/terminal.spec.ts;
// here it is drawn in React Flow in jsdom, with "Tidy up" (canvas/tidy.ts), "Arrange by Epic"
// (canvas/arrange-by-epic-command.ts), "Re-pack" (canvas/sources/epics.ts) and the Projects faked.
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeType } from '../../src/renderer/canvas/nodes/index'
import { createItems } from '../../src/renderer/canvas/overlays/create-items'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'
import { TERMINAL_NODE_KIND } from '../../src/shared/ipc/terminal'
import type { LayoutOpInput } from '../../src/shared/layout/types'

const tidyUp = vi.hoisted(() => ({ run: vi.fn(() => Promise.resolve()), projects: [] as [string, string | undefined][] }))

vi.mock('../../src/renderer/canvas/tidy', () => ({
  useTidyUp: (projectId: string, root: string | undefined) => {
    if (!tidyUp.projects.some(([id]) => id === projectId)) tidyUp.projects.push([projectId, root])
    return tidyUp.run
  },
}))

const arrange = vi.hoisted(() => ({ run: vi.fn(() => Promise.resolve()), projects: [] as [string, string | undefined][], requests: [] as string[] }))

vi.mock('../../src/renderer/canvas/arrange-by-epic-command', () => ({
  useArrangeByEpic: (projectId: string, root: string | undefined) => {
    if (!arrange.projects.some(([id]) => id === projectId)) arrange.projects.push([projectId, root])
    return arrange.run
  },
  useArrangeByEpicRequests: (projectId: string, run: unknown) => {
    if (run === arrange.run && !arrange.requests.includes(projectId)) arrange.requests.push(projectId)
  },
}))

const repack = vi.hoisted(() => ({ run: vi.fn(() => Promise.resolve()), projects: [] as string[], requests: [] as string[] }))

vi.mock('../../src/renderer/canvas/arrangement-record', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/canvas/arrangement-record')>()),
  useRepack: (projectId: string) => {
    if (!repack.projects.includes(projectId)) repack.projects.push(projectId)
    return repack.run
  },
}))

vi.mock('../../src/renderer/canvas/sources/epics', () => ({
  useRepackRequests: (projectId: string, run: unknown) => {
    if (run === repack.run && !repack.requests.includes(projectId)) repack.requests.push(projectId)
  },
}))

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: 'p1', projects: [{ id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => readOnly.hint,
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

describe('the Browser Node type', () => {
  it('is registered under the kind "browser", with the "New browser" item (worfy-browser/02)', async () => {
    const browser = await import('../../src/renderer/canvas/nodes/BrowserNode')
    const { nodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    expect(browser.kind).toBe('browser')
    expect(nodeTypes.get('browser')?.Component).toBe(browser.default)
    expect(createItems({ './BrowserNode.tsx': browser }, nodeTypes).map((item) => [item.label, item.type.kind])).toEqual([['New browser', 'browser']])
    // Neutral: no colour of its own on the minimap (ADR-0077 item 2).
    expect(nodeTypes.get('browser')?.minimapColor).toBeUndefined()
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
    readOnly.hint = null
    tidyUp.run.mockClear()
    arrange.run.mockClear()
    repack.run.mockClear()
  })

  const openMenu = async (ops: LayoutOps = { apply: () => Promise.resolve() }) => {
    const { default: CanvasMenu } = await import('../../src/renderer/canvas/overlays/CanvasMenu')
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <LayoutOpsContext.Provider value={ops}>
          <ReactFlowProvider>
            <ReactFlow nodes={[]} edges={[]}>
              <CanvasMenu />
            </ReactFlow>
          </ReactFlowProvider>
        </LayoutOpsContext.Provider>
      </div>,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(container.querySelector('.react-flow__pane')!, { clientX: 100, clientY: 120 })
    return screen.findByRole('menu', { name: 'Canvas' })
  }

  it('opens on a right click on the empty plane with the New items, a separator, then Tidy up, which runs the Canvas’s Tidy up (worfy-week/07)', async () => {
    const menu = await openMenu()
    const rows = [...menu.children].map((child) => (child.getAttribute('role') === 'separator' ? '—' : child.textContent))
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.slice(-4)).toEqual(['—', 'Tidy up', 'Arrange by Epic', 'Re-pack'])
    expect(rows.slice(0, -4).every((label) => label?.startsWith('New '))).toBe(true)
    expect(tidyUp.projects).toEqual([['p1', '/repo/one']])

    fireEvent.click(screen.getByRole('menuitem', { name: 'Tidy up' }))
    expect(tidyUp.run).toHaveBeenCalledTimes(1)
    expect(arrange.run).not.toHaveBeenCalled()
    expect(repack.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('has Arrange by Epic under Tidy up, which runs the Canvas’s Arrange by Epic and carries out the palette’s requests (worfy-canvas/12)', async () => {
    await openMenu()
    expect(arrange.projects).toEqual([['p1', '/repo/one']])
    expect(arrange.requests).toEqual(['p1'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Arrange by Epic' }))
    expect(arrange.run).toHaveBeenCalledTimes(1)
    expect(tidyUp.run).not.toHaveBeenCalled()
    expect(repack.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('has Re-pack under Tidy up, which runs the Canvas’s Re-pack of the Epic frames and carries out the palette’s requests (worfy-canvas/01)', async () => {
    await openMenu()
    expect(repack.projects).toEqual(['p1'])
    expect(repack.requests).toEqual(['p1'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Re-pack' }))
    expect(repack.run).toHaveBeenCalledTimes(1)
    expect(tidyUp.run).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('on a read-only screen Tidy up, Arrange by Epic and Re-pack are inactive with the hint, and a click runs none', async () => {
    const HINT = 'Mini gives this Machine read-only access'
    readOnly.hint = HINT
    await openMenu()
    for (const name of ['Tidy up', 'Arrange by Epic', 'Re-pack']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item.getAttribute('aria-disabled'), name).toBe('true')
      expect(item.getAttribute('title'), name).toBe(HINT)
      fireEvent.click(item)
    }
    expect(tidyUp.run).not.toHaveBeenCalled()
    expect(arrange.run).not.toHaveBeenCalled()
    expect(repack.run).not.toHaveBeenCalled()
  })

  it('has New browser, which creates a Browser Node with no address at the spot of the right click (worfy-browser/02)', async () => {
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    await openMenu({ apply })
    fireEvent.click(screen.getByRole('menuitem', { name: 'New browser' }))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[0]).toMatchObject({ op: 'create', node: { kind: 'browser', w: 640, h: 440, data: {} } })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
