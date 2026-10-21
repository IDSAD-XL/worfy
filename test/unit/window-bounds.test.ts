import { describe, expect, it } from 'vitest'
import { DEFAULT_SIZE, MIN_SIZE, POINTER_MARGIN, SIZE_CHANGE_TOP_SHIFT, boundsOffPoint, initialBounds, parseWindowState, serializeWindowState, sizeOnlyChange } from '../../src/shared/window/bounds'

const display = { x: 0, y: 25, width: 1440, height: 875 }

describe('parseWindowState', () => {
  it('reads saved bounds', () => {
    expect(parseWindowState('{"bounds":{"x":10,"y":40,"width":900,"height":600}}')).toEqual({ x: 10, y: 40, width: 900, height: 600 })
  })

  it.each([
    ['not JSON', '{'],
    ['an empty object', '{}'],
    ['a missing field', '{"bounds":{"x":10,"y":40,"width":900}}'],
    ['a zero width', '{"bounds":{"x":10,"y":40,"width":0,"height":600}}'],
    ['a string coordinate', '{"bounds":{"x":"10","y":40,"width":900,"height":600}}'],
  ])('treats %s as nothing saved', (_case, raw) => {
    expect(parseWindowState(raw)).toBeUndefined()
  })
})

describe('initialBounds', () => {
  it('opens at the default size when nothing is saved', () => {
    expect(initialBounds(undefined, [display])).toEqual(DEFAULT_SIZE)
  })

  it('reuses saved bounds that are on a display', () => {
    const saved = { x: 100, y: 120, width: 1000, height: 700 }
    expect(initialBounds(saved, [display])).toEqual(saved)
  })

  it('reuses bounds on a second display', () => {
    const saved = { x: 1600, y: 100, width: 1000, height: 700 }
    expect(initialBounds(saved, [display, { x: 1440, y: 0, width: 1920, height: 1080 }])).toEqual(saved)
  })

  it('falls back to the default size when the saved display is gone', () => {
    expect(initialBounds({ x: 3000, y: 100, width: 1000, height: 700 }, [display])).toEqual(DEFAULT_SIZE)
  })

  it('falls back when only a sliver of the window would be visible', () => {
    expect(initialBounds({ x: 1400, y: 100, width: 1000, height: 700 }, [display])).toEqual(DEFAULT_SIZE)
  })

  it('never opens smaller than the minimum size', () => {
    expect(initialBounds({ x: 100, y: 100, width: 300, height: 200 }, [display])).toEqual({ x: 100, y: 100, ...MIN_SIZE })
  })
})

describe('serializeWindowState', () => {
  it('writes what parseWindowState reads back', () => {
    const bounds = { x: -200, y: 40, width: 900, height: 600 }
    expect(JSON.parse(serializeWindowState(bounds))).toEqual({ bounds })
    expect(parseWindowState(serializeWindowState(bounds))).toEqual(bounds)
  })
})

