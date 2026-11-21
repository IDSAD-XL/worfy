// Picking the lines a comment is made on, for the Changes view (line-comments.tsx) and Review mode of a PR
// (pr-review/review-comments.tsx): one way to pick on one screen (worfy-changes-view ticket 09; spec, the owner's answers
// of 2026-11-21, D2). A pick is lines of one file and one side.
//
// - «+» in the gutter, as on GitHub: pressing it starts a pick on its line, moving the pointer up or down over lines of
//   the same file and side stretches it (`mousemove` and `mouseup` on the window until the button is let go; the line is
//   the one under the pointer, by its cell's `data-side` / `data-line`), and letting go opens the comment of the whole
//   range. A line of another file or side, or of another hunk of the file, does not change the pick; the window losing
//   the focus, or a move with no button held (let go outside the window), ends the drag and opens nothing. Let go on
//   the line it was pressed on, «+» opens the range picked when its line is in it, else its line alone.
// - Shift with «+» stretches the pick to that line (same file and side) and opens nothing; with nothing picked there it
//   picks the line alone.
// - A click on a line picks it, a click with Shift stretches the pick, a selection of text across lines picks those
//   lines; the key `c` opens the comment of the lines picked.
// - While lines are picked, no comment is open and no drag is on, «Comment on lines 95–102 (c)» stands under the last
//   of them (one line: «Comment on line 95 (c)»); a click on it opens the comment, as `c` does. Escape takes the pick away.
// - A keyboard press of a focused «+» (Enter, Space: a click with no pointer) opens the comment as before.
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { DiffLine } from '../../shared/changes/types'
import { showToast } from '../toast/toasts'
import type { LineSide } from './DiffPane'
import { lineNumber, type FileEntry } from './diff-window'

/** The lines picked for a comment: one file, one side, `start` where the pick began. */
export interface Picked {
  key: string
  side: LineSide
  start: number
  end: number
}

export const pickRange = (pick: Picked): { from: number; to: number } => ({ from: Math.min(pick.start, pick.end), to: Math.max(pick.start, pick.end) })

/** The hunk block (`changes-hunk`) an event target is in; null off one. */
const hunkOf = (target: EventTarget | null): Element | null => {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return element?.closest('[data-testid="changes-hunk"]') ?? null
}

const inPick = (pick: Picked | null, key: string, side: LineSide, line: number): boolean => pick !== null && pick.key === key && pick.side === side && line >= pickRange(pick).from && line <= pickRange(pick).to

/** The line a pointer event is on: the file of its hunk, its side and number; null off a line. */
export function lineAt(target: EventTarget | null): { key: string; side: LineSide; line: number } | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const cell = element?.closest<HTMLElement>('[data-line][data-side]')
  const key = cell?.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.key
  const line = Number(cell?.dataset.line)
  const side = cell?.dataset.side
  if (key === undefined || !Number.isInteger(line) || line < 1 || (side !== 'old' && side !== 'new')) return null
  return { key, side, line }
}

/** The words of the hint: «Comment on lines 95–102 (c)», «Comment on line 95 (c)». */
export const hintText = (pick: Picked): string => {
  const { from, to } = pickRange(pick)
  return from === to ? `Comment on line ${from} (c)` : `Comment on lines ${from}–${to} (c)`
}

export interface LinePickOptions {
  /** Lines may be picked and commented on: no «+», no hint and no pick otherwise. */
  enabled: boolean
  /** A comment is open: the hint stands aside. */
  commenting: boolean
  /** The comment of lines `from`…`to` of a side of a file. */
  open: (key: string, side: LineSide, from: number, to: number) => void
  /** Whether an open comment holds what is not saved: «+» then changes nothing (the caller tells the user why). */
  held: () => boolean
  /** A click on these is theirs, not a pick of the line. */
  ownControls: string
  /** The key of the toast «Click a line first, then press c». */
  toastKey: string
  /** The accessible name of «+» of a line. */
  plusLabel: (line: number, path: string) => string
}

export interface LinePick {
  picked: Picked | null
  setPicked: (next: Picked | null) => void
  /** «+» of a line or Comment of the menu: the range picked when the line is in it, else the line alone. */
  openOn: (key: string, side: LineSide, line: number) => void
  isPicked: (line: DiffLine, side: LineSide, entry: FileEntry) => boolean
  /** «+» of a line, for the gutter. */
  plus: (line: DiffLine, side: LineSide, entry: FileEntry) => ReactNode
  /** The hint under the last line picked; null under any other line. */
  hint: (line: DiffLine, side: LineSide, entry: FileEntry) => ReactNode
  lineEvents: { onClick: (event: ReactMouseEvent<HTMLDivElement>) => void; onMouseUp: () => void }
  /** The key `c`: false when it is not the screen's to take. */
  commentKey: () => boolean
  /** Escape: true when it took a pick away. */
  clear: () => boolean
}

/** The drag of «+» in progress: where it was pressed, the line under the pointer, and whether it has left the first. */
interface Drag {
  /** The hunk «+» was pressed in: the drag stays in it, as a comment covers lines of one hunk. */
  hunk: Element | null
  key: string
  side: LineSide
  line: number
  end: number
  moved: boolean
}

