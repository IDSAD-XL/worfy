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
