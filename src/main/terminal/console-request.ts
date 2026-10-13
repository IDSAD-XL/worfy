// The one question the console of Windows asks its terminal (worfy-windows ticket 22).
//
// The console of the node-pty package (OpenConsole.exe, spawnShellPty in pty.ts) asks the terminal
// for its device attributes when a shell starts — `ESC [ c` — and holds the output of the shell
// for three seconds when nobody answers (measured on the owner's PC: the prompt after 3275 ms
// without an answer, after 276 ms with one).
//
// xterm.js answers such a request, and that is the trouble: every xterm.js that is given the
// output answers it — a second screen of the same Terminal, a window that was reloaded and got the
// kept output replayed — and the console passes a second, unasked answer on to the shell as typed
// input. Measured in the packaged build: after a reload the prompt reads `PS …> [?1;2c`, and a
// program waiting for one key gets the ESC of the answer.
//
// So main answers, once per request, and takes the request out of the output before it is kept or
// sent to any screen: no xterm.js ever sees it.
//
// The console sends this request by itself only at the start of a shell; a resize brings none
// (measured, Windows PowerShell and Git Bash). But this console also passes a request that a
// PROGRAM writes on to the terminal, and the answer back to the program (measured: a program that
// wrote `ESC [ c` read back `ESC [ ? 1 ; 2 c` when the terminal answered, and nothing when it did
// not). Such a request is answered here in the same way, with what xterm.js would say. Other
// requests of a program (the cursor position, the colors) still go to the screens: only a screen
// knows those answers.

const ESC = '\x1b'

/** What xterm.js answers to the request: a VT100 with the advanced video option. */
export const DEVICE_ATTRIBUTES_ANSWER = `${ESC}[?1;2c`

/** The request, with or without its default parameter: `ESC [ c`, `ESC [ 0 c`. */
const REQUEST = new RegExp(`${ESC}\\[0?c`, 'g')

/** The end of a chunk that may be the start of a request: `ESC`, `ESC [`, `ESC [ 0`. */
const START_AT_THE_END = new RegExp(`${ESC}(?:\\[0?)?$`)

/** Takes the device attributes requests out of the output of one shell, whole or cut between two chunks. */
export class ConsoleRequests {
  /** What the last chunk ended with, when that may be the start of a request. */
  private carry = ''

  /**
   * Reads one chunk: answers it without the requests, and how many it held. An end of the chunk
   * that may be the start of a request is kept back and comes with the next chunk — as part of a
   * request, or as the text it turned out to be.
   */
  feed(chunk: string): { text: string; requests: number } {
    let requests = 0
    const text = (this.carry + chunk).replace(REQUEST, () => {
      requests += 1
      return ''
    })
    this.carry = START_AT_THE_END.exec(text)?.[0] ?? ''
    return { text: this.carry === '' ? text : text.slice(0, -this.carry.length), requests }
  }

  /** Whether an end of the last chunk is kept back. */
  get holds(): boolean {
    return this.carry !== ''
  }

  /** What is kept back, given up as the text it is: the next chunk did not come, or the stream has ended. */
  rest(): string {
    const rest = this.carry
    this.carry = ''
    return rest
  }
}
