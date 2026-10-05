// The Canvas's extension points and its copy of the Layout (src/renderer/canvas/).
//
// The discovery test drops a temporary Node type file into src/renderer/canvas/nodes/ before
// anything imports the canvas, then renders the real Canvas.tsx over a fake bridge: a Node of the
// new kind is drawn by the new file, with no edit of nodes/index.ts or Canvas.tsx, and a Node of
// a kind nobody declares is drawn as the placeholder while the rest of the Canvas still renders.
import { act, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LayoutState } from '../../src/shared/layout/types'

// This project type-checks test/**/*.tsx without Node's types (the renderer has none), so node:fs
// and node:process are loaded through computed specifiers and given the few signatures used here.
interface Fs {
  rmSync(path: string, options: { force: true }): void
  writeFileSync(path: string, data: string): void
}

const nodeModule = async <T,>(name: string): Promise<T> => (await import(/* @vite-ignore */ ['node', name].join(':'))) as T

let fs: Fs
let probeFile = ''

const probeSource = `export const kind = 'zz-vitest-probe'
export default function ZzVitestProbeNode() {
  return <span>Node type probe from a file</span>
}
`

beforeAll(async () => {
  fs = await nodeModule<Fs>('fs')
  const { cwd } = await nodeModule<{ cwd(): string }>('process')
  probeFile = `${cwd()}/src/renderer/canvas/nodes/ZzVitestProbeNode.tsx`
  fs.writeFileSync(probeFile, probeSource)
})

afterAll(() => {
  fs.rmSync(probeFile, { force: true })
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

  it.each([
    ['no component', { './ANode.tsx': { kind: 'a' } }, /ANode.tsx must default-export/],
    ['no kind', { './ANode.tsx': { default: Dummy } }, /ANode.tsx must export a `kind`/],
    ['a kind with capitals', { './ANode.tsx': { kind: 'Note', default: Dummy } }, /must export a `kind`/],
    ['the placeholder type name as kind', { './ANode.tsx': { kind: 'worfy:unknown', default: Dummy } }, /must export a `kind`/],
    ['a zero width', { './ANode.tsx': { kind: 'a', default: Dummy, defaultWidth: 0 } }, /`defaultWidth` must be a positive number/],
    ['two files with one kind', { './ANode.tsx': { kind: 'a', default: Dummy }, './BNode.tsx': { kind: 'a', default: Dummy } }, /ANode.tsx and .\/BNode.tsx both declare kind 'a'/],
  ])('throws on %s', async (_name, modules, message) => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    expect(() => collectNodeTypes(modules)).toThrow(message)
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
    } finally {
      for (const undo of restore) undo()
      if (!hadObserver) delete globals.ResizeObserver
      delete globals.worfy
    }
  })

  it('shows a hint instead of a Canvas when there is no active Project', async () => {
    const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
    render(<Canvas projectId={undefined} />)
    expect(screen.getByText('Add a project to see its canvas.')).toBeTruthy()
  })
})
