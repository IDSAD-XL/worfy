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
// - GitHub accounts: `gh auth status`. None signed in is `fail` with the `gh auth login` action,
//   which the user goes through in a Terminal Node.
// - Harness: the installer's state (src/main/harness/install.ts, ticket 13) — not installed fails,
//   another version than this build's warns; both offer Install / Update.
// - Plugin dependencies: the plugins the Harness plugin needs (ticket 30, ADR-0059), from the same
//   state — the same `claude plugin list`, no command of its own. Missing fails and offers the same
//   install action, which then runs the dependency's commands alone; without the Harness plugin's
//   folder nothing was listed, so the row only says when it is checked.
// - Harness scripts: `profile --help`, run as the Epics read runs the Harness scripts — the same
//   runner (harnessScriptRunner) and the environment of src/main/harness/script-env.ts, not the
//   screen's `env` (worfy-harness ticket 37). `--help` reads no registry. A script that cannot run
//   fails with the exit code and what stderr says, and a hint for the cause (no node on the login
//   shell's PATH, a timeout, a crash, a script worfy cannot start): worfy then reads no Epics.
//   Without a Harness, with an old one that has no `profile`, and on Windows, where worfy cannot run
//   the scripts yet (worfy-windows ticket 05), the row warns.
// - Old Harness in ~/.claude: the files of the Q19 list (src/main/harness/migrate/plan.ts, ticket 14);
//   a warning with the move form.
// - qmd, its models, the collections of the connected Projects (src/main/harness/qmd.ts, ticket 17).
//   qmd is optional for worfy itself (search falls back to grep), so these only warn.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountInfoLike } from '../agent/session'
import { DEPENDENCY_MARKETPLACE_SOURCE } from '../harness/install'
import { harnessHomes, locateHarness } from '../harness/locate'
import type { HarnessScriptEnvSource } from '../harness/script-env'
import { environmentExit, harnessScriptRunner, HarnessScriptStartError, HARNESS_SCRIPT_TIMEOUT_MS, NODE_NOT_FOUND, scriptFailureDetail } from '../workflow/profile'
import { hasLegacyHarness, type PlanOptions } from '../harness/migrate/plan'
import { MIN_NODE_MAJOR, modelPlan, NODE_INSTALL_HINT, profileDocsLanguages, QMD_VERSION, qmdState, type QmdHomes } from '../harness/qmd'
import type { HarnessStatus } from '../../shared/ipc/harness'
import type { Check, CheckGroup, CheckId, FirstRunAction, FirstRunReport } from '../../shared/ipc/first-run'

export type Env = Readonly<Record<string, string | undefined>>

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
  /** The platform the checks are for; process.platform by default. */
  platform?: NodeJS.Platform
  /** How long `profile --help` of the Harness scripts row may take; 15 s, as for the Epics read, by default. */
  harnessScriptTimeoutMs?: number
  /** How long a tool or the sign-in may take; 15 s and 60 s by default. */
  toolTimeoutMs?: number
  accountTimeoutMs?: number
}

const TOOL_TIMEOUT_MS = 15_000
/** How long the Claude Code process of the sign-in check may take to answer; then it is closed (askAccount). */
export const ACCOUNT_TIMEOUT_MS = 60_000
/** The check's own limit on accountInfo(), a little later than askAccount's, so the process is closed first. */
const SIGN_IN_GUARD_MS = ACCOUNT_TIMEOUT_MS + 5_000
const MAX_OUTPUT = 256 * 1024

interface ToolRun {
  code: number | null
  stdout: string
  stderr: string
  /** Not on the PATH, or not executable. */
  missing: boolean
}

/** Runs a tool found on the PATH of `env`. Never rejects. */
function runTool(name: string, args: readonly string[], env: Env, timeoutMs: number): Promise<ToolRun> {
  return new Promise((resolve) => {
    execFile(name, [...args], { env: env as NodeJS.ProcessEnv, timeout: timeoutMs, maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr, missing: false })
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') return resolve({ code: null, stdout, stderr, missing: true })
      resolve({ code: typeof code === 'number' ? code : null, stdout, stderr: stderr || error.message, missing: false })
    })
  })
}

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

