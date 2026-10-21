// Where the stack of toasts goes in its column at the right edge of the window (worfy-ui ticket 16;
// ToastRegion.tsx measures, this file decides). The stack keeps clear of what the user works with in
// that column: the toolbar, a view's header with its buttons, an open popup. These come in as
// vertical spans (the part of the column each one takes); the stack goes into the first free band
// from the top where it fits whole.

/** The part of the column, in px from the top of the window, that one element takes. */
export interface Span {
  top: number
  bottom: number
}

/** The top of the stack; `maxHeight` cuts it (it scrolls) when no free band holds it whole. */
export interface Placement {
  top: number
  maxHeight: number | null
}

/** How often the place is measured again while a toast is shown: a popup opens without telling the region. */
export const PLACE_MS = 200

/** Room kept between the stack and the edge of the window or an element it keeps clear of. */
export const EDGE = 12

/** The least band worth a cut stack: one toast of one line (toast.css: 32 px and its margin). */
export const MIN_BAND = 40

/**
 * The first free band from the top of a window `height` px tall that holds a stack `need` px tall,
 * between the `blocked` spans. When none does, the tallest band of at least MIN_BAND px, and the
 * stack is cut to it. When even that is missing — a popup over the whole column — null: the stack
 * stays at its place under the toolbar (toast.css) and covers the popup, so an error is still seen.
 */
export function placeStack(blocked: readonly Span[], need: number, height: number): Placement | null {
  const bands: Span[] = []
  let cursor = EDGE
  for (const span of [...blocked].sort((a, b) => a.top - b.top)) {
    if (span.top - EDGE > cursor) bands.push({ top: cursor, bottom: span.top - EDGE })
    cursor = Math.max(cursor, span.bottom + EDGE)
  }
  if (height - EDGE > cursor) bands.push({ top: cursor, bottom: height - EDGE })

  const size = (band: Span): number => band.bottom - band.top
  const whole = bands.find((band) => size(band) >= need)
  if (whole !== undefined) return { top: whole.top, maxHeight: null }
  const tallest = bands.reduce<Span | undefined>((best, band) => (best === undefined || size(band) > size(best) ? band : best), undefined)
  if (tallest === undefined || size(tallest) < MIN_BAND) return null
  return { top: tallest.top, maxHeight: size(tallest) }
}
