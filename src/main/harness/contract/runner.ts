// The runner of the contract set of the Harness (epic worfy-harness-guarantees, ticket 08): one case
// is one run of `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions`
// with the Harness folder as its plugin (`--plugin-dir`), against the scripted stand-in of the
// Messages API (./messages-api-stand-in.ts). No model, no key, no sign-in: the environment is
// claudeEnv (a key that is no key, HOME, CLAUDE_CONFIG_DIR and HARNESS_HOME in a temporary folder of
// the run), so nothing reads or writes the real ~/.claude or the Harness state of this machine.
//
// A case is data (ContractCase): its prompt, the calls the stand-in scripts, what it lays out before
// the run and what it checks after. The runner knows no case, so a ticket adds cases without
// touching it. Its answer tells three things apart, which Health (ticket 09) writes as different
// lines:
//   - passed: the run happened and the check holds;
//   - failed: Claude Code started with the plugin (system/init came) and the Harness did not do its
//     part — a hook did not load, the guard did not refuse, Stop did not hold the turn, a hook of the
//     plugin blocked the run (judgeRun), or the check itself threw. The reason names what is missing;
//   - not-run: nothing about the Harness can be said — the binary did not start, the stand-in could
//     not listen, Claude Code printed no system/init, or, with no hook of the plugin blocking, ended
//     its turn with an API error, printed no result or did not finish within the limit.
// A stop (`signal`: worfy quits) ends the running case as the limit does, with every process of its tree,
// removes its temporary folder at once and runs no case after it; those are not-run (STOPPED).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killTool } from '../../first-run/tools'
import { removeTree } from '../../storage/remove'
import { claudeEnv, startScriptedStandIn, type RecordedRequest, type RecordedToolResult, type ScriptedChain, type ScriptedStandIn } from './messages-api-stand-in'

/** The model Claude Code names in its requests; the stand-in answers for any. */
const MODEL = 'claude-sonnet-4-5'

/** One line of Claude Code's stream-json output. */
export type StreamLine = Record<string, unknown>

/** What a case has before its run: its folders. */
export interface CaseContext {
  /** The folder the run works in (Claude Code's cwd). */
  cwd: string
  /** HOME of the run; CLAUDE_CONFIG_DIR is its .claude. */
  home: string
  /** HARNESS_HOME of the run: the gate registry and state of the Harness hooks. */
  harnessHome: string
  /** A folder of the case's own for files outside cwd (a stub, say). */
  scratch: string
  /** The Harness folder the run loads as its plugin. */
  pluginDir: string
}

/** What a run left for the case to check. */
export interface CaseRun extends CaseContext {
  /** The stream-json lines, in order. */
  lines: StreamLine[]
  /** The first system/init line. */
  init: StreamLine
  /** Every turn of a conversation the stand-in answered. */
  requests: RecordedRequest[]
  /** The result Claude Code sent back for a scripted call. */
  toolResult(id: string): RecordedToolResult | undefined
  exitCode: number | null
  stderr: string
}

export interface ContractCase {
  /** The name of the case in a Health line and a test. */
  id: string
  /** What the case guarantees, in one sentence. */
  title: string
  /** The prompt of the run; the main thread's chain is told by it. */
  prompt: string
  /** The calls the stand-in makes the "model" write, per conversation. */
  chains?: ScriptedChain[] | ((context: CaseContext) => ScriptedChain[])
  /** Lays out what the run needs (a git repository, a marker); returns variables the run gets on top of claudeEnv. */
  prepare?(context: CaseContext): Record<string, string> | void
  /** Null when the guarantee holds, otherwise what is missing. */
  check(run: CaseRun): string | null
}

export type CaseOutcome =
  | { id: string; title: string; status: 'passed' }
  | { id: string; title: string; status: 'failed'; reason: string }
  | { id: string; title: string; status: 'not-run'; reason: string }

