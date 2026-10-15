// Pinning a Node to the screen (src/renderer/canvas/pinning.ts): the coordinates of a pinned Node
// are screen coordinates of the Canvas, so pinning and unpinning convert between the two through
// the viewport, and a pinned Node is placed on the plane anew for every viewport.
import { describe, expect, it } from 'vitest'
import type { LayoutNode, Viewport } from '../../src/shared/layout/types'
import { COLUMN_GAP, FRAME_PADDING, HEADER_HEIGHT, ROW_GAP, TICKET_HEIGHT, TICKET_WIDTH, TICKETS_TOP } from '../../src/renderer/canvas/epic-layout'
import {
  canvasToScreen,
  clearToolbarPlacement,
  epicHeaderBand,
  FOCUS_ENTRY_OFFSET,
  FOCUS_ENTRY_SIZE,
  PINNED_Z_INDEX,
  pinnedScreenPoint,
  pinOp,
  placePinned,
  planeToolbarStyle,
  screenToCanvas,
  toolbarRect,
  unpinOp,
  type PlaneRect,
  type ToolbarKeepOut,
} from '../../src/renderer/canvas/pinning'

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

describe('a pinned Node is shown clear of the minimap', () => {
  // The minimap's corner at the bottom right, margins included: x from 560, y from 420.
  const size = { width: 800, height: 600, minimap: { width: 240, height: 180 } }
  const overlapsCorner = (point: { x: number; y: number }, w = 220, h = 120): boolean => point.x + w > 800 - 240 && point.y + h > 600 - 180

  it('is moved out of the corner when it is saved in it', () => {
    const shown = pinnedScreenPoint(node({ pinned: true, x: 1500, y: 900 }), size)
    expect(overlapsCorner(shown)).toBe(false)
    // Up, the shorter way out (180 against 240 to the left).
    expect(shown).toEqual({ x: 800 - 220, y: 600 - 180 - 120 })
  })

  it('takes the shorter way out of the corner: to the left when that is shorter', () => {
    // Overlaps the corner by 20 to the right of its left edge and by 100 below its top edge.
    expect(pinnedScreenPoint(node({ pinned: true, x: 360, y: 400 }), size)).toEqual({ x: 800 - 240 - 220, y: 400 })
    expect(pinnedScreenPoint(node({ pinned: true, x: 500, y: 330 }), size)).toEqual({ x: 500, y: 600 - 180 - 120 })
  })

  it('stays where it was saved when it only touches the corner or is beside it', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 340, y: 470 }), size)).toEqual({ x: 340, y: 470 })
    expect(pinnedScreenPoint(node({ pinned: true, x: 580, y: 300 }), size)).toEqual({ x: 580, y: 300 })
  })

  it('goes the one way out that fits, and stays inside the Canvas when neither fits', () => {
    // Too wide to stand left of the corner: only up is possible.
    expect(pinnedScreenPoint(node({ pinned: true, x: 100, y: 500, w: 600 }), size)).toEqual({ x: 100, y: 600 - 180 - 120 })
    // Too tall to stand above it: only left is possible.
    expect(pinnedScreenPoint(node({ pinned: true, x: 500, y: 100, h: 500 }), size)).toEqual({ x: 800 - 240 - 220, y: 100 })
    // Neither fits: as close as the Canvas lets it, overlapping.
    expect(pinnedScreenPoint(node({ pinned: true, x: 500, y: 500, w: 700, h: 500 }), size)).toEqual({ x: 100, y: 100 })
  })

  it('ignores the corner while the Canvas size is not known', () => {
    expect(pinnedScreenPoint(node({ pinned: true, x: 1500, y: 900 }), { width: 0, height: 0, minimap: { width: 240, height: 180 } })).toEqual({ x: 1500, y: 900 })
  })

  it('pinning and unpinning use the same place out of the corner', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    expect(pinOp(node({ x: 700, y: 550 }), viewport, size)).toMatchObject({ x: 800 - 220, y: 600 - 180 - 120 })
    const unpin = unpinOp(node({ pinned: true, x: 1500, y: 900 }), viewport, size)
    expect({ x: unpin.x, y: unpin.y }).toEqual({ x: 800 - 220, y: 600 - 180 - 120 })
  })

  it('placePinned puts React Flow\'s Node out of the corner too', () => {
    const flow = [{ id: 'a', position: { x: 0, y: 0 }, width: 220, height: 120, data: { node: node({ id: 'a', pinned: true, x: 2000, y: 1500 }) } }]
    expect(placePinned(flow, { x: 0, y: 0, zoom: 1 }, size)[0]).toMatchObject({ position: { x: 580, y: 300 } })
  })
})

