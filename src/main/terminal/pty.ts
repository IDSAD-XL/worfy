// The shells of Terminal Nodes, run in pseudo-terminals by node-pty (rebuilt for Electron's ABI
// by postinstall, unpacked from app.asar in the packaged app).
//
// Each terminal is `$SHELL -l` in the root of its Project, with the environment of the user's
// login shell (ADR-0007, the same one Sessions get) plus the terminal variables. The registry
// keeps the last 256 KB of each terminal's output, so a renderer that comes back (the Canvas
// remounted, the window reloaded) redraws the terminal with what it already showed.
//
// A shell that exited on its own stays exited: its exit code and last output are kept until the
// Node is closed or the user asks for a new shell (open with `restart`), so a renderer that comes
// back shows the exit instead of silently starting another shell.
//
// One shell can be open on several screens at once (worfy-link ticket 05, ADR-0053): every client
// that opened it is a subscriber and gets each chunk of output, with the same `end`, its exit and
// the start of a new shell (Restart on any screen). A subscriber leaves when its client goes
// (leave()); the shell is closed when the last one has left. The pty has one size: the size of the
// subscriber that typed or clicked in the terminal last (Q14). A subscriber's resize is remembered
// and applies only while it owns the size; typing (write) or a click (takeSize) makes it the owner.
// When the owner leaves, the size goes to the subscriber that typed or clicked last, or else to the
// one whose size came last.
//
// No shell outlives what owns it: close() sends SIGHUP, as a terminal emulator does when its
// window closes, and SIGKILL after a grace period when the shell ignores it; closeAll() does that
// for every terminal and resolves once all of them have exited.
//
// open() may carry a command (worfy-harness ticket 19: `gh auth login` from the first-run screen).
// The shell that call starts gets it typed, with a newline, as the user would type it: after the
// shell's first output (the profile's output or the prompt), or after COMMAND_DELAY_MS when it
// prints nothing. Input typed before the prompt waits in the terminal for the shell to read it.
// Attaching to a shell that already runs types nothing.
import { basename } from 'node:path'
import { spawn as spawnNodePty } from 'node-pty'
import type { Env } from '../agent/env'

export const COLS_MIN = 20
export const COLS_MAX = 500
export const ROWS_MIN = 5
export const ROWS_MAX = 300
/** Output kept per terminal for redrawing it, in UTF-16 code units (one per character of ASCII). */
export const REPLAY_LIMIT = 256 * 1024
export const KILL_GRACE_MS = 1000
/** How long a new shell may stay silent before its command is typed anyway. */
export const COMMAND_DELAY_MS = 1000

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))

export function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: clamp(cols, COLS_MIN, COLS_MAX), rows: clamp(rows, ROWS_MIN, ROWS_MAX) }
}

/** Variables that describe the shell worfy captured the environment from, not the new one. */
const STALE_KEYS = ['PWD', 'OLDPWD', 'SHLVL', '_'] as const

/** The environment of a Terminal's shell: the login shell environment, the terminal variables, the Project root. */
export function terminalEnv(base: Readonly<Env>, cwd: string): Env {
  const env: Env = { ...base }
  for (const key of STALE_KEYS) delete env[key]
  env.PWD = cwd
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'worfy'
  // An app started from Finder has no LANG; without it a shell treats typed UTF-8 as bytes.
  env.LANG ??= 'en_US.UTF-8'
  return env
}

/** The last REPLAY_LIMIT units of a stream, and the length of the whole stream. */
export class ReplayBuffer {
  private chunks: string[] = []
  private kept = 0
  private total = 0

  get end(): number {
    return this.total
  }

  push(data: string): void {
    this.chunks.push(data)
    this.kept += data.length
    this.total += data.length
    while (this.kept > REPLAY_LIMIT && this.chunks.length > 0) {
      const first = this.chunks[0] ?? ''
      const excess = this.kept - REPLAY_LIMIT
      if (first.length <= excess) {
        this.chunks.shift()
        this.kept -= first.length
      } else {
        this.chunks[0] = first.slice(excess)
        this.kept -= excess
      }
    }
  }

  text(): string {
    const joined = this.chunks.join('')
    this.chunks = joined === '' ? [] : [joined]
    return joined
  }
}

/** The part of node-pty's IPty the registry uses; tests may pass their own. */
export interface PtyProcess {
  readonly pid: number
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type SpawnPty = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Env }) => PtyProcess

/** Where a terminal's events go for one subscriber: the client that opened it. */
export interface TerminalSink {
  output(data: string, end: number): void
  exit(exitCode: number, signal: number | null): void
  /** A new shell started for the terminal (Restart, on this screen or another). */
  started(pid: number): void
}