export interface ContractSetOptions {
  /** The Claude Code binary: the SDK's own, or the terminal's. */
  binary: string
  /** The Harness folder, loaded with --plugin-dir. */
  pluginDir: string
  /** How long one run may take before the runner stops it (by its pid) and calls the case not run. */
  runLimitMs: number
  /** Where the temporary folders of the runs go; the system temporary folder without it. Each run removes its own. */
  scratch?: string
  /**
   * Stops the set (worfy quitting, ticket 09): the running case ends at once with its processes, as at the limit,
   * its temporary folder goes, and every case left is not run.
   */
  signal?: AbortSignal
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The last characters of a text, for a reason line. */
const tail = (text: string, size = 600): string => (text.length > size ? `…${text.slice(-size)}` : text)

const parseLines = (out: string): StreamLine[] =>
  out
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as StreamLine]
      } catch {
        return []
      }
    })

interface Spawned {
  out: string
  err: string
  code: number | null
  /** The spawn error (ENOENT, EACCES), when the binary did not start. */
  error?: NodeJS.ErrnoException
  timedOut: boolean
}

/** The pids under `root` in the process tree (POSIX `ps`), read once before any kill: a killed parent's children move to pid 1. */
function descendants(root: number | undefined): number[] {
  if (root === undefined) return []
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  if (ps.status !== 0) return []
  const children = new Map<number, number[]>()
  for (const line of ps.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const found: number[] = []
  const queue = [root]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const pid of children.get(next) ?? []) {
      if (found.includes(pid)) continue
      found.push(pid)
      queue.push(pid)
    }
  }
  return found
}

function runBinary(binary: string, args: string[], cwd: string, env: Record<string, string>, limitMs: number, signal?: AbortSignal): Promise<Spawned> {
  return new Promise((resolve) => {
    // Bytes, decoded once at the end: a character split between two chunks stays whole.
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    let error: NodeJS.ErrnoException | undefined
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    // A stop at the limit ends Claude Code with the processes it started: a hook that hangs would outlive
    // its run otherwise. Claude Code 2.1.322 starts each hook in a process group of its own, so a kill of
    // Claude Code's group misses them: the tree is walked from the pid of the process the runner started
    // (on Windows taskkill /T does that, killTool).
    // The same stop at the limit and on `signal`; synchronous up to the kill, so a quit of worfy does not outrun it.
    const stop = (): void => {
      if (process.platform === 'win32') return killTool(child, process.platform, process.env)
      for (const pid of descendants(child.pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Ended already.
        }
      }
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, limitMs)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (e) => (error = e))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8'), code, timedOut, ...(error === undefined ? {} : { error }) })
    })
  })
}

/** What a run of Claude Code gave, as judgeRun reads it. */
export interface RunTrace {
  /** Why the binary did not start (ENOENT, EACCES); undefined when it started. */
  startError?: string
  /** Whether the runner stopped the run at its limit. */
  timedOut: boolean
  limitMs: number
  exitCode: number | null
  lines: StreamLine[]
  stderr: string
  /** How many turns of a conversation reached the stand-in. */
  requests: number
}

export type RunVerdict = { status: 'ran'; init: StreamLine } | { status: 'failed' | 'not-run'; reason: string }

/** The hook_response lines that blocked: exit code 2, or a JSON answer that blocks or stops. */
function blockingHooks(lines: StreamLine[]): string[] {
  return lines
    .filter((line) => line.type === 'system' && line.subtype === 'hook_response')
    .filter((line) => {
      if (line.exit_code === 2) return true
      try {
        const answer = JSON.parse(String(line.stdout ?? '')) as Record<string, unknown>
        return answer.decision === 'block' || answer.continue === false
      } catch {
        return false
      }
    })
    .map((line) => `${String(line.hook_event)} (exit code ${String(line.exit_code)}): ${tail(String(line.stderr || line.stdout || ''), 200).trim()}`)
}

/** The hooks that started (hook_started) and never answered (no hook_response with their hook_id). */
function hungHooks(lines: StreamLine[]): string[] {
  const answered = new Set(lines.filter((line) => line.type === 'system' && line.subtype === 'hook_response').map((line) => line.hook_id))
  return lines.filter((line) => line.type === 'system' && line.subtype === 'hook_started' && !answered.has(line.hook_id)).map((line) => String(line.hook_event))
}

