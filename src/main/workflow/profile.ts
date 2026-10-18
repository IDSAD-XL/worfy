// Reads the Project's Profile: the list of MCP servers its agents may use (ADR-0021), the
// GitHub account worfy's own gh calls go with (ADR-0020, worfy-week ticket 01) and the Pipeline
// with what the Stage of a Ticket is computed from (ADR-0067, `readPipelineProfile`).
//
// The Profile lives outside the repository — `<claude home>/profiles/<name>/profile.json` with the
// old Harness, `<Harness home>/projects/<name>/` with the plugin — and its only reader is the
// Harness's `bin/profile -C <root> --field <a.b>` (src/main/harness/locate.ts says which; the
// plugin's script gets HARNESS_HOME): exit code 0 prints the
// field (JSON for an array, the bare string for a string, the bare word `null` for a null), 3 means
// the folder is in no registered project, 4 means the field is absent. For a field — the MCP list,
// the GitHub account — every way of not getting a value (those codes, a missing script, a failed
// run, output of the wrong shape) falls back to what worfy did without a Profile (the default MCP
// list; gh with the login shell's own account), and the reason goes to the log. Where the workflow
// lives (`readResolvedProfile`, below) is the exception: a call that failed is told from a folder
// with no Profile, and the workflow readers show its reason instead of guessing (worfy-harness
// ticket 37).
//
// Nothing here writes: the script runs with the Project as cwd and only reads.
import { execFile, spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { constants } from 'node:fs'
import { access, open, stat, type FileHandle } from 'node:fs/promises'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { CANVAS_SERVER_NAME } from '../../shared/canvas/tools'
import { DEFAULT_PIPELINE, pipelineSchema, type PipelineStage } from '../../shared/workflow/pipeline'
import { isAbsolutePath, isWindowsAbsolutePath } from '../../shared/paths'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import type { HarnessScriptEnv } from '../harness/script-env'

/** The script's environment, for example the login shell's from src/main/agent/env.ts. */
export type ProfileEnv = HarnessScriptEnv

/** The Profile field with the list of MCP server names. */
export const MCP_ALLOWED_FIELD = 'mcp.allowed'

/**
 * The servers the workflow needs: the qmd of the Harness plugin (ADRs, lessons, Tickets), which worfy
 * registers as `plugin_worfy_qmd` (src/main/agent/options.ts, ADR-0048 item 4), and the canvas. The
 * name `qmd` means the user's own server from ~/.claude.json: it is not in the default list, so a
 * Session never gets two qmd servers (worfy-harness ticket 17).
 */
export const DEFAULT_MCP_SERVERS: readonly string[] = Object.freeze(['plugin_worfy_qmd', CANVAS_SERVER_NAME])

/** What one run of `bin/profile` ended with. */
export interface ProfileRun {
  /** The exit code; null when the process ended without one: killed at its time limit, or by `signal`. */
  code: number | null
  /**
   * The signal that ended the script when the runner did not send it for its time limit (SIGSEGV,
   * SIGABRT, a SIGKILL from memory pressure); absent or null for a timeout and for an exit code.
   */
  signal?: string | null
  stdout: string
  stderr: string
}

/**
 * Runs `bin/profile` with `args` in `cwd`. Resolves with the exit code whatever it is; rejects when
 * the script cannot be started (ENOENT when there is none).
 */
export type ProfileRunner = (cwd: string, args: readonly string[]) => Promise<ProfileRun>

/**
 * The `profile` script of the Harness found on the machine (src/main/harness/locate.ts): the
 * plugin's in <harnessHome>/plugin/bin, or the old one in <claudeHome>/bin.
 */
export const profilePath = (claudeHome: string): string => join(locateHarness(harnessHomes(claudeHome)).binDir, 'profile')

const MAX_OUTPUT = 1024 * 1024
/** How long a Harness script run by the main process may take before it is killed. */
export const HARNESS_SCRIPT_TIMEOUT_MS = 15_000

/** The most of a script's stderr a reason carries: its first lines, not a whole stack trace. */
const DETAIL_LINES = 3
const DETAIL_CHARS = 400

/** A line of the gate resolver's own reason, with bin/profile's wrapping of it in front or without it. */
const RESOLVER_REASON = /^(?:profile: resolver .+? failed \(exit \d+\) — project not determined: )?gate-resolve: /gm

/**
 * A script's stderr with the gate resolver's own reasons unwrapped: bin/profile reports a resolver
 * failure as `profile: resolver <path> failed (exit N) — project not determined: gate-resolve:
 * registry <path> is broken: …`, and with two long paths the line outgrows scriptFailureDetail's
 * limit before the reason. Such a line, and a bare `gate-resolve: …` line, keep only the reason
 * (`registry <path> is broken: …`). Every other line stays as it is, a crash of the resolver
 * (`… project not determined: TypeError: …`) included: its wrapping says where it crashed.
 */
export const resolverReason = (stderr: string): string => stderr.replace(RESOLVER_REASON, '')

/**
 * What a failed Harness script's stderr says, short enough for a line of the window. A gate
 * resolver reason comes without bin/profile's wrapping (resolverReason). A node crash gives its
 * Error line (`TypeError: …`), not the stack under it nor the `Node.js vNN` line node prints last;
 * other stderr gives its first lines. Empty when stderr says nothing.
 */
export function scriptFailureDetail(stderr: string): string {
  const lines = resolverReason(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^at\s/.test(line) && !/^Node\.js v\d/.test(line) && !/^\^+$/.test(line))
  const thrown = lines.find((line) => /^(?:[A-Z][A-Za-z]*)?Error\b.*:/.test(line))
  const text = thrown ?? lines.slice(0, DETAIL_LINES).join(' — ')
  return text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS)}…` : text
}

/**
 * Whether a failed run points at the environment the script ran with rather than at the Harness:
 * the interpreter was not found (exit code 127, `env: node: No such file or directory`) or could
 * not be run (126). Such a failure may go away when the login shell is captured again.
 */
export const environmentExit = (code: number | null): boolean => code === 127 || code === 126

// ── starting a Harness script with node ──────────────────────────────────────

/** What worfy says when the scripts' environment has no node on its PATH. */
export const NODE_NOT_FOUND = 'node not found in PATH'

/**
 * Why a Harness script was not started; nothing was run. `ENOENT`: there is no file at the script's
 * path. `NODE_NOT_FOUND`: the PATH of the environment it was to run with has no node. `NOT_NODE`:
 * on Windows, a script of an older Harness that is not a Node script (harnessScriptCommand).
 */
export class HarnessScriptStartError extends Error {
  constructor(
    readonly code: 'ENOENT' | 'NODE_NOT_FOUND' | 'NOT_NODE',
    message: string,
  ) {
    super(message)
  }
}

/** The PATH of `env`. On Windows the variable may be spelled in any case: a plain environment has `Path`. */
function searchPath(env: HarnessScriptEnv): string | undefined {
  if (env.PATH !== undefined || process.platform !== 'win32') return env.PATH
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH' && env[name] !== undefined)
  return key === undefined ? undefined : env[key]
}

/**
 * The node on the PATH of `env`, the first one in PATH order, or null. Relative entries of PATH are
 * skipped: they would name a folder of the Project the script runs in. On Windows so is `\tools`
 * (the root of the current drive): the check here would look on worfy's drive, the start in the
 * script's working folder on another (the same rule as findOnPath in src/main/agent/env.ts).
 */
export async function nodeOnPath(env: HarnessScriptEnv): Promise<string | null> {
  const windows = process.platform === 'win32'
  const name = windows ? 'node.exe' : 'node'
  const absolute = windows ? isWindowsAbsolutePath : isAbsolute
  for (const entry of (searchPath(env) ?? '').split(delimiter)) {
    const dir = windows ? entry.trim().replace(/^"(.*)"$/u, '$1') : entry
    if (!absolute(dir)) continue
    const candidate = join(dir, name)
    try {
      if (!(await stat(candidate)).isFile()) continue
      if (!windows) await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not there, or not executable: the next entry.
    }
  }
  return null
}

/** How many bytes of a script are read for its `#!` line. */
const FIRST_LINE_BYTES = 256

