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
// CAN (U+0018) in place of its final `c`, which ends the sequence there without an answer. What
// the screens and the kept output get is the same in every case, so neither ever holds a request.
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

/** The next character that may start a request. */
const START = new RegExp(`[${ESC}${CSI}]`, 'g')

/** Takes the device attributes requests out of the output of one shell, whole or cut between chunks. */
export class ConsoleRequests {
  private state: State = 'text'
  /** The start of a possible request read so far and not given out. */
  private held = ''
  /** The controls inside `held`: a screen acts on them where they stand, request or not. */
  private controls = ''
  /** True when that start was given out as text already (rest(), HOLD_LIMIT): the screens are inside it. */
  private sent = false

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
        text += this.sent ? CAN : this.controls
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
        // Given out already: CAN ends the sequence on the screens without an answer.
        text += this.sent ? CAN : this.controls
        this.reset()
      } else {
        // Any other character: this is no request, and what was held back is the text it is.
        text += (this.sent ? '' : this.held) + char
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
    return rest
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
