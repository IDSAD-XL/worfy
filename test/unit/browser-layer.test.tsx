// The Browser layer as a component (src/renderer/canvas/overlays/BrowserLayer.tsx, worfy-browser
// ticket 15): React Flow's store read through the layer's selector and JSON.parse, the page placed by
// the profile rule, and the profile written into the Node. Drawn in React Flow in jsdom with the real
// Browser frame (BrowserNode) and the real profiles store; only main (ipc) and the Project are faked.
// A Browser saved before profiles existed has a page address and no `profile` key: the layer must keep
// the key absent, or the rule that keeps such a Browser on `default` never applies to it.
// And a Browser in focus mode (worfy-browser ticket 17): the layer tells main it is on screen at a
// readable zoom, though its frame on the Canvas is not — main's sleep rules then keep it Live
// (test/unit/browser-sleep.test.ts) — and the Browsers left on the Canvas not; its tile is
// see-through and what focus mode covers is hidden, the page in the tile alone not inert, so it
// takes input; each page lies on its own tile.
import { act, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserProfilesNow } from '../../src/renderer/browser/profiles'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import BrowserLayer from '../../src/renderer/canvas/overlays/BrowserLayer'
import { FocusMode } from '../../src/renderer/focus/FocusMode'
import { focusLayoutChanged } from '../../src/renderer/focus/focus-state'
import { buildPreset, type TileTree } from '../../src/renderer/focus/split-tree'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import { BROWSER_SLEEP_BOUNDS } from '../../src/shared/settings/app-settings'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'

// main: `browser.profiles.list` answers the profiles each Project has here, and `browser.lives.list`
// that the Browsers `lives` are Live (worfy-browser ticket 05: the layer draws a page only for a Live
// Browser), drawn by this window but those of `away`; nothing else is asked.
const main = vi.hoisted(() => ({
  profiles: {} as Record<string, string[]>,
  screens: [] as { projectId: string; visible: string[]; zoom: number }[],
  lives: ['b0'],
  away: [] as string[],
}))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { projectId: string }) => {
    if (channel === 'browser.screen') {
      main.screens.push(input as unknown as { projectId: string; visible: string[]; zoom: number })
      return Promise.resolve({ ok: true, value: null })
    }
    if (channel === 'browser.lives.list') {
      const lives = main.lives.map((nodeId) => ({ nodeId, live: true, unsaved: false, overLimit: false, picture: null, here: !main.away.includes(nodeId) }))
      return Promise.resolve({ ok: true, value: { projectId: input.projectId, lives } })
    }
    if (channel !== 'browser.profiles.list') return Promise.resolve({ ok: false, error: `${channel} is not faked` })
    const profiles = (main.profiles[input.projectId] ?? []).map((id): BrowserProfile => ({ id, name: id, origins: [], autopilot: false }))
    return Promise.resolve({ ok: true, value: { profiles } })
  },
  subscribe: () => () => undefined,
}))

// Each test shows its own Project, so a list the profiles store kept from an earlier test is never read.
const shown = vi.hoisted(() => ({ projectId: '' }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: shown.projectId, projects: [{ id: shown.projectId, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => null,
}))

const page = 'http://127.0.0.1:3000/page.html'

/** An old Browser as the Canvas holds it: a page address and no `profile` key in its Layout Node. */
function oldBrowser(id: string): Node {
  const node: LayoutNode = { id, kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { url: page } }
  return { id, type: 'browser', position: { x: 0, y: 0 }, data: { node } }
}

function canvasTree(nodes: Node[], focus: TileTree | undefined, apply: (op: LayoutOpInput) => Promise<void>) {
  return (
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={{ apply }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ browser: BrowserNode }}>
            <BrowserLayer />
            {focus === undefined ? null : <FocusMode tree={focus} onChange={() => undefined} onExit={() => undefined} />}
          </ReactFlow>
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>
  )
}

function drawCanvas(nodes: Node[], focus?: TileTree) {
  const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
  render(canvasTree(nodes, focus, apply))
  return apply
}