/**
 * The client a subscriber belongs to, known by the object itself, not by an id: a client without a
 * window may come back under the id of an old one whose `destroyed` is still on the way.
 */
export type TerminalClient = object

interface Size {
  cols: number
  rows: number
}

/** A client that opened the terminal. */
interface Subscriber {
  sink: TerminalSink
  /** The size of its view, from its open, resize or takeSize. */
  size: Size
  /** When it last typed or clicked in the terminal (0: never), on the registry's clock. */
  touched: number
  /** When its size last came, on the registry's clock. */
  sized: number
}

/** The subscribers of one terminal and the one whose size the pty has; kept across a restart. */
interface Audience {
  subscribers: Map<TerminalClient, Subscriber>
  owner: TerminalClient | null
}

export interface OpenRequest {
  cwd: string
  cols: number
  rows: number
  /** Start a new shell even when the last one exited on its own. */
  restart?: boolean | undefined
  /** Typed into the shell with a newline once it has started; only when this call starts the shell. */
  command?: string | undefined
}

export interface ShellExit {
  exitCode: number
  signal: number | null
}

export interface OpenResult {
  pid: number
  shell: string
  replay: string
  end: number
  started: boolean
  /** Set when the shell exited on its own and no new one was asked for: nothing runs. */
  exited: ShellExit | null
}

/** A shell that exited on its own, kept until its Node is closed or restarted. */
interface Ended {
  pid: number
  shell: string
  buffer: ReplayBuffer
  exit: ShellExit
}

interface Terminal {
  pty: PtyProcess
  shell: string
  buffer: ReplayBuffer
  /** The size the pty has now. */
  size: Size
  exited: Promise<void>
  closing: boolean
}

export interface TerminalRegistryOptions {
  /** The login shell environment (ADR-0007); asked for each new shell. */
  env: () => Promise<Env>
  spawn?: SpawnPty
  killGraceMs?: number
  commandDelayMs?: number
}

