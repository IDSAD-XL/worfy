// The Canvas has no semantic zoom (worfy-canvas ticket 20, the owner's decision of 2026-10-21): at
// every zoom each Node is drawn whole, only scaled by the Canvas transform. Ticket 06 had drawn a
// Node as its header alone or as a block of its kind below some zoom; nothing of that is left.
// jsdom applies no CSS: what the Canvas looks like zoomed out is test/e2e/zoom-whole-nodes.spec.ts.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
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

describe('no stylesheet draws a Node by the zoom', () => {
  it('none keys a rule on a zoom level or on the zoom itself', () => {
    const found = stylesheets()
      .filter(({ text }) => /data-zoom-level|--w-zoom|data-node-title/.test(text))
      .map(({ name }) => name)
    expect(found).toEqual([])
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
  }
  const folder = join(renderer, 'canvas/nodes')
  const files = readdirSync(folder).filter((name) => name.endsWith('Node.tsx'))

  it.each(files)('%s', (name) => {
    const marked = readFileSync(join(folder, name), 'utf8').includes('{...NODE_HEADER}')
    expect(marked, name in EXCEPTIONS ? `${name} is listed as an exception` : `${name} does not mark its header`).toBe(!(name in EXCEPTIONS))
  })

  it('every exception is a Node type that still exists', () => {
    expect(Object.keys(EXCEPTIONS).filter((name) => !files.includes(name))).toEqual([])
  })

  it('the read-only Terminal of a Linked machine is marked like the Terminal', () => {
    expect(readFileSync(join(renderer, 'canvas/ReadOnlyTerminal.tsx'), 'utf8')).toContain('{...NODE_HEADER}')
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