describe('the Browser layer with an old Browser (a page address, no `profile` key)', () => {
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
    main.profiles = {}
  })

  it('asks for a profile when `default` is gone and two others are left: no <webview>, nothing written into the Node', async () => {
    shown.projectId = 'alpha-0a1b2c3d'
    main.profiles = { [shown.projectId]: ['work-bbbbbb', 'admin-aaaaaa'] }
    const apply = drawCanvas([oldBrowser('b0')])
    // Main's answer is in the profiles store, which the layer and the frame both read. React draws a
    // store change in one commit for both, before waitFor looks again, and the layer writes a profile
    // from that commit's effect: from here on the test sees what the layer did with the list.
    await waitFor(() => expect(browserProfilesNow(shown.projectId)?.map((profile) => profile.id)).toEqual(['work-bbbbbb', 'admin-aaaaaa']))
    // React Flow keeps a Node it has not measured hidden (jsdom measures nothing): found by test id.
    expect(screen.getByTestId('browser-choose-profile-button').textContent).toBe('Choose a profile')
    expect(screen.getByTestId('browser-choose-profile').textContent).toContain('The Browser profile of this Browser was deleted.')
    expect(document.querySelector('webview')).toBeNull()
    expect(screen.queryByTestId('browser-layer')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('opens it under `default` while `default` exists, and writes `default` into the Node', async () => {
    shown.projectId = 'beta-1a2b3c4d'
    main.profiles = { [shown.projectId]: ['default', 'admin-aaaaaa'] }
    const apply = drawCanvas([oldBrowser('b0')])
    await waitFor(() => expect(document.querySelector('webview[data-browser-id="b0"]')).not.toBeNull())
    const view = document.querySelector('webview[data-browser-id="b0"]')
    expect(view?.getAttribute('partition')).toBe('persist:worfy-browser-1a2b3c4d-default')
    expect(view?.getAttribute('src')).toBe(page)
    expect(screen.getByTestId('browser-frame').getAttribute('data-profile')).toBe('default')
    expect(screen.queryByTestId('browser-choose-profile')).toBeNull()
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ op: 'patchData', id: 'b0', data: { profile: 'default' } }))
    expect(apply).toHaveBeenCalledTimes(1)
  })
})

