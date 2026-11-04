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
// the user approves them in Codex (`/hooks`); the status says so (`hooksToApprove`), and the toolbar
// shows the step "Approve the Harness hooks in Codex" (ticket 39), whose "Check again" asks Codex
// (src/main/vendors/codex/harness-hooks.ts) and clears it once they are approved (hooksApproved).
//
// The MCP servers: Codex 0.166.0 reads Claude Code's .mcp.json of a plugin but fills in no
// ${CLAUDE_PLUGIN_ROOT} there (worfy-polish ticket 55), so `node ${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp` would
// start node on a path that is not there. Before each `codex plugin add` of the Harness, worfy writes
// <pluginDir>/.codex-plugin/plugin.json, the manifest Codex reads before .claude-plugin/plugin.json:
// Claude Code's manifest with `mcpServers` of .mcp.json, the variable replaced by pluginDir as in the
// agents (codexPluginManifest). Without a `cwd` the server still starts in the session's folder, where
// qmd-mcp reads the Project's profile. Claude Code does not read .codex-plugin/ and keeps .mcp.json.
//
// Codex counts as there when this build has its binary and CODEX_HOME exists (Codex ran and signed
// in on this machine): without either nothing here runs, and nothing is written. worfy writes only
// the agent files, the Codex manifest in its own Harness copy and its own record in its data folder
// (ADR-0005); the plugins and Codex's config are written by `codex plugin`.
//
// The version: the one `codex plugin list --json` names for worfy@worfy-harness. A plugin of a local
// marketplace may be listed without a version of its own (`local`); then the version worfy recorded
// after its last install into Codex stands for it, so an update runs once, not on every Install.
//
// The status reads Codex for CODEX_STATUS_TIMEOUT_MS at most: every read of the Harness state waits
// for it (the toolbar, the first-run screen, the Update check), the Claude Code part included, so a
// Codex that hangs makes its own part an error rather than holding the rest.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import type { CodexHarness as CodexHarnessStatus, CodexHarnessState, CodexHarnessStep } from '../../shared/ipc/harness'
import { codexExecutablePath, type CodexPackageResolver, type CodexRuntime } from '../vendors/codex/binary'
import { CODEX_ABSENT } from '../vendors/codex/launch'
import { codexAgentFiles, codexAgentsDrift, writeCodexAgents, type CodexAgentsDrift } from './codex-agents'
import { compareHarnessVersions, DEPENDENCY_MARKETPLACE, DEPENDENCY_MARKETPLACE_SOURCE, DOWNLOAD_TIMEOUT_MS, HARNESS_MARKETPLACE, HARNESS_PLUGIN_ID, runTool, type Tool } from './install'

type Env = Readonly<Record<string, string | undefined>>

/** How long the status waits for `codex plugin list`; then the Codex part is an error and the command is stopped. */
export const CODEX_STATUS_TIMEOUT_MS = 10_000

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
  /** The agent files to write (missing or different), worfy's older files to remove, and the names a file of the user's own holds. */
  agents: CodexAgentsDrift
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
  /** How long the status waits for `codex plugin list`; CODEX_STATUS_TIMEOUT_MS by default. */
  statusTimeoutMs?: number
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
 * The installed plugins of `codex plugin list --json`, by `name@marketplace`. Codex 0.166.0 prints
 * `{ installed: [...], available: [...] }` with `{ pluginId: "name@marketplace", name, marketplaceName,
 * version, installed, enabled }` (test/fixtures/codex-cli/plugin-list-0.166.0.json); only `installed`
 * is read, `available` lists plugins that are not installed. Older guesses are still read: a list of
 * plugins, `{ plugins }`, or `{ marketplaces: [{ name, plugins }] }` as the app-server's plugin/list
 * answers, with `{ id | name, marketplace?, localVersion | version, installed?, enabled? }`.
 */