/** The checks in the order the screen shows them, with their group and title. */
const CHECKS: readonly { id: CheckId; group: CheckGroup; title: string }[] = [
  { id: 'claude-login', group: 'Claude Code', title: 'Sign-in' },
  { id: 'claude-version', group: 'Claude Code', title: 'Claude Code in the terminal' },
  { id: 'git', group: 'Command-line tools', title: 'git' },
  { id: 'gh', group: 'Command-line tools', title: 'gh' },
  { id: 'node', group: 'Command-line tools', title: 'node' },
  { id: 'jq', group: 'Command-line tools', title: 'jq' },
  { id: 'gh-auth', group: 'GitHub', title: 'GitHub accounts' },
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
 * the timeout is closed then, and its late answer or error goes nowhere.
 */
export async function askAccount(open: () => Promise<AccountQuery>, timeoutMs: number): Promise<AccountInfoLike> {
  let query: AccountQuery | null = null
  let closed = false
  let timedOut = false
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
    close()
  }
}

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

async function claudeVersion(deps: CheckDeps, timeoutMs: number): Promise<Row> {
  const bundled = deps.bundledClaudeCodeVersion
  const run = await runTool('claude', ['--version'], deps.env, timeoutMs)
  const builtIn = bundled === null ? 'its own copy' : `its own ${bundled}`
  if (run.missing) {
    // `claude update` needs a `claude` to run: here the line only says to install it.
    return row('warn', 'not found on the PATH of the login shell', `Sessions in worfy still run ${builtIn}; install Claude Code (claude.com/claude-code) to use it in a terminal`)
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

async function tool(name: 'git' | 'gh' | 'jq', deps: CheckDeps, timeoutMs: number): Promise<Row> {
  const run = await runTool(name, ['--version'], deps.env, timeoutMs)
  const install = `brew install ${name}`
  if (run.missing) return row('fail', 'not found on the PATH of the login shell', 'worfy does not install it: run the command in a terminal', install)
  if (run.code !== 0) return row('fail', `${name} --version failed: ${lastLine(run.stderr) || `exit ${String(run.code)}`}`, 'Reinstall it', install)
  return row('ok', firstLine(run.stdout))
}

async function node(deps: CheckDeps, timeoutMs: number): Promise<Row> {
  const run = await runTool('node', ['--version'], deps.env, timeoutMs)
  if (run.missing) return row('fail', 'not found on the PATH of the login shell', `The Harness scripts need node ${MIN_NODE_MAJOR} or newer`, NODE_INSTALL_HINT)
  const found = semver(run.stdout)
  if (run.code !== 0 || found === null) return row('fail', `node --version failed: ${lastLine(run.stderr) || `exit ${String(run.code)}`}`, 'Reinstall it', NODE_INSTALL_HINT)
  const version = found.join('.')
  if (found[0] < MIN_NODE_MAJOR) return row('fail', `${version}, needs ${MIN_NODE_MAJOR} or newer`, `The Harness scripts and qmd need node ${MIN_NODE_MAJOR} or newer`, NODE_INSTALL_HINT)
  return row('ok', version)
}

/** The accounts `gh auth status` names, `host: login`; gh prints them to stdout (2.40+) or stderr (older). */
export function ghAccounts(output: string): string[] {
  const accounts: string[] = []
  for (const match of output.matchAll(/Logged in to (\S+) (?:account|as) ([A-Za-z0-9-]+)/g)) accounts.push(`${match[1] ?? ''}: ${match[2] ?? ''}`)
  return accounts
}

async function ghAuth(deps: CheckDeps, timeoutMs: number): Promise<Row> {
  const run = await runTool('gh', ['auth', 'status'], deps.env, timeoutMs)
  if (run.missing) return row('fail', 'gh is not installed', 'Install gh first (brew install gh), then sign in')
  const accounts = ghAccounts(`${run.stdout}\n${run.stderr}`)
  if (accounts.length > 0) return row('ok', accounts.join(', '))
  return row('fail', 'not signed in to any GitHub host', 'Sign in with gh auth login: you answer its questions yourself', 'gh auth login', [action('gh-login', 'Sign in…')])
}

function harness(status: HarnessStatus): Row {
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
    case 'outdated':
      return row('warn', `${state.from ?? 'unknown version'} → ${state.to}`, `Update it to the Harness of this build${devRun}`, null, install('Update'))
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

/** The hint of the Harness scripts row for each way `profile --help` fails. */
export const HARNESS_SCRIPT_HINTS = {
  node: 'worfy cannot run the Harness scripts, so it reads no Epics: they need node on the PATH of your login shell',
  timeout: 'worfy reads no Epics while the Harness scripts take this long: a busy machine or a slow disk; Check again',
  crash: 'worfy reads no Epics while the Harness scripts fail: install the Harness plugin again, or report what the script says',
  start: 'worfy cannot start the Harness scripts, so it reads no Epics: their files must be readable and executable; install the Harness plugin again',
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
  // Windows cannot start a `#!/usr/bin/env node` script by itself: it has no `#!` lines, and the
  // scripts have no extension it could run them by. Not tried here; worfy-windows ticket 05 decides how.
  if ((deps.platform ?? process.platform) === 'win32') return later('worfy cannot run the Harness scripts on Windows yet (worfy-windows ticket 05)')
  const script = join(location.binDir, 'profile')
  // An old Harness without the script: the Epics are read without a Profile, as the reader does.
  if (!existsSync(script)) return later(`no profile script in ${location.binDir}`)
  const timeoutMs = deps.harnessScriptTimeoutMs ?? HARNESS_SCRIPT_TIMEOUT_MS
  try {
    const run = await harnessScriptRunner(claudeHome, await deps.scriptEnv(), 'profile', timeoutMs)(location.binDir, ['--help'])
    if (run.code === 0) return row('ok', 'profile --help answered')
    const detail = scriptFailureDetail(run.stderr)
    // A signal the runner did not send for the time limit: the script crashed, it was not slow.
    if (run.code === null && run.signal) return row('fail', `profile --help was ended by the signal ${run.signal}${detail ? `: ${detail}` : ''}`, HARNESS_SCRIPT_HINTS.crash)
    if (run.code === null) return row('fail', `profile --help did not answer within ${timeoutMs / 1000} s`, HARNESS_SCRIPT_HINTS.timeout)
    return row('fail', `profile --help: exit code ${run.code}${detail ? `: ${detail}` : ''}`, environmentExit(run.code) ? HARNESS_SCRIPT_HINTS.node : HARNESS_SCRIPT_HINTS.crash)
  } catch (error) {
    // The script runs as `node <script>` (harnessScriptNode): no node on the scripts' PATH is said as such.
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

async function qmdRows(deps: CheckDeps): Promise<QmdRows> {
  const state = await qmdState({ ...deps.homes, env: deps.env })
  const installed = state.qmd !== null

  let qmd: Row
  if (state.version === 'ok') qmd = row('ok', `${QMD_VERSION} (${state.qmd?.path ?? ''})`)
  else if (state.version === 'warn') qmd = row('warn', `${state.qmd?.version ?? 'unknown version'} (${state.qmd?.path ?? ''})`, state.warning ?? '')
  else if (!state.node.ok)
    qmd = row('warn', 'not installed', `qmd needs node ${MIN_NODE_MAJOR} or newer: install node first. Without qmd the Harness searches with grep`, NODE_INSTALL_HINT)
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
  // One read of qmd's state feeds its three rows; a failure there fails each of them with the error.
  const qmdAll = qmdRows(deps)
  qmdAll.catch(() => undefined)
  // One read of the installer's state feeds the Harness plugin and its dependencies.
  const harnessStatus = Promise.resolve().then(() => deps.harness())
  harnessStatus.catch(() => undefined)
  const rows: Record<CheckId, Promise<Row>> = {
    'claude-login': guarded(() => signIn(deps)),
    'claude-version': guarded(() => claudeVersion(deps, timeoutMs)),
    git: guarded(() => tool('git', deps, timeoutMs)),
    gh: guarded(() => tool('gh', deps, timeoutMs)),
    node: guarded(() => node(deps, timeoutMs)),
    jq: guarded(() => tool('jq', deps, timeoutMs)),
    'gh-auth': guarded(() => ghAuth(deps, timeoutMs)),
    harness: guarded(async () => harness(await harnessStatus)),
    'harness-dependencies': guarded(async () => harnessDependencies(await harnessStatus)),
    'harness-scripts': guarded(() => harnessScripts(deps)),
    'legacy-harness': guarded(() => legacyHarness(deps)),
    qmd: guarded(async () => (await qmdAll).qmd),
    'qmd-models': guarded(async () => (await qmdAll).models),
    'qmd-collections': guarded(async () => (await qmdAll).collections),
  }
  const checks = await Promise.all(CHECKS.map(async (check) => ({ ...check, ...(await rows[check.id]) })))
  return { checks, checkedAt: new Date().toISOString() }
}
