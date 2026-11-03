// Install Harness in Codex (worfy-multi-vendor ticket 35, decision 08). Codex reads plugins of
// Claude Code's format, so the Harness copy the Claude installer keeps in <harnessHome>/plugin/
// (install.ts, ADR-0040) is installed into Codex as well, from the same folder, with the commands of
// the Codex this build pins (binary.ts, ticket 17), never the user's own `codex`:
//
//   the dependency     codex plugin marketplace add anthropics/claude-plugins-official   (when not known yet)
//                      codex plugin add mattpocock-skills@claude-plugins-official
//   first install      codex plugin marketplace add <harnessHome>/plugin                  (when not known yet)
//                      codex plugin add worfy@worfy-harness
//   another version    codex plugin add worfy@worfy-harness
//   the state          codex plugin list --json
//   known marketplaces codex plugin marketplace list --json                              (install only)
//
// Codex has no dependencies between plugins, so the plugins plugin.json names as `dependencies` are
// installed as plugins of their own, with the same skills as in Claude Code (owner, Q5). Another
// version is installed with `plugin add` again: `codex plugin marketplace upgrade` refreshes only Git
// marketplaces (its help text in the pinned 0.166.0), and the local marketplace is the folder
// itself, which the Claude install has already replaced.
//
// The agents: worfy-implementer, worfy-reviewer, worfy-scout as TOML files in <CODEX_HOME>/agents/
// only (codex-agents.ts). Codex turns the hooks of a plugin off after every install or update until
// the user approves them in Codex (`/hooks`); the status says so (`hooksToApprove`), and ticket 39
// adds the step itself.
//
// Codex counts as there when this build has its binary and CODEX_HOME exists (Codex ran and signed
// in on this machine): without either nothing here runs, and nothing is written. worfy writes only
// the agent files and its own record in its data folder (ADR-0005); the plugins and Codex's config
// are written by `codex plugin`.
//
// The version: the one `codex plugin list --json` names for worfy@worfy-harness. A plugin of a local
// marketplace may be listed without a version of its own (`local`); then the version worfy recorded
// after its last install into Codex stands for it, so an update runs once, not on every Install.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CodexHarness as CodexHarnessStatus, CodexHarnessState, CodexHarnessStep } from '../../shared/ipc/harness'
import { codexExecutablePath, type CodexPackageResolver, type CodexRuntime } from '../vendors/codex/binary'
import { CODEX_ABSENT } from '../vendors/codex/launch'
import { codexAgentFiles, codexAgentsDrift, writeCodexAgents } from './codex-agents'
import { compareHarnessVersions, DEPENDENCY_MARKETPLACE, DEPENDENCY_MARKETPLACE_SOURCE, DOWNLOAD_TIMEOUT_MS, HARNESS_MARKETPLACE, HARNESS_PLUGIN_ID, runTool, type Tool } from './install'

type Env = Readonly<Record<string, string | undefined>>

/**
 * The Codex binary of the install commands: WORFY_CODEX_CLI when set (tests point it at a stand-in),
 * else the binary this build pins. None under WORFY_CODEX=fake or absent (the fake app-server has no
 * `plugin` commands) and none under vitest, so no test reaches the real Codex.
 */
export function codexInstallBinary(env: Env, runtime: CodexRuntime, resolvePackage?: CodexPackageResolver, exists: (path: string) => boolean = existsSync): string | undefined {
  if (env.WORFY_CODEX_CLI) return env.WORFY_CODEX_CLI
  if (env.WORFY_CODEX === 'fake' || env.WORFY_CODEX === CODEX_ABSENT || env.VITEST || process.env.VITEST) return undefined
  const file = codexExecutablePath(runtime, resolvePackage)
  return file !== undefined && exists(file) ? file : undefined
}

/** A failed step of the Codex install: the state the status reports for it. */
export class CodexStepError extends Error {
  constructor(
    readonly step: CodexHarnessStep,
    reason: string,
  ) {
    super(reason)
  }
}

/** What an install into Codex would do; the consent dialog names it with the Claude Code part. */
export interface CodexPlan {
  /** The version Codex lists for worfy@worfy-harness (or worfy recorded); null when it is not installed. */
  from: string | null
  to: string
  /** Arguments of each `codex` command for the dependencies, in order; they run first. */
  dependencyCommands: string[][]
  /** Arguments of each `codex` command for the plugin worfy, in order. */
  commands: string[][]
  /** <CODEX_HOME>/agents. */
  agentsDir: string
  /** The agent files to write (missing or different) and worfy's older files to remove. */
  agents: { write: string[]; remove: string[] }
}

