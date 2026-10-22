import type { IDisposable } from '@xterm/xterm'

// The alternate screen of a Terminal keeps exactly as many lines as the screen has rows
// (worfy-windows ticket 86).
//
// xterm.js 6.0 gives its alternate buffer room for the rows the terminal had when the buffer was
// last cleared: at construction (80x24, before the Node is measured) and on every return to the
// normal screen. A resize to fewer rows does not take that room back while the alternate buffer
// is empty, that is, whenever the normal screen is shown (Buffer.resize skips an empty buffer).
// A program that then enters the alternate screen and prints past its last row pushes lines into
// that room, as if the alternate screen had a scrollback, and the wheel over the terminal scrolls
// those lines instead of sending the arrow keys xterm.js sends a program in the alternate screen
// (`printf '\033[?1049h'; cat -v` in a Terminal of 21 rows: three lines of room, the wheel scrolled
// and sent nothing). It shows wherever the screen has fewer rows than before: on Windows the cell
// is taller, so a Node of the default size has 21 rows and not 24.
//
// So after every resize of the normal screen the alternate buffer is cleared again, at the new
// size; it is empty then, so nothing is lost.
// shortcut: reaches into xterm.js internals (`_core.buffers.alt`), checked for their shape, and does
// nothing when they are not there; redo when an xterm.js upgrade trims the empty alternate buffer
// on resize itself (the first test of test/unit/terminal-alt-buffer.test.tsx fails then).

/** What this module uses of an xterm.js Terminal: the public parts and the internals it reaches. */
export interface AltBufferTerminal {
  readonly rows: number
  onResize(listener: (size: { cols: number; rows: number }) => void): IDisposable
}

interface AltBuffer {
  lines: { length: number; maxLength: number }
  clear(): void
}

function altBufferOf(terminal: AltBufferTerminal): AltBuffer | undefined {
  const alt = (terminal as unknown as { _core?: { buffers?: { alt?: Partial<AltBuffer> } } })._core?.buffers?.alt
  if (alt === undefined || typeof alt.clear !== 'function' || typeof alt.lines?.length !== 'number' || typeof alt.lines.maxLength !== 'number') return undefined
  return alt as AltBuffer
}

/** Gives the empty alternate buffer room for exactly the terminal's rows; true when it had more. */
export function fitAltBuffer(terminal: AltBufferTerminal): boolean {
  // A shown alternate screen is not empty: it is left as it is, and fitted when it is left.
  const alt = altBufferOf(terminal)
  if (alt === undefined || alt.lines.length !== 0 || alt.lines.maxLength <= terminal.rows) return false
  alt.clear()
  return true
}

/** Fits the alternate buffer now and after every resize, until disposed. */
export function keepAltBufferFitted(terminal: AltBufferTerminal): IDisposable {
  fitAltBuffer(terminal)
  return terminal.onResize(() => fitAltBuffer(terminal))
}
