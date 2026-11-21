// Picking lines for a comment (src/renderer/changes/line-pick.tsx; worfy-changes-view ticket 09, spec, the owner's answers
// of 2026-11-21, D2), the hook the Changes view and Review mode of a PR share, on rows drawn as DiffPane draws them
// (`changes-hunk` with the file's `data-key`, lines with `data-side` and `data-line`):
// - pressing «+» and moving over lines picks a range, letting go opens the comment of it; a line of another file or of
//   the other side does not change the pick; let go on its own line, «+» opens that line;
// - Shift with «+» stretches the pick and opens nothing; with nothing picked it picks the line alone;
// - «Comment on lines N–M (c)» stands under the last line picked while lines are picked and no comment is open; a click
//   on it opens the comment; Escape (clear) takes the pick away;
// - a keyboard press of «+» (a click with no pointer) still opens its line.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffLine } from '../../src/shared/changes/types'
import { useLinePick, type LinePick } from '../../src/renderer/changes/line-pick'
import type { FileEntry } from '../../src/renderer/changes/diff-window'

const entry = (path: string): FileEntry => ({ key: `repo\u0000${path}`, repo: 'repo', file: { path, oldPath: null, status: 'M', additions: 3, deletions: 1, binary: false, oldMode: null, newMode: null, oldBlob: null, newBlob: null, untracked: false, workflow: false, fold: null } })
const A = entry('src/a.ts')
const B = entry('src/b.ts')
/** A file of two hunks: new lines 1–5, then 10–11. */
const C = entry('src/c.ts')
/** A move of the pointer with its main button held: a drag of «+». */
const PRESSED = { buttons: 1 }

/** Lines 1–5 of the new side and line 1 of the old side, as Side by side names its cells. */
const added = (numbers: number[]) => numbers.map((at) => ({ line: { kind: 'add' as const, text: `line ${at}`, oldLine: null, newLine: at, crlf: false, noNewline: false }, side: 'new' as const }))
const LINES: { line: DiffLine; side: 'old' | 'new' }[] = [{ line: { kind: 'del', text: 'old one', oldLine: 1, newLine: null, crlf: false, noNewline: false }, side: 'old' }, ...added([1, 2, 3, 4, 5])]
/** The hunks drawn, as DiffPane draws them: one block per hunk, each with its file's key. */
const BLOCKS: { file: FileEntry; lines: typeof LINES }[] = [
  { file: A, lines: LINES },
  { file: B, lines: LINES },
  { file: C, lines: added([1, 2, 3, 4, 5]) },
  { file: C, lines: added([10, 11]) },
]

let pick: LinePick
let commenting = false
let held = false
const expose = (now: LinePick): void => {
  pick = now
}

