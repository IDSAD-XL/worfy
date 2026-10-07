// The Canvas's extension points and its copy of the Layout (src/renderer/canvas/).
//
// The discovery test copies the Node type registry, src/renderer/canvas/nodes/index.ts, unedited,
// into a temporary mirror of the repository whose nodes/ holds the real Node type files plus one
// probe type (./glob-probe.tsx, ADR-0036). In this file the registry's import path leads to that
// copy, so the real Canvas.tsx, rendered over a fake bridge, draws a Node of the new kind with
// the new file, with no edit of nodes/index.ts or Canvas.tsx, and a Node of a kind nobody declares
// as the placeholder while the rest of the Canvas still renders. Nothing is written into src/,
// and which test file Vite transforms the real registry for first does not matter.
import { act, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LayoutState } from '../../src/shared/layout/types'
import { globProbe } from './glob-probe'

const registryCopy = vi.hoisted(() => ({ path: '', remove: () => {} }))

// The factory runs when something first imports the registry, which every test here does inside
// a test body, after beforeAll has built the copy.
vi.mock('../../src/renderer/canvas/nodes/index', () => {
  if (registryCopy.path === '') throw new Error('the Node type registry was imported before its copy was built')
  return import(/* @vite-ignore */ registryCopy.path)
})

const probeSource = `export const kind = 'zz-vitest-probe'
export default function ZzVitestProbeNode() {
  return <span>Node type probe from a file</span>
}
`

beforeAll(async () => {
  const probe = await globProbe({
    module: 'src/renderer/canvas/nodes/index.ts',
    globDir: 'src/renderer/canvas/nodes',
    probes: { 'ZzVitestProbeNode.tsx': probeSource },
  })
  registryCopy.path = probe.modulePath
  registryCopy.remove = probe.remove
})

afterAll(() => {
  registryCopy.remove()
})

const Dummy = () => null

describe('collectNodeTypes', () => {
  it('maps each kind to its component, with the default size when the module gives none', async () => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    const types = collectNodeTypes({
      './NoteNode.tsx': { kind: 'note', default: Dummy, defaultWidth: 220, defaultHeight: 120 },
      './EpicFrameNode.tsx': { kind: 'epic-frame', default: Dummy },
    })
    expect(types.get('note')).toEqual({ kind: 'note', Component: Dummy, defaultWidth: 220, defaultHeight: 120 })
    expect(types.get('epic-frame')).toEqual({ kind: 'epic-frame', Component: Dummy, defaultWidth: 240, defaultHeight: 140 })
  })

  it('takes a type\'s minimap colour from its file, and leaves it undefined when the file declares none (ticket 29)', async () => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    const types = collectNodeTypes({
      './NoteNode.tsx': { kind: 'note', default: Dummy, minimapColor: 'var(--border-strong)' },
      './EpicFrameNode.tsx': { kind: 'epic-frame', default: Dummy },
    })
    expect(types.get('note')?.minimapColor).toBe('var(--border-strong)')
    expect(types.get('epic-frame')?.minimapColor).toBeUndefined()
  })

  it.each([
    ['no component', { './ANode.tsx': { kind: 'a' } }, /ANode.tsx must default-export/],
    ['no kind', { './ANode.tsx': { default: Dummy } }, /ANode.tsx must export a `kind`/],
    ['a kind with capitals', { './ANode.tsx': { kind: 'Note', default: Dummy } }, /must export a `kind`/],
    ['the placeholder type name as kind', { './ANode.tsx': { kind: 'worfy:unknown', default: Dummy } }, /must export a `kind`/],
    ['a zero width', { './ANode.tsx': { kind: 'a', default: Dummy, defaultWidth: 0 } }, /`defaultWidth` must be a positive number/],
    ['a minimap colour that is a number', { './ANode.tsx': { kind: 'a', default: Dummy, minimapColor: 42 } }, /ANode.tsx: `minimapColor` must be a CSS colour/],
    ['a blank minimap colour', { './ANode.tsx': { kind: 'a', default: Dummy, minimapColor: '  ' } }, /ANode.tsx: `minimapColor` must be a CSS colour/],
    ['two files with one kind', { './ANode.tsx': { kind: 'a', default: Dummy }, './BNode.tsx': { kind: 'a', default: Dummy } }, /ANode.tsx and .\/BNode.tsx both declare kind 'a'/],
  ])('throws on %s', async (_name, modules, message) => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    expect(() => collectNodeTypes(modules)).toThrow(message)
  })
})

