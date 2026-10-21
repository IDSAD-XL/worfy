// Semantic zoom (worfy-canvas ticket 06): the three levels of a Node's view and the hook that
// follows the level, not the zoom. A Node that reads the level is drawn again only when the level
// changes; a pan or a zoom within one level leaves it alone. The marks on the React Flow root (the
// level and, at the far level, the zoom for the inverse scale) come from overlays/ZoomLevel.tsx.
// jsdom applies no CSS: what each level looks like is test/e2e/semantic-zoom.spec.ts.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import ZoomLevelMarks from '../../src/renderer/canvas/overlays/ZoomLevel'
import { COMPACT_ZOOM_MIN, FULL_ZOOM_MIN, hiddenByLevel, useZoomLevel, ZOOM_LEVEL_ATTRIBUTE, ZOOM_VARIABLE, zoomLevelOf, type ZoomLevel } from '../../src/renderer/canvas/zoom-level'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

describe('zoomLevelOf', () => {
  it('has the thresholds 0.3 and 0.6 of the ticket', () => {
    expect(COMPACT_ZOOM_MIN).toBe(0.3)
    expect(FULL_ZOOM_MIN).toBe(0.6)
  })

  it.each([
    [2.5, 'full'],
    [1, 'full'],
    [0.6, 'full'],
    [0.5999, 'compact'],
    [0.45, 'compact'],
    [0.3, 'compact'],
    [0.2999, 'far'],
    [0.2, 'far'],
  ] as const)('zoom %f is %s', (zoom, level) => {
    expect(zoomLevelOf(zoom)).toBe(level)
  })
})

type SetZoom = (zoom: number) => void

/** Hands the test a way to set React Flow's zoom, and points its store at `root`. */
function Store({ root, onReady, children }: { root: HTMLElement; onReady: (set: SetZoom) => void; children: ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ domNode: root as HTMLDivElement })
    onReady((zoom) => store.setState({ transform: [12, 34, zoom] }))
  }, [store, root, onReady])
  return <>{children}</>
}

function setup(start: number, extra?: ReactNode, root = document.createElement('div')) {
  const seen: ZoomLevel[] = []
  function Probe() {
    seen.push(useZoomLevel())
    return null
  }
  let setZoom: SetZoom = () => undefined
  render(
    <ReactFlowProvider>
      <Store root={root} onReady={(set) => (setZoom = set)}>
        <Probe />
        {extra}
      </Store>
    </ReactFlowProvider>,
  )
  act(() => setZoom(start))
  const zoomTo = (zoom: number) => act(() => setZoom(zoom))
  return { root, seen, zoomTo }
}

describe('useZoomLevel', () => {
  it('draws the Node again when the level changes, never for a zoom within the level', () => {
    const { seen, zoomTo } = setup(1)
    const before = seen.length
    expect(seen.at(-1)).toBe('full')

    for (const zoom of [0.95, 0.8, 0.7, 0.61, 0.6, 1.4, 2.5, 1]) zoomTo(zoom)
    expect(seen.length).toBe(before)

    zoomTo(0.59)
    expect(seen.length).toBe(before + 1)
    expect(seen.at(-1)).toBe('compact')
    for (const zoom of [0.55, 0.4, 0.31, 0.3, 0.5]) zoomTo(zoom)
    expect(seen.length).toBe(before + 1)

    zoomTo(0.29)
    expect(seen.length).toBe(before + 2)
    expect(seen.at(-1)).toBe('far')
    for (const zoom of [0.25, 0.2, 0.28]) zoomTo(zoom)
    expect(seen.length).toBe(before + 2)

    zoomTo(0.6)
    expect(seen.length).toBe(before + 3)
    expect(seen.at(-1)).toBe('full')
  })
})

describe('overlays/ZoomLevel.tsx', () => {
  it('marks the React Flow root with the level, and with the zoom only at the far level', () => {
    const { root, zoomTo } = setup(1, <ZoomLevelMarks />)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('full')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')

    zoomTo(0.45)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('compact')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')

    zoomTo(0.25)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('far')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('0.25')
    zoomTo(0.2)
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('0.2')

    zoomTo(0.7)
    expect(root.getAttribute(ZOOM_LEVEL_ATTRIBUTE)).toBe('full')
    expect(root.style.getPropertyValue(ZOOM_VARIABLE)).toBe('')
  })
})

/** A Node on the Canvas as React Flow draws it: its wrapper, its surface, a header with a button, a body with a field. */
function canvasNode(root: HTMLElement, { pinned = false, marked = true } = {}) {
  const node = document.createElement('div')
  node.className = pinned ? 'react-flow__node w-pinned' : 'react-flow__node'
  const surface = document.createElement('div')
  surface.className = 'w-node-surface'
  const header = document.createElement('div')
  if (marked) header.setAttribute('data-node-header', '')
  const button = document.createElement('button')
  header.append(button)
  const field = document.createElement('textarea')
  surface.append(header, field)
  node.append(surface)
  root.append(node)
  return { button, field }
}