describe('the toolbars of a selection among the Nodes', () => {
  const plain = { x: 100, y: 200, width: 220, height: 120, z: 1000, pinned: false }

  it('is under the pinned Nodes when the selection has none, above the unselected Nodes of the plane', () => {
    const style = planeToolbarStyle([plain], 1, 'top', 12)
    expect(style?.zIndex).toBe(PINNED_Z_INDEX - 1)
    // Unselected Nodes have z 0 and pinned ones PINNED_Z_INDEX (React Flow adds 1000 to a selected one).
    expect(style?.zIndex).toBeGreaterThan(0)
    expect(style?.zIndex).toBeLessThan(PINNED_Z_INDEX)
  })

  it('is above the selection when it has a pinned Node', () => {
    const pinned = { ...plain, x: 400, z: PINNED_Z_INDEX + 1000, pinned: true }
    expect(planeToolbarStyle([pinned], 1, 'top', 12)?.zIndex).toBe(PINNED_Z_INDEX + 1001)
    expect(planeToolbarStyle([plain, pinned], 1, 'bottom', 12)?.zIndex).toBe(PINNED_Z_INDEX + 1001)
  })

  it('is centred on the side of the selection, `offset` screen pixels away, at its screen size', () => {
    const second = { ...plain, x: 500, y: 100 }
    // Bounds x 100..720, y 100..320; at zoom 2, 12 screen pixels are 6 canvas units.
    expect(planeToolbarStyle([plain, second], 2, 'top', 12)?.transform).toBe('translate(410px, 94px) scale(0.5) translate(-50%, -100%)')
    expect(planeToolbarStyle([plain, second], 2, 'bottom', 12)?.transform).toBe('translate(410px, 326px) scale(0.5) translate(-50%, 0%)')
  })

  it('takes pointer events, which React Flow\'s viewport does not', () => {
    expect(planeToolbarStyle([plain], 1, 'top', 12)?.pointerEvents).toBe('all')
  })

  it('is not drawn for an empty selection', () => {
    expect(planeToolbarStyle([], 1, 'top', 12)).toBeNull()
  })
})

