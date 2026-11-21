// Picking the lines a comment is made on, for the Changes view (line-comments.tsx) and Review mode of a PR
// (pr-review/review-comments.tsx): one way to pick on one screen (worfy-changes-view ticket 09; spec, the owner's answers
// of 2026-11-21, D2). A pick is lines of one file and one side.
//
// - «+» in the gutter, as on GitHub: pressing it starts a pick on its line, moving the pointer up or down over lines of
//   the same file, side and hunk stretches it (`mousemove` and `mouseup` on the window until the button is let go; the line is
//   the one under the pointer, by its cell's `data-side` / `data-line`), and letting go opens the comment of the whole
//   range. A line of another file or side, or of another hunk of the file, does not change the pick; the window losing
//   the focus, or a move with no button held (let go outside the window), ends the drag and opens nothing. Let go on
//   the line it was pressed on, «+» opens the range picked when its line is in it, else its line alone.
// - Shift with «+» stretches the pick to that line and opens nothing; with nothing picked in that file, side and hunk it
//   picks the line alone.
// - A click on a line picks it, a click with Shift stretches the pick, a selection of text across lines picks those
//   lines; the key `c` opens the comment of the lines picked.
// - Every way of stretching keeps a pick in the hunk it began in (`Picked.block`), as a comment covers lines of one hunk
//   (GitHub refuses a range across hunks): a line of another hunk is picked alone (a selection: the line it ended on).
// - While lines are picked, no comment is open and no drag is on, «Comment on lines 95–102 (c)» stands under the last
//   of them (one line: «Comment on line 95 (c)»); a click on it opens the comment, as `c` does. Escape takes the pick away.
// - A keyboard press of a focused «+» (Enter, Space: a click with no pointer) opens the comment as before.
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { DiffLine } from '../../shared/changes/types'
import { showToast } from '../toast/toasts'
import type { LineSide } from './DiffPane'
import { lineNumber, type FileEntry } from './diff-window'

/** The lines picked for a comment: one file, one side, one hunk, `start` where the pick began. */
export interface Picked {
  key: string
  side: LineSide
  /** The hunk block the pick began in (DiffPane's `data-block`): a pick stretches only over its lines. */
  block: string | null
  start: number
  end: number
}

/** A line of the diff: its file, side, hunk block and number. */
export interface LineAt {
  key: string
  side: LineSide
  block: string | null
  line: number
}

export const pickRange = (pick: Picked): { from: number; to: number } => ({ from: Math.min(pick.start, pick.end), to: Math.max(pick.start, pick.end) })

/** The pick stretched to a line: from the same start when the line is of its file, side and hunk, else the line alone. */
const stretched = (pick: Picked | null, at: LineAt): Picked =>
  pick !== null && pick.key === at.key && pick.side === at.side && pick.block === at.block ? { ...pick, end: at.line } : { key: at.key, side: at.side, block: at.block, start: at.line, end: at.line }

const elementOf = (target: EventTarget | null): Element | null => (target instanceof Element ? target : target instanceof Node ? target.parentElement : null)

const inPick = (pick: Picked | null, key: string, side: LineSide, line: number): boolean => pick !== null && pick.key === key && pick.side === side && line >= pickRange(pick).from && line <= pickRange(pick).to

/** The line a pointer event is on: the file of its hunk, its side, hunk block and number; null off a line. */
export function lineAt(target: EventTarget | null): LineAt | null {
  const cell = elementOf(target)?.closest<HTMLElement>('[data-line][data-side]')
  const hunk = cell?.closest<HTMLElement>('[data-testid="changes-hunk"]')
  const key = hunk?.dataset.key
  const line = Number(cell?.dataset.line)
  const side = cell?.dataset.side
  if (key === undefined || !Number.isInteger(line) || line < 1 || (side !== 'old' && side !== 'new')) return null
  return { key, side, block: hunk?.dataset.block ?? null, line }
}

/** The hunk block an element is in (DiffPane's `data-block` of `changes-hunk`); null off one. */
const blockOf = (target: EventTarget | null): string | null => elementOf(target)?.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.block ?? null

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
  openOn: (key: string, side: LineSide, line: number, block: string | null) => void
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
  key: string
  side: LineSide
  /** The hunk «+» was pressed in: the drag stays in it, as a comment covers lines of one hunk. */
  block: string | null
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

  const openOn = useCallback((key: string, side: LineSide, line: number, block: string | null) => {
    const { options: now, picked: pick } = latest.current
    if (!now.enabled || now.held()) return
    if (inPick(pick, key, side, line)) {
      const { from, to } = pickRange(pick!)
      now.open(key, side, from, to)
      return
    }
    setPicked({ key, side, block, start: line, end: line })
    now.open(key, side, line, line)
  }, [])

  /** Shift with «+»: the pick stretches to the line, or the line alone is picked. */
  const stretch = (at: LineAt) => {
    setPicked((pick) => stretched(pick, at))
  }

  // ── the drag of «+» ──
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const press = (start: LineAt) => {
    stop.current?.()
    const { key, side, block, line } = start
    const drag: Drag = { key, side, block, line, end: line, moved: false }
    const onMove = (event: MouseEvent) => {
      // No button held: it was let go where the window did not hear it (outside it). The drag ends, opening nothing.
      if (event.buttons === 0) {
        stop.current?.()
        return
      }
      const at = lineAt(event.target)
      // A line of another hunk of the same file is not taken: the comment would not get the lines between them.
      if (at === null || at.key !== drag.key || at.side !== drag.side || at.block !== drag.block) return
      if (at.line === drag.line && !drag.moved) return
      drag.moved = true
      drag.end = at.line
      setPicked({ key: drag.key, side: drag.side, block: drag.block, start: drag.line, end: at.line })
    }
    const onUp = () => {
      stop.current?.()
      if (!drag.moved) {
        openOn(drag.key, drag.side, drag.line, drag.block)
        return
      }
      const { from, to } = pickRange({ ...drag, start: drag.line })
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
          const at: LineAt = { key: entry.key, side, block: blockOf(event.currentTarget), line: number }
          if (event.shiftKey) stretch(at)
          else if (!latest.current.options.held()) press(at)
        }}
        onClick={(event) => {
          event.stopPropagation()
          // A press of the pointer was taken by mousedown and mouseup; a click with no pointer is the keyboard's.
          if (event.detail !== 0) return
          if (event.shiftKey) stretch({ key: entry.key, side, block: blockOf(event.currentTarget), line: number })
          else openOn(entry.key, side, number, blockOf(event.currentTarget))
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
      setPicked(event.shiftKey ? stretched(picked, at) : stretched(null, at))
    },
    onMouseUp: () => {
      if (!enabled) return
      const selection = globalThis.getSelection?.()
      if (selection == null || selection.isCollapsed) return
      const from = lineAt(selection.anchorNode)
      const to = lineAt(selection.focusNode)
      if (from === null || to === null || from.key !== to.key || from.side !== to.side || from.line === to.line) return
      // Across hunks the lines between are not the comment's: the line the selection ended on is picked alone.
      setPicked(stretched({ key: from.key, side: from.side, block: from.block, start: from.line, end: from.line }, to))
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