/**
 * Whether a run got as far as a case can judge, and if not, whose fault it is. Only Claude Code or
 * its environment is to blame (not-run) while it never came up with the plugin — no start, no
 * system/init — or when, with no hook of the plugin holding it up, the run ended without its
 * result: no turn reached the stand-in, an API error (the API cannot be reached), no result line,
 * the time limit (a slow machine). A run a hook of the plugin held up is the Harness's: failed,
 * naming the hook — with no turn, a hook that blocked or started and never answered; with turns, a
 * stop of any kind while a hook blocked.
 */
export function judgeRun(trace: RunTrace): RunVerdict {
  if (trace.startError !== undefined) return { status: 'not-run', reason: `could not start the binary: ${trace.startError}` }
  const init = trace.lines.find((line) => line.type === 'system' && line.subtype === 'init')
  const stderr = `stderr: ${tail(trace.stderr)}`
  if (init === undefined)
    return { status: 'not-run', reason: `Claude Code printed no system/init (${trace.timedOut ? `stopped at the limit of ${trace.limitMs} ms` : `exit code ${String(trace.exitCode)}`}); ${stderr}` }
  const blocked = blockingHooks(trace.lines)
  const holding = blocked.length === 0 ? '' : `; hooks of the plugin blocked: ${[...new Set(blocked)].join('; ')}`
  const result = trace.lines.find((line) => line.type === 'result')
  const ended = trace.timedOut
    ? `Claude Code did not finish in ${trace.limitMs} ms and was stopped; ${trace.requests} turns asked the stand-in`
    : result === undefined
      ? `Claude Code printed no result (exit code ${String(trace.exitCode)})`
      : result.is_error === true
        ? `the turn ended with an error of the API or of Claude Code: ${tail(JSON.stringify(result), 400)}`
        : undefined
  if (trace.requests === 0) {
    const hung = hungHooks(trace.lines)
    const none = `Claude Code started with the plugin but asked the stand-in no turn (exit code ${String(trace.exitCode)})`
    if (blocked.length > 0 || hung.length > 0)
      return { status: 'failed', reason: `${none}${holding}${hung.length === 0 ? '' : `; hooks of the plugin that never answered: ${[...new Set(hung)].join(', ')}`}; ${stderr}` }
    return { status: 'not-run', reason: `${ended === undefined ? none : `${none}; ${ended}`}; ${stderr}` }
  }
  if (ended === undefined) return { status: 'ran', init }
  return blocked.length > 0 ? { status: 'failed', reason: `${ended}${holding}` } : { status: 'not-run', reason: `${ended}; ${stderr}` }
}

