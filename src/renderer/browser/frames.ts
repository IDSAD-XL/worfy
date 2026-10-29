// The frames of a Live Browser this window does not draw itself (worfy-browser ticket 07, ADR-0078
// items 9 and 16): another window of this Machine draws its page, or the page is on the Machine of a
// Linked machine's Project. While its frame is on screen the window watches it
// (`browser.frames.watch`) and draws every `browser.frame` main sends; the user's click, scroll and
// keys go to the page (`browser.input`), in the page's CSS pixels, and an address typed in the bar
// goes there (`browser.navigate`). A read-only screen never watches: it shows the frame alone. The
// watch is told again every BROWSER_SCREEN_RENEW_MS, and ends on `pagehide`: main ends one it is not
// told again of, as a reload or a closed window of a Linked machine tells it nothing.
import { useEffect, useState } from 'react'
import { BROWSER_SCREEN_RENEW_MS, type BrowserInput } from '../../shared/ipc/browser'
import { screenId } from '../canvas/screen'
import { invoke, subscribe } from '../ipc'

/** The last frame of a Browser's page: a JPEG's bytes and the page's viewport in CSS pixels. */
export interface BrowserFrame {
  bytes: Uint8Array
  width: number
  height: number
}

function watch(projectId: string, nodeId: string, on: boolean): void {
  void invoke('browser.frames.watch', { projectId, nodeId, screen: screenId(), watch: on }).then(
    (result) => {
      if (!result.ok) console.warn('browser.frames.watch failed:', result.error)
    },
    (error: unknown) => console.warn('browser.frames.watch failed:', error),
  )
}

/** The frames of Browser `nodeId` while `on`: the last one, null until one comes. */
export function useBrowserFrames(projectId: string, nodeId: string, on: boolean): BrowserFrame | null {
  const [frame, setFrame] = useState<BrowserFrame | null>(null)
  useEffect(() => {
    if (!on) return
    let stop: () => void
    try {
      stop = subscribe('browser.frame', (event) => {
        if (event.projectId !== projectId || event.nodeId !== nodeId) return
        setFrame({ bytes: Uint8Array.from(atob(event.image), (char) => char.charCodeAt(0)), width: event.width, height: event.height })
      })
    } catch (error) {
      // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
      console.error('browser.frame: cannot subscribe', error)
      return undefined
    }
    watch(projectId, nodeId, true)
    // main ends a watch it is not told again of (FRAMES_WATCH_MS, src/main/browser/screencast.ts).
    const renew = setInterval(() => watch(projectId, nodeId, true), BROWSER_SCREEN_RENEW_MS)
    // A reload or a close of the window runs no cleanup of React: the watch ends here, or by itself.
    const hide = () => watch(projectId, nodeId, false)
    window.addEventListener('pagehide', hide)
    return () => {
      stop()
      clearInterval(renew)
      window.removeEventListener('pagehide', hide)
      watch(projectId, nodeId, false)
    }
  }, [projectId, nodeId, on])
  return on ? frame : null
}

/**
 * Where a point `x`, `y` of a box of `box` (CSS px from its top-left corner) is on the page that
 * `frame` shows, in the page's CSS px, and whether it falls on the picture at all; null while either
 * has no size. The frame is drawn into the box as large as it fits whole, from the top-left corner
 * (object-fit: contain in BrowserNode.css), as the page itself is scaled into its frame's body when
 * its viewport is not the body's (worfy-browser ticket 18, ADR-0087); without a viewport of its own
 * the frame fills the box. A point off the picture still maps — a drag may leave it — but `inside`
 * is false there.
 */
export function framePoint(x: number, y: number, box: { width: number; height: number }, frame: { width: number; height: number }): { x: number; y: number; inside: boolean } | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  const point = { x: x / scale, y: y / scale }
  return { ...point, inside: point.x >= 0 && point.y >= 0 && point.x <= frame.width && point.y <= frame.height }
}

/** Sends the user's input in the frames of Browser `nodeId` to its page. */
export function sendBrowserInput(projectId: string, nodeId: string, input: BrowserInput): void {
  void invoke('browser.input', { projectId, nodeId, input }).then(
    (result) => {
      if (!result.ok) console.warn('browser.input failed:', result.error)
    },
    (error: unknown) => console.warn('browser.input failed:', error),
  )
}

/** The address bar of a frame that shows frames: the page of Browser `nodeId` goes to `url`. */
export function navigateBrowserFrames(projectId: string, nodeId: string, url: string): void {
  void invoke('browser.navigate', { projectId, nodeId, url }).then(
    (result) => {
      if (!result.ok) console.warn('browser.navigate failed:', result.error)
    },
    (error: unknown) => console.warn('browser.navigate failed:', error),
  )
}

/** The CDP modifiers of a DOM event: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

/** What a key types: a printable key's character, a carriage return for Enter; nothing with Ctrl or ⌘ held, or for any other key. */
export function keyText(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): string | undefined {
  if (event.ctrlKey || event.metaKey) return undefined
  if (event.key === 'Enter') return '\r'
  return [...event.key].length === 1 ? event.key : undefined
}

/** The CDP button of a DOM mouse button. */
export function buttonOf(button: number): 'left' | 'middle' | 'right' {
  return button === 1 ? 'middle' : button === 2 ? 'right' : 'left'
}