function Harness({ open }: { open: (key: string, side: string, from: number, to: number) => void }) {
  const own = useLinePick({ enabled: true, commenting, open, held: () => held, ownControls: 'button', toastKey: 'test-pick', plusLabel: (line, path) => `Comment on line ${line} of ${path}` })
  useEffect(() => expose(own))
  const pick = own
  return (
    <div {...pick.lineEvents}>
      {BLOCKS.map(({ file, lines }, index) => (
        <div key={index} data-block={`${file.key}\u0000hunk${index}`} data-testid="changes-hunk" data-key={file.key} data-path={file.file.path}>
          {lines.map(({ line, side }) => {
            const at = side === 'old' ? line.oldLine : line.newLine
            return (
              <div key={`${side}${at}`}>
                <div data-testid="changes-line" data-side={side} data-line={at} className={pick.isPicked(line, side, file) ? 'is-picked' : ''}>
                  <span className="sign">{pick.plus(line, side, file)}</span>
                  <span className="code">{line.text}</span>
                </div>
                {pick.hint(line, side, file)}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const row = (file: FileEntry, line: number, side: 'old' | 'new' = 'new'): HTMLElement =>
  screen.getAllByTestId('changes-line').find((each) => each.dataset.side === side && each.dataset.line === String(line) && each.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.key === file.key)!
const plusOf = (file: FileEntry, line: number, side: 'old' | 'new' = 'new') => row(file, line, side).querySelector<HTMLElement>('[data-testid="changes-line-plus"]')!
const codeOf = (file: FileEntry, line: number, side: 'old' | 'new' = 'new') => row(file, line, side).querySelector<HTMLElement>('.code')!
const pickedLines = (file: FileEntry): string[] => screen.getAllByTestId('changes-line').filter((each) => each.classList.contains('is-picked') && each.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.key === file.key).map((each) => `${each.dataset.side}${each.dataset.line}`)
const hints = (): HTMLElement[] => screen.queryAllByTestId('changes-pick-hint')

function mount() {
  const open = vi.fn()
  const view = render(<Harness open={open} />)
  return { open, view }
}

afterEach(() => {
  cleanup()
  commenting = false
  held = false
})

describe('the drag of «+»', () => {
  it('pressing «+» and moving over lines picks a range; letting go opens the comment of the whole range', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 3), PRESSED)
    fireEvent.mouseMove(codeOf(A, 4), PRESSED)
    expect(pickedLines(A)).toEqual(['new2', 'new3', 'new4'])
    expect(open).not.toHaveBeenCalled()
    // No hint while the drag is on: it would push the lines under the pointer down.
    expect(hints()).toEqual([])
    fireEvent.mouseUp(codeOf(A, 4))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(A.key, 'new', 2, 4)
  })

  it('upwards too: the range runs from the line let go on to the line pressed', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 4))
    fireEvent.mouseMove(codeOf(A, 2), PRESSED)
    fireEvent.mouseUp(codeOf(A, 2))
    expect(open).toHaveBeenCalledWith(A.key, 'new', 2, 4)
  })

  it('a line of another file or of the other side does not change the pick', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 3), PRESSED)
    fireEvent.mouseMove(codeOf(B, 5), PRESSED)
    fireEvent.mouseMove(codeOf(A, 1, 'old'), PRESSED)
    expect(pickedLines(A)).toEqual(['new2', 'new3'])
    expect(pickedLines(B)).toEqual([])
    fireEvent.mouseUp(codeOf(B, 5))
    expect(open).toHaveBeenCalledWith(A.key, 'new', 2, 3)
  })

  it('let go on the line it was pressed on, «+» opens that line alone; after the drag no listener stays on the window', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 3))
    fireEvent.mouseUp(plusOf(A, 3))
    expect(open).toHaveBeenCalledWith(A.key, 'new', 3, 3)
    expect(pickedLines(A)).toEqual(['new3'])
    open.mockClear()
    fireEvent.mouseMove(codeOf(A, 5), PRESSED)
    fireEvent.mouseUp(codeOf(A, 5))
    expect(open).not.toHaveBeenCalled()
    expect(pickedLines(A)).toEqual(['new3'])
  })

  it('a press inside the range picked, let go there, opens the range', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 4), PRESSED)
    fireEvent.mouseUp(codeOf(A, 4))
    open.mockClear()
    fireEvent.mouseDown(plusOf(A, 3))
    fireEvent.mouseUp(plusOf(A, 3))
    expect(open).toHaveBeenCalledWith(A.key, 'new', 2, 4)
  })

  it('a comment holding what is not saved: a press of «+» changes nothing', () => {
    const { open } = mount()
    held = true
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 4), PRESSED)
    fireEvent.mouseUp(codeOf(A, 4))
    expect(open).not.toHaveBeenCalled()
    expect(pickedLines(A)).toEqual([])
  })

  it('the right button starts no drag', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2), { button: 2 })
    fireEvent.mouseMove(codeOf(A, 4), PRESSED)
    fireEvent.mouseUp(codeOf(A, 4))
    expect(open).not.toHaveBeenCalled()
    expect(pickedLines(A)).toEqual([])
  })
})

