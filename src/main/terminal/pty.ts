// The shells of Terminal Nodes, run in pseudo-terminals by node-pty (rebuilt for Electron's ABI
// by postinstall, unpacked from app.asar in the packaged app).
//
// Each terminal is a shell in the root of its Project, with the environment of the user's login
// shell (ADR-0007, the same one Sessions get) plus the terminal variables. Which shell, terminalShell
// says: `$SHELL -l` on macOS and Linux; on Windows PowerShell — pwsh, else Windows PowerShell — or
// Git Bash when the Project's settings ask for it, never cmd.exe (ADR-0054). The registry
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
// An answer of a screen's terminal to the program (write with `reply`) does not (ticket 39 of
// worfy-windows): it reaches the shell, and the size stays where it is. Cursor-position requests
// are answered by main itself, once, at the pty's size, and the screens' answers to them are
// dropped (cursor-answers.ts).
// When the owner leaves, the size goes to the subscriber that typed or clicked last, or else to the
// one whose size came last.
//
// No shell outlives what owns it: close() sends SIGHUP, as a terminal emulator does when its
// window closes, and SIGKILL after a grace period when the shell ignores it; closeAll() does that
// for every terminal and resolves once all of them have exited. Windows has neither process groups
// nor SIGHUP: there close() ends every process under the shell, then closes the pseudo-console,
// which takes the shell and what is left on its console (worfy-windows ticket 10). A shell of
// Windows that exits on its own and leaves a program on its console takes that program with it
// when the registry reports the exit: the pty is taken apart then (release), which closes the
// console (worfy-windows ticket 22). A program
// started from the shell with Start-Process is under the shell and ends with it; on macOS an app
// started with `open` is not a child of the shell and stays. A close there has an upper bound: when
// node-pty has not reported the exit by then, the Terminal is closed without it.
//
// open() may carry a command (worfy-harness ticket 19: `gh auth login` from the first-run screen).
// The shell that call starts gets it typed, with Enter, as the user would type it: after the
// shell's first output (the profile's output or the prompt), or after COMMAND_DELAY_MS when it
// prints nothing. Input typed before the prompt waits in the terminal for the shell to read it.
// Attaching to a shell that already runs types nothing.
//
// A registry made with `integration` (the Terminal Nodes', not "Sign in with gh") starts zsh with
// worfy's shell integration (shell-integration.ts, worfy-terminal-ai ticket 01): its ZDOTDIR is
// worfy's folder, and the OSC 633 sequences it prints with its nonce tell main where the prompt
// is, which command runs, in which folder and how it ended (osc.ts). That state is kept per
// Terminal (shellState) and its changes go to onShellEvent's listeners. Another shell, or zsh in a
// registry without `integration`, runs as before.
//
// With `assist` as well, each such zsh is also given the socket of Terminal AI and a token of its
// own (worfy-terminal-ai ticket 03); the token is given back when the shell has exited. A shell
// that is not zsh gets neither.
import { posix, win32 } from 'node:path'
import { spawn as spawnNodePty } from 'node-pty'
import { findGitBash, findOnPath, getVar, powershellScriptCommand, type Env, type FileExists } from '../agent/env'
import type { ReplaySize } from '../../shared/ipc/terminal'
import type { TerminalShellSetting } from '../../shared/projects/action-templates'
import { ConsoleRequests, DEVICE_ATTRIBUTES_ANSWER } from './console-request'
import { CursorAnswers, isCursorAnswer } from './cursor-answers'
import { ShellTracker, type ShellEvent, type ShellState } from './osc'
import { REPLAY_LIMIT, ReplayBuffer } from './replay-buffer'
import { integrationEnv, isZsh, newNonce, type AssistAdmission, type AssistDoor, type ShellIntegration } from './shell-integration'
import type { PtyProcess, SpawnPty } from './pty-types'
import { endDescendants, exitCodeKnown, gitBashKill, killUnconnected, readsExitCode, spawnWindowsPty, stopOutputWorker, withoutConsoleHelper, type DescendantsVerdict, type StartedShell } from './windows-pty'

export { REPLAY_LIMIT, ReplayBuffer } from './replay-buffer'
export type { PtyProcess, SpawnPty } from './pty-types'
export { DESCENDANTS_TIMEOUT_MS, descendantsScript, endDescendants, gitBashKill, HANGUP_GRACE_MS, SHELL_START_SLACK_MS, type DescendantsVerdict, type StartedShell } from './windows-pty'