/** U+FEFF, which an editor may put before the `#!` of a file it saves as UTF-8. */
const BYTE_ORDER_MARK = 0xfeff

/**
 * The first line of the file at `path`, a UTF-8 byte order mark before it dropped, or null when the
 * file cannot be read.
 */
async function firstLine(path: string): Promise<string | null> {
  let file: FileHandle | undefined
  try {
    file = await open(path, 'r')
    const buffer = Buffer.alloc(FIRST_LINE_BYTES)
    const { bytesRead } = await file.read(buffer, 0, FIRST_LINE_BYTES, 0)
    const line = buffer.toString('utf8', 0, bytesRead).split(/\r?\n/u)[0] ?? ''
    return line.charCodeAt(0) === BYTE_ORDER_MARK ? line.slice(1) : line
  } catch {
    return null
  } finally {
    await file?.close().catch(() => undefined)
  }
}

/** The program and arguments that start a Harness script. */
export interface HarnessScriptCommand {
  file: string
  args: string[]
}

/**
 * How the Harness script `script` is started with `args` and `env` (ADR-0055 item 2). A Node script
 * runs as `node <script>`, node from the PATH of `env`, never by its `#!` line, which Windows does
 * not read. A script whose `#!` line names another interpreter is a Harness from before its scripts
 * were Node (the old `<claude home>/bin`, or a plugin not yet updated: epic-status was bash): on
 * macOS and Linux it is started by itself, as before; on Windows it cannot be, and the error says
 * to update the Harness. Checked before anything starts, in this order: a missing script is told
 * from a missing node, and neither is left to node's own exit code 1, which would read as a script
 * that failed. Every runner of a Harness script starts it through this.
 */