describe('the drag of «+» ends', () => {
  // Review round 2: a drag took lines of the file's next hunk, and the hint promised lines the comment did not get.
  it('within the hunk it began in: a line of the same file\'s next hunk does not change the pick', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(C, 4))
    fireEvent.mouseMove(codeOf(C, 5), PRESSED)
    fireEvent.mouseMove(codeOf(C, 10), PRESSED)
    fireEvent.mouseMove(codeOf(C, 11), PRESSED)
    expect(pickedLines(C)).toEqual(['new4', 'new5'])
    fireEvent.mouseUp(codeOf(C, 11))
    expect(open).toHaveBeenCalledWith(C.key, 'new', 4, 5)
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on lines 4–5 (c)'])
  })

  // Review round 2: the button let go outside the window (⌘-Tab) left the drag on until the next mouseup anywhere.
  it('when the window loses the focus: the next mouseup opens nothing, and the hint is back', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 3), PRESSED)
    expect(hints()).toEqual([])
    fireEvent.blur(window)
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on lines 2–3 (c)'])
    fireEvent.mouseUp(codeOf(A, 3))
    expect(open).not.toHaveBeenCalled()
  })

  it('when a move comes with no button held: the button was let go where the window did not hear it', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseMove(codeOf(A, 3), PRESSED)
    fireEvent.mouseMove(codeOf(A, 5), { buttons: 0 })
    expect(pickedLines(A)).toEqual(['new2', 'new3'])
    fireEvent.mouseUp(codeOf(A, 5))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('Shift with «+»', () => {
  it('stretches the pick to its line and opens nothing', () => {
    const { open } = mount()
    fireEvent.click(codeOf(A, 2))
    fireEvent.mouseDown(plusOf(A, 5), { shiftKey: true })
    expect(pickedLines(A)).toEqual(['new2', 'new3', 'new4', 'new5'])
    expect(open).not.toHaveBeenCalled()
  })

  it('with nothing picked in that file and side, picks its line alone', () => {
    const { open } = mount()
    fireEvent.click(codeOf(B, 2))
    fireEvent.mouseDown(plusOf(A, 4), { shiftKey: true })
    expect(pickedLines(A)).toEqual(['new4'])
    expect(pickedLines(B)).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('from the keyboard (a click with no pointer) too', () => {
    const { open } = mount()
    fireEvent.click(codeOf(A, 1))
    fireEvent.click(plusOf(A, 3), { shiftKey: true })
    expect(pickedLines(A)).toEqual(['new1', 'new2', 'new3'])
    expect(open).not.toHaveBeenCalled()
  })
})

// Review round 3: Shift with «+», a click with Shift and a selection of text took lines of the file's next hunk, and the
// hint promised lines the comment did not get (Changes cut the range, Review mode refused it).
describe('a pick stays in the hunk it began in', () => {
  it('Shift with «+» on a line of the next hunk picks that line alone', () => {
    const { open } = mount()
    fireEvent.click(codeOf(C, 3))
    fireEvent.mouseDown(plusOf(C, 10), { shiftKey: true })
    expect(pickedLines(C)).toEqual(['new10'])
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on line 10 (c)'])
    fireEvent.click(plusOf(C, 11), { shiftKey: true })
    expect(pickedLines(C)).toEqual(['new10', 'new11'])
    fireEvent.click(plusOf(C, 2), { shiftKey: true })
    expect(pickedLines(C)).toEqual(['new2'])
    expect(open).not.toHaveBeenCalled()
  })

  it('a click with Shift on a line of the next hunk picks that line alone', () => {
    mount()
    fireEvent.click(codeOf(C, 3))
    fireEvent.click(codeOf(C, 10), { shiftKey: true })
    expect(pickedLines(C)).toEqual(['new10'])
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on line 10 (c)'])
    fireEvent.click(codeOf(C, 11), { shiftKey: true })
    expect(pickedLines(C)).toEqual(['new10', 'new11'])
  })

  it('a selection of text across hunks picks the line it ended on alone', () => {
    const { view } = mount()
    const select = (from: HTMLElement, to: HTMLElement) => {
      const range = document.createRange()
      range.setStart(from.firstChild!, 1)
      range.setEnd(to.firstChild!, 2)
      const chosen = document.getSelection()!
      chosen.removeAllRanges()
      chosen.addRange(range)
      fireEvent.mouseUp(view.container.firstElementChild!)
      chosen.removeAllRanges()
    }
    select(codeOf(C, 2), codeOf(C, 4))
    expect(pickedLines(C)).toEqual(['new2', 'new3', 'new4'])
    select(codeOf(C, 3), codeOf(C, 10))
    expect(pickedLines(C)).toEqual(['new10'])
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on line 10 (c)'])
  })
})

describe('the hint', () => {
  it('«Comment on lines N–M (c)» stands under the last line picked; a click on it opens the comment of the range', () => {
    const { open } = mount()
    expect(hints()).toEqual([])
    fireEvent.click(codeOf(A, 2))
    fireEvent.click(codeOf(A, 4), { shiftKey: true })
    expect(hints()).toHaveLength(1)
    const [hint] = hints()
    expect(hint!.textContent).toBe('Comment on lines 2–4 (c)')
    expect(hint!.previousElementSibling).toBe(row(A, 4))
    fireEvent.click(hint!)
    expect(open).toHaveBeenCalledWith(A.key, 'new', 2, 4)
  })

  it('one line: «Comment on line 3 (c)»; a pick made upwards stands under its lowest line', () => {
    mount()
    fireEvent.click(codeOf(A, 3))
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on line 3 (c)'])
    fireEvent.click(codeOf(A, 1), { shiftKey: true })
    expect(hints().map((each) => each.textContent)).toEqual(['Comment on lines 1–3 (c)'])
    expect(hints()[0]!.previousElementSibling).toBe(row(A, 3))
  })

  it('stands aside while a comment is open, and Escape (clear) takes the pick and the hint away', () => {
    const { view, open } = mount()
    fireEvent.click(codeOf(A, 2))
    commenting = true
    view.rerender(<Harness open={open} />)
    expect(hints()).toEqual([])
    commenting = false
    view.rerender(<Harness open={open} />)
    expect(hints()).toHaveLength(1)
    let took = false
    act(() => {
      took = pick.clear()
    })
    expect(took).toBe(true)
    expect(hints()).toEqual([])
    expect(pickedLines(A)).toEqual([])
    act(() => {
      took = pick.clear()
    })
    expect(took).toBe(false)
  })

  it('a click on a line outside the pick moves it there', () => {
    mount()
    fireEvent.click(codeOf(A, 1))
    fireEvent.click(codeOf(A, 2), { shiftKey: true })
    fireEvent.click(codeOf(B, 5))
    expect(hints().map((each) => [each.closest<HTMLElement>('[data-testid="changes-hunk"]')!.dataset.key, each.textContent])).toEqual([[B.key, 'Comment on line 5 (c)']])
  })
})

describe('the keyboard', () => {
  it('a press of a focused «+» (a click with no pointer) opens its line; c opens the lines picked', () => {
    const { open } = mount()
    fireEvent.click(plusOf(A, 5))
    expect(open).toHaveBeenCalledWith(A.key, 'new', 5, 5)
    fireEvent.click(codeOf(A, 3), { shiftKey: true })
    open.mockClear()
    let took = false
    act(() => {
      took = pick.commentKey()
    })
    expect(took).toBe(true)
    expect(open).toHaveBeenCalledWith(A.key, 'new', 3, 5)
  })

  it('a pointer click of «+» after its press opens nothing more: mousedown and mouseup took it', () => {
    const { open } = mount()
    fireEvent.mouseDown(plusOf(A, 2))
    fireEvent.mouseUp(plusOf(A, 2))
    fireEvent.click(plusOf(A, 2), { detail: 1 })
    expect(open).toHaveBeenCalledTimes(1)
  })
})
