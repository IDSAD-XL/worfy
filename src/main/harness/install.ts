// The installer of the Harness (worfy-harness tickets 13 and 30; ADR-0040, ADR-0048, ADR-0059): worfy
// puts the Harness copy of its build (bundled.ts) into <harnessHome>/plugin/ and has Claude Code
// install it from there as the plugin `worfy` in the user scope — and, before that, the plugins
// plugin.json of the copy names as `dependencies`, which Claude Code needs to load `worfy` at all.
//
// The copy is the marketplace and the plugin at once: harness/.claude-plugin/marketplace.json names
// the marketplace `worfy-harness` with the plugin at `./` (ADR-0048, decision 3). The commands are
// ADR-0048's, run with the Claude Code binary of the SDK (ADR-0008), never the user's `claude`:
//
//   a missing dependency  claude plugin marketplace add anthropics/claude-plugins-official   (when not known yet)
//                         claude plugin install <name>@claude-plugins-official --scope user
//   first install         claude plugin marketplace add <harnessHome>/plugin
//                         claude plugin install worfy@worfy-harness --scope user
//   another version       claude plugin update worfy@worfy-harness --scope user
//   the state             claude plugin list --json
//   known marketplaces    claude plugin marketplace list --json                               (install() only)
//
// A second `install` does not change the version (ADR-0048), so the version is changed by `update`.
// Reading the state writes nothing: without the plugin folder it runs no command at all. install()
// reads the two lists before its dialog, also without the folder, so the dialog names exactly what
// will run. Writing happens only after the user agreed (`confirm`). worfy itself writes only
// <harnessHome>/plugin/ (through a staging folder next to it, renamed into place, so a failed copy
// leaves the previous one as it was); settings.json and plugins/ are written by `claude plugin`
// (ADR-0040, decision 7; ADR-0059 adds the official marketplace and the dependency to that).
//
// An install ends installed or not installed, never half way (ADR-0059): the dependency goes first,
// and a failure there leaves no Harness copy and no `worfy`; a first `install` of `worfy` that
// fails but left its record is uninstalled again.
//
// An older build never replaces a newer Harness (worfy-harness ticket 67). The version is
// `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts), and only its semver part has an order.
// The copy in plugin/ and the version Claude Code lists are both checked: they differ after a copy
// whose `plugin update` failed. Without plugin/, a previous copy an interrupted swap set aside counts.
// - either carries a higher semver, or a version that is not a build version: no copy, no command,
//   and the reason in the state (Health) and in the log; putting this build's Harness in place then
//   takes removing that folder by hand, and the dialog then says it installs an older Harness;
// - either is the same semver from another commit: a short SHA has no order, so the install runs
//   only through the consent dialog, which says worfy cannot tell which one is newer (Replace).
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { HarnessDependency, HarnessState, HarnessStatus, HarnessStep } from '../../shared/ipc/harness'
import { programStart } from '../program'
import { claudeHome } from '../storage/paths'
import { HARNESS_PLUGIN_NAME, locateHarness } from './locate'

/** The marketplace of harness/.claude-plugin/marketplace.json. */
export const HARNESS_MARKETPLACE = 'worfy-harness'
/** The plugin as Claude Code names it: `worfy@worfy-harness`. */
export const HARNESS_PLUGIN_ID = `${HARNESS_PLUGIN_NAME}@${HARNESS_MARKETPLACE}`

/**
 * The one marketplace worfy adds for a dependency (ADR-0059): its name, as a dependency of
 * plugin.json carries it after `@`, and the GitHub repository `claude plugin marketplace add` takes.
 * A dependency of any other marketplace is not installed by worfy.
 */
export const DEPENDENCY_MARKETPLACE = 'claude-plugins-official'
export const DEPENDENCY_MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official'

/** Lines of a failed command's output kept in the error. */
const TAIL_LINES = 5
const COMMAND_TIMEOUT_MS = 120_000
/** The limit of a command that downloads (the dependency's marketplace and plugin come from GitHub). */
const DOWNLOAD_TIMEOUT_MS = 600_000

type Env = Readonly<Record<string, string | undefined>>

/**
 * Whether a run may install (ticket 13, item 5): the packaged app, or a run with WORFY_CLAUDE_HOME
 * (a sandbox). A dev run without it would replace the Harness the terminal and the Stable copy work
 * on with the Harness of a worktree, so it only shows the state.
 */
export function installOffered({ packaged, env }: { packaged: boolean; env: Env }): boolean {
  return packaged || Boolean(env.WORFY_CLAUDE_HOME)
}

/**
 * The environment of the `claude` commands. With WORFY_CLAUDE_HOME (a sandbox) Claude Code gets the
 * same folder as CLAUDE_CONFIG_DIR, and HOME inside the sandbox too (its parent when the folder is
 * named `.claude`), so worfy and Claude Code see one ~/.claude and nothing reaches the real one.
 * Without it the user's environment is left as it is.
 */
export function claudeCommandEnv(env: Env): Env {
  if (!env.WORFY_CLAUDE_HOME) return env
  const home = claudeHome(env)
  return { ...env, HOME: basename(home) === '.claude' ? dirname(home) : home, CLAUDE_CONFIG_DIR: home }
}

