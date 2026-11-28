import { useEffect } from 'react'

/** How long the thumb of a container stays after its last scroll event (scrollbars.css). */
export const SCROLLING_MARK_MS = 800

const ATTRIBUTE = 'data-scrolling'

/**
 * Marks the element that scrolls with `data-scrolling` until SCROLLING_MARK_MS after its last scroll
 * event, so scrollbars.css shows its thumb while it scrolls by the wheel or the keys, not only under the
 * pointer. One listener for the whole window, on the document in the capture phase: a scroll event of an
 * element does not bubble, but capture hears it. Called once, at the root of the app (main.tsx); a new
 * panel gets the mark without calling anything.
 */
export function useScrollingMark(): void {
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>()
    const onScroll = (event: Event): void => {
      // The document's own scroll comes from the document: its scrollbar is the root element's.
      const element = event.target instanceof Element ? event.target : event.target === document ? document.documentElement : null
      if (element === null) return
      const running = timers.get(element)
      if (running !== undefined) clearTimeout(running)
      else element.setAttribute(ATTRIBUTE, '')
      timers.set(
        element,
        setTimeout(() => {
          timers.delete(element)
          element.removeAttribute(ATTRIBUTE)
        }, SCROLLING_MARK_MS),
      )
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      for (const [element, timer] of timers) {
        clearTimeout(timer)
        element.removeAttribute(ATTRIBUTE)
      }
      timers.clear()
    }
  }, [])
}
