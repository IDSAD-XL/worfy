// The page viewport of a Browser and its resize (worfy-browser ticket 18, ADR-0087): the viewport the
// Node's data asks for, how the page is fitted into the frame's body, where a point of the frames
// another window shows lies on the page, the <webview> the Browser layer lays out at the viewport and
// scales into the body, the settings sidebar that writes `data.viewport`, and the resize handles of a
// selected frame. Drawn in React Flow in jsdom with the real frame and layer; main (ipc) is faked.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { framePoint } from '../../src/renderer/browser/frames'
import { useFollowBrowserLives } from '../../src/renderer/browser/lives'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import { BROWSER_VIEWPORT_MAX, BROWSER_VIEWPORT_MIN, browserPageViewport, viewportFit } from '../../src/renderer/canvas/nodes/browser-viewport'
import BrowserLayer from '../../src/renderer/canvas/overlays/BrowserLayer'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { BrowserLife } from '../../src/shared/ipc/browser'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'

const PROJECT = 'view-0c0c0c0c'
const PROFILE = 'default'

// main: the Project's one profile, the lives it tells, every `browser.input` sent, and the
// `browser.frame` listener the frames of a page drawn elsewhere subscribe with.
const main = vi.hoisted(() => ({
  lives: [] as BrowserLife[],
  inputs: [] as Record<string, unknown>[],
  frame: null as ((event: { projectId: string; nodeId: string; image: string; width: number; height: number }) => void) | null,
}))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { input?: Record<string, unknown>; projectId?: string }) => {
    if (channel === 'browser.profiles.list') return Promise.resolve({ ok: true, value: { profiles: [{ id: PROFILE, name: 'default', origins: [], autopilot: false } satisfies BrowserProfile] } })
    if (channel === 'browser.control.list') return Promise.resolve({ ok: true, value: { controls: [] } })
    if (channel === 'browser.lives.list') return Promise.resolve({ ok: true, value: { projectId: input.projectId, lives: main.lives } })
    if (channel === 'browser.input') {
      main.inputs.push(input.input ?? {})
      return Promise.resolve({ ok: true, value: null })
    }
    return Promise.resolve({ ok: true, value: null })
  },
  subscribe: (channel: string, listener: never) => {
    if (channel === 'browser.frame') main.frame = listener
    return () => undefined
  },
}))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: PROJECT, projects: [{ id: PROJECT, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => null,
}))

/** The Browser layer's part for a frame drawn alone: it follows the lives of the Project. */
function Lives() {
  useFollowBrowserLives(PROJECT)
  return null
}

function browserNode(data: Record<string, unknown>, extra: Partial<Node> = {}, id = 'b1'): Node {
  const node: LayoutNode = { id, kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: PROFILE, url: 'http://127.0.0.1/page.html', ...data } }
  return { id: node.id, type: 'browser', position: { x: 0, y: 0 }, data: { node }, ...extra }
}

function draw(nodes: Node[], { layer = false } = {}) {
  const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={{ apply }}>
        <ReactFlowProvider>
          <Lives />
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ browser: BrowserNode }}>
            {layer ? <BrowserLayer /> : null}
          </ReactFlow>
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
  return apply
}

const life = (over: Partial<BrowserLife>): BrowserLife => ({ nodeId: 'b1', live: true, unsaved: false, overLimit: false, picture: null, here: true, ...over })

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
  main.lives = []
  main.inputs = []
  main.frame = null
})

