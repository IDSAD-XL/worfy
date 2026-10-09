// The shell integration sequences of a Terminal, read by main out of the pty output.
//
// The zsh script of worfy (src/main/terminal/zsh/integration.zsh) prints the OSC 633 sequences of
// VS Code's shell integration (https://code.visualstudio.com/docs/terminal/shell-integration):
//
//   ESC ] 633 ; A ; <nonce> BEL              the prompt starts
//   ESC ] 633 ; B ; <nonce> BEL              the prompt ends: the shell waits for input
//   ESC ] 633 ; E ; <command line> ; <nonce> BEL   the command line about to run (escaped)
//   ESC ] 633 ; C ; <nonce> BEL              the command starts
//   ESC ] 633 ; D ; <exit code> ; <nonce> BEL  the command finished
//   ESC ] 633 ; P ; Cwd=<folder> ; <nonce> BEL  the current folder (escaped)
//
// Unlike VS Code, every sequence carries the nonce of its shell as its last parameter: a program
// that runs in the Terminal does not know it, so it cannot forge the end of a command or a command
// line. A sequence without the nonce, with another one, and any OSC 133 is passed over. The output
// itself is never changed: the sequences stay in the stream, and xterm skips them.
//
// Programs also switch the alternate screen (CSI ? 1049, ? 1047, ? 47 h/l; vim, less): that is
// tracked whoever prints it, as xterm does.
//
// The tracker is plain code over chunks of output: a sequence may be cut between two chunks at any
// place, and reads the same as a whole one.

/** How many of the last command lines a Terminal keeps. */
export const COMMANDS_KEPT = 20
/** The default limit of a command's kept output and of one sequence, in UTF-16 code units. */
export const DEFAULT_LIMIT = 256 * 1024

const ESC = '\x1b'
const BEL = '\x07'
/** CAN and SUB abort a sequence in xterm. */
const CAN = '\x18'
const SUB = '\x1a'

/**
 * Escapes a value of a sequence as the zsh script does and VS Code's documentation asks: `\` to
 * `\\`, `;` and every code 0x20 and below to `\xHH`.
 */
export function encodeValue(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (char === '\\') out += '\\\\'
    else if (char === ';' || code <= 0x20) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += char
  }
  return out
}

/** Undoes encodeValue: `\\` and `\xHH`; any other backslash stays as it is. */
export function decodeValue(value: string): string {
  return value.replace(/\\(\\|x[0-9a-fA-F]{2})/g, (_match, escaped: string) => (escaped === '\\' ? '\\' : String.fromCharCode(Number.parseInt(escaped.slice(1), 16))))
}

export type ShellEvent =
  /** The prompt is shown in full: the shell waits for input. */
  | { type: 'prompt' }
  /** A command started; `command` is its line, null when it started with a space. */
  | { type: 'command-started'; command: string | null }
  | { type: 'command-finished'; command: string | null; exitCode: number | null }

export interface ShellState {
  /** The current folder of the shell, from its last P. */
  cwd: string | null
  /** The prompt is shown and no command was started since (between B and C). */
  awaitingInput: boolean
  /** A command runs (between C and D). */
  commandRunning: boolean
  /** A program switched to the alternate screen and has not switched back. */
  altScreen: boolean
  /** The exit code of the last finished command. */
  exitCode: number | null
  /** The last COMMANDS_KEPT command lines, the newest last; lines that start with a space are not here. */
  commands: readonly string[]
  /** What the last finished command printed (between C and D), the last `limit` units of it. */
  lastOutput: string | null
}

/** Text kept up to a limit: the end of it. */
class TailText {
  private parts: string[] = []
  private length = 0

  constructor(private readonly limit: number) {}

  push(text: string): void {
    if (text === '') return
    this.parts.push(text)
    this.length += text.length
    if (this.length > this.limit * 2) this.trim()
  }

  text(): string {
    this.trim()
    return this.parts.join('')
  }

  private trim(): void {
    let joined = this.parts.join('')
    if (joined.length > this.limit) joined = joined.slice(joined.length - this.limit)
    this.parts = joined === '' ? [] : [joined]
    this.length = joined.length
  }
}

/** Where an OSC that starts at `start` (its ESC) ends, or why it does not. */
type OscEnd =
  /** The body is text[bodyStart, bodyEnd); the next text starts at `next`. */
  | { kind: 'done'; bodyEnd: number; next: number }
  /** Aborted by an ESC that does not start ST, or by CAN/SUB; scanning resumes at `next`. */
  | { kind: 'aborted'; next: number }
  /** Its end has not come yet. */
  | { kind: 'open' }

