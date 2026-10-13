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
// When the owner leaves, the size goes to the subscriber that typed or clicked last, or else to the
// one whose size came last.
//
// No shell outlives what owns it: close() sends SIGHUP, as a terminal emulator does when its
// window closes, and SIGKILL after a grace period when the shell ignores it; closeAll() does that
// for every terminal and resolves once all of them have exited. Windows has neither process groups
// nor SIGHUP: there close() ends every process under the shell, then closes the pseudo-console,
// which takes the shell and what is left on its console (worfy-windows ticket 10). A program
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
import { execFile } from 'node:child_process'
import { posix, win32 } from 'node:path'
import { spawn as spawnNodePty } from 'node-pty'
import { findGitBash, findOnPath, powershellScriptCommand, type Env, type FileExists } from '../agent/env'
import type { TerminalShellSetting } from '../../shared/projects/action-templates'
import { ConsoleRequests, DEVICE_ATTRIBUTES_ANSWER } from './console-request'
import { OscCutScanner, ShellTracker, type ShellEvent, type ShellState } from './osc'
import { integrationEnv, isZsh, newNonce, type ShellIntegration } from './shell-integration'

export const COLS_MIN = 20
export const COLS_MAX = 500
export const ROWS_MIN = 5
export const ROWS_MAX = 300
/** Output kept per terminal for redrawing it, in UTF-16 code units (one per character of ASCII). */
export const REPLAY_LIMIT = 256 * 1024
export const KILL_GRACE_MS = 1000
/** How often node-pty is asked on Windows whether a shell has exited (exitCodeKnown). */
export const EXIT_POLL_MS = 500
/** How long after node-pty knew the exit code of a shell of Windows its exit is reported without node-pty's own event: time for the last output. */
export const EXIT_GRACE_MS = 1000
/** How long the end of a chunk that may be the start of a request of the console waits for the next chunk (console-request.ts). */
export const HELD_OUTPUT_MS = 50
/** How long the helper that ends the processes under a shell of Windows may run. */
export const DESCENDANTS_TIMEOUT_MS = 3000
/** The upper bound of closing a Terminal on Windows; after it the Terminal is closed without node-pty's exit event. */
export const WINDOWS_CLOSE_BOUND_MS = 5000
/**
 * How much later than `startedBy` the creation time of a shell may read and still be that shell.
 * `startedBy` is Date.now() of this process and the creation time is the kernel's: two clocks,
 * and the first may run behind by a tick of the timer of Windows (15.6 ms at its coarsest). On the
 * owner's PC, with a 1 ms timer, the creation time read 0.6–6.8 ms before `startedBy` in 200 of
 * 200 starts. A pid given out again within this time of the start is not a realistic case.
 */
export const SHELL_START_SLACK_MS = 100
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

/**
 * The last REPLAY_LIMIT units of a stream, and the length of the whole stream. When the start of
 * what is kept falls inside an OSC sequence, the start is cut further, to the end of that sequence:
 * a new screen would print its tail (with the nonce of the shell) as text.
 */
export class ReplayBuffer {
  private chunks: string[] = []
  private kept = 0
  private total = 0
  /** Follows the part of the stream already dropped. */
  private readonly dropped = new OscCutScanner()

  get end(): number {
    return this.total
  }

  push(data: string): void {
    this.chunks.push(data)
    this.kept += data.length
    this.total += data.length
    while (this.kept > REPLAY_LIMIT && this.chunks.length > 0) {
      const first = this.chunks[0] ?? ''
      this.dropFirst(Math.min(first.length, this.kept - REPLAY_LIMIT))
    }
    // The start fell inside a sequence: drop on to its end, or all of it while the end has not come.
    while (this.dropped.inside && this.chunks.length > 0) this.removeFirst(this.dropped.skip(this.chunks[0] ?? ''))
  }

  /** Drops `count` units from the start of the first chunk, reading them. */
  private dropFirst(count: number): void {
    const first = this.chunks[0] ?? ''
    this.dropped.read(count >= first.length ? first : first.slice(0, count))
    this.removeFirst(count)
  }

  private removeFirst(count: number): void {
    const first = this.chunks[0] ?? ''
    if (count >= first.length) this.chunks.shift()
    else this.chunks[0] = first.slice(count)
    this.kept -= Math.min(count, first.length)
  }