export function codexPluginsOf(parsed: unknown): Map<string, ListedPlugin> | null {
  const plugins = new Map<string, ListedPlugin>()
  const add = (item: unknown, marketplace: string | null): void => {
    const entry = record(item)
    if (entry === null || entry.installed === false) return
    const id = text(entry.pluginId) ?? text(entry.id)
    const name = text(entry.name)
    const market = text(entry.marketplace) ?? text(entry.marketplaceName) ?? marketplace
    const key = id?.includes('@') ? id : name !== null && market !== null ? `${name}@${market}` : id !== null && market !== null ? `${id}@${market}` : null
    if (key === null) return
    plugins.set(key, { version: text(entry.localVersion) ?? text(entry.version), enabled: entry.enabled !== false })
  }
  const top = record(parsed)
  if (Array.isArray(parsed)) for (const item of parsed as unknown[]) add(item, null)
  else if (Array.isArray(top?.installed)) for (const item of top.installed as unknown[]) add(item, null)
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

const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}'

/**
 * The Codex manifest of the Harness copy at `pluginDir` (.codex-plugin/plugin.json): Claude Code's
 * manifest `claudeManifest` with `mcpServers` of the plugin's .mcp.json `mcp`, every
 * `${CLAUDE_PLUGIN_ROOT}` in their strings replaced by `pluginDir`. A string that starts with it is a
 * path, normalised for `platform` (backslashes on Windows). Without servers, the manifest as it is.
 */
export function codexPluginManifest(claudeManifest: Record<string, unknown>, mcp: unknown, pluginDir: string, platform: NodeJS.Platform = process.platform): Record<string, unknown> {
  const servers = record(record(mcp)?.mcpServers)
  if (servers === null) return { ...claudeManifest }
  const normalize = platform === 'win32' ? win32.normalize : posix.normalize
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') return value.startsWith(PLUGIN_ROOT) ? normalize(value.split(PLUGIN_ROOT).join(pluginDir)) : value.split(PLUGIN_ROOT).join(pluginDir)
    if (Array.isArray(value)) return value.map(fill)
    const object = record(value)
    return object === null ? value : Object.fromEntries(Object.entries(object).map(([key, each]) => [key, fill(each)]))
  }
  return { ...claudeManifest, mcpServers: fill(servers) }
}

/** The state the status reports, and the agents a file of the user's own keeps out (codexAgentsDrift's `skipped`). */
interface StateRead {
  state: CodexHarnessState
  skipped: string[]
}

const stepState = (error: CodexStepError): CodexHarnessState => ({ kind: 'error', step: error.step, reason: error.message })

/** "Marketplace `x` is already added" is not a failure; "already added from a different source" is. */
const alreadyAdded = (message: string): boolean => /already added/i.test(message) && !/different source/i.test(message)

export class CodexHarness {
  /** Set after this run installed or updated the plugin in Codex: Codex then waits for its hooks to be approved. */
  private hooksToApprove = false

  constructor(private readonly options: CodexInstallerOptions) {}

  /**
   * A check found the hooks approved in Codex (src/main/vendors/codex/harness-hooks.ts, ticket 39): the
   * status no longer asks to approve them, until the next install or update turns them off again.
   */
  hooksApproved(): void {
    this.hooksToApprove = false
  }

  /** Whether Codex is there to install into: the binary, and CODEX_HOME (Codex ran on this machine). */
  present(): boolean {
    return this.options.codex !== undefined && existsSync(this.options.codexHome)
  }

  get agentsDir(): string {
    return join(this.options.codexHome, 'agents')
  }

  /**
   * The state in Codex; null when Codex is not there. Writes nothing; runs `codex plugin list` only,
   * and waits for it statusTimeoutMs at most: a Codex that does not answer by then is an error of
   * `plugin list`, its command is stopped, and an answer that comes later is dropped.
   */
  async status(failure?: CodexStepError): Promise<CodexHarnessStatus | null> {
    if (!this.present()) return null
    const { state, skipped } = failure === undefined ? await this.boundedRead() : { state: stepState(failure), skipped: [] }
    return { state, agentsDir: this.agentsDir, hooksToApprove: this.hooksToApprove && state.kind === 'installed', skippedAgents: skipped }
  }