describe('a Browser in focus mode (worfy-browser ticket 17)', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    main.screens = []
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    main.profiles = {}
    main.lives = ['b0']
    main.away = []
  })

  /** A Browser whose frame is far off the Canvas on screen (jsdom's Canvas has no size: every frame is off it). */
  function farBrowser(id: string): Node {
    const node: LayoutNode = { id, kind: 'browser', x: 9000, y: 9000, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { url: page, profile: 'default' } }
    return { id, type: 'browser', position: { x: 9000, y: 9000 }, data: { node } }
  }

  it('off the Canvas the window shows it nowhere', async () => {
    shown.projectId = 'gamma-2a3b4c5d'
    main.profiles = { [shown.projectId]: ['default'] }
    drawCanvas([farBrowser('b0')])
    await waitFor(() => expect(document.querySelector('webview[data-browser-id="b0"]')).not.toBeNull())
    await waitFor(() => expect(main.screens.length).toBeGreaterThan(0))
    expect(main.screens.at(-1)!.visible).toEqual([])
  })

  it('shown in a focus tile it is on screen, at a zoom readable under any setting of Settings → Browser', async () => {
    shown.projectId = 'delta-3a4b5c6d'
    main.profiles = { [shown.projectId]: ['default'] }
    drawCanvas([farBrowser('b0')], buildPreset('columns', ['b0'])!)
    // The tile draws the frame's second copy; its body is the one the page is laid over.
    await waitFor(() => expect(document.querySelector('[data-testid="focus-tile"] [data-testid="browser-frame-body"]')).not.toBeNull())
    await waitFor(() => expect(main.screens.at(-1)?.visible).toEqual(['b0']))
    expect(main.screens.at(-1)!.zoom).toBeGreaterThanOrEqual(BROWSER_SLEEP_BOUNDS.zoom.max)
  })

  it('makes the tile see-through and hides what focus mode covers; of it only the page in the tile is not inert', async () => {
    shown.projectId = 'eps-4a5b6c7d'
    main.profiles = { [shown.projectId]: ['default'] }
    main.lives = ['b0', 'b1']
    drawCanvas([farBrowser('b0'), farBrowser('b1')], buildPreset('columns', ['b0'])!)
    await waitFor(() => expect(document.querySelector('webview[data-browser-id="b1"]')).not.toBeNull())
    const layer = screen.getByTestId('focus-mode')
    await waitFor(() => expect(layer.hasAttribute('data-see-through')).toBe(true))
    expect(screen.getByTestId('focus-tile').hasAttribute('data-see-through')).toBe(true)
    expect(layer.closest('[data-focus-covered]')).toBeNull()
    const inTile = document.querySelector('webview[data-browser-id="b0"]')!
    const kept = document.querySelector('webview[data-browser-id="b1"]')!
    await waitFor(() => expect(inTile.closest('[data-under-focus]')?.getAttribute('data-under-focus')).toBe('shown'))
    expect(inTile.closest('[data-focus-covered]')).not.toBeNull()
    await waitFor(() => expect(inTile.closest('[inert]')).toBeNull())
    // The Browser left on the Canvas stays rendered for main, invisible and inert.
    expect(kept.closest('[data-under-focus]')?.getAttribute('data-under-focus')).toBe('kept')
    expect(kept.closest('[inert]')).not.toBeNull()
    // The tile's body owns its page for a screen reader.
    const body = document.querySelector('[data-testid="focus-tile"] [data-testid="browser-frame-body"]')!
    expect(body.getAttribute('aria-owns')).toBe(inTile.closest('[data-under-focus]')!.id)
    // On screen: the Browser in the tile; the other's frame is off the Canvas, as without focus mode.
    await waitFor(() => expect(main.screens.at(-1)).toMatchObject({ visible: ['b0'], zoom: 1 }))
  })

  it('leaves the tile opaque and what focus mode covers inert while another window draws the page', async () => {
    shown.projectId = 'zeta-5a6b7c8d'
    main.profiles = { [shown.projectId]: ['default'] }
    main.away = ['b0']
    drawCanvas([farBrowser('b0')], buildPreset('columns', ['b0'])!)
    await waitFor(() => expect(screen.getAllByTestId('browser-frame').map((frame) => frame.getAttribute('data-page'))).toEqual(['frames', 'frames']))
    const layer = screen.getByTestId('focus-mode')
    expect(layer.hasAttribute('data-see-through')).toBe(false)
    expect(document.querySelector('[data-focus-covered]')).toBeNull()
    expect(document.querySelector('.react-flow')!.closest('[inert]')).not.toBeNull()
  })

  it('lays each page on its own tile body', async () => {
    shown.projectId = 'eta-6a7b8c9d'
    main.profiles = { [shown.projectId]: ['default'] }
    main.lives = ['b0', 'b1']
    drawCanvas([farBrowser('b0'), farBrowser('b1')], buildPreset('columns', ['b0', 'b1'])!)
    await waitFor(() => expect(document.querySelectorAll('[data-under-focus="shown"]')).toHaveLength(2))
    const boxes: Record<string, DOMRect> = { b0: new DOMRect(10, 20, 300, 200), b1: new DOMRect(400, 20, 250, 200) }
    for (const tile of document.querySelectorAll<HTMLElement>('[data-testid="focus-tile"]')) {
      const box = boxes[tile.dataset.nodeId!]!
      tile.querySelector<HTMLElement>('[data-testid="browser-frame-body"]')!.getBoundingClientRect = () => box
    }
    act(() => focusLayoutChanged())
    for (const [id, box] of Object.entries(boxes)) {
      const element = document.querySelector<HTMLElement>(`webview[data-browser-id="${id}"]`)!.parentElement!
      await waitFor(() => expect(element.style.transform).toBe(`translate(${box.x}px, ${box.y}px) scale(1)`))
      expect(element.style.width).toBe(`${box.width}px`)
    }
  })

  it('lays the page on its tile body again when the body changes size, and stops watching it once focus mode closes', async () => {
    const observers: { callback: () => void; targets: Element[]; disconnects: number }[] = []
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      entry: { callback: () => void; targets: Element[]; disconnects: number }
      constructor(callback: () => void) {
        this.entry = { callback, targets: [], disconnects: 0 }
        observers.push(this.entry)
      }
      observe(target: Element): void {
        this.entry.targets.push(target)
      }
      unobserve(): void {}
      disconnect(): void {
        this.entry.disconnects += 1
      }
    }
    shown.projectId = 'iota-8a9b0c1d'
    main.profiles = { [shown.projectId]: ['default'] }
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const nodes = [farBrowser('b0')]
    const { rerender } = render(canvasTree(nodes, buildPreset('columns', ['b0'])!, apply))
    await waitFor(() => expect(document.querySelectorAll('[data-under-focus="shown"]')).toHaveLength(1))
    const body = document.querySelector<HTMLElement>('[data-testid="focus-tile"] [data-testid="browser-frame-body"]')!
    body.getBoundingClientRect = () => new DOMRect(30, 40, 500, 300)
    act(() => {
      for (const observer of observers) if (observer.targets.includes(body)) observer.callback()
    })
    const element = document.querySelector<HTMLElement>('webview[data-browser-id="b0"]')!.parentElement!
    await waitFor(() => expect(element.style.transform).toBe('translate(30px, 40px) scale(1)'))
    expect(element.style.width).toBe('500px')
    const watching = observers.filter((observer) => observer.targets.includes(body))
    expect(watching.length).toBeGreaterThan(0)
    rerender(canvasTree(nodes, undefined, apply))
    await waitFor(() => expect(element.getAttribute('data-under-focus')).toBe('kept'))
    for (const observer of watching) expect(observer.disconnects).toBeGreaterThan(0)
  })

  it('shows the Browser nowhere again once focus mode closes', async () => {
    shown.projectId = 'theta-7a8b9c0d'
    main.profiles = { [shown.projectId]: ['default'] }
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const nodes = [farBrowser('b0')]
    const { rerender } = render(canvasTree(nodes, buildPreset('columns', ['b0'])!, apply))
    await waitFor(() => expect(main.screens.at(-1)?.visible).toEqual(['b0']))
    rerender(canvasTree(nodes, undefined, apply))
    await waitFor(() => expect(main.screens.at(-1)?.visible).toEqual([]))
    // The page is back on its frame on the Canvas.
    const element = document.querySelector('webview[data-browser-id="b0"]')!.parentElement!
    expect(element.style.transform).toMatch(/^translate\(9\d{3}px, 9\d{3}px\)$/)
    expect(element.getAttribute('data-under-focus')).toBe('kept')
  })
})
