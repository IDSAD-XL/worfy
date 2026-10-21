// Closing a popover of the Canvas: on Escape and on a mousedown outside it (the Archive, the history
// of a Ticket or an Epic).
import { useEffect, type RefObject } from 'react'

/** Closes on Escape (that press does nothing else) and on a mousedown outside `inside`. */
export function useDismiss(open: boolean, close: () => void, inside: readonly RefObject<HTMLElement | null>[]): void {
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && inside.every((ref) => ref.current?.contains(event.target as Node) !== true)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The press that closes the popover does nothing else (the Esc of an active Node, of Focus mode).
      event.preventDefault()
      close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open, close, inside])
}