describe('a field the level hides keeps no keyboard focus', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('hiddenByLevel: the body below full, the header too at far; never a pinned or an unmarked Node', () => {
    const root = document.createElement('div')
    const plain = canvasNode(root)
    const pinned = canvasNode(root, { pinned: true })
    const unmarked = canvasNode(root, { marked: false })
    expect(hiddenByLevel(plain.field, 'full')).toBe(false)
    expect(hiddenByLevel(plain.field, 'compact')).toBe(true)
    expect(hiddenByLevel(plain.button, 'compact')).toBe(false)
    expect(hiddenByLevel(plain.button, 'far')).toBe(true)
    expect(hiddenByLevel(pinned.field, 'far')).toBe(false)
    expect(hiddenByLevel(unmarked.field, 'far')).toBe(false)
  })

  it('the overlay takes the focus off a Note-like field when the level goes to compact, and off the header at far', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const plain = canvasNode(root)
    const pinned = canvasNode(root, { pinned: true })
    const { zoomTo } = setup(1, <ZoomLevelMarks />, root)

    plain.field.focus()
    expect(document.activeElement).toBe(plain.field)
    zoomTo(0.7)
    expect(document.activeElement).toBe(plain.field)
    zoomTo(0.5)
    expect(document.activeElement).not.toBe(plain.field)

    plain.button.focus()
    zoomTo(0.45)
    zoomTo(0.4)
    expect(document.activeElement).toBe(plain.button)
    zoomTo(0.2)
    expect(document.activeElement).not.toBe(plain.button)

    pinned.field.focus()
    zoomTo(0.6)
    zoomTo(0.2)
    expect(document.activeElement).toBe(pinned.field)
  })
})

describe('every Node type marks its header and title, or is a known exception', () => {
  /** Node types that stay full at every level, and why (F-SPEC "Zoom levels"). */
  const EXCEPTIONS: Record<string, string> = {
    'BrowserNode.tsx': 'its page is a <webview> laid over the Canvas by overlays/BrowserLayer.tsx',
    'DoneShelfNode.tsx': 'a row of chips placed by position, no header; its far view is not part of ticket 06',
    'TicketNode.tsx': 'whole at compact; a block without text at far (epic-frame.css)',
    'EpicFrameNode.tsx': 'a header of constant screen size at far (epic-frame.css)',
    'BindingAnchorNode.tsx': 'an invisible anchor of a Binding',
  }
  const folder = join(process.cwd(), 'src/renderer/canvas/nodes')
  const files = readdirSync(folder).filter((name) => name.endsWith('Node.tsx'))

  it.each(files)('%s', (name) => {
    const source = readFileSync(join(folder, name), 'utf8')
    const marked = source.includes('{...NODE_HEADER}') && source.includes('{...NODE_TITLE}')
    if (name in EXCEPTIONS) expect(marked, `${name} is listed as an exception`).toBe(false)
    else expect(marked, `${name} marks neither NODE_HEADER nor NODE_TITLE`).toBe(true)
  })

  it('the read-only Terminal of a Linked machine is marked like the Terminal', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/canvas/ReadOnlyTerminal.tsx'), 'utf8')
    expect(source).toContain('{...NODE_HEADER}')
    expect(source).toContain('{...NODE_TITLE}')
  })
})

describe('a Card runs its page at full, pinned, or in a focus tile', () => {
  const PROJECT = { id: 'demo-0000000a', name: 'demo', path: '/Users/test/projects/demo', branch: 'main' }

  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
    document.body.replaceChildren()
  })

  async function cardAt(zoom: number, { pinned = false, focus = false } = {}) {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string) => {
        if (channel === 'projects.list') return Promise.resolve({ ok: true, value: { projects: [PROJECT], activeId: PROJECT.id, revision: 1 } })
        if (channel === 'cards.get') return Promise.resolve({ ok: true, value: { projectId: PROJECT.id, cardId: 'c1', url: 'worfy-card://c1.0000000a/index.html', exists: true, title: 'Clock', revision: 1 } })
        return Promise.resolve({ ok: false, error: `no ${channel}` })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
    const { default: CardNode } = await import('../../src/renderer/canvas/nodes/CardNode')
    const props = { id: 'c1', selected: false, data: { node: { id: 'c1', kind: 'card', x: 0, y: 0, w: 300, h: 220, hidden: false, locked: false, pinned, tags: [], data: {} } } } as unknown as CanvasNodeProps
    const view = setup(zoom, <FocusTileContext.Provider value={focus}>{<CardNode {...props} />}</FocusTileContext.Provider>)
    await waitFor(() => expect(document.querySelector('[data-testid="card-frame"], [data-testid="card-placeholder"]')).not.toBeNull())
    return view
  }

  it.each([
    ['at full (0.6)', 0.6, {}, true],
    ['at compact (0.5)', 0.5, {}, false],
    ['at far (0.2)', 0.2, {}, false],
    ['pinned, at compact', 0.5, { pinned: true }, true],
    ['pinned, at far', 0.2, { pinned: true }, true],
    ['in a focus tile, at compact', 0.5, { focus: true }, true],
  ] as const)('%s', async (_name, zoom, options, running) => {
    await cardAt(zoom, options)
    expect(document.querySelector('[data-testid="card-frame"]') !== null).toBe(running)
    expect(document.querySelector('[data-testid="card-placeholder"]') !== null).toBe(!running)
  })
})
