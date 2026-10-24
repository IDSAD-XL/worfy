// The Canvas has no semantic zoom (worfy-canvas ticket 20, the owner's decision of 2026-10-21): at
// every zoom each Node is drawn whole, only scaled by the Canvas transform. Ticket 06 had drawn a
// Node as its header alone or as a block of its kind below some zoom; nothing of that is left.
// jsdom applies no CSS: what the Canvas looks like zoomed out is test/e2e/zoom-whole-nodes.spec.ts.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NODE_HEADER } from '../../src/renderer/canvas/node-header'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
import { PLACE_MS } from '../../src/renderer/toast/placement'
import { ToastRegion } from '../../src/renderer/toast/ToastRegion'
import { resetToasts, showToast } from '../../src/renderer/toast/toasts'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const renderer = join(process.cwd(), 'src/renderer')

/** Every stylesheet of the renderer, by its path from src/renderer. */
function stylesheets(folder = renderer): { name: string; text: string }[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return stylesheets(path)
    return entry.name.endsWith('.css') ? [{ name: path.slice(renderer.length + 1), text: readFileSync(path, 'utf8') }] : []
  })
}

/** The selectors of a stylesheet: the text before each `{` back to the last `}` or `;`, comments taken out. */
function selectorsOf(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('{')
    .slice(0, -1)
    .map((part) => part.slice(Math.max(part.lastIndexOf('}'), part.lastIndexOf(';')) + 1).trim())
}