/** What an install would do; the dialog shows it before anything is written. */
export interface InstallPlan {
  /** <harnessHome>/plugin. */
  pluginDir: string
  /** The version Claude Code lists, or null for a first install. */
  from: string | null
  /**
   * The version of the copy in pluginDir; null when there is none or it names none. It differs from
   * `from` when a copy went in and its `plugin update` failed (ticket 67).
   */
  folder: string | null
  /** The version of this build. */
  to: string
  /** Whether the folder is replaced by the copy of this build (it carries an older or unordered version, or none: refusal()). */
  copy: boolean
  /** The dependencies this install adds: those of plugin.json that Claude Code does not list. */
  dependencies: string[]
  /** Arguments of each `claude` command that installs them, in order; they run first, before the copy. */
  dependencyCommands: string[][]
  /** Arguments of each `claude` command for the plugin `worfy`, in order; they run after the copy. */
  commands: string[][]
  /** `bin/epic-status` of the old Harness in the Claude home when it is still there (ADR-0049, `legacy`); null otherwise. */
  legacyHarness: string | null
}

export interface InstallerOptions {
  /** The Harness copy of this build (bundledHarnessDir()). */
  bundledDir: string
  /** harnessHome(); the copy goes to its plugin/. */
  harnessHome: string
  /** The Claude Code binary to run; undefined when there is none. */
  claude: string | undefined
  /** The environment of every `claude` command. */
  env: Env
  canInstall: boolean
  /** Claude Code's home (claudeHome()), where the old Harness is looked for; without it the dialog does not warn about it. */
  claudeHome?: string
  /** Copies a tree into an empty folder; tests inject a failing one. */
  copyTree?: (from: string, to: string) => Promise<void>
  /** Renames a folder; tests inject one that fails as a file held open on Windows does. */
  renameDir?: (from: string, to: string) => Promise<void>
  /** Removes a folder tree; tests inject one that fails as a file held open on Windows does. */
  removeDir?: (path: string) => Promise<void>
  /** The system the renames and removals are retried for (retriedOnWindows); that of this process by default. */
  platform?: NodeJS.Platform
  /** How long a rename or removal that a held-open file refuses on Windows is tried again; 60 s by default. */
  renameRetryMs?: number
}

/** Errors of a rename on Windows that a file held open causes — an antivirus scan, an editor, a running Claude Code. */
const HELD_OPEN = new Set(['EPERM', 'EBUSY', 'EACCES'])
/** The same for a removal of a tree, where a folder emptied a moment later answers ENOTEMPTY. */
const HELD_OPEN_REMOVE = new Set([...HELD_OPEN, 'ENOTEMPTY'])
/** How long graceful-fs tries a rename again on win32, and its largest pause. */
export const RENAME_RETRY_MS = 60_000
const RENAME_MAX_PAUSE_MS = 100
/**
 * The limit of the retries on a failure path: putting the previous copy back after the new one could
 * not be put in place, and removing the staging folder after a failure (a staging folder left behind
 * is removed by the next install). The rename that failed already waited its own RENAME_RETRY_MS,
 * so the worst failure — the new copy refused, the copy put back, staging refused — takes about
 * 60 + 10 + 10 = 80 s, not 180.
 */
export const ROLLBACK_RETRY_MS = 10_000

const defaultRemove = (path: string): Promise<void> => rm(path, { recursive: true, force: true })

/**
 * Runs `operation`, and on Windows runs it again while it fails with one of `codes` — a file held
 * open — as graceful-fs does for a rename on win32: pauses of 0, 10, 20 … 100 ms, until `retryMs`
 * has passed since the first attempt. Then, and on any other error or system, the error of the last
 * attempt is thrown.
 */
export async function retriedOnWindows(
  operation: () => Promise<void>,
  { platform = process.platform, retryMs = RENAME_RETRY_MS, codes = HELD_OPEN }: { platform?: NodeJS.Platform; retryMs?: number; codes?: ReadonlySet<string> } = {},
): Promise<void> {
  const started = Date.now()
  let pause = 0
  for (;;) {
    try {
      await operation()
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (platform !== 'win32' || code === undefined || !codes.has(code) || Date.now() - started >= retryMs) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, pause))
    pause = Math.min(pause + 10, RENAME_MAX_PAUSE_MS)
  }
}

export type InstallOutcome = 'done' | 'declined' | 'nothing-to-do'

/** A failed step: the state the installer reports for it. */
class StepError extends Error {
  constructor(
    readonly step: HarnessStep,
    reason: string,
  ) {
    super(reason)
  }
}

interface PluginEntry {
  version: string | null
  enabled: boolean
  errors: string[]
}

/** What reading found: the version of the copy, the plugin Claude Code lists, and its dependencies. */
interface Facts {
  bundled: string | null
  /** `version` of <pluginDir>/.claude-plugin/plugin.json; undefined when the folder is not there. */
  folder: string | null | undefined
  /** The `worfy@worfy-harness` entry of `plugin list`; null when not listed or when not asked. */
  entry: PluginEntry | null
  /** A previous copy an interrupted swap set aside (`.plugin-old-*`) when plugin/ is not there: the next copy puts it back first (removeLeftovers). */
  setAside: { dir: string; version: string | null } | null
  /** Each dependency of the build's plugin.json, from the same `plugin list`; `unchecked` when it was not asked. */
  dependencies: HarnessDependency[]
}

/** A plan and, when Claude Code could not say which marketplaces it knows, why: a failed `marketplace add` repeats it. */
interface Planned {
  plan: InstallPlan | null
  marketplacesUnread: string | null
}

