// The geometry and the address of a Browser frame (ADR-0078), shared by the frame
// (BrowserNode.tsx) and the Browser layer that draws its page (../overlays/BrowserLayer.tsx), so
// the page always lands exactly in the frame's body.
import type { LayoutNode } from '../../../shared/layout/types'

/** The `kind` of a Browser Node in the Layout. */
export const BROWSER_KIND = 'browser'
/** Height of the frame's header, in Canvas units. */
export const BROWSER_HEADER_HEIGHT = 28
/** Width of the frame's border, in Canvas units. */
export const BROWSER_BORDER = 1

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where the page of a frame at `frame` goes, in Canvas units: the frame's body, inside the border and under the header. */
export function browserPageRect(frame: Rect): Rect {
  return {
    x: frame.x + BROWSER_BORDER,
    y: frame.y + BROWSER_BORDER + BROWSER_HEADER_HEIGHT,
    w: Math.max(0, frame.w - 2 * BROWSER_BORDER),
    h: Math.max(0, frame.h - 2 * BROWSER_BORDER - BROWSER_HEADER_HEIGHT),
  }
}

/** The page address a Browser Node keeps in `data.url`: an http(s) URL, or null for anything else. */
export function browserUrl(node: LayoutNode): string | null {
  const url = node.data.url
  if (typeof url !== 'string' || !URL.canParse(url)) return null
  const { protocol } = new URL(url)
  return protocol === 'http:' || protocol === 'https:' ? url : null
}