/** Runs one case and says what came of it; never throws for a run that went wrong. */
export async function runContractCase(contractCase: ContractCase, options: ContractSetOptions): Promise<CaseOutcome> {
  const { id, title } = contractCase
  const notRun = (reason: string): CaseOutcome => ({ id, title, status: 'not-run', reason })
  // A function, not a read: the signal changes while the case runs.
  const stopped = (): boolean => options.signal?.aborted === true
  if (stopped()) return notRun(STOPPED)
  // The real path, long form on Windows (not RUNNER~1): the Stop case names the tree's gate marker by
  // the path git prints for it, and git prints the path the process's folder was given as.
  const root = realpathSync.native(mkdtempSync(join(options.scratch ?? tmpdir(), `contract-${id}-`)))
  let standIn: ScriptedStandIn | undefined
  try {
    const context: CaseContext = { cwd: join(root, 'cwd'), home: join(root, 'home'), harnessHome: join(root, 'home', 'harness'), scratch: join(root, 'scratch'), pluginDir: options.pluginDir }
    for (const dir of [context.cwd, context.home, context.harnessHome, context.scratch]) mkdirSync(dir, { recursive: true })
    let extra: Record<string, string> = {}
    let chains: ScriptedChain[] = []
    try {
      extra = contractCase.prepare?.(context) ?? {}
      chains = typeof contractCase.chains === 'function' ? contractCase.chains(context) : (contractCase.chains ?? [])
    } catch (e) {
      return notRun(`could not prepare the run: ${message(e)}`)
    }
    try {
      standIn = await startScriptedStandIn(chains)
    } catch (e) {
      return notRun(`the stand-in of the Messages API could not listen: ${message(e)}`)
    }
    const env = { ...claudeEnv(standIn, context.home), HARNESS_HOME: context.harnessHome, ...extra }
    const args = ['-p', contractCase.prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', MODEL, '--setting-sources', '', '--permission-mode', 'bypassPermissions', '--plugin-dir', options.pluginDir]
    // On a stop the folder goes at once, after the kill (the listener of runBinary comes first): when worfy quits,
    // the `finally` below may never run.
    const removeNow = (): void => {
      try {
        removeTree(root)
      } catch {
        // A file the killed processes still hold (Windows): the folder stays in the system's temporary folder.
      }
    }
    // Stopped while it laid out the run: nothing starts, and the `finally` removes the folder.
    if (stopped()) return notRun(STOPPED)
    const running = runBinary(options.binary, args, context.cwd, env, options.runLimitMs, options.signal)
    options.signal?.addEventListener('abort', removeNow, { once: true })
    const spawned = await running.finally(() => options.signal?.removeEventListener('abort', removeNow))
    if (stopped()) return notRun(STOPPED)
    const lines = parseLines(spawned.out)
    const requests = standIn.requests()
    const verdict = judgeRun({
      ...(spawned.error === undefined ? {} : { startError: `${options.binary}: ${spawned.error.code ?? spawned.error.message}` }),
      timedOut: spawned.timedOut,
      limitMs: options.runLimitMs,
      exitCode: spawned.code,
      lines,
      stderr: spawned.err,
      requests: requests.length,
    })
    if (verdict.status !== 'ran') return { id, title, status: verdict.status, reason: verdict.reason }
    const run: CaseRun = { ...context, lines, init: verdict.init, requests, toolResult: (callId) => standIn?.toolResult(callId), exitCode: spawned.code, stderr: spawned.err }
    let why: string | null
    try {
      why = contractCase.check(run)
    } catch (e) {
      // The check reads the plugin folder (its manifest, rules, agents): a Harness copy it cannot read is a broken Harness.
      why = `the check threw: ${message(e)}`
    }
    return why === null ? { id, title, status: 'passed' } : { id, title, status: 'failed', reason: why }
  } finally {
    await standIn?.close()
    try {
      removeTree(root)
    } catch {
      // A file a hook still holds open (Windows): the folder stays in the scratch folder, whose owner removes it.
    }
  }
}

/** The reason of a case the set's `signal` stopped, or never started. */
export const STOPPED = 'the run was stopped: worfy is quitting'

/** Runs the cases one after another (each with folders of its own) and returns their outcomes in order. */
export async function runContractSet(cases: readonly ContractCase[], options: ContractSetOptions): Promise<CaseOutcome[]> {
  const outcomes: CaseOutcome[] = []
  for (const contractCase of cases) outcomes.push(await runContractCase(contractCase, options))
  return outcomes
}

/**
 * Git in the cwd of a case, as the run's own HOME sees it: no git config of this machine (signing,
 * hooks, templates), an identity of its own. Throws on failure.
 */
export function git(context: Pick<CaseContext, 'cwd' | 'home'>, args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env }
  // A test run from inside a git hook would otherwise work on that repository.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_GLOBAL']) delete env[name]
  const run = spawnSync('git', args, {
    cwd: context.cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...env, HOME: context.home, USERPROFILE: context.home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'contract', GIT_AUTHOR_EMAIL: 'contract@localhost', GIT_COMMITTER_NAME: 'contract', GIT_COMMITTER_EMAIL: 'contract@localhost' },
  })
  if (run.error !== undefined || run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr || String(run.error)}`)
  return run.stdout.replace(/\n+$/, '')
}