export function useLinePick(options: LinePickOptions): LinePick {
  const { enabled, commenting, toastKey } = options
  const [picked, setPicked] = useState<Picked | null>(null)
  // A drag of «+» is on: the hint waits for it to end, or it would push the lines under the pointer down.
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ options, picked })
  useEffect(() => {
    latest.current = { options, picked }
  })

  const openOn = useCallback((key: string, side: LineSide, line: number) => {
    const { options: now, picked: pick } = latest.current
    if (!now.enabled || now.held()) return
    if (inPick(pick, key, side, line)) {
      const { from, to } = pickRange(pick!)
      now.open(key, side, from, to)
      return
    }
    setPicked({ key, side, start: line, end: line })
    now.open(key, side, line, line)
  }, [])

  /** Shift with «+»: the pick stretches to the line, or the line alone is picked. */
  const stretch = (key: string, side: LineSide, line: number) => {
    setPicked((pick) => (pick !== null && pick.key === key && pick.side === side ? { ...pick, end: line } : { key, side, start: line, end: line }))
  }

  // ── the drag of «+» ──
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const press = (hunk: Element | null, key: string, side: LineSide, line: number) => {
    stop.current?.()
    const drag: Drag = { hunk, key, side, line, end: line, moved: false }
    const onMove = (event: MouseEvent) => {
      // No button held: it was let go where the window did not hear it (outside it). The drag ends, opening nothing.
      if (event.buttons === 0) {
        stop.current?.()
        return
      }
      const at = lineAt(event.target)
      // A line of another hunk of the same file is not taken: the comment would not get the lines between them.
      if (at === null || at.key !== drag.key || at.side !== drag.side || hunkOf(event.target) !== drag.hunk) return
      if (at.line === drag.line && !drag.moved) return
      drag.moved = true
      drag.end = at.line
      setPicked({ key: drag.key, side: drag.side, start: drag.line, end: at.line })
    }
    const onUp = () => {
      stop.current?.()
      if (!drag.moved) {
        openOn(drag.key, drag.side, drag.line)
        return
      }
      const { from, to } = pickRange({ key: drag.key, side: drag.side, start: drag.line, end: drag.end })
      latest.current.options.open(drag.key, drag.side, from, to)
    }
    // The window lost the focus (⌘-Tab) with the button held: its mouseup may never come here.
    const onBlur = () => stop.current?.()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    setDragging(true)
    stop.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      stop.current = null
      setDragging(false)
    }
  }

  const plus = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    const number = lineNumber(line, side)
    if (!enabled || number === null) return null
    return (
      <button
        type="button"
        className="w-cl__plus nodrag"
        aria-label={options.plusLabel(number, entry.file.path)}
        data-testid="changes-line-plus"
        onMouseDown={(event) => {
          if (event.button !== 0) return
          // No selection of text starts under the drag, and the line under it is not picked by its own click.
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) stretch(entry.key, side, number)
          else if (!latest.current.options.held()) press(hunkOf(event.currentTarget), entry.key, side, number)
        }}
        onClick={(event) => {
          event.stopPropagation()
          // A press of the pointer was taken by mousedown and mouseup; a click with no pointer is the keyboard's.
          if (event.detail !== 0) return
          if (event.shiftKey) stretch(entry.key, side, number)
          else openOn(entry.key, side, number)
        }}
      >
        +
      </button>
    )
  }

  const isPicked = (line: DiffLine, side: LineSide, entry: FileEntry): boolean => {
    const number = lineNumber(line, side)
    return number !== null && inPick(picked, entry.key, side, number)
  }

  const hint = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    const number = lineNumber(line, side)
    if (!enabled || commenting || dragging || picked === null || picked.key !== entry.key || picked.side !== side || number !== pickRange(picked).to) return null
    const { from, to } = pickRange(picked)
    return (
      <button type="button" className="w-cl-hint nodrag" data-testid="changes-pick-hint" onClick={() => latest.current.options.open(picked.key, picked.side, from, to)}>
        {hintText(picked)}
      </button>
    )
  }

  const lineEvents: LinePick['lineEvents'] = {
    onClick: (event) => {
      if (!enabled || (event.target as Element).closest?.(options.ownControls)) return
      // A drag that selected text is a pick of its own (onMouseUp).
      if (globalThis.getSelection?.()?.isCollapsed === false) return
      const at = lineAt(event.target)
      if (at === null) return
      if (event.shiftKey && picked !== null && picked.key === at.key && picked.side === at.side) setPicked({ ...picked, end: at.line })
      else setPicked({ key: at.key, side: at.side, start: at.line, end: at.line })
    },
    onMouseUp: () => {
      if (!enabled) return
      const selection = globalThis.getSelection?.()
      if (selection == null || selection.isCollapsed) return
      const from = lineAt(selection.anchorNode)
      const to = lineAt(selection.focusNode)
      if (from === null || to === null || from.key !== to.key || from.side !== to.side || from.line === to.line) return
      setPicked({ key: from.key, side: from.side, start: from.line, end: to.line })
    },
  }

  const commentKey = (): boolean => {
    if (!enabled) return false
    if (picked === null) {
      showToast({ kind: 'info', key: toastKey, text: 'Click a line first, then press c' })
      return true
    }
    const { from, to } = pickRange(picked)
    options.open(picked.key, picked.side, from, to)
    return true
  }

  const clear = (): boolean => {
    if (!enabled || latest.current.picked === null) return false
    setPicked(null)
    return true
  }

  return { picked, setPicked, openOn, isPicked, plus, hint, lineEvents, commentKey, clear }
}