export interface CodexInstallerOptions {
  /** The Harness copy of this build; its version and agents. */
  bundledDir: string
  /** <harnessHome>/plugin: the copy the Claude install keeps, Codex's local marketplace. */
  pluginDir: string
  /** The Codex binary (codexInstallBinary); undefined when there is none. */
  codex: string | undefined
  /** The environment of every `codex` command. */
  env: Env
  /** CODEX_HOME (codexHomeOf): Codex counts as there only when it exists; the agents go to its agents/. */
  codexHome: string
  /** The file in worfy's data folder where the version installed into Codex is recorded. */
  recordFile: string
  /** The system the agent files' renames and removals are retried for; that of this process by default. */
  platform?: NodeJS.Platform
  /** How long a held-open agent file is tried again on Windows. */
  renameRetryMs?: number
  /** Renames an agent file into place; tests inject one that fails as a file held open on Windows does. */
  renameFile?: (from: string, to: string) => Promise<void>
}

interface ListedPlugin {
  version: string | null
  enabled: boolean
}

/** A Harness version as scripts/build-version.ts stamps it; a version Codex gives a local plugin (`local`) is not one. */
const isBuildVersion = (version: string | null): version is string => version !== null && compareHarnessVersions(version, '0.0.0') !== 'unknown'

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/**
 * The installed plugins of `codex plugin list --json`, by `name@marketplace`. Read leniently: a list
 * of plugins, `{ plugins }`, or `{ marketplaces: [{ name, plugins }] }` as the app-server's
 * plugin/list answers; a plugin is `{ id | name, marketplace?, localVersion | version, installed?, enabled? }`.
 */
export function codexPluginsOf(parsed: unknown): Map<string, ListedPlugin> | null {
  const plugins = new Map<string, ListedPlugin>()
  const add = (item: unknown, marketplace: string | null): void => {
    const entry = record(item)
    if (entry === null || entry.installed === false) return
    const id = text(entry.id)
    const name = text(entry.name)
    const market = text(entry.marketplace) ?? text(entry.marketplaceName) ?? marketplace
    const key = id?.includes('@') ? id : name !== null && market !== null ? `${name}@${market}` : id !== null && market !== null ? `${id}@${market}` : null
    if (key === null) return
    plugins.set(key, { version: text(entry.localVersion) ?? text(entry.version), enabled: entry.enabled !== false })
  }
  const top = record(parsed)
  if (Array.isArray(parsed)) for (const item of parsed as unknown[]) add(item, null)
  else if (Array.isArray(top?.plugins)) for (const item of top.plugins as unknown[]) add(item, null)
  else if (Array.isArray(top?.marketplaces)) {
    for (const market of top.marketplaces as unknown[]) {
      const entry = record(market)
      if (entry !== null && Array.isArray(entry.plugins)) for (const item of entry.plugins as unknown[]) add(item, text(entry.name))
    }
  } else return null
  return plugins
}

/** The marketplace names of `codex plugin marketplace list --json`: a list of `{ name }` or `{ marketplaces: [...] }`; null when unread. */
export function codexMarketplacesOf(parsed: unknown): Set<string> | null {
  const list = Array.isArray(parsed) ? (parsed as unknown[]) : Array.isArray(record(parsed)?.marketplaces) ? (record(parsed)?.marketplaces as unknown[]) : null
  if (list === null) return null
  const names = list.map((item) => text(record(item)?.name))
  return names.every((name) => name !== null) ? new Set(names as string[]) : null
}

/** `name@marketplace` of each dependency of plugin.json. */
function dependenciesOf(dir: string): string[] {
  try {
    const deps = (JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as { dependencies?: unknown }).dependencies
    if (!Array.isArray(deps)) return []
    return deps.flatMap((dep: unknown) => {
      if (typeof dep === 'string') return [dep]
      const { name, marketplace } = record(dep) ?? {}
      return typeof name === 'string' ? [typeof marketplace === 'string' ? `${name}@${marketplace}` : name] : []
    })
  } catch {
    return []
  }
}

function manifestVersion(dir: string): string | null {
  try {
    return text((JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: unknown }).version)
  } catch {
    return null
  }
}

/** "Marketplace `x` is already added" is not a failure; "already added from a different source" is. */
const alreadyAdded = (message: string): boolean => /already added/i.test(message) && !/different source/i.test(message)

export class CodexHarness {
  /** Set after this run installed or updated the plugin in Codex: Codex then waits for its hooks to be approved. */
  private hooksToApprove = false

