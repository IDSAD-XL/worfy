// The installer of the Harness (worfy-harness ticket 13; ADR-0040, ADR-0048): worfy puts the Harness
// copy of its build (bundled.ts) into <harnessHome>/plugin/ and has Claude Code install it from
// there as the plugin `worfy` in the user scope.
//
// The copy is the marketplace and the plugin at once: harness/.claude-plugin/marketplace.json names
// the marketplace `worfy-harness` with the plugin at `./` (ADR-0048, decision 3). The commands are
// ADR-0048's, run with the Claude Code binary of the SDK (ADR-0008), never the user's `claude`:
//
//   first install   claude plugin marketplace add <harnessHome>/plugin
//                   claude plugin install worfy@worfy-harness --scope user
//   another version claude plugin update worfy@worfy-harness --scope user
//   the state       claude plugin list --json
//
// A second `install` does not change the version (ADR-0048), so the version is changed by `update`.
// Reading the state writes nothing: without the plugin folder it runs no command at all. Writing
// happens only after the user agreed (`confirm`). worfy itself writes only <harnessHome>/plugin/
// (through a staging folder next to it, renamed into place, so a failed copy leaves the previous
// one as it was); settings.json and plugins/ are written by `claude plugin` (ADR-0040, decision 7).
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { HarnessState, HarnessStatus, HarnessStep } from '../../shared/ipc/harness'
import { claudeHome } from '../storage/paths'
import { HARNESS_PLUGIN_NAME, locateHarness } from './locate'

/** The marketplace of harness/.claude-plugin/marketplace.json. */
export const HARNESS_MARKETPLACE = 'worfy-harness'
/** The plugin as Claude Code names it: `worfy@worfy-harness`. */
export const HARNESS_PLUGIN_ID = `${HARNESS_PLUGIN_NAME}@${HARNESS_MARKETPLACE}`

/** Lines of a failed command's output kept in the error. */
const TAIL_LINES = 5
const COMMAND_TIMEOUT_MS = 120_000

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
  /** The installed version, or null for a first install. */
  from: string | null
  /** The version of this build. */
  to: string
  /** Whether the folder is replaced by the copy of this build (it carries another version, or none). */
  copy: boolean
  /** Arguments of each `claude` command, in order. */
  commands: string[][]
  /** The plugins the Harness depends on (plugin.json `dependencies`): Claude Code does not install them from an unknown marketplace. */
  dependencies: string[]
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

/** What reading found: the version of the copy and the plugin Claude Code lists. */
interface Facts {
  bundled: string | null
  /** `version` of <pluginDir>/.claude-plugin/plugin.json; undefined when the folder is not there. */
  folder: string | null | undefined
  /** The `worfy@worfy-harness` entry of `plugin list`; null when not listed or when not asked. */
  entry: PluginEntry | null
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

/** The default copy into the (empty) staging folder: the whole tree, modes kept, symlinks as they are. */
const copyWhole = (from: string, to: string): Promise<void> => cp(from, to, { recursive: true, verbatimSymlinks: true })

/** The text of the consent dialog for a plan. */
export function confirmationText(plan: InstallPlan): { button: string; message: string; detail: string } {
  const update = plan.from !== null
  const lines = [
    plan.copy
      ? `worfy copies the Harness of this build to ${plan.pluginDir}, replacing what is there, and runs Claude Code's own commands:`
      : `The Harness of this build is already in ${plan.pluginDir}. worfy runs Claude Code's own commands:`,
    ...plan.commands.map((args) => `  ${commandLine(args)}`),
    '',
    'Claude Code records the plugin in its settings.json and its plugins folder. Nothing else in ~/.claude changes.',
  ]
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
  if (plan.dependencies.length > 0) {
    lines.push(
      '',
      `The Harness needs ${plan.dependencies.join(', ')}. Claude Code does not install it from a marketplace it does not know; if it is missing, install it with:`,
      ...plan.dependencies.map((dep) => `  claude plugin install ${dep}`),
    )
  }
  return {
    button: update ? 'Update' : 'Install',
    message: update ? `Update the worfy Harness ${plan.from ?? ''} → ${plan.to}?` : `Install the worfy Harness ${plan.to}?`,
    detail: lines.join('\n'),
  }
}

export class HarnessInstaller {
  private readonly pluginDir: string
  private running: Promise<{ outcome: InstallOutcome; status: HarnessStatus }> | null = null

  constructor(private readonly options: InstallerOptions) {
    this.pluginDir = join(options.harnessHome, 'plugin')
  }

  /** The state, as the toolbar shows it. Writes nothing; runs `plugin list` only when the plugin folder is there. */
  async status(): Promise<HarnessStatus> {
    let state: HarnessState
    try {
      state = this.stateOf(await this.facts())
    } catch (error) {
      state = this.errorState(error)
    }
    return this.withState(state)
  }

