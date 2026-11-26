import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import './divider.css'

// A divider dragged with the mouse: the WAI-ARIA window splitter. It holds a value — the share of a
// pane (session/SplitDivider.tsx) or a width in pixels (shell/SidebarResizeHandle.tsx) — and its
// owner lays the panes out by it. A drag with the mouse moves it, so do ←/→ (a step), Home and End
// (the bounds); a double click puts it back to `reset`. `onMove` follows the drag; `onCommit` gets the
// value where a gesture ended — the pointer let go, a key, a double click — so an owner writes it once
// per gesture, not on every pointer move. A cancelled drag — the pointer cancelled, or Escape pressed —
// puts the value back where it started and commits nothing (worfy-polish ticket 158).
//
// The drag follows the pointer on window, as Focus mode's dividers do (src/renderer/focus/FocusMode.tsx,
// followPointer): a pointermove with the primary button up is skipped rather than taken for a release,
// so a capture Chromium takes away mid-drag does not end the gesture.

export interface DividerProps {
  value: number
  min: number
  max: number
  /** How far one arrow key moves it. */
  step: number
  /** The value a double click puts back. */
  reset: number
  /**
   * How far the value moves for one pixel the pointer travels, measured on the divider when a drag
   * starts: 1 for a width in pixels, 1 / the parent's width for a share. Not a positive number — no drag.
   */
  perPixel: (divider: HTMLElement) => number
  /** How a value is rounded once it is within the bounds. */
  round: (value: number) => number
  /** What `aria-valuenow`, `-min` and `-max` say for a value; the value itself by default. */
  ariaValue?: (value: number) => number
  onMove: (value: number) => void
  onCommit: (value: number) => void
  /** A drag cancelled; without it the divider moves back to where the drag started by `onMove`. */
  onCancel?: () => void
  className: string
  label: string
  title?: string
  testId?: string
}

interface Drag {
  pointerId: number
  startX: number
  start: number
  perPixel: number
  last: number
}

const same = (value: number): number => value

export function Divider({ value, min, max, step, reset, perPixel, round, ariaValue = same, onMove, onCommit, onCancel, className, label, title, testId }: DividerProps) {
  const stop = useRef<(() => void) | null>(null)
  // A drag still under way when the divider goes (its pane closed) stops following the pointer.
  useEffect(() => () => stop.current?.(), [])
  const clamp = (next: number): number => round(Math.min(Math.max(next, min), max))

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const element = event.currentTarget
    const rate = perPixel(element)
    if (!(rate > 0) || !Number.isFinite(rate)) return
    event.preventDefault()
    stop.current?.()
    const drag: Drag = { pointerId: event.pointerId, startX: event.clientX, start: value, perPixel: rate, last: value }
    const onPointerMove = (move: PointerEvent) => {
      if (move.pointerId !== drag.pointerId || (move.buttons & 1) === 0) return
      drag.last = clamp(drag.start + (move.clientX - drag.startX) * drag.perPixel)
      onMove(drag.last)
    }
    const onPointerUp = (up: PointerEvent) => {
      if (up.pointerId !== drag.pointerId) return
      end()
      onCommit(drag.last)
    }
    const cancel = () => {
      end()
      if (onCancel === undefined) onMove(drag.start)
      else onCancel()
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === drag.pointerId) cancel()
    }
    // Escape ends the drag where it started; nothing else under the pointer hears it (focus mode would close).
    const onKeyDownWhileDragging = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      cancel()
    }
    const end = () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('keydown', onKeyDownWhileDragging, true)
      document.body.classList.remove('w-divider-dragging')
      delete element.dataset.dragging
      stop.current = null
    }
    // Capture phase: a pane that stops a pointer event must not stall the drag.
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('keydown', onKeyDownWhileDragging, true)
    document.body.classList.add('w-divider-dragging')
    element.dataset.dragging = ''
    stop.current = end
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowLeft'
        ? value - step
        : event.key === 'ArrowRight'
          ? value + step
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : undefined
    if (next === undefined) return
    event.preventDefault()
    const kept = clamp(next)
    onMove(kept)
    onCommit(kept)
  }

  const onDoubleClick = () => {
    onMove(reset)
    onCommit(reset)
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator with a value is the WAI-ARIA window splitter; jsx-a11y counts every separator as static.
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={ariaValue(min)}
      aria-valuemax={ariaValue(max)}
      aria-valuenow={ariaValue(value)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the window splitter takes the focus to move with the arrows.
      tabIndex={0}
      title={title}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  )
}
