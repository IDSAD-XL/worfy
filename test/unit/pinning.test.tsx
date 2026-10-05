// Pinning a Node to the screen (src/renderer/canvas/pinning.ts): the coordinates of a pinned Node
// are screen coordinates of the Canvas, so pinning and unpinning convert between the two through
// the viewport, and a pinned Node is placed on the plane anew for every viewport.
import { describe, expect, it } from 'vitest'
import type { LayoutNode, Viewport } from '../../src/shared/layout/types'
import { canvasToScreen, pinOp, placePinned, screenToCanvas, unpinOp } from '../../src/renderer/canvas/pinning'

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
  it('pinning keeps the Node where it is on the screen: its position becomes screen coordinates', () => {
    expect(pinOp(node({ x: 200, y: 200 }), { x: 40, y: -20, zoom: 0.5 })).toEqual({ op: 'pin', id: 'n1', pinned: true, x: 140, y: 80 })
  })

  it('unpinning at zoom 0.5 puts the Node on the canvas under its place on the screen', () => {
    expect(unpinOp(node({ pinned: true, x: 140, y: 80 }), { x: 40, y: -20, zoom: 0.5 })).toEqual({ op: 'pin', id: 'n1', pinned: false, x: 200, y: 200 })
  })

  it('a pinned Node stays put on the screen after the canvas pans and zooms in between', () => {
    const pinnedAt = { x: 0, y: 0, zoom: 1 }
    const pin = pinOp(node({ x: 300, y: 150 }), pinnedAt)
    const pinned = node({ pinned: true, x: pin.x, y: pin.y })
    const later = { x: -900, y: 420, zoom: 0.5 }
    const unpin = unpinOp(pinned, later)
    // The canvas point now under the screen point (300, 150).
    expect(canvasToScreen({ x: unpin.x, y: unpin.y }, later)).toEqual({ x: 300, y: 150 })
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

  it('returns the same array when nothing is pinned, so React Flow sees no change', () => {
    const flow = [{ id: 'b', position: { x: 5, y: 6 }, width: 220, height: 120, data: { node: node({ id: 'b' }) } }]
    expect(placePinned(flow, { x: 10, y: 10, zoom: 2 })).toBe(flow)
  })
})
