import { expect } from '@playwright/test'

// Comparing layout sizes read from the app's page. At a fractional display scale (150 % on Windows) the same box
// reads a little differently from one layout to the next — 47.33331298828125 then 47.333335876464844 px, a
// difference in the 6th decimal (PC gate full of main 9731f583a, under load). Two sizes within PX_TOLERANCE are
// the same size; a real change of layout is at least a whole device pixel.

/** How far two layout sizes may differ and still be the same size, in CSS px. */
export const PX_TOLERANCE = 0.01

/** Expects every size of `seen` to be `expected` within PX_TOLERANCE; the message names `what` and both sizes. */
export function expectSamePx(seen: readonly number[], expected: number, what: string): void {
  const off = seen.filter((size) => !(Math.abs(size - expected) <= PX_TOLERANCE))
  expect(off, `${what}: expected ${expected} px (±${PX_TOLERANCE}), got ${off.join(', ')} px`).toEqual([])
}
