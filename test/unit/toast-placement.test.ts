// Where the stack of toasts goes in its column (src/renderer/toast/placement.ts; worfy-ui ticket 16):
// the first free band from the top that holds it, else the tallest band with the stack cut to it,
// else its place under the toolbar.
import { describe, expect, it } from 'vitest'
import { EDGE, MIN_BAND, placeStack } from '../../src/renderer/toast/placement'

const TOOLBAR = { top: 0, bottom: 52 }

describe('placeStack', () => {
  it('with nothing in the column the stack is at the top edge; under the toolbar it keeps EDGE below it', () => {
    expect(placeStack([], 100, 800)).toEqual({ top: EDGE, maxHeight: null })
    expect(placeStack([TOOLBAR], 100, 800)).toEqual({ top: 52 + EDGE, maxHeight: null })
  })

  it('goes below a header with buttons under the toolbar, however tall the header grew', () => {
    // A focused Ticket whose title took two lines and whose blockers line is there: its action row ends at 236.
    expect(placeStack([TOOLBAR, { top: 74, bottom: 236 }], 120, 800)).toEqual({ top: 236 + EDGE, maxHeight: null })
  })

  it('takes the first band from the top that holds the whole stack, skipping one too small; spans come in any order and may overlap', () => {
    // Band 64..88 is too small for 60; band 212..400 holds it.
    const blocked = [{ top: 412, bottom: 500 }, TOOLBAR, { top: 100, bottom: 160 }, { top: 150, bottom: 200 }]
    expect(placeStack(blocked, 60, 800)).toEqual({ top: 212, maxHeight: null })
    // A band exactly as tall as the stack holds it.
    expect(placeStack([TOOLBAR, { top: 64 + 60 + EDGE, bottom: 700 }], 60, 800)).toEqual({ top: 64, maxHeight: null })
  })

  it('goes below an open popup: the Command palette or Settings in the middle of the column', () => {
    expect(placeStack([TOOLBAR, { top: 60, bottom: 500 }], 56, 800)).toEqual({ top: 512, maxHeight: null })
    // Settings at 1024×768: 124..644; the band below it is 656..756.
    expect(placeStack([TOOLBAR, { top: 124, bottom: 644 }], 56, 768)).toEqual({ top: 656, maxHeight: null })
  })

  it('when no band holds the whole stack, the tallest one cuts it; when none holds one toast, null', () => {
    expect(placeStack([TOOLBAR, { top: 200, bottom: 600 }], 300, 800)).toEqual({ top: 612, maxHeight: 800 - EDGE - 612 })
    // A popup over the whole column: no band of MIN_BAND, the stack stays at its place in toast.css.
    expect(placeStack([TOOLBAR, { top: 60, bottom: 800 - EDGE - MIN_BAND + 1 }], 100, 800)).toBeNull()
    expect(placeStack([{ top: 0, bottom: 800 }], 40, 800)).toBeNull()
  })
})