describe('the selection toolbar takes a place around the selection that covers nothing', () => {
  // A frame at the origin; its top-row Tickets start TICKETS_TOP (92) below its top edge, the
  // columns stand COLUMN_GAP (24) apart and the rows ROW_GAP (12) apart, as epic-layout.ts lays them.
  const frame = { x: 0, y: 0, width: 1000, height: 600 }
  const band = epicHeaderBand(frame)
  const ticketAt = (column: number, row: number) => ({
    x: FRAME_PADDING + column * (TICKET_WIDTH + COLUMN_GAP),
    y: TICKETS_TOP + row * (TICKET_HEIGHT + ROW_GAP),
    width: TICKET_WIDTH,
    height: TICKET_HEIGHT,
  })
  const size = { width: 200, height: 34 }
  const focus = { size: FOCUS_ENTRY_SIZE, offset: FOCUS_ENTRY_OFFSET }
  const offsets = { top: 12, side: 12, bottom: 48 }
  const keepOut = (nodes: PlaneRect[], bands: PlaneRect[] = [band]): ToolbarKeepOut => ({ bands, nodes, focus })
  const place = (selection: PlaneRect, zones: ToolbarKeepOut, zoom = 1) => clearToolbarPlacement([selection], zones, zoom, size, offsets)
  const overlaps = (a: PlaneRect, b: PlaneRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  const focusRect = (selection: PlaneRect, zoom: number) => toolbarRect([selection], zoom, FOCUS_ENTRY_SIZE, { side: 'bottom', offset: FOCUS_ENTRY_OFFSET })!

  it('the band of a frame is its header and its column labels, no taller than the frame', () => {
    expect(band).toEqual({ x: 0, y: 0, width: 1000, height: TICKETS_TOP })
    // A collapsed frame is only its header row.
    expect(epicHeaderBand({ ...frame, height: HEADER_HEIGHT })).toEqual({ ...frame, height: HEADER_HEIGHT })
  })

  for (const zoom of [1, 0.6]) {
    it(`a top-row Ticket with a neighbour below — the toolbar covers neither the header, the neighbour nor the Focus button (zoom ${zoom})`, () => {
      const top = ticketAt(0, 0)
      const below = ticketAt(0, 1)
      const placement = place(top, keepOut([below]), zoom)
      const rect = toolbarRect([top], zoom, size, placement)!
      expect(overlaps(rect, band), 'the header').toBe(false)
      expect(overlaps(rect, below), 'the neighbour below').toBe(false)
      expect(overlaps(rect, focusRect(top, zoom)), 'the Focus button').toBe(false)
      // Beside it, on the right: nothing stands there.
      expect(placement).toEqual({ side: 'right', offset: 12 })
    })
  }

  it('on top when nothing is there', () => {
    expect(place(ticketAt(0, 1), keepOut([]))).toEqual({ side: 'top', offset: 12 })
    expect(place({ ...ticketAt(0, 0), x: 1200 }, keepOut([ticketAt(0, 0)]))).toEqual({ side: 'top', offset: 12 })
  })

  it('a Node above the selection is kept off as the header is: on the right instead', () => {
    // A Ticket of the second row: on top the toolbar would lie over the bottom of the Ticket above (12 px apart).
    expect(place(ticketAt(0, 1), keepOut([ticketAt(0, 0)]))).toEqual({ side: 'right', offset: 12 })
  })

  it('on the left when the top and the right are taken', () => {
    expect(place(ticketAt(1, 1), keepOut([ticketAt(1, 0), ticketAt(2, 1)]))).toEqual({ side: 'left', offset: 12 })
  })

  it('below the Focus button when the top and both sides are taken', () => {
    const selection = ticketAt(1, 0)
    expect(place(selection, keepOut([ticketAt(0, 0), ticketAt(2, 0)]))).toEqual({ side: 'bottom', offset: 48 })
    const rect = toolbarRect([selection], 1, size, { side: 'bottom', offset: 48 })!
    expect(rect.y).toBeGreaterThanOrEqual(focusRect(selection, 1).y + FOCUS_ENTRY_SIZE.height)
  })

  it('beside the selection the toolbar is level with its top edge, `side` pixels away', () => {
    const selection = ticketAt(1, 1)
    expect(toolbarRect([selection], 1, size, { side: 'right', offset: 12 })).toEqual({ x: selection.x + TICKET_WIDTH + 12, y: selection.y, width: 200, height: 34 })
    expect(toolbarRect([selection], 2, size, { side: 'left', offset: 12 })).toEqual({ x: selection.x - 6 - 100, y: selection.y, width: 100, height: 17 })
  })

  it('the Focus button is kept off: a small selection would have it under the toolbar beside it', () => {
    // 20 × 10 units: the Focus button below it (96 px wide, centred) reaches up beside the selection's top edge.
    const small = { x: 400, y: 400, width: 20, height: 10 }
    const above = { x: 300, y: 300, width: 300, height: 90 }
    const right = toolbarRect([small], 1, size, { side: 'right', offset: 12 })!
    expect(overlaps(right, focusRect(small, 1))).toBe(true)
    expect(place(small, keepOut([above], []))).toEqual({ side: 'bottom', offset: 48 })
    // Without the Focus button it would go to the right.
    expect(place(small, { bands: [], nodes: [above], focus: null })).toEqual({ side: 'right', offset: 12 })
  })

  it('at zoom 0.6 the toolbar is taller in canvas units and reaches a Node beside the selection it clears at zoom 1', () => {
    const selection = ticketAt(0, 1)
    // 45 units under the selection's top edge, right of it: 34 units of toolbar clear it at zoom 1, 56.7 at zoom 0.6 do not.
    const lower = { x: selection.x + TICKET_WIDTH + 20, y: selection.y + 45, width: 204, height: 160 }
    const zones = keepOut([ticketAt(0, 0), lower])
    expect(place(selection, zones, 1)).toEqual({ side: 'right', offset: 12 })
    expect(place(selection, zones, 0.6)).toEqual({ side: 'left', offset: 12 })
  })

  it('at zoom 0.5 the toolbar above reaches the band from a Ticket further down', () => {
    // 70 canvas units below the band: at zoom 1 the toolbar above (12 + 34 = 46) clears it, at zoom 0.5 (24 + 68 = 92) it does not.
    const lower = { ...ticketAt(0, 0), y: TICKETS_TOP + 70 }
    expect(place(lower, keepOut([]), 1)).toEqual({ side: 'top', offset: 12 })
    expect(place(lower, keepOut([]), 0.5)).toEqual({ side: 'right', offset: 12 })
  })

  it('a band or a Node beside the toolbar, not under it, does not move it', () => {
    // The toolbar is 200 px wide, centred on the Ticket: x 18..218; the band starts at 300.
    expect(place(ticketAt(0, 0), keepOut([], [{ ...band, x: 300 }]))).toEqual({ side: 'top', offset: 12 })
    // The Ticket above ends 12 units over the selection: 12 more than the toolbar on top would need, at zoom 1 it still reaches it.
    expect(place(ticketAt(0, 1), keepOut([{ ...ticketAt(0, 0), y: ticketAt(0, 0).y - 34 }]))).toEqual({ side: 'top', offset: 12 })
  })

  describe('when every place covers something', () => {
    it('a Ticket in the middle of the grid: the place that covers the least of the other Nodes, the earlier one on a tie', () => {
      // Top: the Ticket above, 200 × 34. Right and left: the neighbours from 12 units on, 188 × 34 each. Below: 200 × 34.
      const selection = ticketAt(1, 1)
      const zones = keepOut([ticketAt(1, 0), ticketAt(0, 1), ticketAt(2, 1), ticketAt(1, 2)])
      expect(place(selection, zones)).toEqual({ side: 'right', offset: 12 })
      // With no Ticket on the right the left is the least (it covers the same as the right did).
      expect(place(selection, keepOut([ticketAt(1, 0), ticketAt(0, 1), ticketAt(1, 2), { ...ticketAt(2, 1), x: ticketAt(2, 1).x - 10 }]))).toEqual({
        side: 'left',
        offset: 12,
      })
    })

    it('a frame header weighs more than any Node: a top-row Ticket in the middle of the grid keeps off the header', () => {
      // On top the toolbar would cover 5 units of the header band only (200 × 5), less than any side covers of a neighbour.
      const selection = { ...ticketAt(1, 0), y: TICKETS_TOP + 41 }
      const zones = keepOut([ticketAt(0, 0), ticketAt(2, 0), ticketAt(1, 1)])
      const top = toolbarRect([selection], 1, size, { side: 'top', offset: 12 })!
      expect(top.y).toBe(TICKETS_TOP - 5)
      expect(place(selection, zones)).toEqual({ side: 'right', offset: 12 })
    })

    it('the Focus button weighs as a header does', () => {
      // A small selection under a header band, with Nodes on both sides and below. Beside it the toolbar would
      // cover a little of the Focus button and less of the Nodes than below; below it covers the Focus button not at all.
      const small = { x: 400, y: 400, width: 20, height: 10 }
      const header = { x: 300, y: 300, width: 300, height: 90 }
      const nodes = [{ x: 100, y: 380, width: 280, height: 200 }, { x: 440, y: 380, width: 280, height: 200 }, { x: 300, y: 455, width: 300, height: 100 }]
      expect(place(small, keepOut(nodes, [header]))).toEqual({ side: 'bottom', offset: 48 })
      // Without the Focus button the right would cover the least.
      expect(place(small, { bands: [header], nodes, focus: null })).toEqual({ side: 'right', offset: 12 })
    })
  })

  it('a selection with a pinned Node keeps the toolbar on top whatever is there: it moves over the plane as the Canvas pans', () => {
    const selection = ticketAt(1, 1)
    const zones = keepOut([ticketAt(1, 0), ticketAt(0, 1), ticketAt(2, 1), ticketAt(1, 2)])
    expect(clearToolbarPlacement([{ ...selection, pinned: true }], zones, 1, size, offsets)).toEqual({ side: 'top', offset: 12 })
    expect(clearToolbarPlacement([{ ...ticketAt(0, 1), pinned: false }, { ...selection, pinned: true }], zones, 1, size, offsets)).toEqual({ side: 'top', offset: 12 })
    expect(clearToolbarPlacement([{ ...selection, pinned: false }], zones, 1, size, offsets)).toEqual({ side: 'right', offset: 12 })
  })

  it('an empty selection gets the first place', () => {
    expect(clearToolbarPlacement([], keepOut([]), 1, size, offsets)).toEqual({ side: 'top', offset: 12 })
  })

  it('toolbarRect is where planeToolbarStyle draws the toolbar', () => {
    const selection = ticketAt(0, 0)
    const plain = { ...selection, z: 1000, pinned: false }
    expect(planeToolbarStyle([plain], 1, 'bottom', 48)?.transform).toBe('translate(118px, 300px) scale(1) translate(-50%, 0%)')
    expect(toolbarRect([plain], 1, size, { side: 'bottom', offset: 48 })).toEqual({ x: 18, y: 300, width: 200, height: 34 })
    expect(planeToolbarStyle([plain], 2, 'right', 12)?.transform).toBe('translate(226px, 92px) scale(0.5) translate(0%, 0%)')
    expect(toolbarRect([plain], 2, size, { side: 'right', offset: 12 })).toEqual({ x: 226, y: 92, width: 100, height: 17 })
    expect(planeToolbarStyle([plain], 2, 'left', 12)?.transform).toBe('translate(10px, 92px) scale(0.5) translate(-100%, 0%)')
    expect(toolbarRect([plain], 2, size, { side: 'left', offset: 12 })).toEqual({ x: -90, y: 92, width: 100, height: 17 })
    expect(toolbarRect([], 1, size, { side: 'top', offset: 12 })).toBeNull()
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