/** node-pty as the registry starts a shell with it: on Windows on the console of the node-pty package (spawnWindowsPty), elsewhere as it is. */
export const spawnShellPty: SpawnPty = (file, args, options) => (process.platform === 'win32' ? spawnWindowsPty(file, args, options) : spawnNodePty(file, args, options))

export const COLS_MIN = 20
export const COLS_MAX = 500
export const ROWS_MIN = 5
export const ROWS_MAX = 300
export const KILL_GRACE_MS = 1000
/** How often node-pty is asked on Windows whether a shell has exited (exitCodeKnown). */
export const EXIT_POLL_MS = 500
/** How long after the read that found the exit code of a shell of Windows its exit is reported without node-pty's own event: time for the last output. */
export const EXIT_GRACE_MS = 1000
/** How long the end of a chunk that may be the start of a request of the console waits for the next chunk (console-request.ts). */
export const HELD_OUTPUT_MS = 50
/** The upper bound of closing a Terminal on Windows; after it the Terminal is closed without node-pty's exit event. */
export const WINDOWS_CLOSE_BOUND_MS = 5000
/** How often a shell of Windows is looked at for its pid while node-pty connects it (pidKnown). */
export const PID_POLL_MS = 10
/** How long a shell of Windows may go without a pid before its start counts as failed; node-pty itself gives up after 5 s. */
export const PID_WAIT_MS = 10_000
/** How long a new shell may stay silent before its command is typed anyway. */
export const COMMAND_DELAY_MS = 1000

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))

export function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: clamp(cols, COLS_MIN, COLS_MAX), rows: clamp(rows, ROWS_MIN, ROWS_MAX) }
}

/** Variables that describe the shell worfy captured the environment from, not the new one. */
const STALE_KEYS = ['PWD', 'OLDPWD', 'SHLVL', '_'] as const

/** The environment of a Terminal's shell: the login shell environment, the terminal variables, the Project root. */
export function terminalEnv(base: Readonly<Env>, cwd: string, platform: NodeJS.Platform = process.platform): Env {
  const env: Env = { ...base }
  for (const key of STALE_KEYS) delete env[key]
  env.PWD = cwd
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'worfy'
  // An app started from Finder has no LANG; without it a shell treats typed UTF-8 as bytes. Not on
  // Windows: PowerShell does not read it, and Git Bash takes its locale from Windows only while
  // LANG is unset.
  if (platform !== 'win32') env.LANG ??= 'en_US.UTF-8'
  return env
}

export interface ShellChoice {
  file: string
  args: string[]
  /** The file name, as a Terminal Node shows it. */
  name: string
  /** Why the shell asked for is not the one that starts; null otherwise. */
  note: string | null
}

export interface ShellSearch {
  /** The system the shell runs on; that of this process by default. */
  platform?: NodeJS.Platform | undefined
  /** Whether a file is there; by default a file or an app execution alias (findOnPath). */
  exists?: FileExists | undefined
}

/**
 * The shell of a Terminal: its file and arguments, by the system, the setting and the environment.
 *
 * Off Windows: `$SHELL -l`, `/bin/zsh -l` without the variable; the setting means nothing there.
 * On Windows: PowerShell with `-NoLogo` — `pwsh.exe` from the Path of `env`, also when it is the
 * alias of an MSIX install that existsSync does not see, else Windows PowerShell of %SystemRoot%
 * by its full path. With the setting `git-bash`: Git Bash of Git for Windows with `--login -i`;
 * when it is not found, PowerShell, with the reason in `note`. `$SHELL` and cmd.exe are never
 * taken there (ADR-0054).
 */
export function terminalShell(env: Readonly<Env>, setting?: TerminalShellSetting, search: ShellSearch = {}): ShellChoice {
  if ((search.platform ?? process.platform) !== 'win32') {
    const file = env.SHELL ?? '/bin/zsh'
    return { file, args: ['-l'], name: posix.basename(file), note: null }
  }
  let note: string | null = null
  if (setting === 'git-bash') {
    const bash = findGitBash(env, search.exists)
    if (bash !== null) return { file: bash, args: ['--login', '-i'], name: win32.basename(bash), note: null }
    note = 'Git Bash was not found on this machine: PowerShell runs instead'
  }
  const file = findOnPath('pwsh', env, search.exists) ?? powershellScriptCommand(getVar(env, 'SystemRoot'), '').file
  return { file, args: ['-NoLogo'], name: win32.basename(file), note }
}