export async function harnessScriptCommand(script: string, args: readonly string[], env: HarnessScriptEnv): Promise<HarnessScriptCommand> {
  const isScript = await stat(script).then(
    (stats) => stats.isFile(),
    () => false,
  )
  if (!isScript) throw new HarnessScriptStartError('ENOENT', `no Harness script at ${script}`)
  const shebang = await firstLine(script)
  // Not readable by worfy: on macOS and Linux it is started by itself, as before scripts were Node,
  // and the system says whether it may run; on Windows node is the only way, and says why it fails.
  if (shebang === null && process.platform !== 'win32') return { file: script, args: [...args] }
  if (shebang !== null && shebang.startsWith('#!') && !/\bnode\b/u.test(shebang)) {
    if (process.platform === 'win32') throw new HarnessScriptStartError('NOT_NODE', `this Harness's ${basename(script)} is not a Node script — update the Harness (${script})`)
    return { file: script, args: [...args] }
  }
  const node = await nodeOnPath(env)
  if (node === null) throw new HarnessScriptStartError('NODE_NOT_FOUND', `${NODE_NOT_FOUND}: ${script} is not run`)
  return { file: node, args: [script, ...args] }
}

/**
 * The default runner: the real script as a child process, with a timeout and a size cap. `env` is
 * the user's login shell environment (src/main/agent/env.ts): the script is run by the node on its
 * PATH, and an app started from Finder has only the system PATH, where there is no node.
 */
export function profileRunner(claudeHome: string, env: ProfileEnv): ProfileRunner {
  return harnessScriptRunner(claudeHome, env, 'profile')
}

/**
 * A runner of another read-only script of the same Harness (`ticket root`, src/main/workflow/folder.ts),
 * with the same timeout, size cap and exit-code rules as `profile`. It rejects with a
 * HarnessScriptStartError when the script or node is missing (or, on Windows, the script is not Node),
 * and with the start error otherwise.
 */
export function harnessScriptRunner(claudeHome: string, env: ProfileEnv, name: 'profile' | 'ticket', timeoutMs = HARNESS_SCRIPT_TIMEOUT_MS): ProfileRunner {
  return async (cwd, args) => {
    // Looked for on every run; the plugin's script gets HARNESS_HOME, where its Profiles are.
    const harness = locateHarness(harnessHomes(claudeHome))
    const script = join(harness.binDir, name)
    const runEnv = scriptEnv(harness, env)
    const command = await harnessScriptCommand(script, args, runEnv)
    return new Promise((resolvePromise, reject) => {
      execFile(command.file, command.args, { cwd, env: runEnv, maxBuffer: MAX_OUTPUT, timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error) return resolvePromise({ code: 0, stdout, stderr })
        const code = (error as NodeJS.ErrnoException).code
        // A number is the script's exit code; a string is a failure to start it (ENOENT, EACCES…).
        if (typeof code === 'number') return resolvePromise({ code, stdout, stderr })
        // `killed`: the runner's own kill at `timeout`. A signal without it came from elsewhere: a crash.
        if (error.killed) return resolvePromise({ code: null, stdout, stderr })
        if (error.signal) return resolvePromise({ code: null, signal: error.signal, stdout, stderr })
        reject(error)
      })
    })
  }
}

