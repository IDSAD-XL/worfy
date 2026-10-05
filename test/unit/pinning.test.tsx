// Pinning a Node to the screen (src/renderer/canvas/pinning.ts): the coordinates of a pinned Node
// are screen coordinates of the Canvas, so pinning and unpinning convert between the two through
// the viewport, and a pinned Node is placed on the plane anew for every viewport.
import { describe, expect, it } from 'vitest'
import type { LayoutNode, Viewport } from '../../src/shared/layout/types'
import { canvasToScreen, pinnedScreenPoint, pinOp, placePinned, screenToCanvas, unpinOp } from '../../src/renderer/canvas/pinning'

const node = (over: Partial<LayoutNode> = {}): LayoutNode => ({
  id: 'n1',
  kind: 'note',
  x: 100,
  y: 60,
  w: 220,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: {},
  ...over,
})

describe('screen and canvas coordinates', () => {
  it('at zoom 0.5 a screen point maps to the canvas point under it, and back', () => {
    const viewport: Viewport = { x: 40, y: -20, zoom: 0.5 }
    // screen = canvas * zoom + viewport offset
    expect(screenToCanvas({ x: 140, y: 80 }, viewport)).toEqual({ x: 200, y: 200 })
    expect(canvasToScreen({ x: 200, y: 200 }, viewport)).toEqual({ x: 140, y: 80 })
  })

  it('round-trips at every zoom of the range', () => {
    for (const zoom of [0.2, 0.5, 1, 1.75, 2.5]) {
      const viewport: Viewport = { x: -333, y: 71, zoom }
      const back = screenToCanvas(canvasToScreen({ x: 12.5, y: -48 }, viewport), viewport)
      expect(back.x).toBeCloseTo(12.5, 9)
      expect(back.y).toBeCloseTo(-48, 9)
    }
  })
})

describe('pin and unpin operations', () => {
  it('pinning keeps the Node where it is on the screen and at its screen size', () => {
    expect(pinOp(node({ x: 200, y: 200 }), { x: 40, y: -20, zoom: 0.5 })).toEqual({ op: 'pin', id: 'n1', pinned: true, x: 140, y: 80, w: 110, h: 60 })
  })

  it('unpinning at zoom 0.5 puts the Node on the canvas under its place on the screen, at the canvas size it is shown at', () => {
    expect(unpinOp(node({ pinned: true, x: 140, y: 80, w: 110, h: 60 }), { x: 40, y: -20, zoom: 0.5 })).toEqual({
      op: 'pin',
      id: 'n1',
      pinned: false,
      x: 200,
      y: 200,
      w: 220,
      h: 120,
    })
  })

  it('a pinned Node stays put on the screen, at its size, after the canvas pans and zooms in between', () => {
    const pinnedAt = { x: 25, y: -10, zoom: 1.5 }
    const pin = pinOp(node({ x: 300, y: 150 }), pinnedAt)
    const pinned = node({ pinned: true, x: pin.x, y: pin.y, w: pin.w, h: pin.h })
    const later = { x: -900, y: 420, zoom: 0.5 }
    const unpin = unpinOp(pinned, later)
    // The canvas rectangle now under the screen rectangle the Node had when it was pinned.
    expect(canvasToScreen({ x: unpin.x, y: unpin.y }, later)).toEqual(canvasToScreen({ x: 300, y: 150 }, pinnedAt))
    expect({ w: unpin.w * later.zoom, h: unpin.h * later.zoom }).toEqual({ w: 220 * 1.5, h: 120 * 1.5 })
  })
})

describe('a pinned Node is shown inside the Canvas', () => {
  const size = { width: 800, height: 600 }

  it('is shown at its saved place when it fits', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 300, y: 200 }), size)).toEqual({ x: 300, y: 200 })
  })

  it('is moved in when its saved place sticks out of a smaller Canvas, on each side', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 1500, y: 900 }), size)).toEqual({ x: 800 - 220, y: 600 - 120 })
    expect(pinnedScreenPoint(node({ pinned: true, x: -50, y: -30 }), size)).toEqual({ x: 0, y: 0 })
  })

  it('keeps its top-left corner in the Canvas when it is larger than the Canvas', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 50, y: 40, w: 1000, h: 900 }), size)).toEqual({ x: 0, y: 0 })
  })

  it('is left where it was saved while the Canvas size is not known', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 1500, y: 900 }), { width: 0, height: 0 })).toEqual({ x: 1500, y: 900 })
    expect(pinnedScreenPoint(node({ pinned: true, x: 1500, y: 900 }), undefined)).toEqual({ x: 1500, y: 900 })
  })

  it('pinning a Node that sticks out of the Canvas pins it moved in', () => {
    expect(pinOp(node({ x: 700, y: -40 }), { x: 0, y: 0, zoom: 1 }, size)).toMatchObject({ x: 800 - 220, y: 0 })
  })

  it('unpinning puts the Node on the canvas where it is shown, not where it was saved', () => {
    const viewport = { x: -100, y: 50, zoom: 2 }
    const unpin = unpinOp(node({ pinned: true, x: 1500, y: 900 }), viewport, size)
    expect(canvasToScreen({ x: unpin.x, y: unpin.y }, viewport)).toEqual({ x: 800 - 220, y: 600 - 120 })
  })
})

describe('placing pinned Nodes on the plane', () => {
  it('moves only pinned Nodes, to the canvas point under their screen place, with their screen size in canvas units', () => {
    const viewport: Viewport = { x: 40, y: -20, zoom: 0.5 }
    const flow = [
      { id: 'a', position: { x: 140, y: 80 }, width: 220, height: 120, data: { node: node({ id: 'a', pinned: true, x: 140, y: 80 }) } },
      { id: 'b', position: { x: 5, y: 6 }, width: 220, height: 120, data: { node: node({ id: 'b', x: 5, y: 6 }) } },
    ]
    const placed = placePinned(flow, viewport)
    expect(placed[0]).toMatchObject({ position: { x: 200, y: 200 }, width: 440, height: 240, draggable: false })
    expect(placed[1]).toBe(flow[1])
  })

  it('places a pinned Node that sticks out of the Canvas where it is shown, inside it', () => {
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 }
    const flow = [{ id: 'a', position: { x: 0, y: 0 }, width: 220, height: 120, data: { node: node({ id: 'a', pinned: true, x: 2000, y: 1500 }) } }]
    expect(placePinned(flow, viewport, { width: 800, height: 600 })[0]).toMatchObject({ position: { x: 580, y: 480 } })
  })

  it('returns the same array when nothing is pinned, so React Flow sees no change', () => {
    const flow = [{ id: 'b', position: { x: 5, y: 6 }, width: 220, height: 120, data: { node: node({ id: 'b' }) } }]
    expect(placePinned(flow, { x: 10, y: 10, zoom: 2 })).toBe(flow)
  })
})