describe('the page viewport a Browser Node asks for', () => {
  it('is two whole sides inside the bounds; anything else — none, null, a part, a fraction, out of bounds — is the body', () => {
    expect(browserPageViewport({ viewport: { w: 1440, h: 900 } })).toEqual({ w: 1440, h: 900 })
    expect(browserPageViewport({ viewport: { w: BROWSER_VIEWPORT_MIN, h: BROWSER_VIEWPORT_MAX } })).toEqual({ w: BROWSER_VIEWPORT_MIN, h: BROWSER_VIEWPORT_MAX })
    for (const viewport of [undefined, null, 'big', { w: 1440 }, { w: 1440.5, h: 900 }, { w: BROWSER_VIEWPORT_MIN - 1, h: 900 }, { w: 1440, h: BROWSER_VIEWPORT_MAX + 1 }, { w: '1440', h: '900' }]) {
      expect(browserPageViewport({ viewport }), JSON.stringify(viewport)).toBeNull()
    }
  })

  it('is fitted whole into the body from its top-left corner; without one the page is the body', () => {
    expect(viewportFit({ w: 640, h: 411 }, null)).toEqual({ w: 640, h: 411, scale: 1 })
    // Wider than the body: the width decides.
    expect(viewportFit({ w: 640, h: 411 }, { w: 1280, h: 800 })).toEqual({ w: 1280, h: 800, scale: 0.5 })
    // Taller than the body: the height decides.
    expect(viewportFit({ w: 640, h: 422 }, { w: 390, h: 844 })).toEqual({ w: 390, h: 844, scale: 0.5 })
    // Smaller than the body: scaled up.
    expect(viewportFit({ w: 800, h: 800 }, { w: 400, h: 200 })).toEqual({ w: 400, h: 200, scale: 2 })
  })
})

describe('a point of the frames another window shows, on the page', () => {
  it('maps through the scale the picture is fitted with, not each side stretched to the box', () => {
    // A 1440 × 900 page in a 640 × 412 box: scale 640 / 1440, the picture 400 px high, 12 px empty under it.
    const box = { width: 640, height: 412 }
    const frame = { width: 1440, height: 900 }
    expect(framePoint(320, 100, box, frame)).toEqual({ x: 720, y: 225, inside: true })
    expect(framePoint(640, 400, box, frame)).toEqual({ x: 1440, y: 900, inside: true })
    // The empty strip under the picture is off the page.
    expect(framePoint(320, 406, box, frame)?.inside).toBe(false)
    // Without a viewport of its own the frame fills the box, as before.
    expect(framePoint(320, 206, box, { width: 640, height: 412 })).toEqual({ x: 320, y: 206, inside: true })
    expect(framePoint(1, 1, { width: 0, height: 412 }, frame)).toBeNull()
  })

  it('a click in the frames of a 1440 × 900 page drawn elsewhere reaches the page where it is on the picture; one beside the picture reaches nothing', async () => {
    main.lives = [life({ here: false })]
    draw([browserNode({ viewport: { w: 1440, h: 900 } })])
    const frames = await screen.findByTestId('browser-frames')
    await waitFor(() => expect(main.frame).not.toBeNull())
    act(() => main.frame?.({ projectId: PROJECT, nodeId: 'b1', image: btoa('jpeg'), width: 1440, height: 900 }))
    await waitFor(() => expect(frames.getAttribute('data-frame')).toBe('shown'))
    frames.getBoundingClientRect = () => ({ left: 100, top: 50, width: 640, height: 412, right: 740, bottom: 462, x: 100, y: 50, toJSON: () => ({}) })
    frames.setPointerCapture = () => undefined

    fireEvent.pointerDown(frames, { clientX: 100 + 320, clientY: 50 + 100, button: 0, pointerId: 1 })
    fireEvent.pointerUp(frames, { clientX: 100 + 320, clientY: 50 + 100, button: 0, pointerId: 1 })
    expect(main.inputs.map(({ type, x, y }) => ({ type, x, y }))).toEqual([
      { type: 'mousePressed', x: 720, y: 225 },
      { type: 'mouseReleased', x: 720, y: 225 },
    ])

    main.inputs = []
    fireEvent.pointerDown(frames, { clientX: 100 + 320, clientY: 50 + 408, button: 0, pointerId: 1 })
    fireEvent.pointerUp(frames, { clientX: 100 + 320, clientY: 50 + 408, button: 0, pointerId: 1 })
    expect(main.inputs).toEqual([])
  })
})

