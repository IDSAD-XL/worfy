import { describe, expect, it, vi } from 'vitest'

// window.ts imports Electron's main-process API, which does not exist under the plain Node that
// runs unit tests; only its pure helpers are tested here, so the module is replaced by an empty one.
vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))

const { DEFAULT_SIZE, MIN_SIZE, initialBounds, parseWindowState, windowStatePath } = await import('../../src/main/window')

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

describe('windowStatePath', () => {
  it("keeps the file in worfy's data directory", () => {
    expect(windowStatePath('/tmp/worfy-data')).toBe('/tmp/worfy-data/window-state.json')
  })
})