  constructor(private readonly options: CodexInstallerOptions) {}

  /** Whether Codex is there to install into: the binary, and CODEX_HOME (Codex ran on this machine). */
  present(): boolean {
    return this.options.codex !== undefined && existsSync(this.options.codexHome)
  }

  get agentsDir(): string {
    return join(this.options.codexHome, 'agents')
  }

  /** The state in Codex; null when Codex is not there. Writes nothing; runs `codex plugin list` only. */
  async status(failure?: CodexStepError): Promise<CodexHarnessStatus | null> {
    if (!this.present()) return null
    let state: CodexHarnessState
    if (failure !== undefined) state = { kind: 'error', step: failure.step, reason: failure.message }
    else {
      try {
        state = this.stateOf(await this.listed())
      } catch (error) {
        if (!(error instanceof CodexStepError)) throw error
        state = { kind: 'error', step: error.step, reason: error.message }
      }
    }
    return { state, agentsDir: this.agentsDir, hooksToApprove: this.hooksToApprove && state.kind === 'installed' }
  }

  private stateOf(listed: Map<string, ListedPlugin>): CodexHarnessState {
    const bundled = manifestVersion(this.options.bundledDir)
    const entry = listed.get(HARNESS_PLUGIN_ID)
    if (entry === undefined) return { kind: 'not-installed' }
    const version = this.versionOf(entry)
    if (bundled === null) return { kind: 'installed', version: version ?? '' }
    const missing = dependenciesOf(this.options.bundledDir).filter((id) => !listed.has(id))
    if (missing.length > 0) return { kind: 'error', step: 'dependency add', reason: `the Harness needs ${missing.join(', ')}, and Codex does not list ${missing.length === 1 ? 'it' : 'them'} as installed` }
    const agents = codexAgentsDrift(this.agentsDir, this.agentFiles(bundled))
    if (version !== bundled || agents.write.length > 0 || agents.remove.length > 0) return { kind: 'outdated', from: version, to: bundled }
    return { kind: 'installed', version }
  }

  /** The version Codex lists, or, for a plugin Codex lists without a build version, the one worfy recorded. */
  private versionOf(entry: ListedPlugin): string | null {
    if (isBuildVersion(entry.version)) return entry.version
    try {
      return text((JSON.parse(readFileSync(this.options.recordFile, 'utf8')) as { version?: unknown }).version)
    } catch {
      return null
    }
  }

  private agentFiles(version: string): Map<string, string> {
    return codexAgentFiles(this.options.bundledDir, this.options.pluginDir, version)
  }

  /**
   * What install would do; null when Codex is not there, the build has no Harness copy, or the
   * plugin, its dependencies and the agents are all in place with this build's version.
   */
  async plan(): Promise<CodexPlan | null> {
    if (!this.present()) return null
    const bundled = manifestVersion(this.options.bundledDir)
    if (bundled === null) return null
    const listed = await this.listed()
    const entry = listed.get(HARNESS_PLUGIN_ID)
    const missing = dependenciesOf(this.options.bundledDir).filter((id) => !listed.has(id))
    const from = entry === undefined ? null : this.versionOf(entry)
    const known = missing.length > 0 || entry === undefined ? await this.marketplaces() : null
    const dependencyCommands: string[][] = []
    if (missing.length > 0) {
      const foreign = missing.filter((id) => !id.endsWith(`@${DEPENDENCY_MARKETPLACE}`))
      if (foreign.length > 0) {
        throw new CodexStepError('dependency add', `the Harness needs ${foreign.join(', ')}, and worfy installs dependencies only from the marketplace ${DEPENDENCY_MARKETPLACE}: install ${foreign.length === 1 ? 'it' : 'them'} in Codex yourself, then try again`)
      }
      if (!(known?.has(DEPENDENCY_MARKETPLACE) ?? false)) dependencyCommands.push(['plugin', 'marketplace', 'add', DEPENDENCY_MARKETPLACE_SOURCE])
      for (const id of missing) dependencyCommands.push(['plugin', 'add', id])
    }
    const commands: string[][] = []
    if (entry === undefined && !(known?.has(HARNESS_MARKETPLACE) ?? false)) commands.push(['plugin', 'marketplace', 'add', this.options.pluginDir])
    if (entry === undefined || from !== bundled) commands.push(['plugin', 'add', HARNESS_PLUGIN_ID])
    const agents = codexAgentsDrift(this.agentsDir, this.agentFiles(bundled))
    if (dependencyCommands.length === 0 && commands.length === 0 && agents.write.length === 0 && agents.remove.length === 0) return null
    return { from, to: bundled, dependencyCommands, commands, agentsDir: this.agentsDir, agents }
  }

