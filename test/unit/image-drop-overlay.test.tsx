// The overlay that turns a paste or a drop on the Canvas into image Nodes
// (src/renderer/canvas/overlays/ImageDrop.tsx, worfy-canvas ticket 23): which events it takes and
// where the image lands. What happens to the files after that is addImages()'s
// (test/unit/image-node.test.tsx); here it is a fake that records its calls.
//
// The Canvas is a plain element at (100, 50), 800 × 600; "on screen" is its offsetParent, which
// jsdom never sets on its own. A point of the screen maps to the plane as (x + 1000, y + 2000).
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINKED_CANVAS_IMAGES } from '../../src/shared/ipc/canvas-images'

const PROJECT = 'demo-0a1b2c3d'
const READ_ONLY = 'Mini gives this Machine read-only access'

const env = vi.hoisted(() => ({
  canvas: null as HTMLElement | null,
  readOnly: null as string | null,
  machine: null as string | null,
  added: [] as { files: readonly File[]; at: { x: number; y: number }; deps: Record<string, unknown> }[],
  toasts: [] as Record<string, unknown>[],
  invoked: [] as [string, unknown][],
}))

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => ({ x: point.x + 1000, y: point.y + 2000 }) }),
  useStoreApi: () => ({ getState: () => ({ domNode: env.canvas }) }),
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  activeProject: () => ({ id: PROJECT }),
  useProjects: () => undefined,
  useReadOnly: () => env.readOnly,
}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input: unknown) => {
    env.invoked.push([channel, input])
    return Promise.resolve({ ok: true, value: { ok: false, error: 'not in this test' } })
  },
  windowMachine: () => env.machine,
}))
vi.mock('../../src/renderer/toast/toasts', () => ({
  showToast: (input: Record<string, unknown>) => {
    env.toasts.push(input)
    return 'toast'
  },
}))
vi.mock('../../src/renderer/canvas/image-drop', () => ({
  addImages: (files: readonly File[], at: { x: number; y: number }, deps: Record<string, unknown>) => {
    env.added.push({ files, at, deps })
    return Promise.resolve(files.length)
  },
}))

const { default: ImageDrop } = await import('../../src/renderer/canvas/overlays/ImageDrop')

const picture = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'picture.png', { type: 'image/png' })

let canvas: HTMLElement
let nodeInside: HTMLElement
let plane: HTMLElement

/** Shows the Canvas on screen or takes it off (another view in front). */
function onScreen(shown: boolean): void {
  Object.defineProperty(canvas, 'offsetParent', { configurable: true, get: () => (shown ? document.body : null) })
}

function paste(target: EventTarget, files: readonly File[] = [picture]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files } })
  target.dispatchEvent(event)
  return event
}

function drag(type: 'dragover' | 'drop', target: EventTarget, at = { x: 300, y: 200 }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
  const dataTransfer = { types: ['Files'], files: [picture], dropEffect: 'unset' }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  target.dispatchEvent(event)
  return event as unknown as Event & { dataTransfer: typeof dataTransfer }
}

const pointerAt = (x: number, y: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))

beforeEach(() => {
  env.readOnly = null
  env.machine = null
  env.added.length = 0
  env.toasts.length = 0
  env.invoked.length = 0
  canvas = document.createElement('div')
  canvas.className = 'react-flow'
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600, x: 100, y: 50, toJSON: () => ({}) })
  plane = document.createElement('div')
  plane.className = 'react-flow__pane'
  const node = document.createElement('div')
  node.className = 'react-flow__node react-flow__node-session'
  nodeInside = document.createElement('span')
  node.append(nodeInside)
  canvas.append(plane, node)
  document.body.append(canvas)
  env.canvas = canvas
  onScreen(true)
})

afterEach(() => {
  cleanup()
  canvas.remove()
})