// eslint-disable-next-line no-control-regex -- BEL, ESC, CAN and SUB are what ends an OSC.
const OSC_STOP = /[\x07\x1b\x18\x1a]/g

function findOscEnd(text: string, bodyStart: number): OscEnd {
  OSC_STOP.lastIndex = bodyStart
  const match = OSC_STOP.exec(text)
  if (match === null) return { kind: 'open' }
  const at = match.index
  const stop = text[at]
  if (stop === BEL) return { kind: 'done', bodyEnd: at, next: at + 1 }
  if (stop === CAN || stop === SUB) return { kind: 'aborted', next: at + 1 }
  // ESC: ST when a backslash follows; else the OSC is aborted and the ESC starts something new.
  const after = text[at + 1]
  if (after === undefined) return { kind: 'open' }
  if (after === '\\') return { kind: 'done', bodyEnd: at, next: at + 2 }
  return { kind: 'aborted', next: at }
}

/** The end of a CSI that starts at `start` (its ESC): the index of its final byte, or -1 when it has not come. */
function findCsiEnd(text: string, start: number): number {
  for (let at = start + 2; at < text.length; at++) {
    const code = text.charCodeAt(at)
    // Parameter bytes 0x30–0x3F and intermediate bytes 0x20–0x2F; the final byte is 0x40–0x7E.
    if (code >= 0x20 && code <= 0x3f) continue
    return at
  }
  return -1
}

const ALT_SCREEN_MODES = new Set(['1049', '1047', '47'])

/** One sequence of the shell, as read out of its body. */
type Signal =
  | { code: 'A' | 'B' | 'C' }
  | { code: 'D'; exitCode: number | null }
  | { code: 'E'; command: string }
  | { code: 'P'; cwd: string }

/** The state of one shell, read out of its output; `nonce` is the one the shell was started with. */
export class ShellTracker {
  private readonly limit: number
  /** The start of a sequence cut at the end of the last chunk. */
  private carry = ''
  private cwd: string | null = null
  private awaitingInput = false
  private commandRunning = false
  private altScreen = false
  private exitCode: number | null = null
  private readonly commands: string[] = []
  private lastOutput: string | null = null
  /** The line of the next command, from E, until its C. */
  private pendingCommand: string | null = null
  /** The line of the running command, from its C until its D. */
  private runningCommand: string | null = null
  private output: TailText | null = null

  constructor(
    private readonly nonce: string,
    options: { limit?: number } = {},
  ) {
    this.limit = options.limit ?? DEFAULT_LIMIT
  }

  get state(): ShellState {
    return {
      cwd: this.cwd,
      awaitingInput: this.awaitingInput,
      commandRunning: this.commandRunning,
      altScreen: this.altScreen,
      exitCode: this.exitCode,
      commands: [...this.commands],
      lastOutput: this.lastOutput,
    }
  }

  /** Reads one chunk of output; answers the events it brought, in order. */
  feed(chunk: string): ShellEvent[] {
    const events: ShellEvent[] = []
    let text = this.carry + chunk
    this.carry = ''
    /** Where the command output not yet kept starts. */
    let outputFrom = 0
    let at = 0
    for (;;) {
      const esc = text.indexOf(ESC, at)
      if (esc === -1) break
      const kind = text[esc + 1]
      if (kind === undefined) {
        text = this.keepCut(text, esc)
        break
      }
      if (kind === ']') {
        const end = findOscEnd(text, esc + 2)
        if (end.kind === 'open') {
          // A sequence longer than the limit is not one of worfy's: read on as text.
          if (text.length - esc > this.limit) {
            at = esc + 2
            continue
          }
          text = this.keepCut(text, esc)
          break
        }
        if (end.kind === 'aborted') {
          at = end.next
          continue
        }
        const signal = this.signal(text.slice(esc + 2, end.bodyEnd))
        at = end.next
        if (signal === undefined) continue
        // A sequence of worfy's is a boundary of the command output: the output runs from C to D.
        if (this.output !== null) this.output.push(text.slice(outputFrom, esc))
        outputFrom = at
        const event = this.apply(signal)
        if (event !== undefined) events.push(event)
        continue
      }
      if (kind === '[') {
        const final = findCsiEnd(text, esc)
        if (final === -1) {
          if (text.length - esc > 64) {
            at = esc + 2
            continue
          }
          text = this.keepCut(text, esc)
          break
        }
        this.csi(text.slice(esc + 2, final), text[final] ?? '')
        at = final + 1
        continue
      }
      at = esc + 1
    }
    if (this.output !== null) this.output.push(text.slice(outputFrom))
    return events
  }

  /** Keeps the cut sequence that starts at `start` for the next chunk; answers the text before it. */
  private keepCut(text: string, start: number): string {
    this.carry = text.slice(start)
    return text.slice(0, start)
  }

