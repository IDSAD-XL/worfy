// The checks of the first-run screen (worfy-harness ticket 19, question Q22): what worfy and the
// Harness need on this Mac, each answered with `ok`, `warn` or `fail` and one line of what to do.
//
// Checks only read. The tools run with the login shell environment (ADR-0007): the PATH a Terminal
// Node and a Session get, not the one worfy was started with from Finder. What each check asks:
// - Sign-in: accountInfo() of a Claude Code process (ADR-0009). The user signs in themselves:
//   `claude` in a Terminal Node, then /login.
// - Claude Code in the terminal: `claude --version` against the version this build carries (Q20).
//   Older or missing is a warning with `claude update`; worfy runs its own copy either way.
// - git, gh, node 22 or newer, jq: `--version`. Missing is `fail` with `brew install <tool>`; worfy
//   installs none of them (Q22).
// - git identity: `git config --get user.name` and `user.email`, run in the temporary folder, outside
//   any repository, so a repository's own config (worfy started from a Terminal in one) does not count;
//   the system and global config and their includes do. A missing value warns with the two
//   `git config --global` commands: git then makes up an author from the account and host name, and
//   the agents' commits carry it. Only a warning — the author may be set in the repository itself.
// - GitHub accounts: `gh auth status`. None signed in is `fail` with the `gh auth login` action,
//   which the user goes through in a Terminal Node.
// - worfy version (worfy-update ticket 08; spec, "Texts", "Health"): only where Update is on (the
//   packaged Stable copy, or WORFY_UPDATE=1). OK without an Update; fails with an Available update
//   that is not quiet, with a failed build (the last line of build.log, "Show log"), and with the
//   tools that build did not find, each with its install command.
// - Harness: the installer's state (src/main/harness/install.ts, ticket 13) — not installed fails,
//   another version than this build's warns; both offer Install / Update. A Harness behind this
//   build fails (worfy-update ticket 08): an older semver, or the same semver that the Update state
//   says is behind (`harnessBehind`, ticket 05); the same semver GitHub has not ordered still warns
//   with "Replace". Neither this fail nor that of worfy version opens First run by itself
//   (`opensFirstRun: false`, spec R9): their signal at the start is a toast.
// - Plugin dependencies: the plugins the Harness plugin needs (ticket 30, ADR-0059), from the same
//   state — the same `claude plugin list`, no command of its own. Missing fails and offers the same
//   install action, which then runs the dependency's commands alone; without the Harness plugin's
//   folder nothing was listed, so the row only says when it is checked.
// - Harness scripts: `profile --help`, run as the Epics read runs the Harness scripts — the same
//   runner (harnessScriptRunner) and the environment of src/main/harness/script-env.ts, not the
//   screen's `env` (worfy-harness ticket 37). `--help` reads no registry. A script that cannot run
//   fails with the exit code and what stderr says, and a hint for the cause (no node on the login
//   shell's PATH, a timeout, a crash, a script worfy cannot start): worfy then reads no Epics.
//   Without a Harness, or with an old one that has no `profile`, the row warns. worfy runs the
//   scripts as `node <script>` (worfy-windows ticket 05), so Windows gets the same check.
// - Old Harness in ~/.claude: the files of the Q19 list (src/main/harness/migrate/plan.ts, ticket 14);
//   a warning with the move form.
// - qmd, its models, the collections of the connected Projects (src/main/harness/qmd.ts, ticket 17).
//   qmd is optional for worfy itself (search falls back to grep), so these only warn.
//
// On Windows (worfy-windows ticket 13; owner's answers Q18, Q20, Q24) the same list, with these
// differences. The tools run with the environment worfy builds there for a Session (src/main/agent/env.ts,
// ticket 09: the session variables and the registry), not a login shell; a missing tool's command is
// `winget install <id>`. `claude` is claude.exe or npm's claude.cmd, which only cmd.exe starts.
// - Git Bash: found as the Sessions find it (findGitBash); the WSL launcher System32\bash.exe does
//   not count. Missing fails with `winget install Git.Git`.
// - jq: missing only warns (owner's decision of 2026-10-09): the skill steps that call jq need it,
//   installing the Harness does not.
// - Windows: build 19044 (Windows 10 21H2) or newer, else fail; an architecture other than x64 warns.
// - PowerShell: the shell a Terminal Node starts (terminalShell, ticket 10); Windows PowerShell
//   without pwsh warns with `winget install Microsoft.PowerShell`.
// - Limits from terminal: whether statusLine of settings.json runs the Limits bridge of this build
//   (src/main/harness/status-line.ts); a warning with an action that points it there.
// The system, its os.release(), its architecture and the answers of the tools come in through
// CheckDeps, so a test checks Windows on any machine.
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'
import { arch as osArch, release as osRelease, tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileOrAlias, findGitBash, getVar, type Env as AgentEnv, type FileExists } from '../agent/env'
import type { AccountInfoLike } from '../agent/session'
import { limitsBridgeState } from '../harness/status-line'
import { terminalShell } from '../terminal/pty'
import { DEPENDENCY_MARKETPLACE_SOURCE, unorderedWhy } from '../harness/install'
import { harnessHomes, locateHarness } from '../harness/locate'
import type { HarnessScriptEnvSource } from '../harness/script-env'
import { environmentExit, harnessScriptRunner, HarnessScriptStartError, HARNESS_SCRIPT_TIMEOUT_MS, NODE_NOT_FOUND, scriptFailureDetail } from '../workflow/profile'
import { hasLegacyHarness, type PlanOptions } from '../harness/migrate/plan'
import { MIN_NODE_MAJOR, modelPlan, profileDocsLanguages, QMD_NODE_NEED, QMD_VERSION, qmdState, type QmdHomes } from '../harness/qmd'
import { programStart } from '../program'
import type { HarnessStatus } from '../../shared/ipc/harness'
import type { Check, CheckGroup, CheckId, FirstRunAction, FirstRunReport } from '../../shared/ipc/first-run'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { numberedVersion } from '../../shared/version-number'
import { installCommand, runTool, WINGET_IDS, type Env, type ToolRun } from './tools'

