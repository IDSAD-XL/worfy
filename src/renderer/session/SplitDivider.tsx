import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

// The divider between two side-by-side panes (worfy-product-session ticket 07: the Mind map and
// the chat of a Product Session). It holds the left pane's share of its parent's width; the parent
// lays the panes out by it. A drag with the mouse moves it, so do ←/→ (a step), Home and End (the
// edges); a double click puts it back to `reset`. Each side keeps at least `min`. `onMove` follows
// the drag; `onCommit` gets the share where a gesture ended — the pointer let go, a key, a double
// click — so a caller writes it once per gesture, not on every pointer move. A cancelled drag puts
// the share back where it started and commits nothing.
//
// The drag follows the pointer on window, as Focus mode's dividers do (src/renderer/focus/FocusMode.tsx,
// followPointer): a pointermove with the primary button up is skipped rather than taken for a release,
// so a capture Chromium takes away mid-drag does not end the gesture.

/** How far one arrow key moves the divider, as a share of the width. */
export const SPLIT_KEY_STEP = 0.05

export interface SplitDividerProps {
  /** The left pane's share of the parent's width, 0–1. */
  share: number
  /** The smallest share either pane keeps. */
  min: number
  /** The share a double click puts back. */
  reset: number
  onMove: (share: number) => void
  onCommit: (share: number) => void
  label: string
  title?: string
  testId?: string
}

/** `share` within `min` … 1 − `min`, rounded to a tenth of a percent: a drag to 70 / 30 is 0.7, not 0.70000001. */
function clampShare(share: number, min: number): number {
  const kept = Math.min(Math.max(share, min), 1 - min)
  return Math.round(kept * 1000) / 1000
}

interface Drag {
  pointerId: number
  startX: number
  startShare: number
  width: number
  last: number
}

export function SplitDivider({ share, min, reset, onMove, onCommit, label, title, testId }: SplitDividerProps) {
  const stop = useRef<(() => void) | null>(null)
  // A drag still under way when the divider goes (the Session closed) stops following the pointer.
  useEffect(() => () => stop.current?.(), [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    if (width <= 0) return
    event.preventDefault()
    stop.current?.()
    const drag: Drag = { pointerId: event.pointerId, startX: event.clientX, startShare: share, width, last: share }
    const onPointerMove = (move: PointerEvent) => {
      if (move.pointerId !== drag.pointerId || (move.buttons & 1) === 0) return
      drag.last = clampShare(drag.startShare + (move.clientX - drag.startX) / drag.width, min)
      onMove(drag.last)
    }
    const onPointerUp = (up: PointerEvent) => {
      if (up.pointerId !== drag.pointerId) return
      end()
      onCommit(drag.last)
    }
    const onPointerCancel = (cancel: PointerEvent) => {
      if (cancel.pointerId !== drag.pointerId) return
      end()
      onMove(drag.startShare)
    }
    const end = () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      document.body.classList.remove('w-split-dragging')
      stop.current = null
    }
    // Capture phase: a pane that stops a pointer event must not stall the drag.
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    document.body.classList.add('w-split-dragging')
    stop.current = end
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowLeft'
        ? share - SPLIT_KEY_STEP
        : event.key === 'ArrowRight'
          ? share + SPLIT_KEY_STEP
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? 1 - min
              : undefined
    if (next === undefined) return
    event.preventDefault()
    const kept = clampShare(next, min)
    onMove(kept)
    onCommit(kept)
  }

  const onDoubleClick = () => {
    onMove(reset)
    onCommit(reset)
  }

  return (
    <div
      className="w-split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round((1 - min) * 100)}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      title={title}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  )
}
