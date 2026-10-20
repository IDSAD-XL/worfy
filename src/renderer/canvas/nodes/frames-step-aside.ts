import { useEffect } from 'react'

// A page on the Canvas that is not this document — a Card's iframe, a Browser's <webview> — takes
// the mouse events of a pointer over it, and this document then sees neither the moves nor the
// release. Shared by CardNode.tsx and the Browser layer (../overlays/BrowserLayer.tsx).

/** The attribute on the React Flow root while a mouse button pressed on the Canvas is held; canvas.css and BrowserNode.css key on it. */
export const PRESSED_ATTRIBUTE = 'data-pointer-pressed'

/**
 * Marks the React Flow root with PRESSED_ATTRIBUTE from a press anywhere on the Canvas until its
 * release (worfy-week ticket 09). canvas.css turns mouse events off for every iframe on the Canvas
 * while the mark is there, and BrowserNode.css for every Browser page. Such a page is on another
 * origin or in another process: a pointer that runs onto it hands the mouse events to the page,
 * and the window sees neither the moves nor the release, so a drag, a resize or a pan would stop
 * following the mouse or never end. React Flow's own `dragging` class comes too late for this: it
 * is set on the first move the window sees, and a quick jerk puts the pointer on the page with that
 * very first move. A press inside such a page never reaches this document, so clicks on the page
 * are untouched.
 */
export function useFramesStepAsideWhilePressed(root: HTMLElement | null): void {
  useEffect(() => {
    if (root === null) return
    let release: number | undefined
    // Off only after the release has been handled: the mouseup that ends React Flow's gesture comes
    // after the pointerup, and it must not land on a page either.
    const released = () => {
      window.clearTimeout(release)
      release = window.setTimeout(() => root.removeAttribute(PRESSED_ATTRIBUTE), 0)
    }
    // The main button only: React Flow drags and resizes with it. A pan with the middle button
    // marks the plane `dragging` on the press itself, and a right press opens a menu whose release
    // may never come back to the window.
    const pressed = (event: PointerEvent) => {
      if (event.button !== 0) return
      window.clearTimeout(release)
      root.setAttribute(PRESSED_ATTRIBUTE, '')
    }
    root.addEventListener('pointerdown', pressed, true)
    window.addEventListener('pointerup', released, true)
    window.addEventListener('pointercancel', released, true)
    window.addEventListener('blur', released)
    return () => {
      root.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('pointerup', released, true)
      window.removeEventListener('pointercancel', released, true)
      window.removeEventListener('blur', released)
      window.clearTimeout(release)
      root.removeAttribute(PRESSED_ATTRIBUTE)
    }
  }, [root])
}
