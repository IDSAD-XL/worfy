import { z } from 'zod'

// Pure geometry and parsing for the main window's saved position and size. It lives in
// src/shared so unit tests run it without Electron; src/main/window.ts does the reading, writing
// and the window itself.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type InitialBounds = Rect | { width: number; height: number }

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const
export const MIN_SIZE = { width: 800, height: 520 } as const

/** How much of a saved window must still be on some display for its position to be reused. */
const MIN_VISIBLE = { width: 120, height: 40 } as const

const windowStateSchema = z.object({
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
})

/** Parses the saved window state; anything unreadable counts as "nothing saved". */
export function parseWindowState(raw: string): Rect | undefined {
  try {
    const parsed = windowStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.bounds : undefined
  } catch {
    return undefined
  }
}

/** The JSON text the window state is saved as; parseWindowState reads it back. */
export function serializeWindowState(bounds: Rect): string {
  return JSON.stringify({ bounds }, null, 2)
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Decides where the window opens. Saved bounds are reused while enough of the window is still on
 * one of the current displays (a monitor may have been unplugged since); otherwise the window opens
 * at the default size, centred by the system.
 */
export function initialBounds(saved: Rect | undefined, workAreas: readonly Rect[]): InitialBounds {
  if (saved) {
    const visible = workAreas.some((area) => {
      const shared = overlap(saved, area)
      return shared.width >= MIN_VISIBLE.width && shared.height >= MIN_VISIBLE.height
    })
    if (visible) {
      return {
        x: saved.x,
        y: saved.y,
        width: Math.max(saved.width, MIN_SIZE.width),
        height: Math.max(saved.height, MIN_SIZE.height),
      }
    }
  }
  return { ...DEFAULT_SIZE }
}

export interface Point {
  x: number
  y: number
}

/** How far a window kept off the pointer stays from it, in DIP on each side. */
export const POINTER_MARGIN = 8

function holds(bounds: Rect, point: Point, margin: number): boolean {
  return (
    point.x >= bounds.x - margin &&
    point.x < bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y < bounds.y + bounds.height + margin
  )
}

function visibleArea(bounds: Rect, workAreas: readonly Rect[]): number {
  return workAreas.reduce((sum, area) => {
    const shared = overlap(bounds, area)
    return sum + Math.max(shared.width, 0) * Math.max(shared.height, 0)
  }, 0)
}

/**
 * Where a window goes so that it no longer contains the point (the mouse pointer) with a margin:
 * the same size, moved just past the pointer to the left, right, below or above. The pick: the most
 * of the window left on the display under the pointer (a move onto another monitor, maybe of
 * another scale factor, does not win by area there), then the most on all displays, then the
 * shortest move. undefined when the window already keeps clear of the point. A move up that would
 * put the window's top above the top of the work area under the point (the menu bar) is not
 * offered: macOS would push the window back down when it is shown. A window wider and taller than
 * the display ends up partly off it; that is the price, since no place on the display keeps clear
 * of the pointer.
 */
export function boundsOffPoint(bounds: Rect, point: Point, workAreas: readonly Rect[], margin: number = POINTER_MARGIN): Rect | undefined {
  if (!holds(bounds, point, margin)) return undefined
  const underPointer = workAreas.find((area) => holds(area, point, 0))
  const candidates: Rect[] = [
    { ...bounds, x: point.x - margin - bounds.width },
    { ...bounds, x: point.x + margin + 1 },
    { ...bounds, y: point.y + margin + 1 },
    { ...bounds, y: point.y - margin - bounds.height },
  ].filter((candidate) => underPointer === undefined || candidate.y >= underPointer.y)
  const onPointerDisplay = (candidate: Rect): number => (underPointer ? visibleArea(candidate, [underPointer]) : 0)
  const shift = (candidate: Rect): number => Math.abs(candidate.x - bounds.x) + Math.abs(candidate.y - bounds.y)
  candidates.sort(
    (a, b) =>
      onPointerDisplay(b) - onPointerDisplay(a) || visibleArea(b, workAreas) - visibleArea(a, workAreas) || shift(a) - shift(b),
  )
  return candidates[0]
}

/**
 * Whether a change of the window's bounds is a change of size (BrowserWindow.setSize): the width
 * or height changed, the left edge kept, and the top either kept or now exactly at the top of the
 * work area of the display the window is mostly on. macOS never moves a resized window sideways,
 * but it may pull its top up to the menu bar, by any distance, when the window no longer fits below
 * it (setSize(1600, 1000) on a 1512 × 982 display, a window moved down off the pointer before). A
 * change that moves the window anywhere else (setBounds with a place, a drag) names the place it
 * wants, and a window kept off the pointer leaves that place as it is.
 */
export function sizeOnlyChange(previous: Rect, next: Rect, workAreas: readonly Rect[]): boolean {
  if (previous.width === next.width && previous.height === next.height) return false
  if (previous.x !== next.x) return false
  if (previous.y === next.y) return true
  const under = workAreas.reduce<{ area: Rect; size: number } | undefined>((best, area) => {
    const size = visibleArea(next, [area])
    return size > 0 && (best === undefined || size > best.size) ? { area, size } : best
  }, undefined)
  return under !== undefined && next.y === under.area.y
}
