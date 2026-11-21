// The keys of the diff screen (DiffScreen.tsx; worfy-changes-view ticket 08): j / k and ↓ / ↑ — the next and the
// previous file, n / p — hunks, c — a comment on the lines picked, Esc — back. None of them while the focus is in a
// field the person types in or in an open layer (a menu, a popover, a dialog): Esc there closes that layer first.
import { useEffect, useRef, type RefObject } from 'react'
import { layerOf, openLayers } from '../theme/open-layers'
import type { DiffPaneHandle } from './DiffPane'
import type { FileEntry } from './diff-window'

/** Input types that take no text: a key pressed on one (Wrap, Hide whitespace) is the screen's. */
const NO_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Whether the keys belong to a field the person types in. */
export function typingIn(target: Element): boolean {
  if ((target instanceof HTMLElement && target.isContentEditable) || target.closest('textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return true
  const input = target.closest('input')
  return input !== null && !NO_TEXT.has(input.type)
}

/** The file `step` away from `at` in `files`, held at the ends; the first one when `at` is none of them. */
export function fileAfter(files: readonly FileEntry[], at: string | null, step: 1 | -1): FileEntry | undefined {
  if (files.length === 0) return undefined
  const index = files.findIndex((entry) => entry.key === at)
  const next = step === 1 ? Math.min(files.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1)
  return files[next]
}

export interface DiffKeysOptions {
  /** The keys are taken only while this is true: the shell keeps its views mounted and hidden. */
  active: boolean
  /** The screen's element: keys pressed while it is inside a hidden view are not its. */
  frame: RefObject<HTMLElement | null>
  entries: readonly FileEntry[]
  chosen: string | null
  select: (key: string) => void
  pane: RefObject<DiffPaneHandle | null>
  /** The key `c`: true when it took it (lines were picked). */
  commentKey: () => boolean
  /** Esc that no field and no layer took. */
  onEscape: () => void
}

/** The keys of the diff screen, on the window while it is shown. */
export function useDiffKeys(options: DiffKeysOptions): void {
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const { active } = options
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const { frame, entries, chosen, select, pane, commentKey, onEscape } = latest.current
      if (frame.current === null || frame.current.closest('[hidden]') !== null) return
      const target = event.target instanceof Element ? event.target : null
      if (target !== null && (typingIn(target) || layerOf(target) !== null)) return
      if (event.key === 'Escape') {
        // A menu or a popover open elsewhere closes first, by its own Esc.
        if (openLayers().length > 0) return
        event.preventDefault()
        onEscape()
        return
      }
      if (event.shiftKey) return
      if (event.key === 'c') {
        if (commentKey()) event.preventDefault()
        return
      }
      if (event.key === 'n' || event.key === 'p') {
        event.preventDefault()
        pane.current?.moveHunk(event.key === 'n' ? 1 : -1)
        return
      }
      const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0
      if (step === 0) return
      const next = fileAfter(entries, chosen, step)
      if (next === undefined) return
      event.preventDefault()
      select(next.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