  text(): string {
    const joined = this.chunks.join('')
    this.chunks = joined === '' ? [] : [joined]
    return joined
  }
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

/** Variable names on Windows are case-insensitive: the value of `name` under any case. */
function envVar(env: Readonly<Env>, name: string): string | undefined {
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper) return value
  return undefined
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
  const file = findOnPath('pwsh', env, search.exists) ?? powershellScriptCommand(envVar(env, 'SystemRoot'), '').file
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

/** A shell of Windows as the registry started it. */
export interface StartedShell {
  pid: number
  /** A moment (ms since 1970) by which the shell was running: taken right after its start. */
  startedBy: number
}

/**
 * What became of the processes under a shell: `ended` — they were looked for and ended; `gone` —
 * the process with the pid of the shell is not the shell that was started, and nothing was ended.
 */
export type DescendantsVerdict = 'ended' | 'gone'

/** 0001-01-01 to 1970-01-01 in ms: .NET counts its ticks (100 ns) from the first. */
const DOTNET_EPOCH_MS = 62135596800000n

/**
 * The PowerShell script that ends every process under a shell of Windows, and not the shell.
 *
 * It takes one list of the processes and walks down from the shell by the parent each process
 * names. Windows gives the pid of a process that ended to a new one, so a pid alone is not asked:
 *   - the shell must have been created by `startedBy`, give or take SHELL_START_SLACK_MS. A
 *     process with its pid created later is another one — the shell ended and its exit has not
 *     been reported yet — and the script prints `gone` and ends nothing;
 *   - a process older than the one it names as its parent is not its child: its parent had that pid
 *     before. (`taskkill /T` does not look at that, and ends such a process with the tree.)
 * Then it ends what it found and prints `ended <n> of <found> left <pids>`: the pids, separated by
 * commas, of what could not be ended — an elevated program, for example. A process that ended by
 * itself meanwhile counts as ended. Every time is compared in UTC: local times of the hour after
 * the autumn clock change would put a child before its parent.
 *
 * The script has no double quote: it goes to PowerShell as one argument of the command line. Its
 * whole text for one shell is pinned in test/unit/terminal-shell.test.ts, since only tests on
 * Windows run it: a change of the text is to be run on a Windows machine again.
 */
export function descendantsScript(shell: StartedShell): string {
  const pid = Math.trunc(shell.pid)
  const ticks = (BigInt(Math.trunc(shell.startedBy)) + BigInt(SHELL_START_SLACK_MS) + DOTNET_EPOCH_MS) * 10000n
  return [
    "$ErrorActionPreference = 'Stop'",
    "$all = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process')",
    `$shell = $all | Where-Object { $_.ProcessId -eq ${pid} } | Select-Object -First 1`,
    `if ($null -eq $shell -or $null -eq $shell.CreationDate -or $shell.CreationDate.ToUniversalTime().Ticks -gt ${ticks}) { 'gone'; exit 0 }`,
    '$under = @{}',
    'foreach ($each in $all) {',
    '  $key = [string]$each.ParentProcessId',
    '  if (-not $under.ContainsKey($key)) { $under[$key] = New-Object System.Collections.ArrayList }',
    '  [void]$under[$key].Add($each)',
    '}',
    '$found = New-Object System.Collections.ArrayList',
    '$seen = @{ [string]$shell.ProcessId = $true }',
    '$queue = New-Object System.Collections.Queue',
    '$queue.Enqueue($shell)',
    'while ($queue.Count -gt 0) {',
    '  $parent = $queue.Dequeue()',
    '  foreach ($child in @($under[[string]$parent.ProcessId])) {',
    '    if ($null -eq $child -or $seen.ContainsKey([string]$child.ProcessId)) { continue }',
    '    if ($null -eq $child.CreationDate -or $child.CreationDate.ToUniversalTime() -lt $parent.CreationDate.ToUniversalTime()) { continue }',
    '    $seen[[string]$child.ProcessId] = $true',
    '    [void]$found.Add($child)',
    '    $queue.Enqueue($child)',
    '  }',
    '}',
    '$ended = 0',
    '$left = New-Object System.Collections.ArrayList',
    'foreach ($child in $found) {',
    '  $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue',
    '  if ($null -eq $process) { $ended++; continue }',
    '  try {',
    '    $started = $process.StartTime.ToUniversalTime()',
    '    $born = $child.CreationDate.ToUniversalTime()',
    '    if ($started.AddMilliseconds(-1) -gt $born -or $started.AddMilliseconds(1) -lt $born) { $ended++; continue }',
    '    Stop-Process -InputObject $process -Force',
    '    $ended++',
    '  } catch {',
    '    if ($null -eq (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue)) { $ended++ } else { [void]$left.Add($child.ProcessId) }',
    '  }',
    '}',
    "'ended ' + $ended + ' of ' + $found.Count + ' left ' + ($left -join ',')",
  ].join('\n')
}

/**
 * Ends every process under a shell of Windows (descendantsScript), with Windows PowerShell of
 * %SystemRoot%. It is called while the shell runs: the processes are found by their living
 * parents. Rejects when the script cannot be started, fails or runs longer than
 * DESCENDANTS_TIMEOUT_MS; a process that could not be ended is only logged, by its pid. Answers
 * `gone` when the pid is not that shell any more, and nothing was ended.
 *
 * The script is passed with -Command, as text. With -EncodedCommand every start with a script not
 * seen before took 2.3–3.3 s on the owner's PC, against 0.45 s for the same script as text, and
 * this script differs in every call by the pid and the time.
 */
export function endDescendants(shell: StartedShell): Promise<DescendantsVerdict> {
  const { file } = powershellScriptCommand(envVar(process.env as Env, 'SystemRoot'), '')
  const args = ['-NoProfile', '-NonInteractive', '-Command', descendantsScript(shell)]
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: DESCENDANTS_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error !== null) return reject(error)
      const answer = String(stdout).trim().split(/\r?\n/).at(-1) ?? ''
      if (answer === 'gone') return resolve('gone')
      const counts = /^ended (\d+) of (\d+) left( \d+(?:,\d+)*)?$/.exec(answer)
      if (counts === null) return reject(new Error(`the helper answered ${JSON.stringify(answer)}`))
      if (counts[1] !== counts[2] || counts[3] !== undefined) {
        console.warn(`[terminal] ${counts[1]} of ${counts[2]} processes under the shell ${shell.pid} were ended; could not be ended (an elevated program, for one): ${counts[3]?.trim() ?? 'not named'}`)
      }
      resolve('ended')
    })
  })
}

