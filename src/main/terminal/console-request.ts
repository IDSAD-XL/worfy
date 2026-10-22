// The one question the console of Windows asks its terminal (worfy-windows ticket 22).
//
// The console of the node-pty package (OpenConsole.exe, spawnShellPty in windows-pty.ts) asks the
// terminal for its device attributes when a shell starts — `ESC [ c` — and holds the output of the
// shell for three seconds when nobody answers (measured on the owner's PC: the prompt after 3275 ms
// without an answer, after 276 ms with one).
//
// xterm.js answers such a request, and that is the trouble: every xterm.js that is given the
// output answers it — a second screen of the same Terminal, a window that was reloaded and got the
// kept output replayed — and the console passes a second, unasked answer on to the shell as typed
// input. Measured in the packaged build: after a reload the prompt reads `PS …> [?1;2c`, and a
// program waiting for one key gets the ESC of the answer.
//
// So main answers, once per request, and takes the request out of the output before it is kept or
// sent to any screen. The scanner reads the output one character at a time, as the parser of
// xterm.js does, and takes out every form xterm.js answers: CSI as `ESC [` or as the one character
// U+009B, parameters whose first value is 0 (`ESC [ c`, `ESC [ 0 c`, `ESC [ 0 0 c`, `ESC [ ; c`,
// `ESC [ 0 ; 1 c`), and the controls xterm.js acts on inside a sequence. A sequence cut off by
// another (`ESC [ ESC [ c c`) is dropped as xterm.js drops it. When the start of a possible request
// had to be given out as text before its end came (rest(): the next chunk was late), the screens
// hold that start too; should it end as a request after all, main answers it and the screens get
// CAN (U+0018) in place of its final `c`, which ends the sequence there without an answer. The
// screens and the kept output always get the same text, and it never holds a request.
//
// Taking a request out must not change what the screens do with the rest. In the raw output the
// ESC of a request also ends a sequence of another program that has not ended yet (`ESC [ 1 ; 3`,
// an OSC title without its BEL, a DCS string): xterm.js drops that sequence. Without the request
// the sequence would stay open, and the next text would end it — `Hello` would become the final
// `H` of `ESC [ 1 ; 3 H` and the screen show `ello`, or the text would go into the title. So the
// scanner follows, as xterm.js does, whether the screens may still be inside such a sequence, and
// in that case gives the request out as its first character, its controls and CAN: that ends the
// sequence as the raw output did, and answers nothing. When the screens are surely outside one
// (the start of a shell), the request leaves nothing behind but its controls.
//
// The console sends this request by itself only at the start of a shell (measured, Windows
// PowerShell and Git Bash). A resize brings no such request, but with node-pty 1.2.0-beta.15 it
// brings about ten cursor-position requests (`ESC [ 6 n`, measured on the owner's PC); main
// answers those itself (cursor-answers.ts). This console also passes a request that a PROGRAM
// writes on to the terminal, and the answer back to the program (measured: a program that wrote
// `ESC [ c` read back `ESC [ ? 1 ; 2 c` when the terminal answered, and nothing when it did not).
// Such a request is answered here in the same way, with what xterm.js would say. Other requests of
// a program (the colors, the modes) still go to the screens: only a screen knows those answers.

const ESC = '\x1b'
/** CSI as one character (C1); xterm.js reads it as `ESC [`. */
const CSI = '\x9b'
/** Cancel: xterm.js ends the sequence it is in, and does nothing else. */
const CAN = '\x18'
/** Substitute: ends a sequence as CAN does. */
const SUB = '\x1a'

/** What xterm.js answers to the request: a VT100 with the advanced video option. */
export const DEVICE_ATTRIBUTES_ANSWER = `${ESC}[?1;2c`

/**
 * How much of a possible request is held back at most. A request is a few characters; past this
 * the start is given out as text, and the scanner still follows it (as after rest()).
 */
export const HOLD_LIMIT = 256

/** Where the scanner is: outside a possible request; after ESC; in the first parameter (zeros so far); past it. */
type State = 'text' | 'escape' | 'first' | 'more'

/**
 * A sequence of another program the screens may still be in, read as xterm.js reads it: a CSI, an
 * ESC with intermediates, an OSC string, or a DCS, SOS, PM or APC string.
 */
type Open = 'csi' | 'esc' | 'osc' | 'string' | null

/** The next character that may start a request. */
const START = new RegExp(`[${ESC}${CSI}]`, 'g')

/** The C1 characters that open a string (DCS, SOS, OSC, PM, APC): xterm.js reads them anywhere. */
const OPENER = /[\x90\x98\x9d\x9e\x9f]/g

/** Which string a C1 character opens, in any state of xterm.js; any other C1 ends what it is in (ST, the executed ones). */
function c1(code: number): Open {
  if (code === 0x9d) return 'osc'
  return code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f ? 'string' : null
}

/** Whether the screens are still inside `open` after one more character, as the parser of xterm.js reads it. */
function after(open: Exclude<Open, null>, code: number): Open {
  if (code === 0x18 || code === 0x1a) return null
  if (code >= 0x80 && code <= 0x9f) return c1(code)
  if (open === 'csi') return code >= 0x40 && code <= 0x7e ? null : open
  // Past 0x9f xterm.js ends an ESC with intermediates; in a CSI or a string it may read on.
  if (open === 'esc') return code >= 0x30 && code !== 0x7f ? null : open
  if (open === 'osc') return code === 0x07 ? null : open
  return open
}