/** Starts a process as node's `spawn` does; a test hands one that records the call and starts it. */
export type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams

export interface HarnessScriptRunOptions {
  /** What the script reads on its stdin; an empty stdin when absent. */
  stdin?: string
  /** When the script is killed (SIGKILL); it then ends with code null. */
  timeoutMs: number
  /** node's spawn when absent. */
  spawn?: SpawnProcess
  /**
   * Kills the script (SIGKILL) when it aborts, as the time limit does: the app aborts it on quit. An
   * aborted signal starts nothing.
   */
  signal?: AbortSignal
}

/**
 * Kills `child` and the processes under it — project-connect runs qmd-collections, which runs
 * `qmd update`; killed alone, the script would leave them writing profile.json with no commit to
 * follow (harness/bin/project-connect, the qmd step). On Windows: `taskkill /T /F` by the full path,
 * without a window; the pid is the runner's own child, still running. Elsewhere: SIGKILL to the
 * process group the child leads (runHarnessScript starts it detached there). When that fails, the
 * child alone.
 */
export function killTree(child: KilledChild, system: KillSystem = KILL_SYSTEM): void {
  const pid = child.pid
  const alone = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  if (pid === undefined) return alone()
  if (system.platform === 'win32') {
    const taskkill = system.spawn(join(system.systemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    taskkill.on('error', alone)
    taskkill.on('exit', (code) => {
      if (code !== 0) alone()
    })
    return
  }
  try {
    system.kill(-pid, 'SIGKILL')
  } catch {
    alone()
  }
}

/** What killTree needs of a child process. */
export type KilledChild = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>

/** What killTree uses of the system; a test hands its own to reach the Windows branch on any system. */
export interface KillSystem {
  platform: NodeJS.Platform
  /** %SystemRoot%, where taskkill.exe lies; C:\Windows when unset. */
  systemRoot: string | undefined
  spawn: (command: string, args: readonly string[], options: { stdio: 'ignore'; windowsHide: boolean }) => Pick<ChildProcess, 'on'>
  /** process.kill: a negative pid is the process group. */
  kill: (pid: number, signal: NodeJS.Signals) => void
}

const KILL_SYSTEM: KillSystem = {
  get platform() {
    return process.platform
  },
  get systemRoot() {
    return process.env.SystemRoot
  },
  spawn: (command, args, options) => spawn(command, args, options),
  kill: (pid, signal) => {
    process.kill(pid, signal)
  },
}

/**
 * The Harness scripts that have not answered yet. Outside Windows each leads a process group of its
 * own, so the Ctrl+C or SIGHUP of a terminal that started worfy does not reach it: Electron quits on
 * those signals and node emits 'exit', and killRunningHarnessScripts ends them then, the scripts
 * started with no signal of their own (qmd-collections, src/main/harness/qmd.ts) included.
 */
const runningScripts = new Set<ChildProcess>()

/**
 * Kills every Harness script that has not answered, with what it started (killTree), and with its
 * process group when the script itself has exited while the group still holds its pipes. Run on the
 * 'exit' of the process; outside Windows the kill is synchronous, as 'exit' needs. On Windows the
 * scripts are not detached, and taskkill, a process of its own, may not start before the exit.
 */
export function killRunningHarnessScripts(): void {
  for (const child of runningScripts) {
    if (child.exitCode === null && child.signalCode === null) killTree(child)
    else if (process.platform !== 'win32' && child.pid !== undefined) killGroup(child.pid)
  }
  runningScripts.clear()
}

/** SIGKILL to the process group `pid` leads; a group that has ended already is no error. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // ESRCH: nothing is left in the group.
  }
}

/** What runHarnessScript rejects with when its signal had aborted before the script started. */
export const HARNESS_SCRIPT_ABORTED = 'not started: the run was stopped'

/**
 * One run of the Harness script `script` with `args` and `env` (`env` already has HARNESS_HOME:
 * scriptEnv), started as harnessScriptCommand says, for the scripts that read stdin or run for
 * minutes: `project-connect` (src/main/projects/connect.ts) and `qmd-collections`
 * (src/main/harness/qmd.ts). Up to 1 MiB of each output is kept. Resolves with the exit code
 * whatever it is (null when it was killed at `timeoutMs`, by `signal`, or by a signal from
 * elsewhere); rejects with a HarnessScriptStartError when the script or node is missing (or, on
 * Windows, the script is not Node), and with the start error otherwise. No console window opens on
 * Windows.
 */
export async function runHarnessScript(script: string, args: readonly string[], env: HarnessScriptEnv, options: HarnessScriptRunOptions): Promise<ProfileRun> {
  const command = await harnessScriptCommand(script, args, env)
  if (options.signal?.aborted) throw new Error(HARNESS_SCRIPT_ABORTED)
  const start = options.spawn ?? spawn
  return new Promise((resolvePromise, reject) => {
    // Outside Windows the script leads a process group of its own, so that a kill reaches what it
    // started (killTree); on Windows `detached` would give it a console of its own.
    const child = start(command.file, command.args, { env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    let stdout = ''
    let stderr = ''
    /** The runner killed the script: at its time limit or on the signal. */
    let killed = false
    let settled = false
    runningScripts.add(child)
    if (!process.listeners('exit').includes(killRunningHarnessScripts)) process.on('exit', killRunningHarnessScripts)
    const exited = (): boolean => child.exitCode !== null || child.signalCode !== null
    /** The script itself has ended, and only a process it left holds the pipes: its own exit code. */
    const settleExited = (): void => {
      child.stdout.destroy()
      child.stderr.destroy()
      settle({ code: child.exitCode, signal: child.signalCode, stdout, stderr })
    }
    const stop = (): void => {
      if (exited()) {
        // The signal (the app quits): what the script left in its process group goes too. On Windows
        // the tree is gone with the script (taskkill /T finds no parent), and its pid may be reused.
        if (process.platform !== 'win32' && child.pid !== undefined) killGroup(child.pid)
        settleExited()
        return
      }
      killed = true
      killTree(child)
    }
    const done = (): void => {
      settled = true
      runningScripts.delete(child)
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
    }
    const settle = (run: ProfileRun): void => {
      if (settled) return
      done()
      resolvePromise(run)
    }
    const timer = setTimeout(() => {
      // At the time limit a script that has ended is answered with its own exit code, and what it
      // left runs on; only the signal (the app quits) or the exit of worfy ends that.
      if (exited()) return settleExited()
      stop()
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      done()
      reject(error)
    })
    // After the runner's own kill the answer is given when the script exits, not on 'close': a
    // process the script started with its stdio inherited (qmd-collections runs `qmd update`) may
    // hold the pipes open long after, and the limit would not hold. The pipes are let go.
    child.on('exit', () => {
      if (!killed) return
      child.stdout.destroy()
      child.stderr.destroy()
      settle({ code: null, signal: null, stdout, stderr })
    })
    child.on('close', (code, signal) => {
      // After the runner's own kill 'exit' has answered already (node emits it before 'close'), so a
      // signal here came from elsewhere (ProfileRun).
      settle({ code, signal, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.stdin ?? '')
  })
}

/** The MCP servers a Session in the Project gets, and where the list came from. */
export interface McpAllowlist {
  servers: readonly string[]
  /** `profile`: the Profile's own list; `default`: DEFAULT_MCP_SERVERS, for `reason`. */
  source: 'profile' | 'default'
  /** Why the default list is used; null when the list is the Profile's. */
  reason: string | null
}

const serverNames = z.array(z.string().trim().min(1))

export interface ReadProfileOptions {
  /** The Project's root, or any folder inside it: the script's cwd and its `-C`. */
  root: string
  /** Claude Code's home; the script is that of the Harness found from it (profilePath). */
  claudeHome: string
  /** The environment the script runs with: the login shell's, so PATH finds node. */
  env: ProfileEnv
  /** Replaces the real script in tests. */
  run?: ProfileRunner | undefined
  /** Where the reason for a fallback goes; console.warn by default. */
  log?: ((message: string) => void) | undefined
}

export type ReadMcpAllowlistOptions = ReadProfileOptions

/**
 * Why `profile` gave no answer. `none`: the folder has no Profile — exit code 3, or no script
 * (worfy-harness ticket 37). `failed`: the call itself failed — no node on the PATH, any other exit
 * code (127 from an older bash Harness's `env node`; 1: a broken registry or profile.json), a
 * timeout, a signal, a script that could not be started.
 */
export type ProfileMiss = 'none' | 'failed'

/**
 * No answer: why, of which kind, and — for a failed call — whether it points at the environment
 * the script ran with: no node on its PATH, or exit code 127 or 126 (`environmentExit`). A script
 * that could not be started otherwise (node failed to start, an older Harness's script on Windows,
 * output over the size cap) is a file problem, not one a new login shell can fix.
 */
export type ProfileMissRead = { ok: false; reason: string; miss: 'none' } | { ok: false; reason: string; miss: 'failed'; environment: boolean }

/** One field of the Profile: its printed value, or why there is none. */
type FieldRead = { ok: true; stdout: string } | ProfileMissRead

/** Runs `bin/profile -C <root> --field <field>` and turns every exit but code 0 into a reason. */
function readField(options: ReadProfileOptions, field: string): Promise<FieldRead> {
  return runProfile(options, ['--field', field], `the Profile has no ${field} field (profile exit code 4)`)
}

/** Runs `bin/profile -C <root> <args>`; every exit but code 0 is a reason, `absent` that of code 4. */
async function runProfile(options: ReadProfileOptions, args: readonly string[], absent: string): Promise<FieldRead> {
  const run = options.run ?? profileRunner(options.claudeHome, options.env)
  const none = (reason: string): FieldRead => ({ ok: false, reason, miss: 'none' })
  const failed = (reason: string, environment = false): FieldRead => ({ ok: false, reason, miss: 'failed', environment })

  let result: ProfileRun
  try {
    result = await run(options.root, ['-C', options.root, ...args])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // With no Harness found this names <claudeHome>/bin/profile, where it was looked for before the plugin.
    if (code === 'ENOENT') return none(`there is no profile script at ${profilePath(options.claudeHome)}`)
    // The script is there, the environment has no node: a login shell captured again may have it.
    if (code === 'NODE_NOT_FOUND') return failed(`the profile script could not be run: ${NODE_NOT_FOUND}`, true)
    if (code === 'NOT_NODE') return failed(`the profile script could not be run: ${error instanceof Error ? error.message : String(error)}`)
    return failed(`the profile script could not be run: ${error instanceof Error ? error.message : String(error)}`)
  }

  const detail = scriptFailureDetail(result.stderr)
  if (result.code === 3) return none(`the folder is in no registered project (profile exit code 3${detail ? `: ${detail}` : ''})`)
  if (result.code === 4) return failed(absent)
  if (result.code === null && result.signal) return failed(`the profile script was ended by the signal ${result.signal}${detail ? `: ${detail}` : ''}`)
  if (result.code === null) return failed(`the profile script did not answer within ${HARNESS_SCRIPT_TIMEOUT_MS / 1000} s`)
  if (result.code !== 0) return failed(`the profile script failed with exit code ${result.code}${detail ? `: ${detail}` : ''}`, environmentExit(result.code))
  return { ok: true, stdout: result.stdout.trim() }
}

/** The Profile's list of MCP servers for the Project at `root`, or the default list with the reason. */
export async function readMcpAllowlist(options: ReadMcpAllowlistOptions): Promise<McpAllowlist> {
  const log = options.log ?? ((message: string) => console.warn(message))
  const fallback = (reason: string): McpAllowlist => {
    log(`[profile] MCP servers for ${options.root}: the default list (${DEFAULT_MCP_SERVERS.join(', ')}), because ${reason}`)
    return { servers: DEFAULT_MCP_SERVERS, source: 'default', reason }
  }

  const field = await readField(options, MCP_ALLOWED_FIELD)
  if (!field.ok) return fallback(field.reason)
  const stdout = field.stdout
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return fallback(`${MCP_ALLOWED_FIELD} is not JSON: ${JSON.stringify(stdout.slice(0, 200))}`)
  }
  if (json === null) return fallback(`${MCP_ALLOWED_FIELD} is null`)
  const parsed = serverNames.safeParse(json)
  if (!parsed.success) return fallback(`${MCP_ALLOWED_FIELD} is not a list of server names: ${JSON.stringify(stdout.slice(0, 200))}`)
  return { servers: [...new Set(parsed.data)], source: 'profile', reason: null }
}

// ── the GitHub account ───────────────────────────────────────────────────────

/** The Profile field with the login of the GitHub account the Project's repository belongs to. */
export const GITHUB_ACCOUNT_FIELD = 'github.account'

/**
 * A GitHub login: letters, digits and single hyphens, at most 39 characters, never starting with a
 * hyphen — so it can never be read by gh as an option.
 */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u

/** The Project's GitHub account, or null with the reason there is none. */
export interface GithubAccount {
  account: string | null
  /** Why there is no account; null when there is one. */
  reason: string | null
}

/**
 * The GitHub account the Profile names for the Project at `root` (`github.account`). Without one —
 * exit code 3 or 4, `null`, no script, a failed run, a value that is not a login — the account is
 * null, gh goes with the login shell's own account as before, and the reason is logged.
 */
export async function readGithubAccount(options: ReadProfileOptions): Promise<GithubAccount> {
  const log = options.log ?? ((message: string) => console.warn(message))
  const none = (reason: string): GithubAccount => {
    log(`[profile] GitHub account for ${options.root}: none, gh runs with the login shell's own account, because ${reason}`)
    return { account: null, reason }
  }

  const field = await readField(options, GITHUB_ACCOUNT_FIELD)
  if (!field.ok) return none(field.reason)
  // A string field prints bare; a JSON-quoted one is taken too.
  let value = field.stdout
  if (value.startsWith('"')) {
    try {
      const json: unknown = JSON.parse(value)
      if (typeof json === 'string') value = json.trim()
    } catch {
      // Not JSON: checked as it is below.
    }
  }
  if (value === 'null') return none(`${GITHUB_ACCOUNT_FIELD} is null`)
  if (value === '') return none(`${GITHUB_ACCOUNT_FIELD} is empty`)
  if (!GITHUB_LOGIN.test(value)) return none(`${GITHUB_ACCOUNT_FIELD} is not a GitHub login: ${JSON.stringify(value.slice(0, 200))}`)
  return { account: value, reason: null }
}

// ── where the workflow is: mode, Workflow folder, repositories ───────────────

/** One repository of the Project as `_resolved.repos` names it; `name` is what a Ticket's `Repo:` line says. */
export interface ResolvedRepo {
  name: string
  path: string
}

/** What `profile --json` says about where the Project's workflow lives (worfy-harness ticket 22, ADR-0042, ADR-0045). */
export interface ResolvedProfile {
  mode: 'full' | 'silent'
  /** Absolute; in Full mode the root of the checkout `profile` ran in. */
  workflowFolder: string
  /** The folder above the repositories of a Project of several repositories, when `profile` ran in it; else null. */
  workspace: string | null
  repos: readonly ResolvedRepo[]
}

const absolute = z.string().refine(isAbsolutePath, 'not an absolute path')

const resolvedSchema = z.object({
  _resolved: z.object({
    mode: z.enum(['full', 'silent']),
    workflow_folder: absolute,
    workspace: absolute.nullable().optional(),
    repos: z.array(z.object({ name: z.string().trim().min(1), path: absolute })),
  }),
})

/**
 * `_resolved.mode`, `workflow_folder`, `workspace` and `repos` of `bin/profile -C <root> --json`, or
 * why there are none, of two kinds (worfy-harness ticket 37). `none` — the folder has no Profile:
 * exit code 3, a missing script, or a Harness from before Silent mode that has no such fields; the
 * caller reads it in Full mode, as worfy read every Project before. `failed` — the call failed and
 * the mode is unknown: any other exit code (4 included), a timeout, a script that could not be
 * started, output that is not JSON or lacks the fields; the caller shows the reason instead of
 * guessing (src/main/workflow/folder.ts). Nothing is logged here.
 */
export async function readResolvedProfile(options: ReadProfileOptions): Promise<{ ok: true; profile: ResolvedProfile } | ProfileMissRead> {
  const read = await runProfile(options, ['--json'], 'the profile script answered --json with exit code 4')
  if (!read.ok) return read
  const wrong = (reason: string): ProfileMissRead => ({ ok: false, reason, miss: 'failed', environment: false })
  let json: unknown
  try {
    json = JSON.parse(read.stdout)
  } catch {
    return wrong(`profile --json printed something that is not JSON: ${JSON.stringify(read.stdout.slice(0, 200))}`)
  }
  // Every version of the script prints an object; `null`, a list or a string is a call that went wrong.
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return wrong(`profile --json printed no object: ${JSON.stringify(read.stdout.slice(0, 200))}`)
  // Only a Harness older than Silent mode has no `_resolved.mode`: no `_resolved` at all, or one without the field.
  const resolved: unknown = (json as { _resolved?: unknown })._resolved
  if (resolved === undefined || (typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved) && (resolved as { mode?: unknown }).mode === undefined)) {
    return { ok: false, reason: 'the Harness gives no _resolved.mode: it is older than Silent mode', miss: 'none' }
  }
  const parsed = resolvedSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return wrong(`profile --json does not have the expected _resolved fields: ${issue ? `${issue.path.join('.') || '(the whole answer)'}: ${issue.message}` : ''}`)
  }
  const { mode, workflow_folder, workspace, repos } = parsed.data._resolved
  return { ok: true, profile: { mode, workflowFolder: workflow_folder, workspace: workspace ?? null, repos: repos.map(({ name, path }) => ({ name, path })) } }
}

// ── the Pipeline ─────────────────────────────────────────────────────────────

/** What the Stage of a Ticket needs from the Profile (ADR-0067). */
export interface PipelineProfile {
  /** The Profile's name, `_resolved.name`: the folder of its Silent mode marks. */
  name: string
  mode: 'full' | 'silent'
  /** `_resolved.pipeline`; the default Pipeline when the Harness gives none or one that does not read. */
  pipeline: readonly PipelineStage[]
  /** Why `pipeline` is the default although the Harness answered; null otherwise. */
  pipelineReason: string | null
  /** `workflow.e2e_lock`: the folder of the e2e lock, whose holder.json names the PRs of the gate full that runs; null without one. */
  e2eLock: string | null
  repos: readonly ResolvedRepo[]
}

const pipelineProfileSchema = z.object({
  _resolved: z.object({
    name: z.string().trim().min(1),
    mode: z.enum(['full', 'silent']),
    repos: z.array(z.object({ name: z.string().trim().min(1), path: absolute })).catch([]),
    pipeline: z.unknown().optional(),
  }),
  workflow: z.object({ e2e_lock: z.string().nullish().catch(null) }).loose().nullish().catch(null),
})

/**
 * `_resolved.name`, `mode`, `repos` and `pipeline` and `workflow.e2e_lock` of `bin/profile -C <root> --json`,
 * or why there are none (any exit code but 0, output that is not the expected JSON). A Harness from
 * before the Pipeline has no `_resolved.pipeline`: the default Pipeline, and `pipelineReason` says so.
 * A relative lock path is not taken: it would depend on worfy's own cwd. Nothing is logged here.
 */
export async function readPipelineProfile(options: ReadProfileOptions): Promise<{ ok: true; profile: PipelineProfile } | ProfileMissRead> {
  const read = await runProfile(options, ['--json'], 'the profile script answered --json with exit code 4')
  if (!read.ok) return read
  const wrong = (reason: string): ProfileMissRead => ({ ok: false, reason, miss: 'failed', environment: false })
  let json: unknown
  try {
    json = JSON.parse(read.stdout)
  } catch {
    return wrong(`profile --json printed something that is not JSON: ${JSON.stringify(read.stdout.slice(0, 200))}`)
  }
  const parsed = pipelineProfileSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return wrong(`profile --json does not have the expected _resolved fields: ${issue ? `${issue.path.join('.') || '(the whole answer)'}: ${issue.message}` : ''}`)
  }
  const { name, mode, repos, pipeline: given } = parsed.data._resolved
  let pipeline: readonly PipelineStage[] = DEFAULT_PIPELINE
  let pipelineReason: string | null = null
  if (given === undefined) pipelineReason = 'the Harness gives no _resolved.pipeline: it is older than the Pipeline'
  else {
    const stages = pipelineSchema.safeParse(given)
    if (stages.success) pipeline = stages.data
    else pipelineReason = `_resolved.pipeline is not a Pipeline: ${stages.error.issues[0]?.message ?? ''}`
  }
  const lock = parsed.data.workflow?.e2e_lock ?? null
  return {
    ok: true,
    profile: { name, mode, pipeline, pipelineReason, e2eLock: lock !== null && isAbsolutePath(lock) ? lock : null, repos: repos.map(({ name: repo, path }) => ({ name: repo, path })) },
  }
}