// Quiet windows on macOS keep out from under the real mouse pointer (src/main/window.ts,
// keepOffPointer): AppKit sends the web view of a mouse-through window mouse entered and exited
// at the pointer when other windows appear or go away over it.
describe('boundsOffPoint', () => {
  it('leaves a window that keeps clear of the pointer where it is', () => {
    expect(boundsOffPoint({ x: 100, y: 100, width: 800, height: 520 }, { x: 1000, y: 300 }, [display])).toBeUndefined()
  })

  it('moves the window of the failed e2e run off the pointer: left, where most of it stays on the display', () => {
    // test/e2e/edges.spec.ts, pointer log of the failed gate: window (224, 95, 1600 × 1000),
    // pointer (1309, 367); a 1728 × 1117 display with a 38 DIP menu bar.
    const workArea = { x: 0, y: 38, width: 1728, height: 1079 }
    const window = { x: 224, y: 95, width: 1600, height: 1000 }
    const pointer = { x: 1309, y: 367 }
    const moved = boundsOffPoint(window, pointer, [workArea])
    expect(moved).toEqual({ x: 1309 - POINTER_MARGIN - 1600, y: 95, width: 1600, height: 1000 })
    expect(boundsOffPoint(moved!, pointer, [workArea])).toBeUndefined()
  })

  it('moves a window that fits beside the pointer wholly onto the display, the shortest way', () => {
    const window = { x: 100, y: 100, width: 800, height: 520 }
    const pointer = { x: 120, y: 300 }
    const moved = boundsOffPoint(window, pointer, [display])
    expect(moved).toEqual({ x: 120 + POINTER_MARGIN + 1, y: 100, width: 800, height: 520 })
    expect(boundsOffPoint(moved!, pointer, [display])).toBeUndefined()
  })

  it('also moves a window whose edge is within the margin of the pointer', () => {
    const window = { x: 100, y: 100, width: 800, height: 520 }
    const pointer = { x: 900 + POINTER_MARGIN - 1, y: 300 }
    const moved = boundsOffPoint(window, pointer, [display])
    expect(moved).toBeDefined()
    expect(moved!.x + moved!.width + POINTER_MARGIN).toBeLessThanOrEqual(pointer.x)
    expect(boundsOffPoint({ ...window, x: 100 - POINTER_MARGIN - 1 }, pointer, [display])).toBeUndefined()
  })

  it('never moves the window up past the top of the work area: macOS would push it back down when shown', () => {
    // Up would leave most of a full-width window on the display, but its top would be under the menu bar.
    const window = { x: 0, y: 30, width: 1440, height: 600 }
    const pointer = { x: 720, y: 620 }
    const moved = boundsOffPoint(window, pointer, [display])
    expect(moved).toEqual({ x: 720 - POINTER_MARGIN - 1440, y: 30, width: 1440, height: 600 })
    expect(moved!.y).toBeGreaterThanOrEqual(display.y)
  })

  it('moves the window up when that is the shortest way and its top stays in the work area', () => {
    const window = { x: 100, y: 200, width: 800, height: 600 }
    const pointer = { x: 500, y: 795 }
    expect(boundsOffPoint(window, pointer, [display])).toEqual({ x: 100, y: 795 - POINTER_MARGIN - 600, width: 800, height: 600 })
  })

  // The pointer exactly on the margin around each edge counts as under the window; one DIP
  // further out it does not.
  it.each([
    ['left', { x: 100 - POINTER_MARGIN, y: 300 }, { x: 100 - POINTER_MARGIN - 1, y: 300 }],
    ['top', { x: 500, y: 100 - POINTER_MARGIN }, { x: 500, y: 100 - POINTER_MARGIN - 1 }],
    ['bottom', { x: 500, y: 100 + 520 + POINTER_MARGIN - 1 }, { x: 500, y: 100 + 520 + POINTER_MARGIN }],
    ['right', { x: 100 + 800 + POINTER_MARGIN - 1, y: 300 }, { x: 100 + 800 + POINTER_MARGIN, y: 300 }],
  ])('takes the pointer exactly on the margin of the %s edge as under the window', (_edge, onMargin, outside) => {
    const window = { x: 100, y: 100, width: 800, height: 520 }
    const moved = boundsOffPoint(window, onMargin, [display])
    expect(moved).toBeDefined()
    expect(boundsOffPoint(moved!, onMargin, [display])).toBeUndefined()
    expect(boundsOffPoint(window, outside, [display])).toBeUndefined()
  })

  it('moves a full-width window down when the pointer is near its top', () => {
    const window = { x: 0, y: 25, width: 1440, height: 600 }
    const pointer = { x: 720, y: 40 }
    expect(boundsOffPoint(window, pointer, [display])).toEqual({ x: 0, y: 40 + POINTER_MARGIN + 1, width: 1440, height: 600 })
  })

  it('moves a window larger than the display off the pointer too, partly off the display', () => {
    const window = { x: -100, y: 0, width: 1700, height: 1000 }
    const pointer = { x: 720, y: 450 }
    const moved = boundsOffPoint(window, pointer, [display])
    expect(moved).toBeDefined()
    expect(moved).toMatchObject({ width: 1700, height: 1000 })
    expect(boundsOffPoint(moved!, pointer, [display])).toBeUndefined()
  })

  // A second display to the right, its top at 0, listed first: the menu bar that limits a move up
  // is the one of the display under the pointer.
  const external = { x: 1440, y: 0, width: 1920, height: 1080 }

  it('moves the window up to exactly the top of the work area under the pointer', () => {
    const window = { x: 100, y: 200, width: 800, height: 600 }
    const pointer = { x: 500, y: display.y + POINTER_MARGIN + 600 }
    expect(boundsOffPoint(window, pointer, [external, display])).toEqual({ x: 100, y: display.y, width: 800, height: 600 })
  })

  it('takes the top limit from the display under the pointer, not from a higher display beside it', () => {
    const window = { x: 0, y: 30, width: 1440, height: 600 }
    const pointer = { x: 720, y: 620 }
    expect(boundsOffPoint(window, pointer, [external, display])).toEqual({ x: 720 - POINTER_MARGIN - 1440, y: 30, width: 1440, height: 600 })
  })

  it('keeps the window on the display under the pointer rather than carry it onto the monitor beside it', () => {
    // Right is the shorter move and leaves as much of the window on the two displays, but half of
    // it on the other monitor; left keeps it whole on this one.
    const window = { x: 700, y: 100, width: 700, height: 700 }
    const pointer = { x: 1000, y: 300 }
    expect(boundsOffPoint(window, pointer, [display, external])).toEqual({ x: 1000 - POINTER_MARGIN - 700, y: 100, width: 700, height: 700 })
  })

  it('keeps the size of the window', () => {
    const window = { x: 224, y: 95, width: 1200, height: 700 }
    const moved = boundsOffPoint(window, { x: 600, y: 400 }, [display])
    expect(moved).toMatchObject({ width: 1200, height: 700 })
  })
})

describe('sizeOnlyChange', () => {
  it('is a change of size with the top-left corner kept (setSize)', () => {
    expect(sizeOnlyChange({ x: 10, y: 40, width: 1280, height: 800 }, { x: 10, y: 40, width: 1600, height: 1000 })).toBe(true)
  })

  it('is a change of size whose top macOS moved by up to the menu bar, the left edge kept', () => {
    const before = { x: 10, y: 95, width: 1280, height: 800 }
    expect(sizeOnlyChange(before, { x: 10, y: 95 - SIZE_CHANGE_TOP_SHIFT, width: 1600, height: 1000 })).toBe(true)
    expect(sizeOnlyChange(before, { x: 10, y: 95 + SIZE_CHANGE_TOP_SHIFT, width: 1600, height: 1000 })).toBe(true)
    expect(sizeOnlyChange(before, { x: 10, y: 95 - SIZE_CHANGE_TOP_SHIFT - 1, width: 1600, height: 1000 })).toBe(false)
    expect(sizeOnlyChange(before, { x: 11, y: 95, width: 1600, height: 1000 })).toBe(false)
  })

  it.each([
    ['a move with a new size (setBounds with a place)', { x: 60, y: 100, width: 900, height: 560 }],
    ['a move alone', { x: 60, y: 100, width: 1280, height: 800 }],
    ['no change', { x: 10, y: 40, width: 1280, height: 800 }],
  ])('is not %s', (_case, next) => {
    expect(sizeOnlyChange({ x: 10, y: 40, width: 1280, height: 800 }, next)).toBe(false)
  })
})
