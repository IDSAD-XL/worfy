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
//   - failed: the run happened and the Harness did not do its part (a hook did not load, the guard
//     did not refuse, Stop did not hold the turn) — the reason names what is missing;
//   - not-run: the run never got as far as a turn — the binary did not start, the stand-in could not
//     listen, Claude Code printed no system/init, never asked the stand-in, ended its turn with an API
//     error, or did not finish within the limit. That says nothing about the Harness.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
}

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

function runBinary(binary: string, args: string[], cwd: string, env: Record<string, string>, limitMs: number): Promise<Spawned> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let timedOut = false
    let error: NodeJS.ErrnoException | undefined
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    // Stopped by its own pid: the runner kills only the process it started.
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, limitMs)
    child.stdout.on('data', (chunk: Buffer) => (out += String(chunk)))
    child.stderr.on('data', (chunk: Buffer) => (err += String(chunk)))
    child.on('error', (e) => (error = e))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ out, err, code, timedOut, ...(error === undefined ? {} : { error }) })
    })
  })
}

/** Runs one case and says what came of it; never throws for a run that went wrong. */
export async function runContractCase(contractCase: ContractCase, options: ContractSetOptions): Promise<CaseOutcome> {
  const { id, title } = contractCase
  const notRun = (reason: string): CaseOutcome => ({ id, title, status: 'not-run', reason })
  // The real path, long form on Windows (not RUNNER~1): the Stop case names the tree's gate marker by
  // the path git prints for it, and git prints the path the process's folder was given as.
  const root = realpathSync.native(mkdtempSync(join(options.scratch ?? tmpdir(), `contract-${id}-`)))
  let standIn: ScriptedStandIn | undefined
  try {
    const context: CaseContext = { cwd: join(root, 'cwd'), home: join(root, 'home'), harnessHome: join(root, 'home', 'harness'), scratch: join(root, 'scratch'), pluginDir: options.pluginDir }
    for (const dir of [context.cwd, context.home, context.harnessHome, context.scratch]) mkdirSync(dir, { recursive: true })
    let extra: Record<string, string> = {}
    try {
      extra = contractCase.prepare?.(context) ?? {}
    } catch (e) {
      return notRun(`could not prepare the run: ${String((e as Error).message ?? e)}`)
    }
    const chains = typeof contractCase.chains === 'function' ? contractCase.chains(context) : (contractCase.chains ?? [])
    try {
      standIn = await startScriptedStandIn(chains)
    } catch (e) {
      return notRun(`the stand-in of the Messages API could not listen: ${String((e as Error).message ?? e)}`)
    }
    const env = { ...claudeEnv(standIn, context.home), HARNESS_HOME: context.harnessHome, ...extra }
    const args = ['-p', contractCase.prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', MODEL, '--setting-sources', '', '--permission-mode', 'bypassPermissions', '--plugin-dir', options.pluginDir]
    const spawned = await runBinary(options.binary, args, context.cwd, env, options.runLimitMs)
    if (spawned.error !== undefined) return notRun(`could not start ${options.binary}: ${spawned.error.code ?? spawned.error.message}`)
    const lines = parseLines(spawned.out)
    const requests = standIn.requests()
    if (spawned.timedOut) return notRun(`Claude Code did not finish in ${options.runLimitMs} ms and was stopped; ${requests.length} turns asked the stand-in; stderr: ${tail(spawned.err)}`)
    const init = lines.find((line) => line.type === 'system' && line.subtype === 'init')
    if (init === undefined) return notRun(`Claude Code printed no system/init (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    if (requests.length === 0) return notRun(`Claude Code never asked the stand-in of the Messages API (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    const result = lines.find((line) => line.type === 'result')
    if (result === undefined) return notRun(`Claude Code printed no result (exit code ${String(spawned.code)}); stderr: ${tail(spawned.err)}`)
    if (result.is_error === true) return notRun(`the turn ended with an error of the API or of Claude Code: ${tail(JSON.stringify(result), 400)}`)
    const run: CaseRun = { ...context, lines, init, requests, toolResult: (callId) => standIn?.toolResult(callId), exitCode: spawned.code, stderr: spawned.err }
    const why = contractCase.check(run)
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