/** What the screens are inside after a possible request that turned out to be none ended with `char`. */
function failed(state: State, char: string): Open {
  const code = char.charCodeAt(0)
  if (code >= 0x80 && code <= 0x9f) return c1(code)
  if (char === CAN || char === SUB || code > 0x9f) return null
  if (state !== 'escape') return code >= 0x40 && code <= 0x7e ? null : 'csi'
  if (char === ']') return 'osc'
  if (char === 'P' || char === 'X' || char === '^' || char === '_') return 'string'
  return code < 0x30 ? 'esc' : null
}

/** Takes the device attributes requests out of the output of one shell, whole or cut between chunks. */
export class ConsoleRequests {
  private state: State = 'text'
  /** The start of a possible request read so far and not given out. */
  private held = ''
  /** The controls inside `held`: a screen acts on them where they stand, request or not. */
  private controls = ''
  /** True when that start was given out as text already (rest(), HOLD_LIMIT): the screens are inside it. */
  private sent = false
  /** A sequence of another program the screens may still be in: a request must end it as its ESC did. */
  private open: Open = null

  /**
   * Reads one chunk: answers it without the requests, and how many it held. An end of the chunk
   * that may be the start of a request is kept back and comes with the next chunk — taken out as
   * part of a request, or as the text it turned out to be.
   */
  feed(chunk: string): { text: string; requests: number } {
    let text = ''
    let requests = 0
    let at = 0
    while (at < chunk.length) {
      if (this.state === 'text') {
        START.lastIndex = at
        const start = START.exec(chunk)
        const end = start === null ? chunk.length : start.index
        text += chunk.slice(at, end)
        this.follow(chunk, at, end)
        if (start === null) break
        this.begin(chunk.charAt(end))
        at = end + 1
        continue
      }
      const char = chunk.charAt(at)
      at += 1
      const code = char.charCodeAt(0)
      if (char === ESC || char === CSI) {
        // A new sequence ends this one: xterm.js drops what was read of it, and acts on its controls.
        text += this.takenOut()
        this.begin(char)
      } else if ((code < 0x20 && char !== CAN && char !== SUB) || code === 0x7f) {
        // Inside a sequence xterm.js carries out a control (and ignores DEL) and reads on.
        this.controls += char
        text += this.keep(char)
      } else if (this.state === 'escape' && char === '[') {
        this.state = 'first'
        text += this.keep(char)
      } else if (this.state === 'first' && char === '0') {
        text += this.keep(char)
      } else if (this.state !== 'escape' && (char === ';' || char === ':' || (this.state === 'more' && char >= '0' && char <= '9'))) {
        this.state = 'more'
        text += this.keep(char)
      } else if (this.state !== 'escape' && char === 'c') {
        requests += 1
        text += this.takenOut()
        this.reset()
      } else {
        // Any other character: this is no request, and what was held back is the text it is.
        text += (this.sent ? '' : this.held) + char
        this.open = failed(this.state, char)
        this.reset()
      }
    }
    return { text, requests }
  }

  /** Whether an end of the last chunk is kept back. */
  get holds(): boolean {
    return this.state !== 'text' && !this.sent
  }

  /**
   * What is kept back, given up as the text it is: the next chunk did not come, or the stream has
   * ended. The scanner still follows that start: should the next chunk end it as a request, the
   * screens get CAN in its place (feed).
   */
  rest(): string {
    if (!this.holds) return ''
    const rest = this.held
    this.held = ''
    this.sent = true
    // Its ESC or CSI ends on the screens whatever sequence they were in.
    this.open = null
    return rest
  }

  /**
   * What the screens get in place of the start held back, when it is taken out — as a request, or
   * cut off by a new sequence. Given out already: CAN, which ends it there without an answer. Not
   * given out: its controls, which xterm.js carries out; and when the screens may be inside a
   * sequence of another program, first the ESC or CSI that ended that one in the raw output, and
   * CAN after the controls, so that what follows is read as it was.
   */
  private takenOut(): string {
    if (this.sent) return CAN
    const text = this.open === null ? this.controls : this.held.charAt(0) + this.controls + CAN
    this.open = null
    return text
  }

  /** Follows the text `chunk[from, to)` given out as it is: does it open or end a sequence on the screens. */
  private follow(chunk: string, from: number, to: number): void {
    let at = from
    while (at < to) {
      if (this.open === null) {
        OPENER.lastIndex = at
        const found = OPENER.exec(chunk)
        if (found === null || found.index >= to) return
        this.open = c1(found[0].charCodeAt(0))
        at = found.index + 1
      } else {
        this.open = after(this.open, chunk.charCodeAt(at))
        at += 1
      }
    }
  }

  private begin(char: string): void {
    this.state = char === ESC ? 'escape' : 'first'
    this.held = char
    this.controls = ''
    this.sent = false
  }

  /** One more character of the possible request: held back, or given out when the start was. */
  private keep(char: string): string {
    if (this.sent) return char
    this.held += char
    if (this.held.length < HOLD_LIMIT) return ''
    return this.rest()
  }

  private reset(): void {
    this.state = 'text'
    this.held = ''
    this.controls = ''
    this.sent = false
  }
}