/** Whether `a` should own the size rather than `b`: it typed or clicked later, or, when neither did, its size came later. */
function later(a: Subscriber, b: Subscriber): boolean {
  if (a.touched !== b.touched) return a.touched > b.touched
  return a.sized > b.sized
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

export class TerminalRegistry {
  private readonly terminals = new Map<string, Terminal>()
  /** Shells being started: a second open of the same key waits for the first instead of starting another. */
  private readonly starting = new Map<string, Promise<Terminal>>()
  private readonly ended = new Map<string, Ended>()
  private readonly audiences = new Map<string, Audience>()
  /** Orders the typing, clicks and sizes of all subscribers. */
  private clock = 0
  private readonly spawnPty: SpawnPty
  private readonly killGraceMs: number
  private readonly commandDelayMs: number

  constructor(private readonly options: TerminalRegistryOptions) {
    this.spawnPty = options.spawn ?? ((file, args, spawnOptions) => spawnNodePty(file, args, spawnOptions))
    this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS
    this.commandDelayMs = options.commandDelayMs ?? COMMAND_DELAY_MS
  }

  /** Running terminals, including those still exiting (not those kept as exited). */
  get size(): number {
    return this.terminals.size + this.starting.size
  }

  has(key: string): boolean {
    return this.terminals.has(key) || this.starting.has(key)
  }

  keys(): string[] {
    return [...new Set([...this.terminals.keys(), ...this.starting.keys()])]
  }

  /** True when the shell of `key` exited on its own and is kept as exited. */
  hasExited(key: string): boolean {
    return this.ended.has(key)
  }

  /**
   * Starts the shell of `key`, or attaches `client` to the one running: `sink` gets its output from
   * now on, as every other subscriber does, and the answer carries what it printed so far. When the
   * last shell exited on its own, answers with that exit and its output instead, unless
   * `request.restart` asks for a new one; a new shell is announced to every subscriber.
   *
   * The pty takes the size of the request when this call starts the shell, or when no other
   * subscriber owns the size; otherwise the size is only remembered.
   */
  async open(key: string, request: OpenRequest, client: TerminalClient, sink: TerminalSink): Promise<OpenResult> {
    const size = clampSize(request.cols, request.rows)
    const audience = this.audienceOf(key)
    const known = audience.subscribers.get(client)
    if (known === undefined) audience.subscribers.set(client, { sink, size, touched: 0, sized: ++this.clock })
    else Object.assign(known, { sink, size, sized: ++this.clock })

    const running = this.terminals.get(key) ?? (await this.starting.get(key))
    if (running !== undefined && !running.closing) {
      const owner = audience.owner
      if (owner === null || owner === client || !audience.subscribers.has(owner)) {
        audience.owner = client
        this.applySize(running, size)
      }
      return { pid: running.pty.pid, shell: running.shell, replay: running.buffer.text(), end: running.buffer.end, started: false, exited: null }
    }
    // A shell still exiting after close: wait for it, then open again (another call may have
    // started the new shell meanwhile).
    if (running !== undefined) {
      await running.exited
      return this.open(key, request, client, sink)
    }

    const ended = this.ended.get(key)
    if (ended !== undefined && request.restart !== true) {
      return { pid: ended.pid, shell: ended.shell, replay: ended.buffer.text(), end: ended.buffer.end, started: false, exited: ended.exit }
    }
    this.ended.delete(key)

    audience.owner = client
    const pending = this.start(key, request)
    this.starting.set(key, pending)
    try {
      const terminal = await pending
      this.terminals.set(key, terminal)
      const { pid } = terminal.pty
      this.broadcast(key, 'reporting the start', (each) => each.started(pid))
      return { pid, shell: terminal.shell, replay: '', end: 0, started: true, exited: null }
    } finally {
      this.starting.delete(key)
    }
  }

  private audienceOf(key: string): Audience {
    let audience = this.audiences.get(key)
    if (audience === undefined) {
      audience = { subscribers: new Map(), owner: null }
      this.audiences.set(key, audience)
    }
    return audience
  }

  /** Sends one event to every subscriber of `key`; one that fails does not stop the others. */
  private broadcast(key: string, what: string, send: (sink: TerminalSink) => void): void {
    const audience = this.audiences.get(key)
    if (audience === undefined) return
    for (const { sink } of [...audience.subscribers.values()]) {
      try {
        send(sink)
      } catch (error) {
        console.warn(`[terminal] ${what} of ${key} failed`, error)
      }
    }
  }

  /** Resizes the pty, unless it already has this size. */
  private applySize(terminal: Terminal, size: Size): void {
    if (terminal.size.cols === size.cols && terminal.size.rows === size.rows) return
    terminal.pty.resize(size.cols, size.rows)
    terminal.size = size
  }

  /** Types `command` once: on the shell's first output, or after COMMAND_DELAY_MS of silence. */
  private typeOnStart(key: string, terminal: Terminal, command: string, ended: () => boolean): () => void {
    let typed = false
    const type = () => {
      if (typed) return
      typed = true
      clearTimeout(timer)
      // The shell may be closing or gone by now: then there is nobody to type to.
      if (terminal.closing || ended()) return
      try {
        terminal.pty.write(`${command}\n`)
      } catch (error) {
        console.warn(`[terminal] typing the command into ${key} failed`, error)
      }
    }
    const timer = setTimeout(type, this.commandDelayMs)
    void terminal.exited.then(() => clearTimeout(timer))
    return type
  }

  private async start(key: string, request: OpenRequest): Promise<Terminal> {
    const env = terminalEnv(await this.options.env(), request.cwd)
    const file = env.SHELL ?? '/bin/zsh'
    const { cols, rows } = clampSize(request.cols, request.rows)
    const pty = this.spawnPty(file, ['-l'], { name: 'xterm-256color', cols, rows, cwd: request.cwd, env })
    let exitedResolve: () => void = () => undefined
    const terminal: Terminal = {
      pty,
      shell: basename(file),
      buffer: new ReplayBuffer(),
      size: { cols, rows },
      exited: new Promise((resolve) => (exitedResolve = resolve)),
      closing: false,
    }
    let firstOutput: (() => void) | undefined
    let ended = false
    pty.onData((data) => {
      terminal.buffer.push(data)
      const { end } = terminal.buffer
      this.broadcast(key, 'sending the output', (each) => each.output(data, end))
      // After the output went out: the command's echo comes after what the shell printed first.
      firstOutput?.()
      firstOutput = undefined
    })
    pty.onExit(({ exitCode, signal }) => {
      const exit: ShellExit = { exitCode, signal: signal === undefined || signal === 0 ? null : signal }
      ended = true
      if (this.terminals.get(key) === terminal) {
        this.terminals.delete(key)
        // Ended by close: nothing to keep. Exited on its own: kept for the next open.
        if (!terminal.closing) this.ended.set(key, { pid: terminal.pty.pid, shell: terminal.shell, buffer: terminal.buffer, exit })
      }
      exitedResolve()
      this.broadcast(key, 'reporting the exit', (each) => each.exit(exit.exitCode, exit.signal))
    })
    if (request.command !== undefined) firstOutput = this.typeOnStart(key, terminal, request.command, () => ended)
    return terminal
  }

  private running(key: string): Terminal {
    const terminal = this.terminals.get(key)
    if (terminal === undefined || terminal.closing) throw new Error(`terminal ${key} is not running`)
    return terminal
  }

  /** Types into the shell; a subscriber that types takes the size of the pty first. */
  write(key: string, data: string, client: TerminalClient | undefined): void {
    const terminal = this.running(key)
    this.touch(key, terminal, client)
    terminal.pty.write(data)
  }

  /**
   * Remembers the size of a subscriber's view; the pty takes it only while that subscriber owns the
   * size. A client that did not open the terminal changes nothing.
   */
  resize(key: string, cols: number, rows: number, client: TerminalClient | undefined): void {
    const terminal = this.running(key)
    const audience = this.audiences.get(key)
    const subscriber = client === undefined ? undefined : audience?.subscribers.get(client)
    if (audience === undefined || subscriber === undefined) return
    subscriber.size = clampSize(cols, rows)
    subscriber.sized = ++this.clock
    if (audience.owner === client) this.applySize(terminal, subscriber.size)
  }

  /** A click in a subscriber's view: it owns the size from now on, and the pty takes `cols`×`rows`. */
  takeSize(key: string, cols: number, rows: number, client: TerminalClient | undefined): void {
    const terminal = this.running(key)
    const subscriber = client === undefined ? undefined : this.audiences.get(key)?.subscribers.get(client)
    if (subscriber === undefined) return
    subscriber.size = clampSize(cols, rows)
    subscriber.sized = ++this.clock
    this.touch(key, terminal, client)
  }

  /** The subscriber typed or clicked: it owns the size, and the pty takes its size. */
  private touch(key: string, terminal: Terminal, client: TerminalClient | undefined): void {
    const audience = this.audiences.get(key)
    const subscriber = client === undefined ? undefined : audience?.subscribers.get(client)
    if (audience === undefined || subscriber === undefined) return
    subscriber.touched = ++this.clock
    audience.owner = client ?? null
    this.applySize(terminal, subscriber.size)
  }

  /**
   * The client went (its window closed, its connection dropped): it stops getting the events of
   * every terminal it opened. A terminal whose owner of the size it was gets the size of the
   * subscriber that typed or clicked last, or else of the one whose size came last; a terminal it
   * was the last subscriber of is closed. Resolves once those terminals have exited.
   */
  async leave(client: TerminalClient): Promise<void> {
    const closing: Promise<void>[] = []
    for (const [key, audience] of [...this.audiences]) {
      if (!audience.subscribers.delete(client)) continue
      if (audience.subscribers.size === 0) {
        this.audiences.delete(key)
        closing.push(this.close(key))
        continue
      }
      if (audience.owner !== client) continue
      const [owner, next] = [...audience.subscribers].reduce((best, each) => (later(each[1], best[1]) ? each : best))
      audience.owner = owner
      const terminal = this.terminals.get(key)
      if (terminal !== undefined && !terminal.closing) this.applySize(terminal, next.size)
    }
    await Promise.all(closing)
  }

  /** Ends the shell of `key`, or forgets its exit; resolves once it has exited. Not running is not an error. */
  async close(key: string): Promise<void> {
    this.ended.delete(key)
    const terminal = this.terminals.get(key) ?? (await this.starting.get(key)?.catch(() => undefined))
    if (terminal === undefined) {
      if (!this.has(key)) this.audiences.delete(key)
      return
    }
    if (!terminal.closing) {
      terminal.closing = true
      const { pid } = terminal.pty
      // The shell is the leader of its own session and process group (node-pty calls setsid):
      // SIGHUP to the group reaches the shell, and the shell passes it on to its jobs.
      signalProcess(-pid, 'SIGHUP')
      signalProcess(pid, 'SIGHUP')
      const timer = setTimeout(() => {
        signalProcess(-pid, 'SIGKILL')
        signalProcess(pid, 'SIGKILL')
      }, this.killGraceMs)
      void terminal.exited.then(() => clearTimeout(timer))
    }
    await terminal.exited
    // Its subscribers heard the exit; a shell started meanwhile keeps the ones it has.
    if (!this.has(key) && !this.ended.has(key)) this.audiences.delete(key)
  }

  /** Closes every terminal whose key passes `test`, running or kept as exited. */
  async closeWhere(test: (key: string) => boolean): Promise<void> {
    const keys = new Set([...this.keys(), ...this.ended.keys()])
    await Promise.all([...keys].filter(test).map((key) => this.close(key)))
  }

  async closeAll(): Promise<void> {
    await this.closeWhere(() => true)
  }
}