export { killTool, runTool, toolStart, windowsProgram, WINGET_IDS, type Env, type ToolRun } from './tools'

/** A connected Project and what its Profile says about qmd. */
export interface ProjectProfile {
  /** The Project's name in worfy. */
  name: string
  /** The Profile's name (`bin/profile --name`); null when the Project has no Profile. */
  profile: string | null
  /** `qmd.collections` of the Profile. */
  collections: readonly string[]
}

export interface CheckDeps {
  /** The login shell environment (agentEnv()). */
  env: Env
  /**
   * The program the gh rows run in place of gh: WORFY_GH, which tests point at a stand-in
   * (src/main/program.ts), as the PR badges and the GitHub accounts do. Unset: gh from the PATH of
   * `env`. Without it an e2e run reached the machine's own gh (worfy-windows ticket 80). `env` here
   * is worfy's own environment, which the PR badges run their stand-in with: the rows add it under
   * the login shell's, so a stand-in's settings reach it from either. ghOverride builds it.
   */
  gh?: { command: string; env: Env }
  /**
   * The environment the Harness scripts get, asked when the scripts row runs: the source the
   * Epics read uses (src/main/harness/script-env.ts), so the row fails exactly when that read does.
   */
  scriptEnv: HarnessScriptEnvSource
  /** `claudeCodeVersion` of the Agent SDK this build carries; null when it could not be read. */
  bundledClaudeCodeVersion: string | null
  /** accountInfo() of a Claude Code process. */
  accountInfo: () => Promise<AccountInfoLike>
  /** The Harness installer's state; reads only. */
  harness: () => Promise<HarnessStatus>
  /** Whether files of the old Harness are in the Claude home. */
  legacyHarness: () => boolean
  homes: QmdHomes
  /** The connected Projects with their Profiles. */
  projects: () => Promise<readonly ProjectProfile[]>
  /** How long `profile --help` of the Harness scripts row may take; 15 s, as for the Epics read, by default. */
  harnessScriptTimeoutMs?: number
  /** How long a tool or the sign-in may take; 15 s and 60 s by default. */
  toolTimeoutMs?: number
  accountTimeoutMs?: number
  /** The machine the checks describe; this one by default. */
  system?: Partial<SystemInfo>
  /** How a tool runs and how a file is looked for; tests give their own answers. */
  probes?: Partial<Probes>
  /**
   * The Limits bridge of this build (bridgeFile() of src/main/harness/status-line.ts); null in a
   * development build. Only the Windows row "Limits from terminal" reads it.
   */
  limitsBridge?: string | null
  /**
   * Update of this copy (worfy-update ticket 08): its snapshot (src/main/ipc/update.ts) and the build
   * version that runs, with its build number when it has one (ticket 14). Unset, or `enabled: false` (a dev build without WORFY_UPDATE=1): no "worfy
   * version" row, and no Harness is taken for behind by GitHub's word.
   */
  update?: () => { snapshot: Pick<UpdateSnapshot, 'enabled' | 'available' | 'build' | 'harnessBehind'>; version: string; number?: number | undefined }
}

/** The machine: process.platform, os.release() (`10.0.<build>` on Windows) and the architecture. */
export interface SystemInfo {
  platform: NodeJS.Platform
  release: string
  arch: string
}

/** What the checks ask the machine. */
export interface Probes {
  /** Runs a tool found on the PATH of `env`, in `cwd` when given (else worfy's own folder); never rejects. */
  run: (name: string, args: readonly string[], env: Env, timeoutMs: number, cwd?: string) => Promise<ToolRun>
  /** Whether a file is there, or an app execution alias of one (fileOrAlias, as Terminal looks): Git Bash, pwsh.exe, the bridge, settings.json. */
  exists: FileExists
}

/** The oldest Windows worfy runs on: Windows 10 21H2 (Q24). */
export const MIN_WINDOWS_BUILD = 19044

const TOOL_TIMEOUT_MS = 15_000
/** How long the Claude Code process of the sign-in check may take to answer; then it is closed (askAccount). */
export const ACCOUNT_TIMEOUT_MS = 60_000
/** The check's own limit on accountInfo(), a little later than askAccount's, so the process is closed first. */
const SIGN_IN_GUARD_MS = ACCOUNT_TIMEOUT_MS + 5_000
const firstLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''
const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