  /**
   * Installs or updates after `confirm` said yes. Without anything to do there is no dialog; with
   * `confirm` saying no nothing is written and `claude` does not run. A second call while one runs
   * gets the same result.
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
      facts = await this.facts()
    } catch (error) {
      return { outcome: 'done', status: this.withState(this.errorState(error)) }
    }
    const plan = this.planOf(facts)
    if (plan === null) return { outcome: 'nothing-to-do', status: this.withState(this.stateOf(facts)) }
    if (!(await confirm(plan))) return { outcome: 'declined', status: this.withState(this.stateOf(facts)) }

    try {
      if (plan.copy) await this.replaceCopy()
      for (const args of plan.commands) await this.claude(args, args[1] === 'marketplace' ? 'marketplace add' : (args[1] as HarnessStep))
    } catch (error) {
      return { outcome: 'done', status: this.withState(this.errorState(error)) }
    }
    return { outcome: 'done', status: await this.status() }
  }

  private withState(state: HarnessState): HarnessStatus {
    return { state, bundledVersion: manifestVersion(this.options.bundledDir), canInstall: this.options.canInstall, pluginDir: this.pluginDir }
  }

  private errorState(error: unknown): HarnessState {
    if (error instanceof StepError) return { kind: 'error', step: error.step, reason: error.message }
    throw error
  }

  private async facts(): Promise<Facts> {
    const bundled = manifestVersion(this.options.bundledDir)
    if (!existsSync(this.pluginDir)) return { bundled, folder: undefined, entry: null }
    return { bundled, folder: manifestVersion(this.pluginDir), entry: await this.listed() }
  }

  /** The `worfy@worfy-harness` entry of `claude plugin list --json`. */
  private async listed(): Promise<PluginEntry | null> {
    const { stdout } = await this.claude(['plugin', 'list', '--json'], 'plugin list')
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      throw new StepError('plugin list', `${commandLine(['plugin', 'list', '--json'])} printed no JSON:\n${tail('', stdout)}`)
    }
    if (!Array.isArray(parsed)) throw new StepError('plugin list', `${commandLine(['plugin', 'list', '--json'])} printed no list`)
    const found = (parsed as unknown[]).find((item) => typeof item === 'object' && item !== null && (item as { id?: unknown }).id === HARNESS_PLUGIN_ID) as
      | { version?: unknown; enabled?: unknown; errors?: unknown }
      | undefined
    if (found === undefined) return null
    return {
      version: typeof found.version === 'string' ? found.version : null,
      enabled: found.enabled !== false,
      errors: Array.isArray(found.errors) ? found.errors.filter((error): error is string => typeof error === 'string') : [],
    }
  }

  private stateOf({ bundled, folder, entry }: Facts): HarnessState {
    if (folder === undefined || entry === null) return { kind: 'not-installed' }
    if (bundled !== null && (entry.version !== bundled || folder !== bundled)) return { kind: 'outdated', from: entry.version, to: bundled }
    // `plugin install` succeeds when a dependency is missing; `plugin list` names it (ticket 13, item 8).
    if (entry.errors.length > 0) return { kind: 'error', step: 'install', reason: entry.errors.join('\n') }
    return { kind: 'installed', version: entry.version ?? folder ?? '', enabled: entry.enabled }
  }

  /** What install() would do; null when the copy and the plugin already carry this build's version. */
  private planOf({ bundled, folder, entry }: Facts): InstallPlan | null {
    if (bundled === null) return null
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
    if (!copy && commands.length === 0) return null
    return {
      pluginDir: this.pluginDir,
      from: entry?.version ?? null,
      to: bundled,
      copy,
      commands,
      dependencies: dependenciesOf(this.options.bundledDir),
      legacyHarness: this.legacyHarness(),
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
   */
  private async replaceCopy(): Promise<void> {
    const { harnessHome, bundledDir } = this.options
    if (manifestVersion(bundledDir) === null) throw new StepError('copy', `this build carries no Harness copy (${bundledDir})`)
    try {
      await mkdir(harnessHome, { recursive: true })
      await this.removeLeftovers()
      const staging = await mkdtemp(join(harnessHome, '.plugin-new-'))
      try {
        await (this.options.copyTree ?? copyWhole)(bundledDir, staging)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
      const old = join(harnessHome, `.plugin-old-${basename(staging).slice('.plugin-new-'.length)}`)
      const hadOld = existsSync(this.pluginDir)
      if (hadOld) await rename(this.pluginDir, old)
      try {
        await rename(staging, this.pluginDir)
      } catch (error) {
        if (hadOld) await rename(old, this.pluginDir)
        await rm(staging, { recursive: true, force: true })
        throw error
      }
      if (hadOld) await rm(old, { recursive: true, force: true })
    } catch (error) {
      throw new StepError('copy', `copying the Harness to ${this.pluginDir} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Folders an interrupted copy left in <harnessHome>. A copy that stopped between its two renames
   * left no plugin/ and the previous copy in `.plugin-old-*`: that copy goes back into place first,
   * so a failure of the copy that follows still leaves it as it was.
   */
  private async removeLeftovers(): Promise<void> {
    const { harnessHome } = this.options
    const setAside = readdirSync(harnessHome).find((name) => name.startsWith('.plugin-old-'))
    if (setAside !== undefined && !existsSync(this.pluginDir)) await rename(join(harnessHome, setAside), this.pluginDir)
    for (const name of readdirSync(harnessHome)) {
      if (name.startsWith('.plugin-new-') || name.startsWith('.plugin-old-')) await rm(join(harnessHome, name), { recursive: true, force: true })
    }
  }

  /** Runs one `claude` command; a missing binary or a non-zero exit is a StepError of `step`. */
  private claude(args: string[], step: HarnessStep): Promise<{ stdout: string; stderr: string }> {
    const { claude, env } = this.options
    if (claude === undefined) return Promise.reject(new StepError(step, `${commandLine(args)}: no Claude Code binary in this build`))
    return new Promise((resolve, reject) => {
      // cwd: a folder without project settings, so `plugin list` shows only what the user scope holds.
      execFile(claude, args, { env, cwd: tmpdir(), timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
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
