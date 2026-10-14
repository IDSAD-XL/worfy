// The output tail of Fix (Epic worfy-terminal-ai, ticket 07): what a failed command printed, as plain
// lines the model can read. Main keeps that output as the program wrote it (ShellState.lastOutput,
// src/main/terminal/osc.ts), with colours, cursor moves, titles and progress lines redrawn over `\r`.
//
// outputLines() replays it the way a terminal shows one line at a time:
//   - CSI sequences go (colours, cursor moves); of them only "erase in line" (CSI K) acts, since a
//     progress line usually clears what is left of its old text with it;
//   - OSC, DCS, SOS, PM and APC strings go whole, up to their end (BEL or ST);
//   - `\r` returns to the start of the line and the text after it overwrites the text before, and
//     backspace steps back one place: a progress line ends as its last state;
//   - every other control character goes.
// outputTail() keeps the last MAX_OUTPUT_LINES of those lines. Redaction and the cut of a long line
// are not here: prepareContext() (context.ts) does both for every request, this tail included.
import { MAX_OUTPUT_LINES } from './context'

const ESC = '\x1b'
const BEL = '\x07'
/** The 8-bit forms: CSI, ST, and the strings DCS, SOS, OSC, PM, APC. */
const CSI_C1 = '\x9b'
const ST_C1 = '\x9c'
const STRING_C1 = new Set(['\x90', '\x98', '\x9d', '\x9e', '\x9f'])
/** The letters after ESC that open a string ended by BEL or ST: DCS, SOS, OSC, PM, APC. */
const STRING_ESC = new Set(['P', 'X', ']', '^', '_'])

/** One line being drawn: its cells, and the place the next character goes to. */
class LineBuffer {
  private cells: string[] = []
  private cursor = 0

  put(char: string): void {
    while (this.cells.length < this.cursor) this.cells.push(' ')
    this.cells[this.cursor] = char
    this.cursor++
  }

  carriageReturn(): void {
    this.cursor = 0
  }

  backspace(): void {
    if (this.cursor > 0) this.cursor--
  }

  /** CSI K: 0 (or none) from the cursor to the end, 1 from the start to the cursor, 2 the whole line. */
  erase(mode: string): void {
    if (mode === '' || mode === '0') this.cells.length = Math.min(this.cells.length, this.cursor)
    else if (mode === '1') for (let at = 0; at <= this.cursor && at < this.cells.length; at++) this.cells[at] = ' '
    else if (mode === '2') this.cells = []
  }

  text(): string {
    return this.cells.join('').trimEnd()
  }
}

/** Where a string (OSC and its kin) that starts at `from` ends: the index after its terminator. */
function stringEnd(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    const char = text[at]
    if (char === BEL || char === ST_C1) return at + 1
    if (char === ESC && text[at + 1] === '\\') return at + 2
  }
  return text.length
}

/** Where a CSI whose parameters start at `from` ends: its final byte (0x40–0x7E), or -1 when it is cut. */
function csiFinal(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code >= 0x40 && code <= 0x7e) return at
    // ESC, CAN and SUB abort a CSI, as xterm aborts it.
    if (code === 0x1b || code === 0x18 || code === 0x1a) return -1
  }
  return -1
}

/** The lines of `output` as a terminal would show them, without any escape sequence or control character. */
export function outputLines(output: string): string[] {
  const lines: string[] = []
  let line = new LineBuffer()
  let at = 0
  while (at < output.length) {
    const char = output[at] ?? ''
    if (char === '\n') {
      lines.push(line.text())
      line = new LineBuffer()
      at++
    } else if (char === '\r') {
      line.carriageReturn()
      at++
    } else if (char === '\b') {
      line.backspace()
      at++
    } else if (char === '\t') {
      line.put(' ')
      at++
    } else if (char === ESC || char === CSI_C1 || STRING_C1.has(char)) {
      const csiFrom = char === CSI_C1 ? at + 1 : char === ESC && output[at + 1] === '[' ? at + 2 : -1
      if (csiFrom !== -1) {
        const final = csiFinal(output, csiFrom)
        if (final === -1) {
          // A cut or aborted CSI: what follows is read anew from its first byte that is not a parameter.
          at = csiFrom
          while (at < output.length && output.charCodeAt(at) >= 0x20 && output.charCodeAt(at) <= 0x3f) at++
          continue
        }
        if (output[final] === 'K') line.erase(output.slice(csiFrom, final).replace(/^\?/, ''))
        at = final + 1
      } else if (STRING_C1.has(char)) {
        at = stringEnd(output, at + 1)
      } else if (STRING_ESC.has(output[at + 1] ?? '')) {
        at = stringEnd(output, at + 2)
      } else {
        // ESC and one more character (ESC 7, ESC =), or with an intermediate byte (ESC ( B).
        at += 2
        while (at < output.length && output.charCodeAt(at - 1) >= 0x20 && output.charCodeAt(at - 1) <= 0x2f) at++
      }
    } else {
      const code = char.charCodeAt(0)
      // The other C0 controls, DEL and the C1 controls are not shown.
      if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) line.put(char)
      at++
    }
  }
  lines.push(line.text())
  return lines
}

/** The last MAX_OUTPUT_LINES lines `output` shows, without the empty lines at its end; [] for no output. */
export function outputTail(output: string | null): string[] {
  if (output === null) return []
  const lines = outputLines(output)
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines.slice(-MAX_OUTPUT_LINES)
}