/** One shell of the choice in the settings of a Project (the channel terminal.shells). */
export interface ShellOption {
  id: TerminalShellSetting
  label: string
  found: boolean
}

/**
 * The shells there are to choose from on this system. None off Windows: the shell is `$SHELL`.
 * On Windows PowerShell — named by the one terminalShell would start — and Git Bash, with whether
 * it is found.
 */
export function terminalShellOptions(env: Readonly<Env>, search: ShellSearch = {}): ShellOption[] {
  if ((search.platform ?? process.platform) !== 'win32') return []
  const powershell = terminalShell(env, 'powershell', search)
  return [
    { id: 'powershell', label: powershell.name.toLowerCase() === 'pwsh.exe' ? 'PowerShell (pwsh)' : 'Windows PowerShell', found: true },
    { id: 'git-bash', label: 'Git Bash', found: findGitBash(env, search.exists) !== null },
  ]
}

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
  /** Typed into the shell with Enter once it has started; only when this call starts the shell. */
  command?: string | undefined
  /**
   * Which shell to start on Windows (the Project's settings). Asked only there, and only when this
   * call starts the shell; when it throws, PowerShell starts.
   */
  shell?: (() => TerminalShellSetting | undefined) | undefined
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
  /** The sizes of the pty `replay` came at (ReplayBuffer.sizes); empty when this call started the shell. */
  sizes: ReplaySize[]
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
  /** The state read out of the output of a shell with the integration; null without it. */
  tracker: ShellTracker | null
  /** The size the pty has now. */
  size: Size
  /** Answers the cursor-position requests in the output, on every system (cursor-answers.ts). */
  cursor: CursorAnswers
  exited: Promise<void>
  closing: boolean
  /** A moment by which the shell was running (StartedShell). */
  startedBy: number
  /** Git Bash on Windows: kill.exe for its SIGHUP before a close (StartedShell.hangup); null otherwise. */
  hangup: string | null
  /**
   * Reports the exit to the registry and the subscribers. Called by node-pty's exit event, by the
   * read of the exit code on Windows, by the bound of a close and when the wait for a pid gives up;
   * only the first call counts.
   */
  finish: (exit: ShellExit) => void
  /** True once the exit was reported (finish). */
  finished: boolean
  /** True once the pty was asked to close (release). */
  released: boolean
  /** True once a resize of the pty failed: said once (applySize). */
  resizeFailed: boolean
}

export interface TerminalRegistryOptions {
  /** The login shell environment (ADR-0007); asked for each new shell. */
  env: () => Promise<Env>
  spawn?: SpawnPty
  killGraceMs?: number
  commandDelayMs?: number
  /** worfy's ZDOTDIR folder: zsh starts with the shell integration. Only the Terminal Nodes' registry has it. */
  integration?: ShellIntegration
  /** Terminal AI's socket and tokens for the zsh shells with the integration; without it they get none. */
  assist?: AssistDoor
  /** The system the shells run on: which shell starts and how it is ended. That of this process by default. */
  platform?: NodeJS.Platform
  /** Ends every process under a shell of Windows, not the shell; endDescendants by default. Not called elsewhere. */
  endDescendants?: (shell: StartedShell) => Promise<DescendantsVerdict | void> | DescendantsVerdict | void
  /** The upper bound of closing a Terminal on Windows; WINDOWS_CLOSE_BOUND_MS by default. */
  closeBoundMs?: number
  /** Whether a file is there, for the search of the shell on Windows (terminalShell). */
  exists?: FileExists
}

