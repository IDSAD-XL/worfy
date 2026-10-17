import type { IBuffer, IBufferCell, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { MAX_FIELD_CHARS } from '../../../shared/terminal-ai/context'

// The line typed in the shell of a Terminal, read off the screen of xterm.js: what the ⌘I panel of
// Command request sends with its words (TerminalAiRequest.tsx). main does not see the BUFFER of zsh;
// only the screen shows it.
//
// The line starts where the prompt ended: the zsh integration puts the mark OSC 633;B at the end of
// PS1 (src/main/terminal/zsh/integration.zsh), and the handler here notes the cell the cursor is on
// when xterm.js reads it. A marker of xterm.js keeps the row as the output scrolls; the next prompt
// (A) or a command starting (C) drops it. The line then runs to the end of that row and of every row
// it goes on to, as one line: a row goes on to the next when xterm.js wrapped it, or when it is full
// to its last cell — zsh draws a long line itself and moves to the next row with a line feed, so
// xterm.js does not mark that row as wrapped. Out of it go:
//   - the grey text after the line: the Suggestion and the notes of Terminal AI (POSTDISPLAY drawn
//     `fg=8`, src/main/terminal/zsh/rc.d/10-assist.zsh; zsh-autosuggestions draws its own the same
//     way), and dim text. Only from the cursor on: zsh draws POSTDISPLAY after the whole BUFFER, and
//     the cursor is always within the BUFFER;
//   - the right prompt (RPROMPT): text at the right edge of the first row that is not wrapped,
//     after a gap of RIGHT_PROMPT_GAP blank cells or more right of the cursor, as VS Code's shell
//     integration tells it.
// The renderer does not know the nonce of the shell, so a program can print the mark itself: then
// the line in the context is other text of the screen, and nothing else changes (the panel sends
// nothing while a command runs).
//
// shortcut: a BUFFER of several lines (Alt+Enter, a `\` continuation) gives only its first line, a
// right prompt closer than RIGHT_PROMPT_GAP cells to the text stays in the line, and a line that
// ends right at the edge of a row takes in the row under it (a list of completions); redo when the
// zsh integration reports BUFFER to main itself.

/** OSC 633 of the shell integration. */
const SHELL_INTEGRATION_OSC = 633
/** At least this many blank cells before text at the right edge make it a right prompt. */
export const RIGHT_PROMPT_GAP = 5
/** The colour zsh draws grey text with: `fg=8`, bright black. */
const GREY = 8

/** Where the prompt ended: the row (a marker that follows the buffer) and the column. */
export interface PromptEnd {
  row: number
  x: number
}

interface Cell {
  text: string
  /** Not typed: grey or dim, as zsh draws text after the line. */
  grey: boolean
  /** The column of the cell it stands for: a wide character takes two. */
  at: number
  /** The row of the buffer. */
  row: number
}

function cellOf(cell: IBufferCell): { text: string; grey: boolean } | null {
  // The second half of a wide character: the first half stands for both.
  if (cell.getWidth() === 0) return null
  const text = cell.getChars()
  return { text: text === '' ? ' ' : text, grey: (cell.isFgPalette() && cell.getFgColor() === GREY) || cell.isDim() !== 0 }
}

const blank = (cell: { text: string }): boolean => cell.text.trim() === ''

/** The last cell of row `y` holds a character (or the second half of a wide one): the text may go on to the next row. */
function lastCellFilled(buffer: IBuffer, y: number, cols: number): boolean {
  const line = buffer.getLine(y)
  const lastCell = line?.getCell(cols - 1)
  if (line === undefined || lastCell === undefined) return false
  const cell = lastCell.getWidth() === 0 ? line.getCell(cols - 2) : lastCell
  return cell !== undefined && cell.getChars().trim() !== ''
}

/**
 * The line typed after the prompt that ended at `end`, out of `buffer` (the normal buffer of a
 * terminal `cols` wide): one string for the row of `end` and the rows it goes on to, without the
 * grey text after it and without a right prompt, with no blank at its end.
 */
export function typedLine(buffer: IBuffer, cols: number, end: PromptEnd): string {
  let { row, x } = end
  // A prompt that filled its row: the cursor waits past the last cell, the line starts on the next row.
  if (x >= cols) {
    row++
    x = 0
  }
  const cells: Cell[] = []
  let cursor: number | null = null
  const cursorRow = buffer.baseY + buffer.cursorY
  for (let y = row; ; y++) {
    const line = buffer.getLine(y)
    if (line === undefined || (y > row && !line.isWrapped && !lastCellFilled(buffer, y - 1, cols))) break
    for (let column = y === row ? x : 0; column < cols; column++) {
      if (y === cursorRow && column === buffer.cursorX) cursor = cells.length
      const read = line.getCell(column)
      const cell = read === undefined ? null : cellOf(read)
      if (cell !== null) cells.push({ ...cell, at: column, row: y })
    }
    if (y === cursorRow && buffer.cursorX >= cols) cursor = cells.length
  }
  // A cursor off the line (a list of completions under it): every grey cell at the end goes.
  const from = cursor ?? 0

  let length = cells.length
  // The right prompt: only when nothing of the line is on a row below the first, as zsh shows it.
  let last = length - 1
  while (last >= 0 && blank(cells[last]!)) last--
  if (last >= 0 && cells[last]!.row === row && cells[last]!.at >= cols - 2) {
    // The start of the text at the edge: the nearest gap of RIGHT_PROMPT_GAP blank cells before it, right of the cursor.
    for (let index = last, gap = 0; index >= from; index--) {
      gap = blank(cells[index]!) ? gap + 1 : 0
      if (gap >= RIGHT_PROMPT_GAP) {
        length = index
        break
      }
    }
  }
  // The grey text after the line, and the blank cells around it.
  while (length > 0 && (blank(cells[length - 1]!) || (cells[length - 1]!.grey && length - 1 >= from))) length--
  return cells
    .slice(0, length)
    .map((cell) => cell.text)
    .join('')
}

/**
 * `line` within MAX_FIELD_CHARS, the most the channel takes: a longer one loses its end and the word
 * the cut falls in, so the head of a secret cut in two never goes out unredacted.
 */
export function lineWithinLimit(line: string): string {
  return line.length <= MAX_FIELD_CHARS ? line : line.slice(0, MAX_FIELD_CHARS).replace(/\S+$/, '')
}

/** The line typed in the shell of `terminal`, kept from the marks of its prompt. */
export interface TypedLineWatch extends IDisposable {
  /** The line as the screen shows it now; empty when no prompt waits for input. */
  line(): string
}

/** Follows the marks of the prompt in the output of `terminal`; call before the output is written. */
export function watchTypedLine(terminal: Terminal): TypedLineWatch {
  let end: { marker: IMarker; x: number } | null = null
  const drop = () => {
    end?.marker.dispose()
    end = null
  }
  const handler = terminal.parser.registerOscHandler(SHELL_INTEGRATION_OSC, (data) => {
    const kind = data.split(';', 1)[0]
    if (kind === 'B') {
      drop()
      // The normal buffer: a prompt is never drawn on the alternate screen.
      end = { marker: terminal.registerMarker(0), x: terminal.buffer.normal.cursorX }
    } else if (kind === 'A' || kind === 'C') drop()
    // Not consumed: the mark means nothing else to xterm.js.
    return false
  })
  return {
    line: () => {
      if (end === null || end.marker.isDisposed || end.marker.line < 0) return ''
      return lineWithinLimit(typedLine(terminal.buffer.normal, terminal.cols, { row: end.marker.line, x: end.x }))
    },
    dispose: () => {
      handler.dispose()
      drop()
    },
  }
}
