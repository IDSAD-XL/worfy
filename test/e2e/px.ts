import { expect } from '@playwright/test'

// Comparing layout sizes read from the app's page. At a fractional display scale (150 % on Windows) the same box
// reads a little differently from one layout to the next — 47.33331298828125 then 47.333335876464844 px, a
// difference in the 6th decimal (PC gate full of main 9731f583a, under load). Two sizes within PX_TOLERANCE are
// the same size; a real change of layout is at least a whole device pixel.

/** How far two layout sizes may differ and still be the same size, in CSS px. */
export const PX_TOLERANCE = 0.01

/**
 * `toBeInViewport` options for "the whole element is in the window" when the element sits on the canvas, under React
 * Flow's zoom: its box has fractional sides, and the visible share Playwright reads is 0.9999998807907104 (one float32
 * step under 1, macOS CI runner) for an element that is wholly in view. 0.999 lets that through and still fails an
 * element cut by a pixel or more on any side of up to 1000 px.
 */
export const WHOLLY_IN_VIEW = { ratio: 0.999 } as const

/** Expects every size of `seen` to be `expected` within PX_TOLERANCE; the message names `what` and both sizes. */
export function expectSamePx(seen: readonly number[], expected: number, what: string): void {
  const off = seen.filter((size) => !(Math.abs(size - expected) <= PX_TOLERANCE))
  expect(off, `${what}: expected ${expected} px (±${PX_TOLERANCE}), got ${off.join(', ')} px`).toEqual([])
}