describe('a paste on the Canvas', () => {
  it('lands under the pointer while the pointer is over the Canvas, and goes to main through canvasImage.add', async () => {
    render(<ImageDrop />)
    pointerAt(300, 200)
    const event = paste(document.body)
    expect(event.defaultPrevented).toBe(true)
    expect(env.added).toHaveLength(1)
    expect(env.added[0]?.files).toEqual([picture])
    expect(env.added[0]?.at).toEqual({ x: 1300, y: 2200 })
    expect(env.added[0]?.deps.projectId).toBe(PROJECT)
    await (env.added[0]?.deps.store as (input: unknown) => Promise<unknown>)({ projectId: PROJECT, name: 'picture.png', data: 'AAAA' })
    expect(env.invoked).toEqual([['canvasImage.add', { projectId: PROJECT, name: 'picture.png', data: 'AAAA' }]])
  })

  it('lands in the middle of the Canvas while the pointer is off it, or has not moved yet', () => {
    render(<ImageDrop />)
    paste(document.body)
    pointerAt(20, 700)
    paste(canvas)
    expect(env.added.map((each) => each.at)).toEqual([
      { x: 1500, y: 2350 },
      { x: 1500, y: 2350 },
    ])
  })

  it('is not taken while the Canvas is not on screen, in a text field, or from outside the Canvas with the focus there', () => {
    render(<ImageDrop />)
    onScreen(false)
    const hidden = paste(document.body)
    onScreen(true)
    const field = document.createElement('textarea')
    canvas.append(field)
    const typed = paste(field)
    const outside = document.createElement('div')
    document.body.append(outside)
    const elsewhere = paste(outside)
    outside.remove()
    const empty = paste(document.body, [])
    expect([hidden, typed, elsewhere, empty].map((event) => event.defaultPrevented)).toEqual([false, false, false, false])
    expect(env.added).toEqual([])
  })
})

describe('a drop on the Canvas', () => {
  it('on the empty plane makes the Nodes where the files were let go', () => {
    render(<ImageDrop />)
    const over = drag('dragover', plane, { x: 400, y: 300 })
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    const drop = drag('drop', plane, { x: 400, y: 300 })
    expect(drop.defaultPrevented).toBe(true)
    expect(env.added.map((each) => each.at)).toEqual([{ x: 1400, y: 2300 }])
  })

  it('on a Node stays the Node\'s: nothing is made and the event is left to the Node', () => {
    render(<ImageDrop />)
    const over = drag('dragover', nodeInside)
    const drop = drag('drop', nodeInside)
    expect(over.defaultPrevented).toBe(false)
    expect(over.dataTransfer.dropEffect).toBe('unset')
    expect(drop.defaultPrevented).toBe(false)
    expect(env.added).toEqual([])
  })
})

describe('where nothing may be made', () => {
  it('on a read-only screen a paste and a drop make nothing, a toast says why, and the cursor says no', () => {
    env.readOnly = READ_ONLY
    env.machine = '22222222-2222-4222-8222-222222222222'
    render(<ImageDrop />)
    expect(paste(document.body).defaultPrevented).toBe(true)
    expect(drag('dragover', plane).dataTransfer.dropEffect).toBe('none')
    drag('drop', plane)
    expect(env.added).toEqual([])
    expect(env.toasts).toEqual([
      { kind: 'info', key: `image-read-only:${PROJECT}`, projectId: PROJECT, text: READ_ONLY, testId: 'image-refused' },
      { kind: 'info', key: `image-read-only:${PROJECT}`, projectId: PROJECT, text: READ_ONLY, testId: 'image-refused' },
    ])
  })

  it("on a Linked machine's Canvas with full access a paste and a drop make nothing and send nothing; a toast says why", () => {
    env.machine = '22222222-2222-4222-8222-222222222222'
    render(<ImageDrop />)
    expect(paste(document.body).defaultPrevented).toBe(true)
    expect(drag('dragover', plane).dataTransfer.dropEffect).toBe('none')
    drag('drop', plane)
    expect(env.added).toEqual([])
    expect(env.invoked).toEqual([])
    expect(env.toasts).toEqual([
      { kind: 'info', key: `image-linked:${PROJECT}`, projectId: PROJECT, text: LINKED_CANVAS_IMAGES, testId: 'image-refused' },
      { kind: 'info', key: `image-linked:${PROJECT}`, projectId: PROJECT, text: LINKED_CANVAS_IMAGES, testId: 'image-refused' },
    ])
  })
})