/** A Harness version as scripts/build-version.ts stamps it, `<major>.<minor>.<patch>+<short SHA>[.dirty]`; the part after `+` may be missing. */
const HARNESS_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9a-f]{7,}(?:\.dirty)?)?$/

/**
 * How the Harness version of this build stands to an installed one:
 * - `same` — the same string;
 * - `newer` / `older` — the semver part orders them (this build is newer / older);
 * - `unordered` — the same semver from another commit, or one of the two `.dirty`: a short SHA has
 *   no order, so worfy cannot tell which is newer;
 * - `unknown` — either is not a build version.
 */
export type HarnessVersionOrder = 'same' | 'newer' | 'older' | 'unordered' | 'unknown'

export function compareHarnessVersions(build: string, installed: string): HarnessVersionOrder {
  if (build === installed) return 'same'
  const ours = HARNESS_VERSION.exec(build)
  const theirs = HARNESS_VERSION.exec(installed)
  if (ours === null || theirs === null) return 'unknown'
  for (const part of [1, 2, 3]) {
    const difference = Number(ours[part]) - Number(theirs[part])
    if (difference !== 0) return difference > 0 ? 'newer' : 'older'
  }
  return 'unordered'
}

/** The semver part of a build version: `0.3.0` of `0.3.0+abc1234`. */
const semverOf = (version: string): string => version.split('+')[0] ?? version

/**
 * Why two versions of the same semver have no order, as the dialog and Health say it: they come
 * from different commits, or from the same commit with uncommitted changes in one of them (`.dirty`).
 */
export function unorderedWhy(build: string, installed: string | null): string {
  const commit = (version: string): string | undefined => /\+([0-9a-f]+)/.exec(version)?.[1]
  const ours = commit(build)
  const theirs = installed === null ? undefined : commit(installed)
  // Short SHAs of one commit may differ in length: one is the start of the other.
  const sameCommit = ours !== undefined && theirs !== undefined && (ours.startsWith(theirs) || theirs.startsWith(ours))
  return sameCommit ? 'come from the same commit, and one of them carries uncommitted changes' : 'come from different commits'
}

/** The first of the installed versions that is the same semver as `build` from another commit; null when none is. */
function sameVersionOf(build: string, installed: readonly (string | null)[]): string | null {
  return installed.find((version): version is string => version !== null && compareHarnessVersions(build, version) === 'unordered') ?? null
}

/** The installed version to name next to `build`: the first that differs from it; null when none does. */
function shownFrom(build: string, installed: readonly (string | null)[]): string | null {
  return installed.find((version): version is string => version !== null && version !== build) ?? null
}

/** `version` of `<dir>/.claude-plugin/plugin.json`; null when the file or the field is unreadable. */
function manifestVersion(dir: string): string | null {
  const manifest = readManifest(dir)
  return typeof manifest?.version === 'string' && manifest.version !== '' ? manifest.version : null
}

