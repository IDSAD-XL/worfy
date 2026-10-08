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

/** Where a terminal's output goes: the window that opened it last. */
export interface TerminalSink {
  output(data: string, end: number): void
  exit(exitCode: number, signal: number | null): void
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
  sink: TerminalSink
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
   * Starts the shell of `key`, or attaches `sink` to the one running: its output goes to `sink`
   * from now on, and the answer carries what it printed so far. When the last shell exited on its
   * own, answers with that exit and its output instead, unless `request.restart` asks for a new one.
   */
  async open(key: string, request: OpenRequest, sink: TerminalSink): Promise<OpenResult> {
    const running = this.terminals.get(key) ?? (await this.starting.get(key))
    if (running !== undefined && !running.closing) {
      running.sink = sink
      const { cols, rows } = clampSize(request.cols, request.rows)
      running.pty.resize(cols, rows)
      return { pid: running.pty.pid, shell: running.shell, replay: running.buffer.text(), end: running.buffer.end, started: false, exited: null }
    }
    // A shell still exiting after close: wait for it, then open again (another call may have
    // started the new shell meanwhile).
    if (running !== undefined) {
      await running.exited
      return this.open(key, request, sink)
    }

    const ended = this.ended.get(key)
    if (ended !== undefined && request.restart !== true) {
      return { pid: ended.pid, shell: ended.shell, replay: ended.buffer.text(), end: ended.buffer.end, started: false, exited: ended.exit }
    }
    this.ended.delete(key)

    const pending = this.start(key, request, sink)
    this.starting.set(key, pending)
    try {
      const terminal = await pending
      this.terminals.set(key, terminal)
      return { pid: terminal.pty.pid, shell: terminal.shell, replay: '', end: 0, started: true, exited: null }
    } finally {
      this.starting.delete(key)
    }
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

  private async start(key: string, request: OpenRequest, sink: TerminalSink): Promise<Terminal> {
    const env = terminalEnv(await this.options.env(), request.cwd)
    const file = env.SHELL ?? '/bin/zsh'
    const { cols, rows } = clampSize(request.cols, request.rows)
    const pty = this.spawnPty(file, ['-l'], { name: 'xterm-256color', cols, rows, cwd: request.cwd, env })
    let exitedResolve: () => void = () => undefined
    const terminal: Terminal = {
      pty,
      shell: basename(file),
      buffer: new ReplayBuffer(),
      sink,
      exited: new Promise((resolve) => (exitedResolve = resolve)),
      closing: false,
    }
    let firstOutput: (() => void) | undefined
    let ended = false
    pty.onData((data) => {
      terminal.buffer.push(data)
      terminal.sink.output(data, terminal.buffer.end)
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
      try {
        terminal.sink.exit(exit.exitCode, exit.signal)
      } catch (error) {
        console.warn(`[terminal] reporting the exit of ${key} failed`, error)
      }
    })
    if (request.command !== undefined) firstOutput = this.typeOnStart(key, terminal, request.command, () => ended)
    return terminal
  }

  private running(key: string): Terminal {
    const terminal = this.terminals.get(key)
    if (terminal === undefined || terminal.closing) throw new Error(`terminal ${key} is not running`)
    return terminal
  }

  write(key: string, data: string): void {
    this.running(key).pty.write(data)
  }

  resize(key: string, cols: number, rows: number): void {
    const size = clampSize(cols, rows)
    this.running(key).pty.resize(size.cols, size.rows)
  }

  /** Ends the shell of `key`, or forgets its exit; resolves once it has exited. Not running is not an error. */
  async close(key: string): Promise<void> {
    this.ended.delete(key)
    const terminal = this.terminals.get(key) ?? (await this.starting.get(key)?.catch(() => undefined))
    if (terminal === undefined) return
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