/**
 * Takes the helper process out of node-pty's kill() on Windows; false when this is not a pty of
 * node-pty as 1.1.0 builds it.
 *
 * This is for a pty on the console of the system (a spawn of its own given to the registry; the
 * app itself starts shells on the console of the node-pty package, where kill() starts no helper —
 * spawnShellPty). On the console of the system kill() closes the pseudo-console — that ends the
 * shell and what is on its console, by their handles — and stops node-pty's worker thread. It also
 * starts a helper that lists the processes of the console, to end them by pid. The console is
 * closed before the helper attaches to it (10 of 10 on the owner's PC): the helper fails with
 * "AttachConsole failed", and 5 s later node-pty ends the pid of the shell, whoever has it by
 * then. The helper adds nothing to closing the console, so it is replaced by an empty list.
 */
function withoutConsoleHelper(pty: PtyProcess): boolean {
  const agent = (pty as { _agent?: { _getConsoleProcessList?: unknown } })._agent
  if (agent === undefined || agent === null || typeof agent._getConsoleProcessList !== 'function') return false
  agent._getConsoleProcessList = () => Promise.resolve([])
  return true
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

/**
 * node-pty as the registry starts a shell with it. On Windows the console is the one of the
 * node-pty package — conpty.dll and OpenConsole.exe next to conpty.node, both signed by Microsoft —
 * and not the one of the system (worfy-windows ticket 22). With the console of the system node-pty
 * forgets a pseudo-console the moment its shell exits and never closes it: every shell that ended
 * with `exit` left its conhost.exe until worfy quit (20 of 20 on the owner's PC). The console of
 * the package is released right after the shell starts, so its host goes when the last process on
 * it does.
 *
 * What comes with that console, each measured on the owner's PC and answered in this file:
 *   - it asks its terminal a question at the start, and passes on the questions of programs
 *     (console-request.ts);
 *   - kill() leaves the thread that reads the output (stopOutputWorker);
 *   - node-pty reports the exit of a shell only when the output of the console closes, which is
 *     when the last process on it ends (exitCodeKnown);
 *   - a write after the shell has gone ends as an `error` of node-pty's input socket, which has no
 *     listener: in the main process that would be an uncaught exception. One write a millisecond
 *     across an exit gave that error (EAGAIN) in 10 of 10 shells, and in none on the console of
 *     the system. It is logged here, once for a shell.
 */
export const spawnShellPty: SpawnPty = (file, args, options) => {
  if (process.platform !== 'win32') return spawnNodePty(file, args, options)
  const pty = spawnNodePty(file, args, { ...options, useConptyDll: true })
  const input = (pty as { _agent?: { inSocket?: { on?: unknown } } })._agent?.inSocket
  if (input !== undefined && input !== null && typeof input.on === 'function') {
    let said = false
    ;(input as { on: (event: 'error', listener: (error: unknown) => void) => void }).on('error', (error) => {
      if (said) return
      said = true
      console.warn(`[terminal] a write to the shell ${pty.pid} failed: the shell is going or gone`, error)
    })
  }
  return pty
}

/**
 * The exit code node-pty already has for a shell of Windows, before its exit event; undefined
 * while the shell runs, and for a pty that is not node-pty's as 1.1.0 builds it.
 *
 * node-pty sends the exit event when the output of the console closes. The console of the package
 * lives while any process is attached to it, so a shell that left a program behind
 * (`Start-Process -NoNewWindow …; exit`, `sleep 30 & exit` in Git Bash) was reported as exited when
 * that program ended: 30 s later, measured, against 1.1 s on the console of the system. Meanwhile
 * the Terminal counted as running, and a resize of it threw. node-pty knows the exit code half a
 * second after the shell is gone; the registry asks for it (EXIT_POLL_MS) and reports the exit
 * itself a moment later (EXIT_GRACE_MS), as node-pty does on the console of the system.
 */
function exitCodeKnown(pty: PtyProcess): number | undefined {
  const code = (pty as { _agent?: { exitCode?: unknown } })._agent?.exitCode
  return typeof code === 'number' ? code : undefined
}

/**
 * Stops the thread in which node-pty reads the output of a console of Windows; false when this is
 * not a pty of node-pty as 1.1.0 builds it.
 *
 * With the console of the package (spawnShellPty) kill() stops that thread only when output comes
 * after it, and none does once the shell is gone: one thread per Terminal stayed until worfy quit
 * (measured: 20 Terminals, 20 threads). The thread ends a second after it is asked, when what was
 * still on the way has been read.
 */
function stopOutputWorker(pty: PtyProcess): boolean {
  const worker = (pty as { _agent?: { _conoutSocketWorker?: { dispose?: unknown } } })._agent?._conoutSocketWorker
  if (worker === undefined || worker === null || typeof worker.dispose !== 'function') return false
  ;(worker as { dispose: () => void }).dispose()
  return true
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
  exited: Promise<void>
  closing: boolean
  /** A moment by which the shell was running (StartedShell). */
  startedBy: number
  /** Reports the exit to the registry and the subscribers; node-pty's exit event calls it, once. */
  finish: (exit: ShellExit) => void
  /** True once the exit was reported (finish). */
  finished: boolean
  /** True once the pty was asked to close (release). */
  released: boolean
}

export interface TerminalRegistryOptions {
  /** The login shell environment (ADR-0007); asked for each new shell. */
  env: () => Promise<Env>
  spawn?: SpawnPty
  killGraceMs?: number
  commandDelayMs?: number
  /** worfy's ZDOTDIR folder: zsh starts with the shell integration. Only the Terminal Nodes' registry has it. */
  integration?: ShellIntegration
  /** The system the shells run on: which shell starts and how it is ended. That of this process by default. */
  platform?: NodeJS.Platform
  /** Ends every process under a shell of Windows, not the shell; endDescendants by default. Not called elsewhere. */
  endDescendants?: (shell: StartedShell) => Promise<DescendantsVerdict | void> | DescendantsVerdict | void
  /** The upper bound of closing a Terminal on Windows; WINDOWS_CLOSE_BOUND_MS by default. */
  closeBoundMs?: number
  /** How often node-pty is asked on Windows whether a shell has exited (default EXIT_POLL_MS). */
  exitPollMs?: number
  /** How long after node-pty knew of an exit it is reported without node-pty's event (default EXIT_GRACE_MS). */
  exitGraceMs?: number
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
  private readonly exitPollMs: number
  private readonly exitGraceMs: number
  private readonly shellListeners = new Set<ShellEventListener>()

  constructor(private readonly options: TerminalRegistryOptions) {
    this.spawnPty = options.spawn ?? spawnShellPty
    this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS
    this.commandDelayMs = options.commandDelayMs ?? COMMAND_DELAY_MS
    this.platform = options.platform ?? process.platform
    this.endDescendants = options.endDescendants ?? endDescendants
    this.closeBoundMs = options.closeBoundMs ?? WINDOWS_CLOSE_BOUND_MS
    this.exitPollMs = options.exitPollMs ?? EXIT_POLL_MS
    this.exitGraceMs = options.exitGraceMs ?? EXIT_GRACE_MS
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
    try {
      terminal.pty.resize(size.cols, size.rows)
    } catch (error) {
      // On Windows node-pty refuses to resize a pty whose shell has exited, and it knows of the
      // exit a moment before the registry reports it. The size stays what the pty has.
      console.warn(`[terminal] the pty of the shell ${terminal.pty.pid} could not be resized to ${size.cols}x${size.rows}`, error)
      return
    }
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
    const { integration } = this.options
    if (integration !== undefined && isZsh(file)) {
      try {
        const nonce = newNonce()
        env = integrationEnv(env, await integration.prepare(), nonce)
        tracker = new ShellTracker(nonce, { limit: REPLAY_LIMIT })
      } catch (error) {
        // Without its folder the shell still starts, as it did before the integration.
        console.warn(`[terminal] the shell integration of ${key} could not be prepared`, error)
      }
    }
    const { cols, rows } = clampSize(request.cols, request.rows)
    const pty = this.spawnPty(file, choice.args, { name: 'xterm-256color', cols, rows, cwd: request.cwd, env })
    const startedBy = Date.now()
    let exitedResolve: () => void = () => undefined
    let firstOutput: (() => void) | undefined
    let ended = false
    // Windows: the looks for an exit that node-pty knows of and has not reported (exitCodeKnown).
    let exitPoll: ReturnType<typeof setInterval> | null = null
    const terminal: Terminal = {
      pty,
      shell: choice.name,
      buffer: new ReplayBuffer(),
      tracker,
      size: { cols, rows },
      exited: new Promise((resolve) => (exitedResolve = resolve)),
      closing: false,
      startedBy,
      finish: (exit) => {
        if (ended) return
        ended = true
        terminal.finished = true
        if (exitPoll !== null) clearInterval(exitPoll)
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
    }
    // On Windows the console asks its terminal for the device attributes; main answers, and the
    // request reaches neither the kept output nor a screen (console-request.ts).
    const requests = this.platform === 'win32' ? new ConsoleRequests() : null
    const deliver = (data: string): void => {
      // A Terminal that was closed and has reported its exit — by itself, or at the bound of the
      // close on Windows — says nothing more: by now its Node may have a new shell, and this
      // output would go to the screens of that one.
      if (ended && terminal.closing) return
      terminal.buffer.push(data)
      const { end } = terminal.buffer
      this.broadcast(key, 'sending the output', (each) => each.output(data, end))
      if (tracker !== null) for (const event of tracker.feed(data)) this.announce(key, event)
      // After the output went out: the command's echo comes after what the shell printed first.
      firstOutput?.()
      firstOutput = undefined
    }
    // The end of a chunk that may be the start of a request is kept back for the next chunk. When
    // none comes it is sent on as the text it is: output never waits for more than HELD_OUTPUT_MS.
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
    if (this.platform === 'win32') {
      exitPoll = setInterval(() => {
        const exitCode = exitCodeKnown(pty)
        if (exitCode === undefined || exitPoll === null) return
        clearInterval(exitPoll)
        exitPoll = null
        // When node-pty's own event comes first, this finds the Terminal ended and does nothing.
        setTimeout(() => terminal.finish({ exitCode, signal: null }), this.exitGraceMs)
      }, this.exitPollMs)
      // The looks do not keep the app from quitting.
      exitPoll.unref?.()
    }
    if (request.command !== undefined) firstOutput = this.typeOnStart(key, terminal, request.command, () => ended)
    return terminal
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
      if (this.platform === 'win32') {
        void this.endWindowsShell(key, terminal)
        // node-pty reports the exit a second after the last output of the console, and something
        // may keep printing; the helper has its own limit. Past the bound nobody waits any more.
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
   */
  private async endWindowsShell(key: string, terminal: Terminal): Promise<void> {
    const { pid } = terminal.pty
    let verdict: DescendantsVerdict | void = undefined
    try {
      verdict = await this.endDescendants({ pid, startedBy: terminal.startedBy })
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
   * pid: a pid given out again is not touched. After the shell exited (`exited`) there is nothing
   * left for kill() to close; it is called to take the pty apart — and only when the helper could
   * be taken out, since on the console of the system the helper would end the pid of a shell that
   * is gone.
   */
  private release(terminal: Terminal, exited: boolean): void {
    if (terminal.released) return
    const { pid } = terminal.pty
    const quiet = withoutConsoleHelper(terminal.pty)
    if (!quiet) {
      console.warn(`[terminal] the pty of the shell ${pid} has no _getConsoleProcessList to take out of kill(): ${exited ? 'kill() is not called, and the thread that reads its output stays' : 'on the console of the system its helper process may end that pid 5 s from now'} (withoutConsoleHelper)`)
    }
    if (exited && !quiet) return
    terminal.released = true
    try {
      terminal.pty.kill()
    } catch (error) {
      console.warn(`[terminal] closing the pty of the shell ${pid} failed`, error)
    }
    try {
      // A pty that is not node-pty's (no helper to take out either) has no such thread: said above.
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