/** `1.2.3` as numbers; null when there is none in the text. */
export function semver(text: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Negative when a is older than b. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** "2.4 GiB", "610 MiB". */
export function formatBytes(bytes: number): string {
  const gib = bytes / 2 ** 30
  if (gib >= 1) return `${gib.toFixed(1)} GiB`
  return `${Math.round(bytes / 2 ** 20)} MiB`
}

type Row = Omit<Check, 'id' | 'group' | 'title'>
const row = (status: Check['status'], detail: string, hint = '', command: string | null = null, actions: Check['actions'] = []): Row => ({ status, detail, hint, command, actions })
const action = (id: FirstRunAction, label: string): Check['actions'][number] => ({ id, label })

/** The checks in the order the screen shows them, with their group and title; `windows` — on Windows only. */
const CHECKS: readonly { id: CheckId; group: CheckGroup; title: string; windows?: true }[] = [
  { id: 'claude-login', group: 'Claude Code', title: 'Sign-in' },
  { id: 'claude-version', group: 'Claude Code', title: 'Claude Code in the terminal' },
  { id: 'limits', group: 'Claude Code', title: 'Limits from terminal', windows: true },
  { id: 'windows', group: 'Windows', title: 'Windows version', windows: true },
  { id: 'arch', group: 'Windows', title: 'Architecture', windows: true },
  { id: 'powershell', group: 'Windows', title: 'PowerShell', windows: true },
  { id: 'git', group: 'Command-line tools', title: 'git' },
  { id: 'git-identity', group: 'Command-line tools', title: 'git identity' },
  { id: 'git-bash', group: 'Command-line tools', title: 'Git Bash', windows: true },
  { id: 'gh', group: 'Command-line tools', title: 'gh' },
  { id: 'node', group: 'Command-line tools', title: 'node' },
  { id: 'jq', group: 'Command-line tools', title: 'jq' },
  { id: 'gh-auth', group: 'GitHub', title: 'GitHub accounts' },
  { id: 'worfy-update', group: 'worfy', title: 'worfy version' },
  { id: 'harness', group: 'Harness', title: 'Harness plugin' },
  { id: 'harness-dependencies', group: 'Harness', title: 'Plugin dependencies' },
  { id: 'harness-scripts', group: 'Harness', title: 'Harness scripts' },
  { id: 'legacy-harness', group: 'Harness', title: 'Old Harness in ~/.claude' },
  { id: 'qmd', group: 'qmd', title: 'qmd' },
  { id: 'qmd-models', group: 'qmd', title: 'qmd models' },
  { id: 'qmd-collections', group: 'qmd', title: 'qmd collections' },
]

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** The part of a Claude Code query the sign-in check uses. */
export interface AccountQuery {
  accountInfo(): Promise<AccountInfoLike>
  close(): void
}

/**
 * accountInfo() of a query that `open` starts, within `timeoutMs`. The query is closed exactly once,
 * whatever comes first: the answer, an error, or the timeout — a query that opens or answers after
 * the timeout is closed then, and its late answer or error goes nowhere. `signal` stops it the same way
 * before the timeout (Settings → Plan's ask when the app quits, src/main/ipc/plan-preset.ts).
 */
export async function askAccount(open: () => Promise<AccountQuery>, timeoutMs: number, signal?: AbortSignal): Promise<AccountInfoLike> {
  if (signal?.aborted) throw new Error(ACCOUNT_ASK_STOPPED)
  let query: AccountQuery | null = null
  let closed = false
  let timedOut = false
  let stopped: (() => void) | undefined
  const close = (): void => {
    if (closed || query === null) return
    closed = true
    try {
      query.close()
    } catch (error) {
      console.warn('[first-run] closing the sign-in query failed', error)
    }
  }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      close()
      reject(new Error(`Claude Code did not answer within ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)
    stopped = () => {
      timedOut = true
      close()
      reject(new Error(ACCOUNT_ASK_STOPPED))
    }
    signal?.addEventListener('abort', stopped, { once: true })
  })
  const ask = (async () => {
    const opened = await open()
    query = opened
    if (timedOut) {
      close()
      throw new Error('opened after the timeout')
    }
    return opened.accountInfo()
  })()
  // After the timeout nobody waits for the answer: its rejection must not go unhandled.
  ask.catch(() => undefined)
  try {
    return await Promise.race([ask, timeout])
  } finally {
    clearTimeout(timer)
    if (stopped !== undefined) signal?.removeEventListener('abort', stopped)
    close()
  }
}

/** What askAccount rejects with when its signal stopped it. */
export const ACCOUNT_ASK_STOPPED = 'the account question was stopped'

async function signIn(deps: CheckDeps): Promise<Row> {
  let account: AccountInfoLike
  try {
    account = await withTimeout(deps.accountInfo(), deps.accountTimeoutMs ?? SIGN_IN_GUARD_MS, 'Claude Code')
  } catch (error) {
    return row('fail', 'Claude Code did not answer', `Could not ask Claude Code: ${error instanceof Error ? error.message : String(error)}`)
  }
  // With a login accountInfo() has subscriptionType; without one only apiProvider and tokenSource
  // "none" (ADR-0009) — the same reading as a Session's start (src/main/agent/session.ts).
  const signedIn = account.subscriptionType !== undefined || (account.tokenSource !== undefined && account.tokenSource !== 'none')
  if (!signedIn) return row('fail', 'not signed in', 'Run claude in a Terminal Node, then /login: you sign in yourself', 'claude')
  const who = [account.email, account.subscriptionType].filter((part): part is string => typeof part === 'string' && part !== '')
  return row('ok', who.length > 0 ? who.join(' · ') : 'signed in')
}

/** The system and the probes of one run of the checks. */
interface Machine {
  system: SystemInfo
  probes: Probes
  windows: boolean
}

/** Where a missing tool was looked for: the login shell off Windows, the environment worfy builds on Windows. */
const notFound = (machine: Machine): string => (machine.windows ? 'not found on the PATH' : 'not found on the PATH of the login shell')

async function claudeVersion(deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  const bundled = deps.bundledClaudeCodeVersion
  const run = await machine.probes.run('claude', ['--version'], deps.env, timeoutMs)
  const builtIn = bundled === null ? 'its own copy' : `its own ${bundled}`
  if (run.missing) {
    // `claude update` needs a `claude` to run: here the line only says to install it.
    return row('warn', notFound(machine), `Sessions in worfy still run ${builtIn}; install Claude Code (claude.com/claude-code) to use it in a terminal`)
  }
  const found = semver(run.stdout)
  if (run.code !== 0 || found === null) {
    return row('warn', `claude --version answered no version${run.stderr ? `: ${lastLine(run.stderr)}` : ''}`, `Sessions in worfy still run ${builtIn}`, 'claude update')
  }
  const version = found.join('.')
  const want = bundled === null ? null : semver(bundled)
  if (want !== null && compareVersions(found, want) < 0) {
    return row('warn', `${version}, older than ${bundled ?? ''} in worfy`, 'Update Claude Code in the terminal; worfy is not blocked', 'claude update')
  }
  return row('ok', version)
}

/** What jq is for on Windows, where it only warns: the Harness installs and runs without it. */
export const JQ_WINDOWS_HINT = 'Skill steps that call jq do not work without it; installing the Harness does not need it'

/**
 * The gh of the checks from worfy's own environment: WORFY_GH with that environment, as the PR
 * badges run it (src/main/ipc/checks.ts); unset or empty, none, and the rows run gh.
 */
export function ghOverride(processEnv: Env): CheckDeps['gh'] {
  const command = processEnv.WORFY_GH
  return command ? { command, env: processEnv } : undefined
}

/** Runs gh, or the program deps.gh names in its place: a `.mjs` one under worfy's own Node (programStart). */
function runGh(args: readonly string[], deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<ToolRun> {
  const start = programStart(deps.gh?.command, 'gh')
  // The override gets worfy's own variables under the login shell's: the shell's PATH, HOME and
  // whatever its profile sets win, and what only worfy has (a stand-in's settings) still reaches it.
  // Keys compare without case, as Windows does: worfy's `PATH` must not stay beside the shell's `Path`.
  const shell = new Set(Object.keys(deps.env).map((key) => key.toUpperCase()))
  const own = Object.fromEntries(Object.entries(deps.gh?.env ?? {}).filter(([key]) => !shell.has(key.toUpperCase())))
  return machine.probes.run(start.file, [...start.args, ...args], { ...own, ...deps.env, ...start.env }, timeoutMs)
}

async function tool(name: 'git' | 'gh' | 'jq', deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  const run = name === 'gh' ? await runGh(['--version'], deps, machine, timeoutMs) : await machine.probes.run(name, ['--version'], deps.env, timeoutMs)
  const install = installCommand(machine.windows, name)
  // On Windows jq is not required (owner's decision of 2026-10-09): missing or broken, it warns.
  const optional = machine.windows && name === 'jq'
  if (run.missing) return row(optional ? 'warn' : 'fail', notFound(machine), optional ? JQ_WINDOWS_HINT : 'worfy does not install it: run the command in a terminal', install)
  if (run.code !== 0) return row(optional ? 'warn' : 'fail', `${name} --version failed: ${lastLine(run.stderr) || `exit ${String(run.code)}`}`, optional ? `Reinstall it. ${JQ_WINDOWS_HINT}` : 'Reinstall it', install)
  return row('ok', firstLine(run.stdout))
}

/** The commands that set the commit author for every repository of this user. */
export const GIT_IDENTITY_COMMANDS = 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"'

/**
 * Whether git knows the commit author: user.name and user.email, asked in the temporary folder so
 * that no repository's own config answers (see the header). Exit 1 of `git config --get` is "not
 * set"; another failure is said with its stderr. Never `fail`: the author may be set per repository.
 */
async function gitIdentity(deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  // A temporary folder that is gone would make execFile fail with ENOENT, read as "git is not
  // installed": then git is asked in worfy's own folder, where a repository's config may answer.
  const outside = existsSync(tmpdir()) ? tmpdir() : undefined
  const ask = (key: string): Promise<ToolRun> => machine.probes.run('git', ['config', '--get', key], deps.env, timeoutMs, outside)
  const [name, email] = await Promise.all([ask('user.name'), ask('user.email')])
  if (name.missing || email.missing) return row('warn', 'git is not installed', `Install git first (${installCommand(machine.windows, 'git')}), then set the commit author`)
  const value = (run: ToolRun): string | null => (run.code === 0 ? firstLine(run.stdout) || null : null)
  const broken = [name, email].find((run) => run.code !== 0 && run.code !== 1)
  if (broken !== undefined) {
    return row('warn', `git config failed: ${lastLine(broken.stderr) || `exit ${String(broken.code)}`}`, 'Check your git config, then set the commit author', GIT_IDENTITY_COMMANDS)
  }
  const missing = [value(name) === null ? 'user.name' : null, value(email) === null ? 'user.email' : null].filter((key): key is string => key !== null)
  if (missing.length > 0) {
    return row(
      'warn',
      `${missing.join(' and ')} not set`,
      'git makes up the author of a commit from your account and host name: set your name and email once',
      GIT_IDENTITY_COMMANDS,
    )
  }
  return row('ok', `${value(name) ?? ''} <${value(email) ?? ''}>`)
}

async function node(deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  const run = await machine.probes.run('node', ['--version'], deps.env, timeoutMs)
  const install = installCommand(machine.windows, 'node')
  if (run.missing) return row('fail', notFound(machine), `The Harness scripts need node ${MIN_NODE_MAJOR} or newer`, install)
  const found = semver(run.stdout)
  if (run.code !== 0 || found === null) return row('fail', `node --version failed: ${lastLine(run.stderr) || `exit ${String(run.code)}`}`, 'Reinstall it', install)
  const version = found.join('.')
  if (found[0] < MIN_NODE_MAJOR) return row('fail', `${version}, needs ${MIN_NODE_MAJOR} or newer`, `The Harness scripts need node ${MIN_NODE_MAJOR} or newer, and qmd needs ${QMD_NODE_NEED}`, install)
  return row('ok', version)
}

const GIT_BASH_HINT = 'Claude Code needs Git Bash for its Bash tool and the Harness hooks; C:\\Windows\\System32\\bash.exe starts WSL and does not count'

/**
 * Git Bash as a Session gets it (ticket 09, src/main/agent/env.ts): CLAUDE_CODE_GIT_BASH_PATH when the
 * environment sets it — the user's own, or the one captureWindowsEnv found — else findGitBash. A
 * variable that names a file under the Windows folder (System32\bash.exe starts WSL) fails, as
 * findGitBash refuses such a candidate; one that names no file fails too.
 */
function gitBash(deps: CheckDeps, machine: Machine): Row {
  const named = getVar(deps.env, 'CLAUDE_CODE_GIT_BASH_PATH')
  if (named !== undefined && named !== '') {
    const systemRoot = (getVar(deps.env, 'SystemRoot') || 'C:\\Windows').toLowerCase()
    if (win32.normalize(named).toLowerCase().startsWith(`${win32.normalize(systemRoot)}\\`)) {
      return row('fail', `CLAUDE_CODE_GIT_BASH_PATH is ${named}`, `${GIT_BASH_HINT}: point the variable at bash.exe of Git for Windows, or remove it`, `winget install ${WINGET_IDS.git}`)
    }
    if (!machine.probes.exists(named)) return row('fail', `CLAUDE_CODE_GIT_BASH_PATH names a missing file: ${named}`, `${GIT_BASH_HINT}: point the variable at bash.exe of Git for Windows, or remove it`, `winget install ${WINGET_IDS.git}`)
    return row('ok', named)
  }
  const bash = findGitBash(deps.env, machine.probes.exists)
  if (bash !== null) return row('ok', bash)
  return row('fail', 'not found', GIT_BASH_HINT, `winget install ${WINGET_IDS.git}`)
}

/** The Windows build of os.release() (`10.0.<build>`); null when there is none. */
export function windowsBuild(release: string): number | null {
  const match = /^\d+\.\d+\.(\d+)/.exec(release.trim())
  return match ? Number(match[1]) : null
}

function windowsVersion(machine: Machine): Row {
  const { release } = machine.system
  const build = windowsBuild(release)
  if (build === null) return row('warn', `unknown build (${release})`, `worfy needs Windows 10 21H2 (build ${MIN_WINDOWS_BUILD}) or newer`)
  // Windows 11 starts at build 22000 and still reports 10.0 (Q24).
  const name = `${build >= 22000 ? 'Windows 11' : 'Windows 10'}, build ${build}`
  if (build < MIN_WINDOWS_BUILD) return row('fail', name, 'Windows 10 21H2 or newer is required: update Windows')
  return row('ok', name)
}

/**
 * The architecture of the machine on Windows, not of worfy's process: os.arch() of an x64 build that
 * runs under emulation on arm64 says x64. PROCESSOR_ARCHITEW6432 names the machine to a 32-bit process
 * under WOW64; PROCESSOR_ARCHITECTURE of the environment worfy builds for a Session is the machine's
 * own (src/main/agent/env.ts takes it from the registry, HKLM Session Manager\Environment, which no
 * emulation changes). Limit: when the registry could not be read (`from: 'fallback'`), the variable
 * comes from worfy's process, which an x64 emulation sees as AMD64. Null without either variable.
 */
export function windowsNativeArch(env: Env): string | null {
  const raw = (getVar(env, 'PROCESSOR_ARCHITEW6432') || getVar(env, 'PROCESSOR_ARCHITECTURE'))?.trim()
  if (!raw) return null
  const names: Record<string, string> = { AMD64: 'x64', ARM64: 'arm64', X86: 'ia32' }
  return names[raw.toUpperCase()] ?? raw.toLowerCase()
}

function architecture(machine: Machine): Row {
  const { arch } = machine.system
  if (arch === 'x64') return row('ok', arch)
  return row('warn', arch, 'worfy is built for x64: an arm64 build comes later, and the x64 build under emulation is not tested')
}

/** The shell a Terminal Node starts (terminalShell of ticket 10): pwsh, else Windows PowerShell. */
function powershell(deps: CheckDeps, machine: Machine): Row {
  const shell = terminalShell(deps.env as Readonly<AgentEnv>, 'powershell', { platform: 'win32', exists: machine.probes.exists })
  if (shell.name.toLowerCase() === 'pwsh.exe') return row('ok', shell.file)
  return row('warn', 'Terminal uses Windows PowerShell', 'Terminal Nodes start PowerShell 7 (pwsh) once it is installed', `winget install ${WINGET_IDS.pwsh}`)
}

/** Whether statusLine of settings.json runs the Limits bridge of this build (src/main/harness/status-line.ts). */
function limits(deps: CheckDeps, machine: Machine): Row {
  const state = limitsBridgeState({
    platform: machine.system.platform,
    settingsFile: join(deps.homes.claudeHome, 'settings.json'),
    bridge: deps.limitsBridge ?? null,
    exists: machine.probes.exists,
  })
  if (state.kind === 'bridged') return row('ok', 'statusLine runs the bridge of this build')
  if (state.kind === 'unavailable') return row('warn', state.detail, state.reason)
  return row('warn', state.detail, 'Limits of Claude Code in a terminal reach worfy only through its bridge; the dialog shows the new statusLine first', null, [action('limits-bridge', 'Set up…')])
}

/** The accounts `gh auth status` names, `host: login`; gh prints them to stdout (2.40+) or stderr (older). */
export function ghAccounts(output: string): string[] {
  const accounts: string[] = []
  for (const match of output.matchAll(/Logged in to (\S+) (?:account|as) ([A-Za-z0-9-]+)/g)) accounts.push(`${match[1] ?? ''}: ${match[2] ?? ''}`)
  return accounts
}

async function ghAuth(deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  const run = await runGh(['auth', 'status'], deps, machine, timeoutMs)
  if (run.missing) return row('fail', 'gh is not installed', `Install gh first (${installCommand(machine.windows, 'gh')}), then sign in`)
  const accounts = ghAccounts(`${run.stdout}\n${run.stderr}`)
  if (accounts.length > 0) return row('ok', accounts.join(', '))
  return row('fail', 'not signed in to any GitHub host', 'Sign in with gh auth login: you answer its questions yourself', 'gh auth login', [action('gh-login', 'Sign in…')])
}

/** A `fail` that does not open First run by itself at the start (worfy-update spec R9). */
const noFirstRun = (checked: Row): Row => ({ ...checked, opensFirstRun: false })

/** How much of the end of build.log is read for its last line. */
const LOG_TAIL_BYTES = 16 * 1024

/** The last line of the file's end; '' when the file does not read. */
function lastLineOf(file: string): string {
  try {
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      const length = Math.min(size, LOG_TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      return lastLine(buffer.toString('utf8'))
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

/** The tools an Update build needs, with the command that installs each (spec item 8). */
const updateToolCommand = (machine: Machine, tool: string): string | null => {
  if (tool === 'git' || tool === 'node') return installCommand(machine.windows, tool)
  return tool === 'pnpm' ? 'npm install -g pnpm' : null
}

/** "worfy version" (worfy-update ticket 08): the Update of this copy, as its snapshot says. */
function worfyUpdate(update: NonNullable<CheckDeps['update']>, machine: Machine): Row {
  const { snapshot, version, number } = update()
  const { available, build } = snapshot
  if (build.phase === 'failed') {
    const missing = (build.missing ?? []).filter((tool) => updateToolCommand(machine, tool) !== null)
    if (missing.length > 0) return noFirstRun(row('fail', `${missing.join(', ')} not found`, 'Updates need git, node and pnpm', missing.map((tool) => updateToolCommand(machine, tool)).join('; ')))
    return noFirstRun(row('fail', 'update failed', build.log === undefined ? '' : lastLineOf(build.log), null, [action('update-log', 'Show log')]))
  }
  // The versions numbered as the toolbar shows them (ticket 14), the build version where a number is not known.
  if (available !== null && !available.quiet) return noFirstRun(row('fail', `${numberedVersion(available.version, available.number)} available`, 'Update worfy from the toolbar or Settings → General'))
  return noFirstRun(row('ok', `${numberedVersion(version, number)}, up to date`))
}

/** `harnessBehind` of the Update state (worfy-update ticket 05). */
type HarnessBehind = NonNullable<UpdateSnapshot['harnessBehind']>

/**
 * The Harness plugin. `behind`: the Update state says a Harness is behind this build's
 * (`harnessBehind`, worfy-update ticket 05), which only GitHub can say for the same semver. It counts
 * only for the Harness installed now (`from`), as the toolbar reads it (ticket 06): an answer
 * about one installed before is not about this one.
 */
function harness(status: HarnessStatus, behind: HarnessBehind | null): Row {
  const { state } = status
  const install = (label: string): Check['actions'] => (status.canInstall ? [action('harness-install', label)] : [])
  const devRun = status.canInstall ? '' : ' (a dev run only shows the state: start the packaged app to install)'
  switch (state.kind) {
    case 'installed':
      return state.enabled
        ? row('ok', state.version)
        : row('warn', `${state.version}, disabled`, 'Enable the plugin in Claude Code', 'claude plugin enable worfy@worfy-harness')
    case 'not-installed':
      return row('fail', 'not installed', `Install the Harness of this build${status.bundledVersion ? ` (${status.bundledVersion})` : ''}${devRun}`, null, install('Install'))
    case 'outdated': {
      const update = (level: Row['status']): Row => row(level, `${state.from ?? 'unknown version'} → ${state.to}`, `Update it to the Harness of this build${devRun}`, null, install('Update'))
      // The same semver from another commit (ticket 67): no arrow and no "update", as worfy cannot
      // tell which one is newer — unless GitHub said this build's commit comes after it (`behind`).
      if (state.sameVersion) {
        if (behind !== null && behind.from === state.from) return noFirstRun(update('fail'))
        return row(
          'warn',
          `${state.from ?? 'unknown version'}, this build ${state.to}`,
          `Both are version ${state.to.split('+')[0] ?? state.to} and ${unorderedWhy(state.to, state.from)}, so worfy cannot tell which is newer: replace it only if this build is the newer one${devRun}`,
          null,
          install('Replace'),
        )
      }
      // An older semver, or a version that does not read. A newer installed Harness is not
      // `outdated` but an installer error (install.ts refuses to replace it).
      return noFirstRun(update('fail'))
    }
    case 'error':
      return row('fail', `error at ${state.step}`, lastLine(state.reason), null, install('Retry'))
  }
}

/** The plugins the Harness depends on, as the installer's state lists them. */
function harnessDependencies(status: HarnessStatus): Row {
  const { dependencies } = status
  if (dependencies.length === 0) return row('ok', 'none')
  const missing = dependencies.filter((each) => each.status === 'missing')
  if (missing.length > 0) {
    const devRun = status.canInstall ? '' : ' (a dev run only shows the state: start the packaged app to install)'
    // The name goes to the hint: the line of what was found is cut where the button starts.
    return row(
      'fail',
      'not installed',
      `Claude Code does not load the Harness plugin without ${missing.map((each) => each.id).join(', ')}: install ${missing.length === 1 ? 'it' : 'them'} from GitHub (${DEPENDENCY_MARKETPLACE_SOURCE})${devRun}`,
      null,
      status.canInstall ? [action('harness-install', 'Install…')] : [],
    )
  }
  if (dependencies.some((each) => each.status === 'unchecked')) {
    // Reading the plugin list failed: the Harness plugin row carries the error.
    if (status.state.kind === 'error') return row('warn', 'not checked', 'Claude Code did not list its plugins: see the Harness plugin above')
    return row('warn', 'checked when the Harness plugin is installed', `Installing the Harness plugin installs ${dependencies.map((each) => each.id).join(', ')} too`)
  }
  return row('ok', dependencies.map((each) => (each.version === null ? each.id : `${each.id} ${each.version}`)).join(', '))
}

/** The exit code of a process that aborted (128 + SIGABRT), where the abort comes as an exit code. */
const ABORT_EXIT = 134

/** The hint of the Harness scripts row for each way `profile --help` fails. */
export const HARNESS_SCRIPT_HINTS = {
  node: 'worfy cannot run the Harness scripts, so it reads no Epics: they need node on the PATH of your login shell',
  timeout: 'worfy reads no Epics while the Harness scripts take this long: a busy machine or a slow disk; Check again',
  crash: 'worfy reads no Epics while the Harness scripts fail: install the Harness plugin again, or report what the script says',
  // A signal ends the script from outside its own code: out of memory (SIGABRT), the system's
  // memory pressure (SIGKILL), a crash of node itself. Installing the plugin again changes none of it.
  signal: 'worfy reads no Epics while the Harness scripts are ended by the system, for example when they run out of memory; Check again, and report what the script says if it happens again',
  start: 'worfy cannot start the Harness scripts, so it reads no Epics: node or the script itself would not start; install the Harness plugin again',
} as const

/**
 * Whether worfy can run the Harness scripts: `profile --help` of the Harness the Epics read finds
 * (src/main/harness/locate.ts), with that read's runner and environment. `--help` reads neither
 * its folder nor the registry; it runs in the Harness's own bin folder, which exists when the
 * script does.
 */
async function harnessScripts(deps: CheckDeps): Promise<Row> {
  const { claudeHome } = deps.homes
  const location = locateHarness(harnessHomes(claudeHome))
  const later = (detail: string): Row => row('warn', detail, 'worfy runs the Harness scripts to read the Epics of a Project')
  if (location.kind === 'none') return later('checked when the Harness plugin is installed')
  const script = join(location.binDir, 'profile')
  // An old Harness without the script: the Epics are read without a Profile, as the reader does.
  if (!existsSync(script)) return later(`no profile script in ${location.binDir}`)
  const timeoutMs = deps.harnessScriptTimeoutMs ?? HARNESS_SCRIPT_TIMEOUT_MS
  try {
    const run = await harnessScriptRunner(claudeHome, await deps.scriptEnv(), 'profile', timeoutMs)(location.binDir, ['--help'])
    if (run.code === 0) return row('ok', 'profile --help answered')
    const detail = scriptFailureDetail(run.stderr)
    // A signal the runner did not send for the time limit: the script crashed, it was not slow.
    if (run.code === null && run.signal) return row('fail', `profile --help was ended by the signal ${run.signal}${detail ? `: ${detail}` : ''}`, HARNESS_SCRIPT_HINTS.signal)
    if (run.code === null) return row('fail', `profile --help did not answer within ${timeoutMs / 1000} s`, HARNESS_SCRIPT_HINTS.timeout)
    // 134 is how an abort ends where there is no signal for it (Windows: node's out-of-memory end),
    // and how a shell reports a child ended by SIGABRT: the system's end, as a signal is.
    const hint = environmentExit(run.code) ? HARNESS_SCRIPT_HINTS.node : run.code === ABORT_EXIT ? HARNESS_SCRIPT_HINTS.signal : HARNESS_SCRIPT_HINTS.crash
    return row('fail', `profile --help: exit code ${run.code}${detail ? `: ${detail}` : ''}`, hint)
  } catch (error) {
    // The script runs as `node <script>` (harnessScriptCommand): no node on the scripts' PATH is said as such.
    if (error instanceof HarnessScriptStartError && error.code === 'NODE_NOT_FOUND') return row('fail', `profile --help: ${NODE_NOT_FOUND}`, HARNESS_SCRIPT_HINTS.node)
    // The file was there a moment ago, so this is not a missing script: node could not be started for it.
    return row('fail', `profile could not be started: ${error instanceof Error ? error.message : String(error)}`, HARNESS_SCRIPT_HINTS.start)
  }
}

function legacyHarness(deps: CheckDeps): Row {
  if (!deps.legacyHarness()) return row('ok', 'none')
  return row('warn', 'files of the old Harness are in ~/.claude', 'Move them out: the form shows every file before anything changes', null, [action('migration-form', 'Move…')])
}

interface QmdRows {
  qmd: Row
  models: Row
  collections: Row
}

async function qmdRows(deps: CheckDeps, machine: Machine): Promise<QmdRows> {
  const state = await qmdState({ ...deps.homes, env: deps.env })
  const installed = state.qmd !== null

  const needsNode = `qmd needs node ${QMD_NODE_NEED}`
  let qmd: Row
  // An installed qmd on an older node dies without a word on any command that opens the index.
  if (installed && !state.node.ok) {
    const found = state.node.version === null ? 'there is no node' : `node is ${state.node.version}`
    qmd = row('warn', `${state.qmd?.version ?? 'unknown version'} (${state.qmd?.path ?? ''})`, `${needsNode}, and ${found}. Until then the Harness searches with grep`, installCommand(machine.windows, 'node'))
  } else if (state.version === 'ok') qmd = row('ok', `${QMD_VERSION} (${state.qmd?.path ?? ''})`)
  else if (state.version === 'warn') qmd = row('warn', `${state.qmd?.version ?? 'unknown version'} (${state.qmd?.path ?? ''})`, state.warning ?? '')
  else if (!state.node.ok)
    qmd = row('warn', 'not installed', `${needsNode}: install node first. Without qmd the Harness searches with grep`, installCommand(machine.windows, 'node'))
  else qmd = row('warn', 'not installed', `Install qmd ${QMD_VERSION} with npm. Without it the Harness searches with grep`, null, [action('qmd-install', 'Install…')])

  const size = formatBytes(modelPlan(profileDocsLanguages(deps.homes)).bytes)
  const download = installed ? [action('qmd-models-download', 'Download…')] : []
  let models: Row
  if (state.answer === 'downloaded') models = row('ok', 'downloaded')
  else if (state.answer === 'skipped') models = row('ok', 'skipped', `Search uses grep; download them any time (${size})`, null, download)
  else
    models = row(
      'warn',
      `not downloaded (${size})`,
      installed ? 'Download them, or skip them and search with grep' : 'Install qmd first to download them, or skip them and search with grep',
      null,
      [...download, action('qmd-models-skip', 'Skip…')],
    )

  return { qmd, models, collections: await collections(deps, installed) }
}

async function collections(deps: CheckDeps, qmdInstalled: boolean): Promise<Row> {
  const projects = await deps.projects()
  const profiled = projects.filter((project) => project.profile !== null)
  if (profiled.length === 0) return row('ok', projects.length === 0 ? 'no connected Projects' : 'no connected Project has a Profile')
  const missing = profiled.filter((project) => project.collections.length === 0)
  if (missing.length === 0) return row('ok', profiled.map((project) => `${project.profile ?? ''}: ${project.collections.length}`).join(', '))
  const script = existsSync(join(deps.homes.harnessHome, 'plugin', 'bin', 'qmd-collections'))
  const needs = [qmdInstalled ? null : 'qmd', script ? null : 'the Harness plugin'].filter((what): what is string => what !== null)
  return row(
    'warn',
    `none for ${missing.map((project) => project.profile ?? project.name).join(', ')}`,
    needs.length === 0 ? 'Set them up: qmd indexes the docs, Tickets and memory of each Project' : `Install ${needs.join(' and ')} first`,
    null,
    needs.length === 0 ? [action('qmd-collections', 'Set up…')] : [],
  )
}

/**
 * Whether the old Harness is in the Claude home: its `bin/epic-status` (what locate.ts calls
 * `legacy`), or anything the move form of ticket 14 would take. The form itself says what it
 * needs first (the plugin of this build) when it cannot move yet. Reads only.
 */
export function oldHarnessPresent(options: Omit<PlanOptions, 'pluginState'>): boolean {
  return existsSync(join(options.claudeHome, 'bin', 'epic-status')) || hasLegacyHarness(options)
}

/** Runs one check; a check that throws is `fail` with the error, so one broken check never hides the others. */
async function guarded(run: () => Promise<Row> | Row): Promise<Row> {
  try {
    return await run()
  } catch (error) {
    return row('fail', 'the check failed', error instanceof Error ? error.message : String(error))
  }
}

/** Every check, in the screen's order. Writes nothing. */
export async function runChecks(deps: CheckDeps): Promise<FirstRunReport> {
  const timeoutMs = deps.toolTimeoutMs ?? TOOL_TIMEOUT_MS
  const platform = deps.system?.platform ?? process.platform
  const system: SystemInfo = { platform, release: osRelease(), arch: (platform === 'win32' ? windowsNativeArch(deps.env) : null) ?? osArch(), ...deps.system }
  const machine: Machine = {
    system,
    probes: { run: (name, args, env, ms, cwd) => runTool(name, args, env, ms, { platform: system.platform, cwd }), exists: fileOrAlias, ...deps.probes },
    windows: system.platform === 'win32',
  }
  // One read of qmd's state feeds its three rows; a failure there fails each of them with the error.
  const qmdAll = qmdRows(deps, machine)
  qmdAll.catch(() => undefined)
  // One read of the installer's state feeds the Harness plugin and its dependencies.
  const harnessStatus = Promise.resolve().then(() => deps.harness())
  harnessStatus.catch(() => undefined)
  // One snapshot of Update feeds "worfy version" and the Harness row; none where Update is off.
  let update: CheckDeps['update']
  try {
    const answer = deps.update?.()
    if (answer?.snapshot.enabled === true) update = () => answer
  } catch (error) {
    // A state that does not read: the row says so, and the Harness row goes by the installer alone.
    update = () => {
      throw error
    }
  }
  const behind = (): HarnessBehind | null => {
    try {
      return update?.().snapshot.harnessBehind ?? null
    } catch {
      return null
    }
  }
  const listed = CHECKS.filter((check) => (machine.windows || check.windows !== true) && (check.id !== 'worfy-update' || update !== undefined))
  const onWindows = (run: () => Promise<Row> | Row): Promise<Row> | null => (machine.windows ? guarded(run) : null)
  const rows: Record<CheckId, Promise<Row> | null> = {
    'claude-login': guarded(() => signIn(deps)),
    'claude-version': guarded(() => claudeVersion(deps, machine, timeoutMs)),
    limits: onWindows(() => limits(deps, machine)),
    windows: onWindows(() => windowsVersion(machine)),
    arch: onWindows(() => architecture(machine)),
    powershell: onWindows(() => powershell(deps, machine)),
    git: guarded(() => tool('git', deps, machine, timeoutMs)),
    'git-identity': guarded(() => gitIdentity(deps, machine, timeoutMs)),
    'git-bash': onWindows(() => gitBash(deps, machine)),
    gh: guarded(() => tool('gh', deps, machine, timeoutMs)),
    node: guarded(() => node(deps, machine, timeoutMs)),
    jq: guarded(() => tool('jq', deps, machine, timeoutMs)),
    'gh-auth': guarded(() => ghAuth(deps, machine, timeoutMs)),
    // Even a row that could not be read stays out of the start rule (spec R9).
    'worfy-update': update === undefined ? null : guarded(() => worfyUpdate(update, machine)).then(noFirstRun),
    harness: guarded(async () => harness(await harnessStatus, behind())),
    'harness-dependencies': guarded(async () => harnessDependencies(await harnessStatus)),
    'harness-scripts': guarded(() => harnessScripts(deps)),
    'legacy-harness': guarded(() => legacyHarness(deps)),
    qmd: guarded(async () => (await qmdAll).qmd),
    'qmd-models': guarded(async () => (await qmdAll).models),
    'qmd-collections': guarded(async () => (await qmdAll).collections),
  }
  const checks = await Promise.all(
    listed.map(async ({ id, group, title }) => ({ id, group, title, ...(await (rows[id] ?? Promise.resolve(row('fail', 'the check did not run')))) })),
  )
  return { checks, checkedAt: new Date().toISOString() }
}