  /** plan(), with a failed `codex` command as `failure` rather than thrown. */
  async tryPlan(): Promise<{ plan: CodexPlan | null; failure: CodexStepError | null }> {
    try {
      return { plan: await this.plan(), failure: null }
    } catch (error) {
      if (error instanceof CodexStepError) return { plan: null, failure: error }
      throw error
    }
  }

  /** apply(), with the failed step returned rather than thrown; null when it all went in. */
  async tryApply(plan: CodexPlan): Promise<CodexStepError | null> {
    try {
      await this.apply(plan)
      return null
    } catch (error) {
      if (error instanceof CodexStepError) return error
      throw error
    }
  }

  /** Runs a plan: the dependencies, the plugin, then the agents and the record. Throws a CodexStepError at the first failure. */
  async apply(plan: CodexPlan): Promise<void> {
    for (const args of plan.dependencyCommands) {
      if (args[1] === 'marketplace') await this.addMarketplace(args, 'dependency marketplace add')
      else await this.codex(args, 'dependency add', DOWNLOAD_TIMEOUT_MS)
    }
    for (const args of plan.commands) {
      if (args[1] === 'marketplace') await this.addMarketplace(args, 'marketplace add')
      else await this.codex(args, 'plugin add')
    }
    if (plan.commands.length > 0) {
      // Codex turns the plugin's hooks off until they are approved again (ticket 39 adds the step).
      this.hooksToApprove = true
      await this.record(plan.to)
    }
    try {
      await writeCodexAgents(plan.agentsDir, this.agentFiles(plan.to), {
        ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
        ...(this.options.renameRetryMs === undefined ? {} : { retryMs: this.options.renameRetryMs }),
        ...(this.options.renameFile === undefined ? {} : { renameFile: this.options.renameFile }),
      })
    } catch (error) {
      throw new CodexStepError('agents', `writing the Codex agents to ${plan.agentsDir} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Records the version installed into Codex in worfy's data folder; a failure only leaves the next status asking for an update. */
  private async record(version: string): Promise<void> {
    try {
      await mkdir(dirname(this.options.recordFile), { recursive: true })
      await writeFile(this.options.recordFile, `${JSON.stringify({ version })}\n`)
    } catch (error) {
      console.warn(`[harness] could not record the Harness version installed into Codex in ${this.options.recordFile}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async addMarketplace(args: string[], step: CodexHarnessStep): Promise<void> {
    try {
      const { stdout, stderr } = await this.codex(args, step, DOWNLOAD_TIMEOUT_MS)
      if (/different source/i.test(`${stdout}\n${stderr}`)) throw new CodexStepError(step, `codex ${args.join(' ')}: ${(stderr.trim() || stdout.trim()).split('\n').slice(-5).join('\n')}`)
    } catch (error) {
      if (error instanceof CodexStepError && alreadyAdded(error.message)) return
      throw error
    }
  }

  /** Every installed plugin of `codex plugin list --json`. */
  private async listed(): Promise<Map<string, ListedPlugin>> {
    const args = ['plugin', 'list', '--json']
    const { stdout } = await this.codex(args, 'plugin list')
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      throw new CodexStepError('plugin list', `codex ${args.join(' ')} printed no JSON:\n${stdout.trim().split('\n').slice(-5).join('\n')}`)
    }
    const plugins = codexPluginsOf(parsed)
    if (plugins === null) throw new CodexStepError('plugin list', `codex ${args.join(' ')} printed no list of plugins`)
    return plugins
  }

  /** The marketplaces Codex knows; null when it cannot say (the plan then adds them, and "already added" is no failure). */
  private async marketplaces(): Promise<Set<string> | null> {
    try {
      const { stdout } = await this.codex(['plugin', 'marketplace', 'list', '--json'], 'marketplace add')
      return codexMarketplacesOf(JSON.parse(stdout))
    } catch {
      return null
    }
  }

  private codex(args: string[], step: CodexHarnessStep, timeout?: number): Promise<{ stdout: string; stderr: string }> {
    const tool: Tool = { binary: this.options.codex, command: 'codex', product: 'Codex', env: this.options.env }
    return runTool(tool, args, timeout).catch((error: unknown) => {
      throw new CodexStepError(step, error instanceof Error ? error.message : String(error))
    })
  }
}
