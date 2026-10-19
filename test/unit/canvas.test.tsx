// The Canvas's extension points and its copy of the Layout (src/renderer/canvas/).
//
// The discovery test copies the Node type registry, src/renderer/canvas/nodes/index.ts, unedited,
// into a temporary mirror of the repository whose nodes/ holds the real Node type files plus one
// probe type (./glob-probe.tsx, ADR-0036). In this file the registry's import path leads to that
// copy, so the real Canvas.tsx, rendered over a fake bridge, draws a Node of the new kind with
// the new file, with no edit of nodes/index.ts or Canvas.tsx, and a Node of a kind nobody declares
// as the placeholder while the rest of the Canvas still renders. Nothing is written into src/,
// and which test file Vite transforms the real registry for first does not matter.
import { act, render, screen, waitFor } from '@testing-library/react'
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
  // Windows: 11 s, 2x the 5.1 s it ran on the PC (2026-10-19), where it hit the 5 s limit in the full run and with six other files.
  it('maps each kind to its component, with the default size when the module gives none', async () => {
    const { collectNodeTypes } = await import('../../src/renderer/canvas/nodes/index')
    const types = collectNodeTypes({
      './NoteNode.tsx': { kind: 'note', default: Dummy, defaultWidth: 220, defaultHeight: 120 },
      './EpicFrameNode.tsx': { kind: 'epic-frame', default: Dummy },
    })
    expect(types.get('note')).toEqual({ kind: 'note', Component: Dummy, defaultWidth: 220, defaultHeight: 120 })
    expect(types.get('epic-frame')).toEqual({ kind: 'epic-frame', Component: Dummy, defaultWidth: 240, defaultHeight: 140 })
  }, process.platform === 'win32' ? 11_000 : undefined)

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

const layoutState = (revision: number, nodes: LayoutState['layout']['nodes'], projectId = 'demo-00000000', viewport = { x: 0, y: 0, zoom: 1 }): LayoutState => ({
  projectId,
  revision,
  layout: { nodes, viewport },
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

  it("asks this machine for the camera of a Linked machine's Project under that Machine (worfy-link ticket 09)", async () => {
    const machine = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'
    const calls: [string, unknown][] = []
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string, input: unknown) => {
        calls.push([channel, input])
        return new Promise(() => undefined)
      },
      on: () => 1,
      off: () => undefined,
    }
    window.history.replaceState(null, '', `/?machine=${machine}&project=camera-00000000`)
    try {
      const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
      render(<Canvas projectId="camera-00000000" />)
      // The camera is this machine's (`local`), kept under the Machine of the Project.
      await waitFor(() => expect(calls).toContainEqual(['viewport.get', { projectId: 'camera-00000000', machine }]))
      // The Layout itself is M's.
      expect(calls).toContainEqual(['linked.invoke', { machine, channel: 'layout.get', input: { projectId: 'camera-00000000' } }])
    } finally {
      window.history.replaceState(null, '', '/')
      delete (globalThis as { worfy?: WorfyBridge }).worfy
    }
  })

  it('shows a hint instead of a Canvas when there is no active Project', async () => {
    const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
    render(<Canvas projectId={undefined} />)
    expect(screen.getByText('Add a project to see its canvas.')).toBeTruthy()
  })
})

// ── dragging and resizing through the real Canvas (worfy-week ticket 06) ─────

type LayoutNodeInput = ReturnType<typeof node>

/**
 * The Canvas over a fake main: `layout.apply` answers with the Layout the operation makes, corrected
 * the way main corrects it (src/main/layout/store.ts: the shared freePlace and stopResize, ADR-0038).
 * Returns every operation the renderer sent.
 */