describe('no stylesheet draws a Node by the zoom', () => {
  // A rule can follow the zoom only through something on the page that changes with it: a mark that
  // code puts on the React Flow root by zoom (any attribute or class named after the zoom or the
  // scale), or the viewport's own inline `transform: scale(...)` read by an attribute selector.
  // shortcut: a mark named after neither (say `[data-far]`) passes here, redo if one is ever needed;
  // the e2e test/e2e/zoom-whole-nodes.spec.ts sees what such a rule hides.
  const FOLLOWS_ZOOM = /zoom|scale|transform|\[style/i

  it('none keys a selector on the zoom, the scale, the viewport transform or an inline style', () => {
    const found = stylesheets().flatMap(({ name, text }) => selectorsOf(text).filter((selector) => FOLLOWS_ZOOM.test(selector)).map((selector) => `${name}: ${selector}`))
    expect(found).toEqual([])
  })

  it('none reads a zoom variable or the far title mark of ticket 06', () => {
    const found = stylesheets()
      .filter(({ text }) => /--w-zoom|data-node-title/.test(text))
      .map(({ name }) => name)
    expect(found).toEqual([])
  })

  it.each([
    ['.react-flow[data-zoom-level="far"] .w-ticket > *'],
    ['.react-flow__viewport[style*="scale(0.2"] .w-node-surface > :not([data-node-header])'],
    ['.react-flow[data-zoomed-out] .w-note__text'],
    ['.w-canvas.is-scaled-down .w-node-surface'],
  ])('the check finds %s', (selector) => {
    expect(selectorsOf(`/* a rule */\n${selector} {\n  opacity: 0;\n}\n`).some((each) => FOLLOWS_ZOOM.test(each))).toBe(true)
  })
})

describe('every Node type marks its header row, or is a known exception', () => {
  // The mark (node-header.ts) is what the toasts keep clear of in a focus tile (toast/ToastRegion.tsx).
  const EXCEPTIONS: Record<string, string> = {
    'BrowserNode.tsx': 'its page is a <webview> laid over the Canvas by overlays/BrowserLayer.tsx',
    'DoneShelfNode.tsx': 'a row of chips placed by position, no header',
    'TicketNode.tsx': 'its card is its header; a focused Ticket has a view of its own',
    'EpicFrameNode.tsx': 'a frame, never in a focus tile',
    'BindingAnchorNode.tsx': 'an invisible anchor of a Binding',
    'ImageNode.tsx': 'the image fills the card whole; there is no header row to keep clear of',
  }
  /** Node types with more than one header: a live Session and a Session read from its transcript. */
  const HEADERS: Record<string, number> = { 'SessionNode.tsx': 2 }
  const folder = join(renderer, 'canvas/nodes')
  const files = readdirSync(folder).filter((name) => name.endsWith('Node.tsx'))

  it.each(files)('%s', (name) => {
    const marks = readFileSync(join(folder, name), 'utf8').split('{...NODE_HEADER}').length - 1
    const expected = name in EXCEPTIONS ? 0 : (HEADERS[name] ?? 1)
    expect(marks, name in EXCEPTIONS ? `${name} is listed as an exception` : `${name}: marked headers`).toBe(expected)
  })

  it('every listed Node type still exists', () => {
    expect([...Object.keys(EXCEPTIONS), ...Object.keys(HEADERS)].filter((name) => !files.includes(name))).toEqual([])
  })

  it('the read-only Terminal of a Linked machine is marked like the Terminal', () => {
    expect(readFileSync(join(renderer, 'canvas/ReadOnlyTerminal.tsx'), 'utf8')).toContain('{...NODE_HEADER}')
  })
})

describe('the toasts keep clear of a marked Node header in a focus tile', () => {
  afterEach(() => {
    cleanup()
    resetToasts()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it.each([
    ['in a focus tile, the stack goes below the header', true, `${180 + 12}px`],
    ['on the Canvas, the header is not kept clear of', false, '12px'],
  ] as const)('%s', (_name, inFocus, top) => {
    vi.useFakeTimers()
    resetToasts()
    // jsdom lays nothing out: each element's box is given here, in window px.
    const boxes = new Map<Element, DOMRect>()
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return boxes.get(this) ?? new DOMRect(0, 0, 0, 0)
    })
    try {
      const tile = document.body.appendChild(document.createElement('div'))
      if (inFocus) tile.className = 'w-focus'
      const header = tile.appendChild(document.createElement('div'))
      for (const [name, value] of Object.entries(NODE_HEADER)) header.setAttribute(name, value)
      // A Node's header across the top of the right column (x 904..1264 of a 1280 px window): no
      // room above it for the stack.
      boxes.set(header, new DOMRect(700, 0, 560, 180))
      render(<ToastRegion projectId={undefined} />)
      const section = screen.getByRole('region', { name: 'Notifications' })
      boxes.set(section, new DOMRect(904, 64, 360, 0))
      Object.defineProperty(section, 'scrollHeight', { configurable: true, value: 50 })
      act(() => {
        showToast({ kind: 'error', text: 'boom' })
      })
      act(() => {
        vi.advanceTimersByTime(PLACE_MS)
      })
      expect(section.style.top).toBe(top)
    } finally {
      measured.mockRestore()
    }
  })
})

type SetZoom = (zoom: number) => void

/** Hands the test a way to set React Flow's zoom. */
function Store({ onReady, children }: { onReady: (set: SetZoom) => void; children: ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    onReady((zoom) => store.setState({ transform: [12, 34, zoom] }))
  }, [store, onReady])
  return <>{children}</>
}

describe('a Card runs its page from zoom 0.4 up, and at any zoom when pinned or in a focus tile', () => {
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
    let setZoom: SetZoom = () => undefined
    render(
      <ReactFlowProvider>
        <Store onReady={(set) => (setZoom = set)}>
          <FocusTileContext.Provider value={focus}>
            <CardNode {...props} />
          </FocusTileContext.Provider>
        </Store>
      </ReactFlowProvider>,
    )
    act(() => setZoom(zoom))
    await waitFor(() => expect(document.querySelector('[data-testid="card-frame"], [data-testid="card-placeholder"]')).not.toBeNull())
  }

  it.each([
    ['at 1', 1, {}, true],
    ['at 0.6', 0.6, {}, true],
    ['at 0.5', 0.5, {}, true],
    ['at 0.4', 0.4, {}, true],
    ['at 0.39', 0.39, {}, false],
    ['at 0.2', 0.2, {}, false],
    ['pinned, at 0.2', 0.2, { pinned: true }, true],
    ['in a focus tile, at 0.2', 0.2, { focus: true }, true],
  ] as const)('%s', async (_name, zoom, options, running) => {
    await cardAt(zoom, options)
    expect(document.querySelector('[data-testid="card-frame"]') !== null).toBe(running)
    expect(document.querySelector('[data-testid="card-placeholder"]') !== null).toBe(!running)
  })
})