  private async boundedRead(): Promise<StateRead> {
    const limit = this.options.statusTimeoutMs ?? CODEX_STATUS_TIMEOUT_MS
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<StateRead>((resolve) => {
      timer = setTimeout(() => {
        resolve({ state: { kind: 'error', step: 'plugin list', reason: `codex plugin list --json did not answer in ${String(Math.round(limit / 1000))} s` }, skipped: [] })
      }, limit)
    })
    try {
      return await Promise.race([this.read(limit), late])
    } finally {
      clearTimeout(timer)
    }
  }

  /** The state from `codex plugin list` (stopped after `timeout`), with the agents a file of the user's own keeps out. */
  private async read(timeout: number): Promise<StateRead> {
    try {
      const listed = await this.listed(timeout)
      const bundled = manifestVersion(this.options.bundledDir)
      const entry = listed.get(HARNESS_PLUGIN_ID)
      if (entry === undefined) return { state: { kind: 'not-installed' }, skipped: [] }
      const version = this.versionOf(entry)
      if (bundled === null) return { state: { kind: 'installed', version: version ?? '' }, skipped: [] }
      const missing = dependenciesOf(this.options.bundledDir).filter((id) => !listed.has(id))
      if (missing.length > 0) return { state: { kind: 'error', step: 'dependency add', reason: `the Harness needs ${missing.join(', ')}, and Codex does not list ${missing.length === 1 ? 'it' : 'them'} as installed` }, skipped: [] }
      const agents = this.agentsDrift(bundled)
      const outdated = version !== bundled || agents.write.length > 0 || agents.remove.length > 0
      return { state: outdated ? { kind: 'outdated', from: version, to: bundled } : { kind: 'installed', version }, skipped: agents.skipped }
    } catch (error) {
      if (!(error instanceof CodexStepError)) throw error
      return { state: stepState(error), skipped: [] }
    }
  }

  /** codexAgentsDrift of this build's agents; an agents folder that cannot be read fails the step `agents`. */
  private agentsDrift(version: string): CodexAgentsDrift {
    try {
      return codexAgentsDrift(this.agentsDir, this.agentFiles(version))
    } catch (error) {
      throw new CodexStepError('agents', `reading the Codex agents in ${this.agentsDir} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
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
    const agents = this.agentsDrift(bundled)
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
      else {
        await this.writeManifest()
        await this.codex(args, 'plugin add')
      }
    }
    if (plan.commands.length > 0) {
      // Codex turns the plugin's hooks off until they are approved again: the toolbar shows the step (ticket 39).
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

  /** Writes <pluginDir>/.codex-plugin/plugin.json (codexPluginManifest), which `codex plugin add` then copies with the rest. */
  private async writeManifest(): Promise<void> {
    const { pluginDir } = this.options
    const file = join(pluginDir, '.codex-plugin', 'plugin.json')
    try {
      const claudeManifest = record(JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))) ?? {}
      const mcpFile = join(pluginDir, '.mcp.json')
      const mcp: unknown = existsSync(mcpFile) ? JSON.parse(readFileSync(mcpFile, 'utf8')) : null
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(codexPluginManifest(claudeManifest, mcp, pluginDir, this.options.platform), null, 2)}\n`)
    } catch (error) {
      throw new CodexStepError('plugin add', `writing the Codex manifest ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
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

  /** Every installed plugin of `codex plugin list --json`; the command is stopped after `timeout` (runTool's own limit by default). */
  private async listed(timeout?: number): Promise<Map<string, ListedPlugin>> {
    const args = ['plugin', 'list', '--json']
    const { stdout } = await this.codex(args, 'plugin list', timeout)
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