describe('node sources', () => {
  it('needs owns, useNodes and moved in the default export', async () => {
    const { collectNodeSources } = await import('../../src/renderer/canvas/extensions')
    const useNodes = () => []
    const moved = () => undefined
    expect(() => collectNodeSources({ './x.ts': { default: { owns: [], useNodes } } })).toThrow(/x.ts must default-export a NodeSource/)
    expect(() => collectNodeSources({ './x.ts': { default: { owns: 'a', useNodes, moved } } })).toThrow(/x.ts must default-export a NodeSource/)
    expect(() => collectNodeSources({ './x.ts': {} })).toThrow(/x.ts must default-export a NodeSource/)
    const good = { owns: ['k'], useNodes, moved }
    expect(collectNodeSources({ './b.ts': { default: good }, './a.ts': { default: good } }).map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

describe('edge sources', () => {
  it('needs a default function, and a source that throws is skipped', async () => {
    const { collectEdgeSources, edgesOf } = await import('../../src/renderer/canvas/extensions')
    expect(() => collectEdgeSources({ './tree.ts': { default: 1 } })).toThrow(/tree.ts must default-export a function/)

    const sources = collectEdgeSources({
      './b.ts': { default: () => [{ id: 'b', source: 'n1', target: 'n2' }] },
      './a.ts': {
        default: () => {
          throw new Error('broken source')
        },
      },
    })
    expect(sources.map((source) => source.id)).toEqual(['a', 'b'])
    const error = console.error
    console.error = () => undefined
    try {
      expect(edgesOf(sources, [])).toEqual([{ id: 'b', source: 'n1', target: 'n2' }])
    } finally {
      console.error = error
    }
  })
})

const layoutState = (revision: number, nodes: LayoutState['layout']['nodes'], projectId = 'demo-00000000'): LayoutState => ({
  projectId,
  revision,
  layout: { nodes, viewport: { x: 0, y: 0, zoom: 1 } },
})

const node = (id: string, kind: string, x: number, data: Record<string, unknown> = {}) => ({
  id,
  kind,
  x,
  y: 0,
  w: 200,
  h: 100,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data,
})

describe('the renderer copy of a Layout', () => {
  it('keeps the highest revision of each Project', async () => {
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    const { renderHook } = await import('@testing-library/react')
    const { useLayout } = await import('../../src/renderer/canvas/useLayout')
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: () => new Promise(() => undefined),
      on: () => 1,
      off: () => undefined,
    }
    try {
      const hook = renderHook(() => useLayout('demo-00000000'))
      act(() => acceptLayoutState(layoutState(5, [node('a', 'note', 5)])))
      act(() => acceptLayoutState(layoutState(3, [node('a', 'note', 3)])))
      expect(hook.result.current.state?.layout.nodes[0]?.x).toBe(5)
      act(() => acceptLayoutState(layoutState(6, [node('a', 'note', 6)])))
      expect(hook.result.current.state?.layout.nodes[0]?.x).toBe(6)
    } finally {
      delete (globalThis as { worfy?: WorfyBridge }).worfy
    }
  })
})

describe('Canvas', () => {
  it('draws a Node type added as one file, and a placeholder for an unknown kind', async () => {
    // React Flow measures its pane and Nodes; jsdom lays nothing out, so give it a size.
    const restore: (() => void)[] = []
    for (const [name, value] of [
      ['offsetWidth', 1200],
      ['offsetHeight', 800],
    ] as const) {
      const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value })
      restore.push(() => {
        if (before) Object.defineProperty(HTMLElement.prototype, name, before)
      })
    }
    const globals = globalThis as { ResizeObserver?: unknown; worfy?: WorfyBridge }
    const hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globals.worfy = {
      invoke: (channel: string) =>
        Promise.resolve(
          channel === 'layout.get'
            ? {
                ok: true,
                value: layoutState(1, [
                  node('p', 'zz-vitest-probe', 0),
                  node('u', 'from-the-future', 300),
                  node('n', 'note', 600, { text: 'a note' }),
                  // A Ticket is drawn by the Epic source only; a stray Layout Node of that kind
                  // carries no Ticket and must not take the Canvas down.
                  node('t', 'ticket', 900),
                ], 'canvas-00000000'),
              }
            : { ok: false, error: 'not in this test' },
        ),
      on: () => 1,
      off: () => undefined,
    }
    try {
      const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
      // Its own Project id: the copy of the Layout above is shared within this file.
      render(<Canvas projectId="canvas-00000000" />)
      expect(await screen.findByText('Node type probe from a file')).toBeTruthy()
      expect(screen.getByTestId('unknown-node').textContent).toBe('Unknown node: from-the-future')
      expect((screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement).value).toBe('a note')
      expect(screen.queryByTestId('ticket-node')).toBeNull()
    } finally {
      for (const undo of restore) undo()
      if (!hadObserver) delete globals.ResizeObserver
      delete globals.worfy
    }
  })

  it('a drag of several Layout Nodes sends one moveMany with every dropped place; a drag of one sends a move (ADR-0038)', async () => {
    const { dropOperation } = await import('../../src/renderer/canvas/history')
    const dragged = [
      { id: 'a', position: { x: 100, y: 0 } },
      { id: 'b', position: { x: 340, y: 0 } },
    ]
    expect(dropOperation(dragged)).toEqual({ op: 'moveMany', moves: [{ id: 'a', x: 100, y: 0 }, { id: 'b', x: 340, y: 0 }] })
    expect(dropOperation(dragged.slice(0, 1))).toEqual({ op: 'move', id: 'a', x: 100, y: 0 })
    expect(dropOperation([])).toBeUndefined()
  })

  it('shows a hint instead of a Canvas when there is no active Project', async () => {
    const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
    render(<Canvas projectId={undefined} />)
    expect(screen.getByText('Add a project to see its canvas.')).toBeTruthy()
  })
})