describe('the <webview> of a Browser with a page viewport', () => {
  const webview = () => document.querySelector<HTMLElement>('webview[data-browser-id="b1"]')

  it('is laid out at the viewport and scaled into the body; without one it fills the body', async () => {
    main.lives = [life({})]
    draw([browserNode({ viewport: { w: 1280, h: 800 } })], { layer: true })
    await waitFor(() => expect(webview()).not.toBeNull())
    // The body of a 640 × 440 frame: 638 × 410 (browserPageRect); 638 / 1280 is the smaller scale.
    expect(webview()!.style.width).toBe('1280px')
    expect(webview()!.style.height).toBe('800px')
    expect(webview()!.style.transform).toBe(`scale(${638 / 1280})`)
    expect(webview()!.parentElement!.style.width).toBe('638px')
    expect(webview()!.parentElement!.className).toContain('w-browser-layer__page--fitted')
  })

  it('has no size of its own without a viewport: the page is the body', async () => {
    main.lives = [life({})]
    draw([browserNode({})], { layer: true })
    await waitFor(() => expect(webview()).not.toBeNull())
    expect(webview()!.style.width).toBe('')
    expect(webview()!.style.transform).toBe('')
    expect(webview()!.parentElement!.className).not.toContain('--fitted')
  })
})

describe('the settings sidebar of a Browser', () => {
  it('opens from the header; a ready size, «Fit to card» and a typed size each go into `data.viewport` by a Layout operation', async () => {
    const apply = draw([browserNode({})])
    const button = await screen.findByTestId('browser-settings')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('browser-sidebar').getAttribute('aria-label')).toBe('Browser settings')
    expect((screen.getByTestId('browser-viewport-card') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByTestId('browser-viewport-1440x900'))
    expect(apply).toHaveBeenLastCalledWith({ op: 'patchData', id: 'b1', data: { viewport: { w: 1440, h: 900 } } })

    fireEvent.click(screen.getByTestId('browser-viewport-custom'))
    // Picking «Custom» writes nothing until Apply.
    expect(apply).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByTestId('browser-viewport-width'), { target: { value: '100' } })
    expect((screen.getByTestId('browser-viewport-apply') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('browser-viewport-width'), { target: { value: '1024' } })
    fireEvent.change(screen.getByTestId('browser-viewport-height'), { target: { value: '700' } })
    fireEvent.click(screen.getByTestId('browser-viewport-apply'))
    expect(apply).toHaveBeenLastCalledWith({ op: 'patchData', id: 'b1', data: { viewport: { w: 1024, h: 700 } } })

    // Esc in the sidebar closes it.
    fireEvent.keyDown(screen.getByTestId('browser-viewport-card'), { key: 'Escape' })
    expect(screen.queryByTestId('browser-sidebar')).toBeNull()
  })

  it('shows the viewport the Node keeps, and «Fit to card» writes null', async () => {
    const apply = draw([browserNode({ viewport: { w: 390, h: 844 } })])
    fireEvent.click(await screen.findByTestId('browser-settings'))
    expect((screen.getByTestId('browser-viewport-390x844') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId('browser-sidebar').textContent).toContain('The page is 390 × 844 px')
    fireEvent.click(screen.getByTestId('browser-viewport-card'))
    expect(apply).toHaveBeenLastCalledWith({ op: 'patchData', id: 'b1', data: { viewport: null } })
    fireEvent.click(screen.getByTestId('browser-sidebar-close'))
    expect(screen.queryByTestId('browser-sidebar')).toBeNull()
  })
})

describe('the resize handles of a Browser frame', () => {
  it('show on a selected frame, not on another', async () => {
    draw([browserNode({}, { selected: true }), browserNode({}, { position: { x: 900, y: 0 } }, 'b2')])
    await screen.findAllByTestId('browser-frame')
    const handles = (id: string) => document.querySelectorAll(`.react-flow__node[data-id="${id}"] .react-flow__resize-control`).length
    expect(handles('b1')).toBeGreaterThan(0)
    expect(handles('b2')).toBe(0)
  })
})