async function renderCanvas(projectId: string, nodes: LayoutNodeInput[], zoom = 1) {
  const { freePlace, obstaclesFor, stopResize } = await import('../../src/shared/layout/free-place')
  const restore: (() => void)[] = []
  // A Node's wrapper measures as the size React Flow gives it in its style, the pane as 1200 × 800.
  // React Flow pans by itself while a drag is near the edge of its pane, which jsdom sizes 0 × 0;
  // the pane gets the window's size, and the Canvas origin sits PANE_ORIGIN pixels in.
  const rect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains('react-flow') ? new DOMRect(0, 0, 1200, 800) : rect.call(this)
  }
  restore.push(() => {
    HTMLElement.prototype.getBoundingClientRect = rect
  })
  for (const [name, value] of [
    ['offsetWidth', 1200],
    ['offsetHeight', 800],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
    const side = name === 'offsetWidth' ? 'width' : 'height'
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('react-flow__node') ? parseFloat(this.style[side]) || 0 : value
      },
    })
    restore.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, name, before)
    })
  }
  const globals = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown; worfy?: WorfyBridge }
  const observer = globals.ResizeObserver
  const matrix = globals.DOMMatrixReadOnly
  // React Flow measures a Node when its observer reports it; this one reports every element once.
  // Measuring reads the zoom from the viewport's CSS transform, which jsdom cannot parse.
  globals.DOMMatrixReadOnly = class {
    readonly m22 = zoom
  }
  globals.ResizeObserver = class {
    constructor(private readonly report: (entries: { target: Element; contentRect: DOMRect }[], observer: unknown) => void) {}
    observe(target: Element): void {
      queueMicrotask(() => this.report([{ target, contentRect: target.getBoundingClientRect() }], this))
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  const viewport = { x: PANE_ORIGIN, y: PANE_ORIGIN, zoom }
  let layout = layoutState(1, nodes, projectId, viewport)
  const sent: Record<string, unknown>[] = []
  const settle = (all: LayoutNodeInput[], id: string, before: LayoutNodeInput | undefined, resize: boolean): LayoutNodeInput[] =>
    all.map((each) => {
      if (each.id !== id) return each
      const obstacles = obstaclesFor(all, new Set([id]))
      return resize && before ? { ...each, ...stopResize(before, each, obstacles) } : { ...each, ...freePlace(each, obstacles) }
    })
  globals.worfy = {
    invoke: (channel: string, payload: unknown) => {
      if (channel === 'layout.get') return Promise.resolve({ ok: true, value: layout })
      if (channel !== 'layout.apply') return Promise.resolve({ ok: false, error: 'not in this test' })
      const op = (payload as { op: Record<string, unknown> }).op
      sent.push(op)
      const all = layout.layout.nodes as LayoutNodeInput[]
      const before = all.find((each) => each.id === op.id)
      let next = all
      if (op.op === 'move') next = settle(all.map((each) => (each.id === op.id ? { ...each, x: op.x as number, y: op.y as number } : each)), op.id as string, before, false)
      if (op.op === 'resize') {
        const sized = all.map((each) => (each.id === op.id ? { ...each, x: op.x as number, y: op.y as number, w: op.w as number, h: op.h as number } : each))
        next = settle(sized, op.id as string, before, true)
      }
      layout = layoutState(layout.revision + 1, next, projectId, viewport)
      return Promise.resolve({ ok: true, value: layout })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  const { Canvas } = (await import('../../src/renderer/canvas/Canvas')) as { Canvas: ComponentType<{ projectId: string | undefined }> }
  const view = render(<Canvas projectId={projectId} />)
  await screen.findAllByTestId('note-node')
  return {
    sent,
    view,
    layout: () => layout.layout,
    cleanup() {
      view.unmount()
      for (const undo of restore) undo()
      if (observer === undefined) delete globals.ResizeObserver
      else globals.ResizeObserver = observer
      if (matrix === undefined) delete globals.DOMMatrixReadOnly
      else globals.DOMMatrixReadOnly = matrix
      delete globals.worfy
    },
  }
}

/** Where the Canvas origin is in the pane, in pixels: far from the edges where React Flow pans by itself. */
const PANE_ORIGIN = 200

/** React Flow's wrapper of a Node: d3-drag listens on it. */
const flowNode = (id: string): HTMLElement => document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement

/**
 * Drags a Node with the mouse from where it is (`at`) so that its corner ends at `to`, as d3-drag
 * sees it: a press on the Node, moves on the window, a release. React Flow starts the drag on the
 * first move past its 1 px threshold and measures from there, so that first move is a small one.
 * `at` and `to` are in canvas units; the pane shows the Canvas at PANE_ORIGIN and `zoom`.
 */
async function drag(id: string, at: { x: number; y: number }, to: { x: number; y: number }, keys: { metaKey?: boolean; ctrlKey?: boolean } = {}, during?: () => void, zoom = 1) {
  // d3-drag listens for the moves on `event.view`; jsdom refuses vitest's window as the init's
  // `view`, so it is set on the event afterwards.
  const view = window
  const mouse = (type: string, point: { x: number; y: number }) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y, ...keys })
    Object.defineProperty(event, 'view', { value: view })
    return event
  }
  const press = { x: PANE_ORIGIN + at.x * zoom + 5, y: PANE_ORIGIN + at.y * zoom + 5 }
  const start = { x: press.x + 2, y: press.y + 2 }
  const end = { x: start.x + (to.x - at.x) * zoom, y: start.y + (to.y - at.y) * zoom }
  await act(async () => {
    flowNode(id).dispatchEvent(mouse('mousedown', press))
    view.dispatchEvent(mouse('mousemove', start))
    view.dispatchEvent(mouse('mousemove', { x: (start.x + end.x) / 2 + 0.25, y: (start.y + end.y) / 2 + 0.25 }))
    view.dispatchEvent(mouse('mousemove', end))
  })
  during?.()
  await act(async () => {
    view.dispatchEvent(mouse('mouseup', end))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('dragging a Node on the Canvas (worfy-week ticket 06)', () => {
  it('a Note dropped at (13, 21) with no neighbour near goes to the grid: the renderer sends a move to (16, 24)', async () => {
    const canvas = await renderCanvas('snap-grid-0000', [node('n', 'note', 0, { text: '' })])
    try {
      await drag('n', { x: 0, y: 0 }, { x: 13, y: 21 })
      expect(canvas.sent).toEqual([{ op: 'move', id: 'n', x: 16, y: 24 }])
    } finally {
      canvas.cleanup()
    }
  })

  it('with ⌘ held the Note dropped at (13, 21) stays at (13, 21), and no guide is drawn', async () => {
    const canvas = await renderCanvas('snap-meta-0000', [node('n', 'note', 0, { text: '' }), { ...node('m', 'note', 300, { text: '' }), y: 0 }])
    try {
      let guides = -1
      // Without ⌘ the grid would take it to (16, 24); with ⌘ nothing snaps and nothing is drawn.
      await drag('n', { x: 0, y: 0 }, { x: 13, y: 21 }, { metaKey: true }, () => {
        guides = document.querySelectorAll('[data-testid="snap-guide"]').length
      })
      expect(guides).toBe(0)
      expect(canvas.sent).toEqual([{ op: 'move', id: 'n', x: 13, y: 21 }])
    } finally {
      canvas.cleanup()
    }
  })

  it('shows a guide while a Node lines up with a neighbour, and none after the drop', async () => {
    const canvas = await renderCanvas('snap-guide-0000', [node('n', 'note', 0, { text: '' }), { ...node('m', 'note', 0, { text: '' }), y: 400 }])
    try {
      let during: string[] = []
      await drag('n', { x: 0, y: 0 }, { x: 5, y: 101 }, {}, () => {
        during = [...document.querySelectorAll('[data-testid="snap-guide"]')].map((line) => `${line.getAttribute('data-axis')}${line.getAttribute('data-at')}`)
      })
      expect(during).toContain('x0')
      expect(document.querySelectorAll('[data-testid="snap-guide"]')).toHaveLength(0)
      expect(canvas.sent).toEqual([{ op: 'move', id: 'n', x: 0, y: 104 }])
    } finally {
      canvas.cleanup()
    }
  })

  it('on the fixture of ticket 04 the outline is where main\'s correction puts the Note, and the drop sends that place', async () => {
    // test/unit/free-place.test.ts and test/contract/layout-store.test.ts: a Note dropped onto a
    // Card at (40, 40) goes to (40, 216).
    const card = { ...node('card', 'note', 0, { text: '' }), w: 300, h: 200 }
    const note = { ...node('note', 'note', 600, { text: '' }), w: 220, h: 120 }
    const canvas = await renderCanvas('snap-outline-0000', [card, note])
    try {
      let outline: (string | null)[] = []
      await drag('note', { x: 600, y: 0 }, { x: 40, y: 40 }, {}, () => {
        outline = [...document.querySelectorAll('[data-testid="snap-outline"]')].flatMap((rect) => [rect.getAttribute('data-x'), rect.getAttribute('data-y')])
      })
      expect(outline).toEqual(['40', '216'])
      expect(canvas.sent).toEqual([{ op: 'move', id: 'note', x: 40, y: 216 }])
      // The fake main corrects the move with main's functions and keeps the place.
      expect(canvas.layout().nodes.find((each) => each.id === 'note')).toMatchObject({ x: 40, y: 216 })
      expect(document.querySelectorAll('[data-testid="snap-outline"]')).toHaveLength(0)
      expect(flowNode('note').style.transform).toBe('translate(40px,216px)')
    } finally {
      canvas.cleanup()
    }
  })

  it('a drag stays one ⌘Z step: undo sends the Note back with one move', async () => {
    const { historyOf } = await import('../../src/renderer/canvas/history')
    const canvas = await renderCanvas('snap-undo-0000', [node('n', 'note', 0, { text: '' })])
    try {
      await drag('n', { x: 0, y: 0 }, { x: 13, y: 21 })
      expect(historyOf('snap-undo-0000').size).toBe(1)
      await act(async () => {
        await historyOf('snap-undo-0000').undo()
      })
      expect(canvas.sent).toEqual([
        { op: 'move', id: 'n', x: 16, y: 24 },
        { op: 'move', id: 'n', x: 0, y: 0 },
      ])
    } finally {
      canvas.cleanup()
    }
  })
})

describe('resizing a Node on the Canvas (worfy-week ticket 06)', () => {
  it('stops the edge 16 short of the neighbour while the mouse is down, sends that size, and stays one ⌘Z step', async () => {
    const { historyOf } = await import('../../src/renderer/canvas/history')
    const canvas = await renderCanvas('snap-resize-0000', [node('n', 'note', 0, { text: '' }), node('m', 'note', 300, { text: '' })])
    try {
      // Select the Note so that its resizer shows, then drag its right edge 200 to the right.
      await act(async () => {
        flowNode('n').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const handle = flowNode('n').querySelector('.react-flow__resize-control.line.right') as HTMLElement
      expect(handle).toBeTruthy()
      const mouse = (type: string, x: number, y: number) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
        Object.defineProperty(event, 'view', { value: window })
        return event
      }
      const y = PANE_ORIGIN + 50
      let during = ''
      await act(async () => {
        handle.dispatchEvent(mouse('mousedown', PANE_ORIGIN + 200, y))
        window.dispatchEvent(mouse('mousemove', PANE_ORIGIN + 250, y))
        window.dispatchEvent(mouse('mousemove', PANE_ORIGIN + 400, y))
      })
      during = flowNode('n').style.width
      await act(async () => {
        window.dispatchEvent(mouse('mouseup', PANE_ORIGIN + 400, y))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(during).toBe('284px')
      expect(canvas.sent).toEqual([{ op: 'resize', id: 'n', x: 0, y: 0, w: 284, h: 100 }])
      expect(historyOf('snap-resize-0000').size).toBe(1)
    } finally {
      canvas.cleanup()
    }
  })
})

// worfy-windows ticket 11: the primary modifier is ⌘ on macOS and Ctrl on Windows; the system is
// what <html data-platform> says (src/renderer/platform.ts; test/setup-dom.ts sets macOS).
describe('the keys of the Canvas by system', () => {
  type Modifier = 'metaKey' | 'ctrlKey'
  const SYSTEMS = [
    ['windows', 'ctrlKey', 'metaKey'],
    ['mac', 'metaKey', 'ctrlKey'],
  ] as const satisfies readonly (readonly [string, Modifier, Modifier])[]

  /** jsdom lays nothing out: offsetParent is always null, and the Canvas takes itself for hidden. */
  function onScreen(): () => void {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
    return () => {
      if (before) Object.defineProperty(HTMLElement.prototype, 'offsetParent', before)
    }
  }

  async function press(init: KeyboardEventInit, target: EventTarget = document.body): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    await act(async () => {
      target.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return event
  }

  /** An element inside a Terminal Node, as xterm builds it. */
  function terminalField(): HTMLElement {
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const field = document.createElement('div')
    terminal.append(field)
    document.body.append(terminal)
    return field
  }

  /**
   * Makes `projectId` the active Project of the window: the search and the selection toolbar belong
   * to the active Project and are not mounted without one.
   */
  let revision = 1000
  async function activate(projectId: string | null): Promise<void> {
    const { acceptProjectsState } = await import('../../src/renderer/projects/useProjects')
    revision += 1
    const projects = projectId === null ? [] : [{ id: projectId, name: 'keys', path: '/repo/keys', branch: 'main' }]
    await act(async () => {
      acceptProjectsState({ projects, activeId: projectId, revision })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const viewport = (): HTMLElement => document.querySelector('.react-flow__viewport') as HTMLElement
  const scale = (): number => Number(/scale\(([\d.]+)\)/.exec(viewport().style.transform)?.[1])

  it.each(SYSTEMS)('on %s a Note dragged with %s held does not snap, and with %s held it does', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    // A neighbour 400 below: a Note dragged to (5, 101) lines up with it and snaps to x = 0.
    const canvas = await renderCanvas(`keys-drag-${system}`, [node('n', 'note', 0, { text: '' }), { ...node('m', 'note', 0, { text: '' }), y: 400 }])
    const guides = (): number => document.querySelectorAll('[data-testid="snap-guide"]').length
    try {
      let during = -1
      // The other modifier is not the one that frees the drag: a guide shows, and the Note snaps.
      await drag('n', { x: 0, y: 0 }, { x: 5, y: 101 }, { [other]: true }, () => {
        during = guides()
      })
      expect(during).toBeGreaterThan(0)
      expect(canvas.sent).toEqual([{ op: 'move', id: 'n', x: 0, y: 104 }])
      // The primary one: no guide while it is held, and the Note stays where it was let go.
      await drag('n', { x: 0, y: 104 }, { x: 5, y: 205 }, { [primary]: true }, () => {
        during = guides()
      })
      expect(during).toBe(0)
      expect(canvas.sent.slice(1)).toEqual([{ op: 'move', id: 'n', x: 5, y: 205 }])
    } finally {
      await activate(null)
      canvas.cleanup()
    }
  })

  it.each(SYSTEMS)('on %s %s+Z undoes a drag and with Shift redoes it; %s+Z does nothing', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-undo-${system}`, [node('n', 'note', 0, { text: '' })])
    await activate(`keys-undo-${system}`)
    try {
      await drag('n', { x: 0, y: 0 }, { x: 13, y: 21 })
      const moved = { op: 'move', id: 'n', x: 16, y: 24 }
      const back = { op: 'move', id: 'n', x: 0, y: 0 }
      expect((await press({ key: 'z', [other]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'z', [primary]: true, [other]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'z', [primary]: true, altKey: true })).defaultPrevented).toBe(false)
      expect(canvas.sent).toEqual([moved])
      expect((await press({ key: 'z', [primary]: true })).defaultPrevented).toBe(true)
      expect(canvas.sent).toEqual([moved, back])
      await press({ key: 'Z', [primary]: true, shiftKey: true })
      expect(canvas.sent).toEqual([moved, back, moved])
      // With a Russian layout the Z key gives 'я': the place of the key decides.
      expect((await press({ key: 'я', code: 'KeyZ', [primary]: true })).defaultPrevented).toBe(true)
      expect(canvas.sent).toEqual([moved, back, moved, back])
      await press({ key: 'Я', code: 'KeyZ', [primary]: true, shiftKey: true })
      expect(canvas.sent).toEqual([moved, back, moved, back, moved])
      expect((await press({ key: 'н', code: 'KeyY', [primary]: true })).defaultPrevented).toBe(false)
      // Dvorak has ; where QWERTY has Z, and BÉPO has à: neither undoes.
      expect((await press({ key: ';', code: 'KeyZ', [primary]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: ':', code: 'KeyZ', [primary]: true, shiftKey: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'à', code: 'KeyZ', [primary]: true })).defaultPrevented).toBe(false)
      expect(canvas.sent).toEqual([moved, back, moved, back, moved])
    } finally {
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })

  it.each(SYSTEMS)('on %s Backspace with %s or %s held leaves the selection alone; alone it deletes it', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-delete-${system}`, [node('n', 'note', 0, { text: '' })])
    await activate(`keys-delete-${system}`)
    try {
      await act(async () => {
        flowNode('n').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await waitFor(() => expect(document.querySelector('[data-testid="selection-toolbar"]')).not.toBeNull())
      expect((await press({ key: 'Backspace', [primary]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'Backspace', [other]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'Delete', [other]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: 'Backspace', altKey: true })).defaultPrevented).toBe(false)
      // The press alone is the Canvas's: it takes the key and sends the selection to the trash.
      expect((await press({ key: 'Backspace' })).defaultPrevented).toBe(true)
    } finally {
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })

  it.each(SYSTEMS)('on %s %s+F opens the search over the Canvas; %s+F does not', async (system, primary, other) => {
    const { useCanvasRequests, closeFind } = await import('../../src/renderer/find/canvas-requests')
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-find-${system}`, [node('n', 'note', 0, { text: '' })])
    await activate(`keys-find-${system}`)
    try {
      await press({ key: 'f', [other]: true })
      await press({ key: 'f', [primary]: true, altKey: true })
      await press({ key: 'f', [primary]: true, shiftKey: true })
      expect(useCanvasRequests.getState().findOpen).toBe(false)
      // With a Node selected the bar says what it searches, and names the keys of the system.
      await act(async () => {
        flowNode('n').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await waitFor(() => expect(document.querySelector('[data-testid="selection-toolbar"]')).not.toBeNull())
      expect((await press({ key: 'f', [primary]: true })).defaultPrevented).toBe(true)
      expect(useCanvasRequests.getState().findOpen).toBe(true)
      const scope = await screen.findByTestId('find-scope')
      expect(scope.getAttribute('title')).toBe(`Only the Nodes selected at the last ${system === 'mac' ? '⌘F' : 'Ctrl+F'}`)
      expect(screen.getByLabelText('Previous match').getAttribute('title')).toBe(`Previous match (${system === 'mac' ? '⇧Enter' : 'Shift+Enter'})`)
      // With a Russian layout the F key gives а: the place of the key decides.
      await act(async () => closeFind())
      expect((await press({ key: 'а', code: 'KeyF', [primary]: true })).defaultPrevented).toBe(true)
      expect(useCanvasRequests.getState().findOpen).toBe(true)
    } finally {
      await act(async () => closeFind())
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })

  it('on Windows Ctrl+F pressed inside a Terminal Node stays with the shell; on macOS ⌘F opens the search from there', async () => {
    const { useCanvasRequests, closeFind } = await import('../../src/renderer/find/canvas-requests')
    const restore = onScreen()
    const canvas = await renderCanvas('keys-find-terminal', [node('n', 'note', 0, { text: '' })])
    await activate('keys-find-terminal')
    const field = terminalField()
    try {
      document.documentElement.dataset.platform = 'windows'
      expect((await press({ key: 'f', ctrlKey: true }, field)).defaultPrevented).toBe(false)
      expect(useCanvasRequests.getState().findOpen).toBe(false)
      document.documentElement.dataset.platform = 'mac'
      await press({ key: 'f', metaKey: true }, field)
      expect(useCanvasRequests.getState().findOpen).toBe(true)
    } finally {
      await act(async () => closeFind())
      field.parentElement?.remove()
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })

  it.each(SYSTEMS)('on %s %s+= and - zoom the Canvas; with %s they do not', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-zoom-${system}`, [node('n', 'note', 0, { text: '' })])
    await activate(`keys-zoom-${system}`)
    try {
      expect(scale()).toBe(1)
      expect((await press({ key: '=', [other]: true })).defaultPrevented).toBe(false)
      expect((await press({ key: '=', [primary]: true, altKey: true })).defaultPrevented).toBe(false)
      expect(scale()).toBe(1)
      expect((await press({ key: '=', [primary]: true })).defaultPrevented).toBe(true)
      await waitFor(() => expect(scale()).toBeGreaterThan(1))
      // `+` is how Shift+= arrives on a US keyboard, and a key of its own on a German one: it zooms in too.
      const once = scale()
      expect((await press({ key: '+', [primary]: true, shiftKey: true })).defaultPrevented).toBe(true)
      await waitFor(() => expect(scale()).toBeGreaterThan(once))
      const zoomed = scale()
      expect((await press({ key: '-', [primary]: true })).defaultPrevented).toBe(true)
      await waitFor(() => expect(scale()).toBeLessThan(zoomed))
      // Inside a Terminal Node the zoom keys still zoom the Canvas, on both systems. Only
      // Ctrl+_ on Windows does not: it is the shell's undo (readline). ⌘_ on macOS zooms out.
      const field = terminalField()
      try {
        const start = scale()
        expect((await press({ key: '=', [primary]: true }, field)).defaultPrevented).toBe(true)
        await waitFor(() => expect(scale()).toBeGreaterThan(start))
        const inside = scale()
        expect((await press({ key: '-', [primary]: true }, field)).defaultPrevented).toBe(true)
        await waitFor(() => expect(scale()).toBeLessThan(inside))
        const before = scale()
        const undo = await press({ key: '_', [primary]: true, shiftKey: true }, field)
        if (system === 'mac') {
          expect(undo.defaultPrevented).toBe(true)
          await waitFor(() => expect(scale()).toBeLessThan(before))
        } else {
          expect(undo.defaultPrevented).toBe(false)
          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(scale()).toBe(before)
        }
      } finally {
        field.parentElement?.remove()
      }
    } finally {
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })

  // React Flow zooms on the wheel while its zoom key is held (zoomActivationKeyCode) and pans
  // otherwise. The key is the primary modifier of the system: on Windows the Windows key held over
  // the wheel must not zoom.
  it.each(SYSTEMS)('on %s the wheel zooms the Canvas while %s is held, and pans it while %s is', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-wheel-${system}`, [node('n', 'note', 0, { text: '' })])
    const KEY = { metaKey: 'Meta', ctrlKey: 'Control' } as const
    const pane = document.querySelector('.react-flow__pane') as HTMLElement
    /** Holds a modifier, turns the wheel over the empty plane, lets the modifier go. */
    const wheel = async (modifier: Modifier) => {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: KEY[modifier], code: `${KEY[modifier]}Left`, bubbles: true }))
      })
      await act(async () => {
        // React Flow takes a wheel with ctrlKey for a pinch and zooms whatever key is held; the
        // event carries no modifier flag, so only the held key decides.
        pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 600, clientY: 400 }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keyup', { key: KEY[modifier], code: `${KEY[modifier]}Left`, bubbles: true }))
      })
    }
    try {
      expect(scale()).toBe(1)
      const before = viewport().style.transform
      await wheel(other)
      expect(scale()).toBe(1)
      expect(viewport().style.transform).not.toBe(before)
      await wheel(primary)
      expect(scale()).toBeGreaterThan(1)
    } finally {
      canvas.cleanup()
      restore()
    }
  })

  it.each(SYSTEMS)('on %s %s+Enter opens focus mode over the selection; %s+Enter does not', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    const restore = onScreen()
    const canvas = await renderCanvas(`keys-focus-${system}`, [node('n', 'note', 0, { text: '' })])
    await activate(`keys-focus-${system}`)
    try {
      await act(async () => {
        flowNode('n').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const button = await waitFor(() => {
        const found = document.querySelector('.w-focus-entry')
        if (found === null) throw new Error('no Focus button yet')
        return found
      })
      // The button names the keys of the system.
      expect(button.querySelector('kbd')?.textContent).toBe(system === 'mac' ? '⌘↩' : 'Ctrl+Enter')
      expect(button.getAttribute('aria-keyshortcuts')).toBe(system === 'mac' ? 'Meta+Enter' : 'Control+Enter')
      await press({ key: 'Enter', [other]: true })
      await press({ key: 'Enter', [primary]: true, altKey: true })
      await press({ key: 'Enter', [primary]: true, shiftKey: true })
      expect(screen.queryByTestId('focus-mode')).toBeNull()
      expect((await press({ key: 'Enter', [primary]: true })).defaultPrevented).toBe(true)
      expect(await screen.findByTestId('focus-mode')).toBeTruthy()
      // Focus mode covers the Canvas: the zoom keys reach neither the Canvas nor the page.
      expect((await press({ key: '=', [primary]: true })).defaultPrevented).toBe(true)
      expect(scale()).toBe(1)
      expect((await press({ key: '0', [other]: true })).defaultPrevented).toBe(false)
      // Ctrl+_ is undo in a shell (readline): on Windows a Terminal tile keeps it. On macOS the
      // shell's keys are on Ctrl, and ⌘_ is the Canvas zoom, swallowed like the rest.
      const field = terminalField()
      // What the terminal itself gets: xterm listens for keydown on its own element, and the guard
      // of focus mode sits before it, on the window in the capture phase.
      const reached: string[] = []
      field.addEventListener('keydown', (event) => reached.push((event as KeyboardEvent).key))
      try {
        expect((await press({ key: '_', [primary]: true, shiftKey: true }, field)).defaultPrevented).toBe(system === 'mac')
        expect(reached).toEqual(system === 'mac' ? [] : ['_'])
        // Every other zoom key pressed in the Terminal tile is swallowed like anywhere else: it
        // does not reach the terminal either.
        for (const key of ['-', '=', '+', '0']) expect((await press({ key, [primary]: true }, field)).defaultPrevented, key).toBe(true)
        expect(reached).toEqual(system === 'mac' ? [] : ['_'])
        expect((await press({ key: '_', [primary]: true, shiftKey: true })).defaultPrevented).toBe(true)
        // And none of these presses zoomed the Canvas under focus mode.
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(scale()).toBe(1)
      } finally {
        field.parentElement?.remove()
      }
    } finally {
      await activate(null)
      canvas.cleanup()
      restore()
    }
  })
})
