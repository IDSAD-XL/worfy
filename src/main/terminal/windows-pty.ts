// node-pty on Windows as the Terminal registry (pty.ts) uses it: how a shell is started on the
// console of the node-pty package, what the registry reads of node-pty's private agent and calls on
// it, and the helper that ends the processes under a shell. Moved out of pty.ts (worfy-windows
// ticket 42) to keep that file under the gate's 1000-line bound; pty.ts exports
// these names as before.
import { execFile } from 'node:child_process'
import { spawn as spawnNodePty } from 'node-pty'
import { powershellScriptCommand, type Env } from '../agent/env'

/** How long the helper that ends the processes under a shell of Windows may run. */
export const DESCENDANTS_TIMEOUT_MS = 3000
/**
 * How much later than `startedBy` the creation time of a shell may read and still be that shell.
 * `startedBy` is Date.now() of this process and the creation time is the kernel's: two clocks,
 * and the first may run behind by a tick of the timer of Windows (15.6 ms at its coarsest). On the
 * owner's PC, with a 1 ms timer, the creation time read 0.6–6.8 ms before `startedBy` in 200 of
 * 200 starts. A pid given out again within this time of the start is not a realistic case.
 */
export const SHELL_START_SLACK_MS = 100

/** Variable names on Windows are case-insensitive: the value of `name` under any case. */
export function envVar(env: Readonly<Env>, name: string): string | undefined {
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === upper) return value
  return undefined
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
 * node-pty as 1.1.0 and 1.2.0-beta.15 build it.
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
export function withoutConsoleHelper(pty: PtyProcess): boolean {
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
  /** Stops and restarts reading the output (node-pty: its socket); main's screen holds a flood back with it (cursor-answers.ts). */
  pause?(): void
  resume?(): void
}

export type SpawnPty = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Env }) => PtyProcess

/**
 * node-pty as the registry starts a shell with it. On Windows the console is the one of the
 * node-pty package — conpty.dll and OpenConsole.exe in the folder `conpty` next to conpty.node,
 * both signed by Microsoft; without conpty.dll the start throws "Cannot find conpty.dll" —
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
 *     the system. It is logged here, once for a shell. A pty without that socket is said at the
 *     start: a later version of node-pty may have moved it.
 */
export const spawnShellPty: SpawnPty = (file, args, options) => {
  if (process.platform !== 'win32') return spawnNodePty(file, args, options)
  const pty = spawnNodePty(file, args, { ...options, useConptyDll: true })
  const input = (pty as { _agent?: { inSocket?: { on?: unknown } } })._agent?.inSocket
  if (input === undefined || input === null || typeof input.on !== 'function') {
    console.warn(`[terminal] the pty of the shell ${pty.pid} has no _agent.inSocket to listen on: a write after the shell has gone may end as an uncaught exception (spawnShellPty)`)
    return pty
  }
  let said = false
  ;(input as { on: (event: 'error', listener: (error: unknown) => void) => void }).on('error', (error) => {
    if (said) return
    said = true
    console.warn(`[terminal] a write to the shell ${pty.pid} failed: the shell is going or gone`, error)
  })
  return pty
}

/**
 * The exit code node-pty already has for a shell of Windows, before its exit event; undefined
 * while the shell runs; null when what is there is not a number — not a pty of node-pty as 1.1.0
 * and 1.2.0-beta.15 build it (readsExitCode tells the pty that has no such field at all).
 *
 * node-pty sends the exit event when the output of the console closes. The console of the package
 * lives while any process is attached to it, so a shell that left a program behind
 * (`Start-Process -NoNewWindow …; exit`, `sleep 30 & exit` in Git Bash) was reported as exited when
 * that program ended: 30 s later, measured, against 1.1 s on the console of the system. Meanwhile
 * the Terminal counted as running, and a resize of it threw. node-pty has the exit code as soon as
 * the shell is gone (its native exit callback, src/win/conpty.cc); the registry reads it every
 * EXIT_POLL_MS and reports the exit EXIT_GRACE_MS after the read that found it: 1.0–1.5 s after
 * the exit. (On the console of the system node-pty itself counts a second from the last output.)
 */
export function exitCodeKnown(pty: PtyProcess): number | undefined | null {
  const code = (pty as { _agent?: { exitCode?: unknown } })._agent?.exitCode
  if (code === undefined) return undefined
  return typeof code === 'number' ? code : null
}

/** Whether node-pty's agent of the pty has the field exitCodeKnown reads; its getter is not called. */
export function readsExitCode(pty: PtyProcess): boolean {
  const agent = (pty as { _agent?: unknown })._agent
  return typeof agent === 'object' && agent !== null && 'exitCode' in agent
}

/**
 * Stops the thread in which node-pty reads the output of a console of Windows; false when this is
 * not a pty of node-pty as 1.1.0 and 1.2.0-beta.15 build it.
 *
 * With the console of the package (spawnShellPty) kill() stops that thread only when output comes
 * after it, and none does once the shell is gone: one thread per Terminal stayed until worfy quit
 * (measured: 20 Terminals, 20 threads). node-pty's dispose() sets a timer of 1000 ms (a second
 * call moves it on) and closes the socket of the thread when it fires; whether everything on the
 * way has been read by then is not checked.
 */
export function stopOutputWorker(pty: PtyProcess): boolean {
  const worker = (pty as { _agent?: { _conoutSocketWorker?: { dispose?: unknown } } })._agent?._conoutSocketWorker
  if (worker === undefined || worker === null || typeof worker.dispose !== 'function') return false
  ;(worker as { dispose: () => void }).dispose()
  return true
}

/**
 * Closes the console of a node-pty terminal of Windows whose shell node-pty has not connected
 * yet; false when the connection is no longer pending, or when this is not a pty of node-pty as
 * 1.2.0-beta.15 builds it.
 *
 * Until the terminal is ready (its first output after the connection) node-pty's kill() is only
 * queued, and the agent gives up a connection after 5 s by itself (CONNECTION_TIMEOUT): a close
 * while the registry waited for the pid left the console host up to 7 s (measured on the owner's
 * PC: 96 consoles 2 s after the closes, none after 7 s). The agent's own kill() drops the pending
 * connection and closes the console now; with the connection dropped the terminal never becomes
 * ready, so the queued kill() never runs after it. Once the shell is connected (`_pendingPtyInfo`
 * cleared) the terminal becomes ready with its first output and runs the queued kill() itself:
 * the agent's kill() then would close the same console twice.
 */
export function killUnconnected(pty: PtyProcess): boolean {
  const agent = (pty as { _agent?: { kill?: unknown; _pendingPtyInfo?: unknown } })._agent
  const kill = agent?.kill
  if (!agent?._pendingPtyInfo || typeof kill !== 'function') return false
  ;(kill as () => void).call(agent)
  return true
}