function readManifest(dir: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `name@marketplace` of each dependency in plugin.json (a string or `{ name, marketplace }`). */
function dependenciesOf(dir: string): string[] {
  const deps = readManifest(dir)?.dependencies
  if (!Array.isArray(deps)) return []
  return deps.flatMap((dep: unknown) => {
    if (typeof dep === 'string') return [dep]
    if (typeof dep === 'object' && dep !== null) {
      const { name, marketplace } = dep as { name?: unknown; marketplace?: unknown }
      if (typeof name === 'string') return [typeof marketplace === 'string' ? `${name}@${marketplace}` : name]
    }
    return []
  })
}

/** The last lines of a command's output: stderr, or stdout when stderr is empty. */
function tail(stderr: string, stdout: string): string {
  const text = stderr.trim() === '' ? stdout : stderr
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
  return lines.slice(-TAIL_LINES).join('\n')
}

const commandLine = (args: readonly string[]): string => `claude ${args.join(' ')}`

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The marketplace a dependency names after `@`; null when it names none. */
function marketplaceOf(dependency: string): string | null {
  const at = dependency.lastIndexOf('@')
  return at > 0 && at < dependency.length - 1 ? dependency.slice(at + 1) : null
}

/** "it" for one, "them" for several. */
const pronoun = (items: readonly unknown[]): string => (items.length === 1 ? 'it' : 'them')

/** The default copy into the (empty) staging folder: the whole tree, modes kept, symlinks as they are. */
const copyWhole = (from: string, to: string): Promise<void> => cp(from, to, { recursive: true, verbatimSymlinks: true })

/** The text of the consent dialog for a plan: every command worfy will run, in the order it runs them. */
export function confirmationText(plan: InstallPlan): { button: string; message: string; detail: string } {
  const update = plan.from !== null
  // worfy is installed with this build's version and only a dependency is missing.
  const onlyDependencies = !plan.copy && plan.commands.length === 0 && plan.dependencyCommands.length > 0
  const lines: string[] = []
  if (plan.dependencyCommands.length > 0) {
    const names = plan.dependencies.join(', ')
    const it = pronoun(plan.dependencies)
    const addsMarketplace = plan.dependencyCommands.some((args) => args[1] === 'marketplace')
    lines.push(
      `The Harness needs ${names}. worfy ${onlyDependencies ? '' : 'first '}runs Claude Code's own commands to install ${it}:`,
      ...plan.dependencyCommands.map((args) => `  ${commandLine(args)}`),
      '',
      `Claude Code downloads ${it} from GitHub (${DEPENDENCY_MARKETPLACE_SOURCE}) and records ${addsMarketplace ? `the marketplace ${DEPENDENCY_MARKETPLACE} and the plugin` : 'the plugin'} in its settings.json and its plugins folder.`,
      '',
    )
  }
  if (onlyDependencies) {
    lines.push(`The Harness of this build (${plan.to}) is already installed from ${plan.pluginDir}. Nothing else in ~/.claude changes.`)
  } else {
    const then = plan.dependencyCommands.length > 0 ? 'Then ' : ''
    lines.push(
      plan.copy
        ? `${then}worfy copies the Harness of this build to ${plan.pluginDir}, replacing what is there, and runs Claude Code's own commands:`
        : `${then === '' ? 'The' : 'Then, as the'} Harness of this build is already in ${plan.pluginDir}${then === '' ? '. worfy' : ', worfy'} runs Claude Code's own commands:`,
      ...plan.commands.map((args) => `  ${commandLine(args)}`),
      '',
      'Claude Code records the plugin in its settings.json and its plugins folder. Nothing else in ~/.claude changes.',
    )
  }
  if (plan.copy) {
    lines.push(
      '',
      'Claude Code loads the plugin straight from this folder: Claude Code sessions already running in a terminal see the files change under them. Restart them afterwards.',
    )
  }
  if (plan.legacyHarness !== null) {
    lines.push(
      '',
      `The old Harness is still in ~/.claude (${plan.legacyHarness}, its hooks in settings.json). Until it is moved out, Claude Code sessions in a terminal run its hooks and the plugin's both.`,
    )
  }
  if (onlyDependencies) {
    return { button: 'Install', message: `Install ${plan.dependencies.join(', ')} for the worfy Harness?`, detail: lines.join('\n') }
  }
  // The copy in the folder and the version Claude Code lists both count: they differ after a failed `plugin update`.
  const installed = [plan.folder, plan.from]
  const same = sameVersionOf(plan.to, installed)
  if (same !== null) {
    // No "Update A → B": the version does not say that B is the newer one.
    lines.unshift(
      `Both carry version ${semverOf(plan.to)} and ${unorderedWhy(plan.to, same)}: worfy cannot tell which of them is newer. Replace the installed Harness only if this build is the newer one; otherwise Cancel and open the worfy build that installed ${same}.`,
      '',
    )
    return { button: 'Replace', message: `Replace the worfy Harness ${same} with ${plan.to}?`, detail: lines.join('\n') }
  }
  const from = shownFrom(plan.to, installed)
  // Only without the folder (refusal() stops the rest): whoever removed it chose this build's older Harness.
  const order = from === null ? null : compareHarnessVersions(plan.to, from)
  if (from !== null && (order === 'older' || order === 'unknown')) {
    return { button: 'Install', message: `Install this build's ${order === 'older' ? 'older ' : ''}Harness ${plan.to} in place of ${from}?`, detail: lines.join('\n') }
  }
  return {
    button: update ? 'Update' : 'Install',
    message: update ? `Update the worfy Harness ${from ?? ''} → ${plan.to}?` : `Install the worfy Harness ${plan.to}?`,
    detail: lines.join('\n'),
  }
}

export class HarnessInstaller {
  private readonly pluginDir: string
  private running: Promise<{ outcome: InstallOutcome; status: HarnessStatus }> | null = null
  /** The refusal the state last logged: a state read again logs it once, an install every time. */
  private loggedRefusal: string | null = null

  constructor(private readonly options: InstallerOptions) {
    this.pluginDir = join(options.harnessHome, 'plugin')
  }

  /** The state, as the toolbar shows it. Writes nothing; runs `plugin list` only when the plugin folder is there. */
  async status(): Promise<HarnessStatus> {
    let facts: Facts
    try {
      facts = await this.facts(false)
    } catch (error) {
      return this.withState(this.errorState(error), this.unchecked())
    }
    return this.withState(this.stateOf(facts), facts.dependencies)
  }

  /**
   * Installs or updates after `confirm` said yes. Without anything to do there is no dialog; with
   * `confirm` saying no nothing is written and `claude` ran only its two reads (`plugin list`,
   * `plugin marketplace list`). A second call while one runs gets the same result.
   */
  install(confirm: (plan: InstallPlan) => Promise<boolean>): Promise<{ outcome: InstallOutcome; status: HarnessStatus }> {
    if (!this.options.canInstall) {
      return Promise.reject(new Error('a dev run does not install the Harness: start the packaged app, or set WORFY_CLAUDE_HOME to a sandbox'))
    }
    this.running ??= this.runInstall(confirm).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runInstall(confirm: (plan: InstallPlan) => Promise<boolean>): Promise<{ outcome: InstallOutcome; status: HarnessStatus }> {
    let facts: Facts
    try {
      // Also without the plugin folder: what is installed already decides what the dialog names.
      facts = await this.facts(true)
    } catch (error) {
      return { outcome: 'done', status: this.withState(this.errorState(error), this.unchecked()) }
    }
    let planned: Planned
    try {
      planned = await this.planOf(facts)
    } catch (error) {
      return { outcome: 'done', status: this.withState(this.errorState(error), facts.dependencies) }
    }
    const { plan, marketplacesUnread } = planned
    if (plan === null) return { outcome: 'nothing-to-do', status: this.withState(this.stateOf(facts), facts.dependencies) }
    if (!(await confirm(plan))) return { outcome: 'declined', status: this.withState(this.stateOf(facts), facts.dependencies) }

    // What the commands that ran so far left of the dependencies, for the status of a failed run.
    let dependencies = facts.dependencies
    try {
      // The dependency first: when it fails there is no Harness copy and no `worfy` to be half installed.
      for (const args of plan.dependencyCommands) {
        if (args[1] === 'marketplace') await this.addDependencyMarketplace(args, marketplacesUnread)
        else {
          await this.claude(args, 'dependency install', DOWNLOAD_TIMEOUT_MS)
          dependencies = dependencies.map((each) => (each.id === args[2] ? { ...each, status: 'installed' } : each))
        }
      }
      if (plan.copy) await this.replaceCopy()
      for (const args of plan.commands) await this.harnessCommand(args)
    } catch (error) {
      return { outcome: 'done', status: this.withState(this.errorState(error), dependencies) }
    }
    return { outcome: 'done', status: await this.status() }
  }

  /**
   * `marketplace add` of the dependency's marketplace. An answer that it is already there is not a
   * failure, whatever its exit code: the plan adds it whenever Claude Code could not say which
   * marketplaces it knows.
   */
  private async addDependencyMarketplace(args: string[], marketplacesUnread: string | null): Promise<void> {
    try {
      await this.claude(args, 'dependency marketplace add', DOWNLOAD_TIMEOUT_MS)
    } catch (error) {
      if (!(error instanceof StepError)) throw error
      if (/\balready\b/i.test(error.message)) return
      throw new StepError(error.step, marketplacesUnread === null ? error.message : `${error.message}\n${marketplacesUnread}`)
    }
  }

  /**
   * One command for the plugin `worfy`. `install` is planned only when Claude Code does not list the
   * plugin, and one that fails may have recorded it all the same (the acceptance run of ticket 26
   * saw it listed and enabled after a refusal): the list is read again and the record removed, so
   * the failure leaves `worfy` not installed. A failed `update` removes nothing: the version that
   * was installed stays.
   */
  private async harnessCommand(args: string[]): Promise<void> {
    const step: HarnessStep = args[1] === 'marketplace' ? 'marketplace add' : (args[1] as HarnessStep)
    try {
      await this.claude(args, step)
    } catch (error) {
      if (!(error instanceof StepError) || step !== 'install') throw error
      let recorded: boolean
      try {
        recorded = (await this.listed()).has(HARNESS_PLUGIN_ID)
      } catch (listError) {
        throw new StepError('install', `${error.message}\nworfy could not check whether Claude Code recorded the plugin all the same:\n${messageOf(listError)}`)
      }
      if (!recorded) throw error
      const uninstall = ['plugin', 'uninstall', HARNESS_PLUGIN_ID, '--scope', 'user']
      try {
        await this.claude(uninstall, 'uninstall')
      } catch (uninstallError) {
        throw new StepError('uninstall', `${error.message}\nClaude Code recorded the plugin all the same, and removing the record failed:\n${messageOf(uninstallError)}`)
      }
      throw new StepError('install', `${error.message}\nClaude Code recorded the plugin all the same; worfy removed the record (${commandLine(uninstall)}).`)
    }
  }

  private withState(state: HarnessState, dependencies: HarnessDependency[]): HarnessStatus {
    return { state, bundledVersion: manifestVersion(this.options.bundledDir), canInstall: this.options.canInstall, pluginDir: this.pluginDir, dependencies }
  }

  private errorState(error: unknown): HarnessState {
    if (error instanceof StepError) return { kind: 'error', step: error.step, reason: error.message }
    throw error
  }

  /** The dependencies of the build's plugin.json, none of them looked up. */
  private unchecked(): HarnessDependency[] {
    return dependenciesOf(this.options.bundledDir).map((id) => ({ id, status: 'unchecked', version: null }))
  }

  /** Reads what is there. `always` — run `plugin list` also without the plugin folder (install(), before its dialog). */
  private async facts(always: boolean): Promise<Facts> {
    const bundled = manifestVersion(this.options.bundledDir)
    const folder = existsSync(this.pluginDir) ? manifestVersion(this.pluginDir) : undefined
    const setAside = folder === undefined ? this.setAside() : null
    if (folder === undefined && !always) return { bundled, folder, entry: null, setAside, dependencies: this.unchecked() }
    const list = await this.listed()
    const dependencies = dependenciesOf(this.options.bundledDir).map((id): HarnessDependency => {
      // A dependency named without a marketplace is installed when any marketplace's plugin of that name is.
      const found = marketplaceOf(id) === null ? [...list].find(([listed]) => listed.startsWith(`${id}@`))?.[1] : list.get(id)
      return found === undefined ? { id, status: 'missing', version: null } : { id, status: 'installed', version: found.version }
    })
    return { bundled, folder, entry: list.get(HARNESS_PLUGIN_ID) ?? null, setAside, dependencies }
  }

  /** The `.plugin-old-*` folder removeLeftovers would put back into place, with its version. */
  private setAside(): Facts['setAside'] {
    const { harnessHome } = this.options
    if (!existsSync(harnessHome)) return null
    const name = readdirSync(harnessHome).find((each) => each.startsWith('.plugin-old-'))
    if (name === undefined) return null
    const dir = join(harnessHome, name)
    return { dir, version: manifestVersion(dir) }
  }

  /** Every plugin of `claude plugin list --json`, by its id (`name@marketplace`). */
  private async listed(): Promise<Map<string, PluginEntry>> {
    const args = ['plugin', 'list', '--json']
    const { stdout } = await this.claude(args, 'plugin list')
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      throw new StepError('plugin list', `${commandLine(args)} printed no JSON:\n${tail('', stdout)}`)
    }
    if (!Array.isArray(parsed)) throw new StepError('plugin list', `${commandLine(args)} printed no list`)
    const plugins = new Map<string, PluginEntry>()
    for (const item of parsed as unknown[]) {
      if (typeof item !== 'object' || item === null) continue
      const { id, version, enabled, errors } = item as { id?: unknown; version?: unknown; enabled?: unknown; errors?: unknown }
      if (typeof id !== 'string') continue
      plugins.set(id, {
        version: typeof version === 'string' ? version : null,
        enabled: enabled !== false,
        errors: Array.isArray(errors) ? errors.filter((error): error is string => typeof error === 'string') : [],
      })
    }
    return plugins
  }

  /**
   * Whether Claude Code knows the dependency's marketplace, by `claude plugin marketplace list
   * --json`: a list of entries with `name`. A Claude Code without that command, or with another
   * answer, cannot say: `unread` then tells why, and the plan adds the marketplace anyway.
   */
  private async dependencyMarketplaceKnown(): Promise<{ known: boolean; unread: string | null }> {
    const args = ['plugin', 'marketplace', 'list', '--json']
    const cannotTell = (why: string): { known: boolean; unread: string } => ({
      known: false,
      unread: `worfy could not tell whether Claude Code already knows the marketplace ${DEPENDENCY_MARKETPLACE}: ${why}`,
    })
    let stdout: string
    try {
      // A read; its failure is not a step of the install, so the step named here never reaches a state.
      ;({ stdout } = await this.claude(args, 'dependency marketplace add'))
    } catch (error) {
      return cannotTell(messageOf(error))
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      return cannotTell(`${commandLine(args)} printed no JSON`)
    }
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string')) {
      return cannotTell(`${commandLine(args)} printed no list of marketplaces with names`)
    }
    return { known: (parsed as { name: string }[]).some(({ name }) => name === DEPENDENCY_MARKETPLACE), unread: null }
  }

  /**
   * Why worfy does not replace the Harness in <harnessHome>/plugin with this build's: the copy or
   * the plugin Claude Code lists carries a newer semver, or a version that is not a build version
   * (compareHarnessVersions). The two can differ: a copy went in and its `plugin update` failed.
   * Without plugin/ the previous copy an interrupted swap set aside counts, as the copy puts it back
   * first; without either there is nothing to refuse: whoever removed the folder chose to replace it.
   * One line, as Health shows the last line of a reason.
   */
  private refusal({ bundled, folder, entry, setAside }: Pick<Facts, 'bundled' | 'folder' | 'entry' | 'setAside'>): string | null {
    if (bundled === null) return null
    const sources: { version: string | null; dir: string }[] =
      folder !== undefined
        ? [
            { version: folder, dir: this.pluginDir },
            { version: entry?.version ?? null, dir: this.pluginDir },
          ]
        : setAside !== null
          ? [setAside]
          : []
    for (const { version, dir } of sources) {
      if (version === null) continue
      const order = compareHarnessVersions(bundled, version)
      if (order !== 'older' && order !== 'unknown') continue
      const why = order === 'older' ? `the installed Harness ${version} is newer than this build's ${bundled}` : `worfy cannot compare the installed Harness version "${version}" with this build's ${bundled}`
      return `${why}, so worfy does not replace it: open the worfy build that installed it instead, or, to put this build's Harness in place all the same, remove ${dir}, then Install`
    }
    return null
  }

  private logRefusal(reason: string, again: boolean): void {
    if (!again && reason === this.loggedRefusal) return
    this.loggedRefusal = reason
    console.warn(`[harness] ${reason}`)
  }

  private stateOf(facts: Facts): HarnessState {
    const { bundled, folder, entry, dependencies } = facts
    const refusal = this.refusal(facts)
    if (refusal !== null) {
      this.logRefusal(refusal, false)
      return { kind: 'error', step: 'copy', reason: refusal }
    }
    if (folder === undefined || entry === null) return { kind: 'not-installed' }
    if (bundled !== null && (entry.version !== bundled || folder !== bundled)) {
      const installed = [folder, entry.version]
      return { kind: 'outdated', from: shownFrom(bundled, installed) ?? entry.version, to: bundled, sameVersion: sameVersionOf(bundled, installed) !== null }
    }
    // `plugin install` succeeds when a dependency is missing, and Claude Code then loads nothing of
    // the plugin (ticket 13, item 8; ticket 30): an error, and install() has a plan for it.
    const missing = dependencies.filter((each) => each.status === 'missing').map((each) => each.id)
    if (missing.length > 0) {
      const reason = `the Harness needs ${missing.join(', ')}, and Claude Code does not list ${pronoun(missing)} as installed`
      return { kind: 'error', step: 'dependency install', reason: [reason, ...entry.errors].join('\n') }
    }
    if (entry.errors.length > 0) return { kind: 'error', step: 'install', reason: entry.errors.join('\n') }
    return { kind: 'installed', version: entry.version ?? folder ?? '', enabled: entry.enabled }
  }

  /**
   * What install() would do; a null plan when the copy, the plugin and its dependencies are all
   * there with this build's version. Reads which marketplaces Claude Code knows when a dependency
   * is missing; a missing dependency worfy does not install is a StepError naming it.
   */
  private async planOf(facts: Facts): Promise<Planned> {
    const { bundled, folder, entry, dependencies } = facts
    if (bundled === null) return { plan: null, marketplacesUnread: null }
    // Before the dependencies too: nothing of an older build goes over a newer Harness.
    const refusal = this.refusal(facts)
    if (refusal !== null) {
      this.logRefusal(refusal, true)
      throw new StepError('copy', refusal)
    }
    const missing = dependencies.filter((each) => each.status === 'missing').map((each) => each.id)
    const foreign = missing.filter((id) => marketplaceOf(id) !== DEPENDENCY_MARKETPLACE)
    if (foreign.length > 0) {
      throw new StepError(
        'dependency install',
        `the Harness needs ${foreign.join(', ')}, and worfy installs dependencies only from the marketplace ${DEPENDENCY_MARKETPLACE}: install ${pronoun(foreign)} in Claude Code yourself, then try again`,
      )
    }
    const dependencyCommands: string[][] = []
    let marketplacesUnread: string | null = null
    if (missing.length > 0) {
      const { known, unread } = await this.dependencyMarketplaceKnown()
      marketplacesUnread = unread
      if (!known) dependencyCommands.push(['plugin', 'marketplace', 'add', DEPENDENCY_MARKETPLACE_SOURCE])
      for (const id of missing) dependencyCommands.push(['plugin', 'install', id, '--scope', 'user'])
    }
    const copy = folder !== bundled
    let commands: string[][] = []
    if (entry === null) {
      commands = [
        ['plugin', 'marketplace', 'add', this.pluginDir],
        ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
      ]
    } else if (entry.version !== bundled) {
      commands = [['plugin', 'update', HARNESS_PLUGIN_ID, '--scope', 'user']]
    }
    if (!copy && commands.length === 0 && dependencyCommands.length === 0) return { plan: null, marketplacesUnread }
    return {
      plan: {
        pluginDir: this.pluginDir,
        from: entry?.version ?? null,
        folder: folder ?? null,
        to: bundled,
        copy,
        dependencies: missing,
        dependencyCommands,
        commands,
        legacyHarness: this.legacyHarness(),
      },
      marketplacesUnread,
    }
  }

  /** `bin/epic-status` of the old Harness when it is still in the Claude home (locate.ts, ADR-0049). */
  private legacyHarness(): string | null {
    const { claudeHome: home, harnessHome } = this.options
    if (home === undefined) return null
    const location = locateHarness({ claudeHome: home, harnessHome })
    return location.kind === 'legacy' ? location.checked[0] : null
  }

  /**
   * Replaces <harnessHome>/plugin with the copy of this build: the copy goes into a staging folder
   * next to it, then the old folder is renamed away and the staging folder into place. A failed
   * copy leaves the old folder untouched; files the new version dropped are gone with the old one.
   *
   * On Windows a rename or removal that a held-open file refuses (EPERM, EBUSY) is tried again for a
   * while (retriedOnWindows, worfy-windows ticket 13):
   * - the old folder cannot be set aside: the step `copy` fails, the old folder is where it was;
   * - the new copy cannot be put in place: the old folder is renamed back first (for at most
   *   ROLLBACK_RETRY_MS more), so plugin/ is missing no longer than needed, then the staging folder
   *   goes, and the step `copy` fails with the first error. When that rename back fails too, the
   *   message says so and the previous copy stays in `.plugin-old-*`, which the next install puts
   *   back first (removeLeftovers);
   * - on every failure path the staging folder is removed with retries of at most ROLLBACK_RETRY_MS:
   *   the worst failure takes about 80 s;
   * - the old folder cannot be removed after the swap: the new copy is in place, so the install goes
   *   on; the folder is left with a warning and removed by the next install.
   */
  private async replaceCopy(): Promise<void> {
    const { harnessHome, bundledDir } = this.options
    if (manifestVersion(bundledDir) === null) throw new StepError('copy', `this build carries no Harness copy (${bundledDir})`)
    try {
      await mkdir(harnessHome, { recursive: true })
      await this.removeLeftovers()
    } catch (error) {
      throw new StepError('copy', `copying the Harness to ${this.pluginDir} failed: ${messageOf(error)}`)
    }
    // removeLeftovers may have put back a copy set aside after the plan was made: checked again (ticket 67).
    const restored = existsSync(this.pluginDir) ? manifestVersion(this.pluginDir) : undefined
    const refusal = this.refusal({ bundled: manifestVersion(bundledDir), folder: restored, entry: null, setAside: null })
    if (refusal !== null) {
      this.logRefusal(refusal, true)
      throw new StepError('copy', refusal)
    }
    try {
      const staging = await mkdtemp(join(harnessHome, '.plugin-new-'))
      try {
        await (this.options.copyTree ?? copyWhole)(bundledDir, staging)
      } catch (error) {
        await this.removeQuietly(staging, this.failureRetryMs())
        throw error
      }
      const old = join(harnessHome, `.plugin-old-${basename(staging).slice('.plugin-new-'.length)}`)
      const hadOld = existsSync(this.pluginDir)
      if (hadOld) {
        try {
          await this.renameDir(this.pluginDir, old)
        } catch (error) {
          // Nothing moved: the previous copy is in place; only the staging folder goes.
          await this.removeQuietly(staging, this.failureRetryMs())
          throw error
        }
      }
      try {
        await this.renameDir(staging, this.pluginDir)
      } catch (error) {
        if (!hadOld) {
          await this.removeQuietly(staging, this.failureRetryMs())
          throw error
        }
        // The previous copy goes back before anything else, as on main: no plugin/ for as short as possible.
        try {
          await this.renameDir(old, this.pluginDir, this.failureRetryMs())
        } catch (rollback) {
          await this.removeQuietly(staging, this.failureRetryMs())
          throw new Error(`${messageOf(error)}; putting the previous copy back failed too (${messageOf(rollback)}): it is in ${old}, and the next install puts it back first`, {
            cause: rollback,
          })
        }
        await this.removeQuietly(staging, this.failureRetryMs())
        throw error
      }
      // The new copy is in place: a previous copy that cannot be removed now is removed by the next install.
      if (hadOld) await this.removeQuietly(old)
    } catch (error) {
      throw new StepError('copy', `copying the Harness to ${this.pluginDir} failed: ${messageOf(error)}`)
    }
  }

  /**
   * Folders an interrupted copy left in <harnessHome>. A copy that stopped between its two renames
   * left no plugin/ and the previous copy in `.plugin-old-*`: that copy goes back into place first,
   * so a failure of the copy that follows still leaves it as it was. A folder that cannot be put
   * back or removed, even after the retries on Windows, is skipped with a warning: it never fails
   * the install, and a previous copy that could not be put back is not removed either.
   */
  private async removeLeftovers(): Promise<void> {
    const { harnessHome } = this.options
    let kept: string | null = null
    const setAside = readdirSync(harnessHome).find((name) => name.startsWith('.plugin-old-'))
    if (setAside !== undefined && !existsSync(this.pluginDir)) {
      try {
        await this.renameDir(join(harnessHome, setAside), this.pluginDir)
      } catch (error) {
        kept = setAside
        console.warn(`[harness] could not put the previous copy ${join(harnessHome, setAside)} back: ${messageOf(error)}`)
      }
    }
    for (const name of readdirSync(harnessHome)) {
      if (name === kept || !(name.startsWith('.plugin-new-') || name.startsWith('.plugin-old-'))) continue
      await this.removeQuietly(join(harnessHome, name))
    }
  }

  /** A rename of the plugin folders, tried again on Windows while a held-open file refuses it. */
  private renameDir(from: string, to: string, retryMs = this.options.renameRetryMs): Promise<void> {
    const { platform, renameDir = rename } = this.options
    return retriedOnWindows(() => renameDir(from, to), { ...(platform === undefined ? {} : { platform }), ...(retryMs === undefined ? {} : { retryMs }) })
  }

  /** The retry limit on a failure path: ROLLBACK_RETRY_MS, or the configured limit when it is shorter. */
  private failureRetryMs(): number {
    return Math.min(this.options.renameRetryMs ?? RENAME_RETRY_MS, ROLLBACK_RETRY_MS)
  }

  /** Removes a folder tree, tried again on Windows like a rename; a folder that still cannot go is left with a warning. */
  private async removeQuietly(path: string, retryMs = this.options.renameRetryMs): Promise<void> {
    const { platform, removeDir = defaultRemove } = this.options
    try {
      await retriedOnWindows(() => removeDir(path), {
        codes: HELD_OPEN_REMOVE,
        ...(platform === undefined ? {} : { platform }),
        ...(retryMs === undefined ? {} : { retryMs }),
      })
    } catch (error) {
      console.warn(`[harness] left ${path}: ${messageOf(error)}; the next install removes it`)
    }
  }

  /** Runs one `claude` command; a missing binary or a non-zero exit is a StepError of `step`. */
  private claude(args: string[], step: HarnessStep, timeout = COMMAND_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
    const { claude, env } = this.options
    if (claude === undefined) return Promise.reject(new StepError(step, `${commandLine(args)}: no Claude Code binary in this build`))
    // A `.mjs` (a stand-in in tests, WORFY_CLAUDE) runs under worfy's own Node (src/main/program.ts);
    // the system cannot say it is missing, Node would.
    const start = programStart(claude, claude)
    const [script] = start.args
    if (script !== undefined && !existsSync(script)) return Promise.reject(new StepError(step, `${commandLine(args)}: Claude Code not found at ${claude} (ENOENT)`))
    return new Promise((resolve, reject) => {
      // cwd: a folder without project settings, so `plugin list` shows only what the user scope holds.
      execFile(start.file, [...start.args, ...args], { env: { ...env, ...start.env }, cwd: tmpdir(), timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES') {
          reject(new StepError(step, `${commandLine(args)}: Claude Code not found at ${claude} (${code})`))
          return
        }
        const exit = typeof code === 'number' ? `exited with ${String(code)}` : error.killed ? 'was stopped (timeout)' : `failed (${error.message.split('\n')[0] ?? ''})`
        const output = tail(stderr, stdout)
        reject(new StepError(step, `${commandLine(args)} ${exit}${output === '' ? '' : `:\n${output}`}`))
      })
    })
  }
}
