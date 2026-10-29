// The page viewport of a Browser (worfy-browser ticket 18, ADR-0087): the width and height in CSS px
// the page is laid out at, kept in the Node's `data.viewport`. Without one the page is as large as
// the frame's body, as it always was. With one, the <webview> is laid out at that size and scaled
// into the body with a CSS transform (viewportFit), the way the Canvas zoom already scales it: the
// page sees the size it was given, the frame on the Canvas keeps its own. The frames of a page drawn
// elsewhere and the picture of an Asleep page are fitted into the body the same way, so a point on
// any of them maps to the same point of the page (framePoint, ../../browser/frames.ts).

/**
 * The smallest a Browser frame is resized to: its header still holds the profile's name, the back,
 * forward and reload buttons, the address bar and the sidebar's button, and its body a page.
 */
export const BROWSER_FRAME_MIN = { w: 360, h: 200 } as const

/** A page viewport, in CSS px. */
export interface BrowserPageViewport {
  w: number
  h: number
}

/** The smallest and largest side of a viewport the sidebar accepts and the frame reads. */
export const BROWSER_VIEWPORT_MIN = 200
export const BROWSER_VIEWPORT_MAX = 3840

/**
 * The ready sizes the sidebar offers, named by their size alone: a viewport sets the page's width and
 * height and nothing else of a device — no devicePixelRatio, no `pointer: coarse`, no meta viewport
 * (ADR-0087) — so a name such as «Phone» would promise what it does not do.
 */
export const BROWSER_VIEWPORT_PRESETS: readonly BrowserPageViewport[] = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
]

/** A side of a viewport: a whole number of CSS px inside the bounds. */
export function viewportSide(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= BROWSER_VIEWPORT_MIN && value <= BROWSER_VIEWPORT_MAX ? value : null
}

/**
 * The viewport a Node's data asks for; null — the page is as large as the frame's body — when it
 * has none, or anything but two sides inside the bounds (a Layout edited by hand, `viewport: null`
 * written by «Fit to card»).
 */
export function browserPageViewport(data: { viewport?: unknown }): BrowserPageViewport | null {
  const { viewport } = data
  if (typeof viewport !== 'object' || viewport === null) return null
  const w = viewportSide((viewport as { w?: unknown }).w)
  const h = viewportSide((viewport as { h?: unknown }).h)
  return w === null || h === null ? null : { w, h }
}

/**
 * How a page of `viewport` lies in a box of `box`: laid out at `w` × `h` CSS px and scaled by
 * `scale` from the box's top-left corner, as large as fits whole. Without a viewport it fills the box.
 */
export function viewportFit(box: BrowserPageViewport, viewport: BrowserPageViewport | null): { w: number; h: number; scale: number } {
  if (viewport === null) return { w: box.w, h: box.h, scale: 1 }
  const scale = Math.min(box.w / viewport.w, box.h / viewport.h)
  return { w: viewport.w, h: viewport.h, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 }
}
