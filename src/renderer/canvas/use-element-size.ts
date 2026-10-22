// Following an element's size on the screen with a ResizeObserver (the Focus button in pinning.ts,
// the selection toolbar in overlays/SelectionToolbar.tsx).
import { useCallback, useRef } from 'react'

/**
 * A ref callback that reports the element's border box to `onSize` each time it changes, rounded up
 * to whole pixels so a fractional width (104.5) is never kept short. The layout size ignores a
 * transform such as scale(1 / zoom), which cancels the viewport's zoom: screen pixels. A zero size
 * (the element not laid out) is not reported. The observer is disconnected when the element goes
 * (React calls the ref with null on unmount) or another one takes its place. `onSize` should be
 * stable: a new one observes the element again.
 */
export function useElementSize<T extends HTMLElement>(onSize: (size: { width: number; height: number }) => void): (element: T | null) => void {
  const observer = useRef<ResizeObserver | null>(null)
  return useCallback(
    (element: T | null) => {
      observer.current?.disconnect()
      observer.current = null
      if (element === null || typeof ResizeObserver === 'undefined') return
      observer.current = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.borderBoxSize?.[0]
        const width = Math.ceil(box?.inlineSize ?? element.offsetWidth)
        const height = Math.ceil(box?.blockSize ?? element.offsetHeight)
        if (width > 0 && height > 0) onSize({ width, height })
      })
      observer.current.observe(element)
    },
    [onSize],
  )
}