/** Hears the shell integration events of every Terminal of a registry. */
export type ShellEventListener = (key: string, event: ShellEvent) => void

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
  private readonly platform: NodeJS.Platform
  private readonly endDescendants: (shell: StartedShell) => Promise<DescendantsVerdict | void> | DescendantsVerdict | void
  private readonly closeBoundMs: number
  private readonly shellListeners = new Set<ShellEventListener>()
  /** Shells of Windows waiting for their pid (pidKnown), by key: what a close calls to take one apart at once. */
  private readonly awaitingPid = new Map<string, () => void>()
  /** Keys closed while their start had not reached the wait for the pid yet: it gives up at once. */
  private readonly closedWhileStarting = new Set<string>()

  constructor(private readonly options: TerminalRegistryOptions) {
    this.spawnPty = options.spawn ?? spawnShellPty
    this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS
    this.commandDelayMs = options.commandDelayMs ?? COMMAND_DELAY_MS
    this.platform = options.platform ?? process.platform
    this.endDescendants = options.endDescendants ?? endDescendants
    this.closeBoundMs = options.closeBoundMs ?? WINDOWS_CLOSE_BOUND_MS
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

  /**
   * What the shell integration knows of the running shell of `key`: its folder, whether it waits
   * for input or runs a command, the alternate screen, the last exit code, the last commands and
   * the output of the last one. Null when nothing runs or the shell has no integration.
   */
  shellState(key: string): ShellState | null {
    const terminal = this.terminals.get(key)
    return terminal === undefined || terminal.closing || terminal.tracker === null ? null : terminal.tracker.state
  }

  /** `listener` hears "prompt shown", "command started" and "command finished" of every Terminal; answers how to stop. */
  onShellEvent(listener: ShellEventListener): () => void {
    this.shellListeners.add(listener)
    return () => this.shellListeners.delete(listener)
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

    // Awaited only when a start is under way: with none, the start below is in `starting` before
    // this call yields, so a close in the same tick finds it (closedWhileStarting).
    const starting = this.terminals.has(key) ? undefined : this.starting.get(key)
    const running = this.terminals.get(key) ?? (starting === undefined ? undefined : await starting)
    if (running !== undefined && !running.closing) {
      const owner = audience.owner
      if (owner === null || owner === client || !audience.subscribers.has(owner)) {
        audience.owner = client
        this.applySize(running, size)
      }
      return { pid: running.pty.pid, shell: running.shell, replay: running.buffer.text(), end: running.buffer.end, sizes: running.buffer.sizes(), started: false, exited: null }
    }
    // A shell still exiting after close: wait for it, then open again (another call may have
    // started the new shell meanwhile).
    if (running !== undefined) {
      await running.exited
      return this.open(key, request, client, sink)
    }

    const ended = this.ended.get(key)
    if (ended !== undefined && request.restart !== true) {
      return { pid: ended.pid, shell: ended.shell, replay: ended.buffer.text(), end: ended.buffer.end, sizes: ended.buffer.sizes(), started: false, exited: ended.exit }
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
      return { pid, shell: terminal.shell, replay: '', end: 0, sizes: [], started: true, exited: null }
    } finally {
      this.starting.delete(key)
      this.closedWhileStarting.delete(key)
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

  /**
   * Resizes the pty, unless it already has this size. Any error of node-pty's resize is caught, on
   * every system, and said once for a Terminal; the size stays what the pty has. The case it is
   * for: on Windows node-pty refuses to resize a pty whose shell has exited, and it knows of the
   * exit up to EXIT_POLL_MS + EXIT_GRACE_MS before the registry reports it. Its callers — a resize,
   * the typing and clicks that take the size (touch), a leave — go on: typed input still reaches
   * the shell.
   */
  private applySize(terminal: Terminal, size: Size): void {
    if (terminal.size.cols === size.cols && terminal.size.rows === size.rows) return
    try {
      terminal.pty.resize(size.cols, size.rows)
    } catch (error) {
      if (!terminal.resizeFailed) console.warn(`[terminal] the pty of the shell ${terminal.pty.pid} could not be resized to ${size.cols}x${size.rows}`, error)
      terminal.resizeFailed = true
      return
    }
    terminal.size = size
    terminal.buffer.resize(size.cols, size.rows)
    terminal.cursor.resize(size.cols, size.rows)
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
        // Enter, as the terminal of that system sends it: PowerShell under ConPTY takes a line feed for Ctrl+J.
        terminal.pty.write(`${command}${this.platform === 'win32' ? '\r' : '\n'}`)
      } catch (error) {
        console.warn(`[terminal] typing the command into ${key} failed`, error)
      }
    }
    const timer = setTimeout(type, this.commandDelayMs)
    void terminal.exited.then(() => clearTimeout(timer))
    return type
  }

  private async start(key: string, request: OpenRequest): Promise<Terminal> {
    let env = terminalEnv(await this.options.env(), request.cwd, this.platform)
    let setting: TerminalShellSetting | undefined
    if (this.platform === 'win32' && request.shell !== undefined) {
      try {
        setting = request.shell()
      } catch (error) {
        console.warn(`[terminal] the shell setting of ${key} could not be read: PowerShell starts`, error)
      }
    }
    const choice = terminalShell(env, setting, { platform: this.platform, exists: this.options.exists })
    if (choice.note !== null) console.warn(`[terminal] ${key}: ${choice.note}`)
    const { file } = choice
    let tracker: ShellTracker | null = null
    // The shell's token for the socket of Terminal AI; given back when the shell is gone.
    let admission: AssistAdmission | null = null
    const { integration, assist } = this.options
    if (integration !== undefined && isZsh(file)) {
      try {
        const nonce = newNonce()
        const dir = await integration.prepare()
        admission = await this.admit(key, dir)
        env = integrationEnv(env, dir, nonce, admission)
        tracker = new ShellTracker(nonce, { limit: REPLAY_LIMIT })
      } catch (error) {
        // Without its folder the shell still starts, as it did before the integration.
        console.warn(`[terminal] the shell integration of ${key} could not be prepared`, error)
      }
    }
    const { cols, rows } = clampSize(request.cols, request.rows)
    let pty: PtyProcess
    try {
      pty = this.spawnPty(file, choice.args, { name: 'xterm-256color', cols, rows, cwd: request.cwd, env })
    } catch (error) {
      if (admission !== null) assist?.revoke(admission.token)
      throw error
    }
    const startedBy = Date.now()
    let exitedResolve: () => void = () => undefined
    let firstOutput: (() => void) | undefined
    let ended = false
    // Windows: the looks for an exit that node-pty knows of and has not reported (exitCodeKnown).
    let exitPoll: ReturnType<typeof setInterval> | null = null
    const terminal: Terminal = {
      pty,
      shell: choice.name,
      buffer: new ReplayBuffer({ cols, rows }),
      tracker,
      size: { cols, rows },
      cursor: new CursorAnswers({ cols, rows }, (answer) => {
        // Not for a Terminal that has ended: its pty takes no input.
        if (ended) return
        try {
          pty.write(answer)
        } catch (error) {
          console.warn(`[terminal] ${key}: a cursor-position request could not be answered`, error)
        }
      }, key, {
        // Held back while main's screen lags behind a flood (cursor-answers.ts, HIGH_WATER).
        pause: () => {
          try {
            pty.pause?.()
          } catch (error) {
            console.warn(`[terminal] ${key}: pausing the output failed`, error)
          }
        },
        resume: () => {
          try {
            pty.resume?.()
          } catch (error) {
            console.warn(`[terminal] ${key}: resuming the output failed`, error)
          }
        },
      }),
      exited: new Promise((resolve) => (exitedResolve = resolve)),
      closing: false,
      startedBy,
      hangup: this.platform === 'win32' ? gitBashKill(file) : null,
      finish: (exit) => {
        if (ended) return
        ended = true
        terminal.finished = true
        terminal.cursor.dispose()
        if (exitPoll !== null) clearInterval(exitPoll)
        if (admission !== null) assist?.revoke(admission.token)
        if (this.terminals.get(key) === terminal) {
          this.terminals.delete(key)
          // Ended by close: nothing to keep. Exited on its own: kept for the next open.
          if (!terminal.closing) this.ended.set(key, { pid: terminal.pty.pid, shell: terminal.shell, buffer: terminal.buffer, exit })
        }
        exitedResolve()
        this.broadcast(key, 'reporting the exit', (each) => each.exit(exit.exitCode, exit.signal))
        // A shell of Windows that exited on its own: kill() takes the pty apart, and the thread
        // that reads its output is stopped there (release).
        if (this.platform === 'win32') this.release(terminal, true)
      },
      finished: false,
      released: false,
      resizeFailed: false,
    }
    // On Windows the console asks its terminal for the device attributes; main answers, and the
    // request reaches neither the kept output nor a screen (console-request.ts).
    const requests = this.platform === 'win32' ? new ConsoleRequests() : null
    const deliver = (data: string): void => {
      // A Terminal that was closed and has reported its exit says nothing more: by now its Node
      // may have a new shell, and an output event names no shell — this would go to the screens of
      // that one. On Windows so does every Terminal that has reported its exit, whichever way the
      // exit came: after the look below node-pty still reads the console, and a program left on it
      // may print while the user restarts the shell. Off Windows what comes after an exit that
      // was not a close is kept for the next open, as before.
      if (ended && (terminal.closing || this.platform === 'win32')) return
      terminal.buffer.push(data)
      const { end } = terminal.buffer
      this.broadcast(key, 'sending the output', (each) => each.output(data, end))
      if (tracker !== null) for (const event of tracker.feed(data)) this.announce(key, event)
      // After the screens and the tracker: main's own screen never holds the output back (it
      // does not throw, cursor-answers.ts).
      terminal.cursor.feed(data)
      // After the output went out: the command's echo comes after what the shell printed first.
      firstOutput?.()
      firstOutput = undefined
    }
    // The end of a chunk that may be the start of a request is kept back for the next chunk. When
    // none comes within HELD_OUTPUT_MS it is sent on as the text it is. The wait starts again with
    // each chunk that keeps the start going (`ESC`, then `[`, then `0`), so a held end can wait
    // longer in all, up to HOLD_LIMIT characters (console-request.ts).
    let held: ReturnType<typeof setTimeout> | null = null
    const sendHeld = (): void => {
      if (held !== null) clearTimeout(held)
      held = null
      const rest = requests?.rest() ?? ''
      if (rest !== '') deliver(rest)
    }
    pty.onData((raw) => {
      if (requests === null) return deliver(raw)
      if (held !== null) clearTimeout(held)
      held = null
      const read = requests.feed(raw)
      // Not for a Terminal that has ended: its pty takes no input.
      if (!ended) {
        try {
          for (let asked = 0; asked < read.requests; asked++) pty.write(DEVICE_ATTRIBUTES_ANSWER)
        } catch (error) {
          console.warn(`[terminal] ${key}: the request of the console could not be answered`, error)
        }
      }
      if (read.text !== '') deliver(read.text)
      if (requests.holds) held = setTimeout(sendHeld, HELD_OUTPUT_MS)
    })
    // On Windows the event means "the output of the console is closed": after kill() it can come
    // before node-pty knows the exit code. The screens are told an integer all the same.
    pty.onExit(({ exitCode, signal }) => {
      sendHeld()
      terminal.finish({ exitCode: (exitCode as number | undefined) ?? 1, signal: signal === undefined || signal === 0 ? null : signal })
    })
    if (this.platform === 'win32' && !readsExitCode(pty)) {
      console.warn(`[terminal] ${key}: the pty of the shell ${pty.pid} has no _agent.exitCode to read: its exit is reported only by node-pty's exit event (exitCodeKnown)`)
    } else if (this.platform === 'win32') {
      exitPoll = setInterval(() => {
        const exitCode = exitCodeKnown(pty)
        if (exitCode === undefined || exitPoll === null) return
        clearInterval(exitPoll)
        exitPoll = null
        if (exitCode === null) {
          console.warn(`[terminal] ${key}: the exit code of the shell ${pty.pid} is not a number: its exit is reported only by node-pty's exit event (exitCodeKnown)`)
          return
        }
        // When node-pty's own event comes first, this finds the Terminal ended and does nothing.
        setTimeout(() => {
          // As at the event: what was read and held back goes out before the exit is told.
          if (!ended) sendHeld()
          terminal.finish({ exitCode, signal: null })
        }, EXIT_GRACE_MS)
      }, EXIT_POLL_MS)
      // The looks do not keep the app from quitting.
      exitPoll.unref?.()
    }
    if (request.command !== undefined) firstOutput = this.typeOnStart(key, terminal, request.command, () => ended)
    if (this.platform === 'win32' && !(pty.pid > 0)) await this.pidKnown(key, terminal)
    return terminal
  }

  /**
   * Waits until node-pty gives the pid of a shell of Windows; fails when the shell ends meanwhile,
   * when the Terminal is closed meanwhile, or when no pid comes within PID_WAIT_MS — in the last
   * two the pty is taken apart at once.
   *
   * node-pty 1.2 creates the shell only once its thread that reads the output is connected
   * (connect() in the worker's onReady, lib/windowsPtyAgent.js): until then pty.pid is 0, and the
   * shell is created after spawn has returned. So the moment the pid came is when the shell was
   * running by (StartedShell.startedBy): the moment of spawn would be before the shell was created,
   * and the helper of a close would take the shell for another process.
   */
  private pidKnown(key: string, terminal: Terminal): Promise<void> {
    const since = Date.now()
    return new Promise((resolve, reject) => {
      // Every way out stops the look: one left running would move startedBy on and on.
      const stop = (): void => {
        clearInterval(look)
        this.awaitingPid.delete(key)
      }
      // Ended without an exit event; on Windows finish() also takes the pty apart (release).
      const giveUp = (why: string): void => {
        stop()
        try {
          killUnconnected(terminal.pty)
        } catch (error) {
          console.warn(`[terminal] closing the console of ${key} before it was connected failed`, error)
        }
        terminal.finish({ exitCode: 1, signal: null })
        reject(new Error(why))
      }
      const look = setInterval(() => {
        // First: a shell that got its pid and exited between two looks is not opened either, or
        // the registry would keep a running Terminal that has ended.
        if (terminal.finished) {
          stop()
          return reject(new Error(`the shell of ${key} ended while node-pty was starting it`))
        }
        if (terminal.pty.pid > 0) {
          stop()
          terminal.startedBy = Date.now()
          return resolve()
        }
        if (Date.now() - since >= PID_WAIT_MS) giveUp(`node-pty gave no pid for the shell of ${key} within ${PID_WAIT_MS} ms`)
      }, PID_POLL_MS)
      // A close meanwhile does not wait for the pid: on Windows the quit waits for the shells
      // only WINDOWS_QUIT_WAIT_MS (src/main/ipc/terminal.ts).
      const closed = (): void => giveUp(`the shell of ${key} was closed while node-pty was starting it`)
      this.awaitingPid.set(key, closed)
      if (this.closedWhileStarting.has(key)) closed()
    })
  }

  /**
   * The way of a new zsh to main for Terminal AI. Without it the shell starts all the same: its
   * Suggestion from history needs no socket.
   */
  private async admit(key: string, dir: string): Promise<AssistAdmission | null> {
    const { assist } = this.options
    if (assist === undefined) return null
    try {
      return await assist.admit(key, dir)
    } catch (error) {
      console.warn(`[terminal] the socket of Terminal AI could not be opened for ${key}`, error)
      return null
    }
  }

  /** Sends one shell integration event to every listener; one that fails does not stop the others. */
  private announce(key: string, event: ShellEvent): void {
    for (const listener of [...this.shellListeners]) {
      try {
        listener(key, event)
      } catch (error) {
        console.warn(`[terminal] a listener of the shell events of ${key} failed`, error)
      }
    }
  }

  private running(key: string): Terminal {
    const terminal = this.terminals.get(key)
    if (terminal === undefined || terminal.closing) throw new Error(`terminal ${key} is not running`)
    return terminal
  }

  /**
   * Types into the shell; a subscriber that types takes the size of the pty first. An answer of the
   * subscriber's terminal to the program (`reply`: a focus report, the device attributes) reaches
   * the shell the same way and leaves the size where it is: the size belongs to the screen that
   * typed or clicked last (ADR-0053, decision 5; worfy-windows ticket 39). An answer to a
   * cursor-position request goes nowhere: main has answered that request itself (cursor-answers.ts).
   */
  write(key: string, data: string, client: TerminalClient | undefined, options: { reply?: boolean } = {}): void {
    const terminal = this.running(key)
    // While main answers (not after its screen refused output, cursor-answers.ts).
    if (options.reply === true && terminal.cursor.answering && isCursorAnswer(data)) return
    if (options.reply !== true) this.touch(key, terminal, client)
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
    // A shell of Windows still waiting for its pid is taken apart now, and one whose start has not
    // reached that wait yet is taken apart when it does; its open fails (pidKnown).
    const closeStarting = this.awaitingPid.get(key)
    if (closeStarting !== undefined) closeStarting()
    else if (this.starting.has(key)) this.closedWhileStarting.add(key)
    const terminal = this.terminals.get(key) ?? (await this.starting.get(key)?.catch(() => undefined))
    if (terminal === undefined) {
      if (!this.has(key)) this.audiences.delete(key)
      return
    }
    if (!terminal.closing) {
      terminal.closing = true
      // A pty paused for main's screen is read to its end: node-pty reports the exit only then.
      terminal.cursor.letOutputFlow()
      const { pid } = terminal.pty
      if (this.platform === 'win32') {
        void this.endWindowsShell(key, terminal)
        // node-pty reports the exit when the output of the console closes (on the console of the
        // system: a second after its last output), and something may keep printing; the read of the
        // exit code (exitCodeKnown) and the helper have limits of their own. Past the bound nobody
        // waits any more.
        const bound = setTimeout(() => {
          console.warn(`[terminal] ${key} did not report its exit in ${this.closeBoundMs} ms: closed without it`)
          this.release(terminal, false)
          terminal.finish({ exitCode: 1, signal: null })
        }, this.closeBoundMs)
        void terminal.exited.then(() => clearTimeout(bound))
      } else {
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
    }
    await terminal.exited
    // Its subscribers heard the exit; a shell started meanwhile keeps the ones it has.
    if (!this.has(key) && !this.ended.has(key)) this.audiences.delete(key)
  }

  /**
   * Ends a shell of Windows. node-pty takes no signal there, and there is no group to signal.
   *
   * First every process under the shell, while the shell is their living parent: a program with a
   * window of its own is not on the shell's console, and closing the console would leave it. Then
   * the pty (release). On the console of the node-pty package, which the app uses, kill() closes
   * the pseudo-console and ends the shell at once with TerminateProcess; what else is on the
   * console is ended by the close. The shell is not ended before the pty is asked: node-pty
   * forgets a pseudo-console the moment its shell exits, and kill() then has nothing to close.
   * Git Bash: the helper first holds its launcher and gives bash SIGHUP, so bash writes its
   * history (StartedShell.hangup); PowerShell writes its history after every command.
   */
  private async endWindowsShell(key: string, terminal: Terminal): Promise<void> {
    const { pid } = terminal.pty
    let verdict: DescendantsVerdict | void = undefined
    try {
      verdict = await this.endDescendants({ pid, startedBy: terminal.startedBy, ...(terminal.hangup === null ? {} : { hangup: terminal.hangup }) })
    } catch (error) {
      console.warn(`[terminal] ending the processes under the shell ${pid} of ${key} failed`, error)
    }
    // The shell is running as far as node-pty says, and the helper did not take the process with
    // its pid for it: the two clocks disagree by more than the slack, or the shell has just ended.
    if (verdict === 'gone' && !terminal.finished) {
      console.warn(`[terminal] ${key}: the process ${pid} was not taken for the shell that was started, and node-pty has reported no exit: nothing under the shell was ended`)
    }
    this.release(terminal, false)
  }

  /**
   * Asks node-pty to close the pty of a shell of Windows, once, without the helper process that
   * kill() starts on the console of the system (withoutConsoleHelper), and stops the thread that
   * reads its output (stopOutputWorker). kill() goes by the handles node-pty holds, never by a
   * pid: a pid given out again is not touched. After the shell exited (`exited`) node-pty has
   * forgotten the pseudo-console, and kill() still takes the pty apart: on the console of the
   * package it destroys node-pty's input socket, which closes the console and ends a program the
   * shell left on it (measured on the PC: neither OpenConsole.exe nor that program is under worfy
   * afterwards). It is called then only when the helper could be taken out, since on the console
   * of the system the helper would end the pid of a shell that is gone.
   */
  private release(terminal: Terminal, exited: boolean): void {
    if (terminal.released) return
    const { pid } = terminal.pty
    const quiet = withoutConsoleHelper(terminal.pty)
    if (!quiet) {
      console.warn(`[terminal] the pty of the shell ${pid} has no _getConsoleProcessList to take out of kill(): ${exited ? 'kill() is not called' : 'on the console of the system its helper process may end that pid 5 s from now'} (withoutConsoleHelper)`)
    }
    // Without kill() the thread that reads the output is still stopped: that does not need kill().
    if (exited && !quiet) return this.stopOutputThread(terminal, quiet)
    terminal.released = true
    terminal.cursor.letOutputFlow()
    try {
      terminal.pty.kill()
    } catch (error) {
      console.warn(`[terminal] closing the pty of the shell ${pid} failed`, error)
    }
    this.stopOutputThread(terminal, quiet)
  }

  /** Stops the thread that reads the output of a pty of Windows (stopOutputWorker); `quiet`: the pty is node-pty's. */
  private stopOutputThread(terminal: Terminal, quiet: boolean): void {
    const { pid } = terminal.pty
    try {
      // A pty that is not node-pty's (no helper to take out either) has no such thread: said in release().
      if (!stopOutputWorker(terminal.pty) && quiet) console.warn(`[terminal] the pty of the shell ${pid} has no _conoutSocketWorker to stop: its thread may stay until worfy quits (stopOutputWorker)`)
    } catch (error) {
      console.warn(`[terminal] stopping the output thread of the shell ${pid} failed`, error)
    }
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