  /** What one OSC body says, or undefined when it is not a sequence of this shell. */
  private signal(body: string): Signal | undefined {
    if (!body.startsWith('633;')) return undefined
    const params = body.split(';')
    if (params.length < 3 || params.at(-1) !== this.nonce) return undefined
    const code = params[1]
    const args = params.slice(2, -1)
    const [arg] = args
    switch (code) {
      case 'A':
      case 'B':
      case 'C':
        return args.length === 0 ? { code } : undefined
      case 'D':
        if (args.length > 1) return undefined
        return { code, exitCode: arg === undefined || !/^\d{1,9}$/.test(arg) ? null : Number(arg) }
      case 'E':
        return args.length === 1 && arg !== undefined ? { code, command: decodeValue(arg) } : undefined
      case 'P':
        return args.length === 1 && arg?.startsWith('Cwd=') === true ? { code, cwd: decodeValue(arg.slice('Cwd='.length)) } : undefined
      default:
        return undefined
    }
  }

  /** Changes the state by one sequence; answers the event it is, if any. */
  private apply(signal: Signal): ShellEvent | undefined {
    switch (signal.code) {
      case 'A':
        this.awaitingInput = false
        return undefined
      case 'B':
        this.awaitingInput = true
        return { type: 'prompt' }
      case 'E':
        this.pendingCommand = signal.command
        return undefined
      case 'P':
        this.cwd = signal.cwd
        return undefined
      case 'C': {
        // A line that starts with a space is not kept, as zsh's HIST_IGNORE_SPACE does not keep it;
        // the script sends no E for it, and a forged one is dropped here too.
        const pending = this.pendingCommand
        const command = pending === null || pending.startsWith(' ') ? null : pending
        this.pendingCommand = null
        if (command !== null) {
          this.commands.push(command)
          if (this.commands.length > COMMANDS_KEPT) this.commands.splice(0, this.commands.length - COMMANDS_KEPT)
        }
        this.awaitingInput = false
        this.commandRunning = true
        this.runningCommand = command
        this.output = new TailText(this.limit)
        return { type: 'command-started', command }
      }
      case 'D': {
        const command = this.runningCommand
        this.exitCode = signal.exitCode
        if (this.output !== null) this.lastOutput = this.output.text()
        this.output = null
        this.commandRunning = false
        this.runningCommand = null
        return { type: 'command-finished', command, exitCode: signal.exitCode }
      }
    }
  }

  private csi(params: string, final: string): void {
    if ((final !== 'h' && final !== 'l') || !params.startsWith('?')) return
    if (params.slice(1).split(';').some((mode) => ALT_SCREEN_MODES.has(mode))) this.altScreen = final === 'h'
  }
}

/**
 * Follows a stream for one question: whether a given place in it falls inside an OSC sequence.
 * The replay buffer of a Terminal cuts its start at any place; when the cut falls inside a
 * sequence, the replay starts after its end, so a new screen does not print its tail (with the
 * nonce) as text.
 */
export class OscCutScanner {
  private state: 'ground' | 'esc' | 'osc' | 'osc-esc' = 'ground'

  /** True when the place after the text read so far is inside a sequence (or right after an ESC). */
  get inside(): boolean {
    return this.state !== 'ground'
  }

  /** Reads the whole of `text`. */
  read(text: string): void {
    this.advance(text, false)
  }

  /**
   * Reads `text` up to the place where the stream leaves the sequence it is in; answers how much it
   * read: all of `text` when the sequence does not end in it, 0 when the stream is not in one.
   */
  skip(text: string): number {
    return this.advance(text, true)
  }

  private advance(text: string, stopOnLeaving: boolean): number {
    let at = 0
    while (at < text.length) {
      if (stopOnLeaving && this.state === 'ground') return at
      switch (this.state) {
        case 'ground': {
          const esc = text.indexOf(ESC, at)
          if (esc === -1) return text.length
          this.state = 'esc'
          at = esc + 1
          break
        }
        case 'esc': {
          const char = text[at]
          at++
          if (char === ']') this.state = 'osc'
          else if (char !== ESC) this.state = 'ground'
          break
        }
        case 'osc': {
          OSC_STOP.lastIndex = at
          const match = OSC_STOP.exec(text)
          if (match === null) return text.length
          at = match.index + 1
          this.state = text[match.index] === ESC ? 'osc-esc' : 'ground'
          break
        }
        case 'osc-esc': {
          const char = text[at]
          at++
          if (char === ']') this.state = 'osc'
          else if (char === ESC) this.state = 'esc'
          else this.state = 'ground'
          break
        }
      }
    }
    return at
  }
}
