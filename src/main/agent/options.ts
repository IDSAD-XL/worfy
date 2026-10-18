// Options of the SDK query() behind one Session.
//
// The Session runs with the user's own settings (ADR-0002): settingSources user + project + local,
// the claude_code system prompt preset, and the model, effort and permission mode picked for the
// Session (ticket 19; bypassPermissions unless the user picked another mode). A Session in a Project also gets
// the canvas (ticket 24, src/main/mcp/canvas-server.ts): the in-process MCP server `worfy-canvas`,
// the Project's Cards folder as an extra writable directory, and the agent instructions appended
// to the preset. Claude Code runs as the native binary of the SDK's platform package
// (ADR-0008): in `pnpm dev` the SDK finds it itself; in the packaged app its own lookup points
// inside app.asar, where nothing can be spawned, so the path into app.asar.unpacked is explicit.
// On Windows that binary is claude.exe of the win32 package (ADR-0057).
// Outside bypassPermissions Claude Code asks the Session's permission gate before a tool
// (canUseTool, ticket 21, src/main/agent/permissions.ts). An unattended Session (Autopilot,
// worfy-daily ticket 02, src/main/agent/session-settings.ts) starts in bypassPermissions whatever
// mode its settings carry; its Subagents, those of workflow scripts included, inherit the mode.
//
// MCP servers (ADR-0021, worfy-daily ticket 06): a Session in a Project gets only the servers on
// its Profile's list (src/main/workflow/profile.ts). The list goes to Claude Code as the policy
// tier (`managedSettings`): `allowedMcpServers` filters every server the user's settings bring —
// user, project and local config, plugins, claude.ai connectors — and `allowManagedMcpServersOnly`
// keeps an `allowedMcpServers` in the user's own settings from widening it. settingSources stay
// as they are, so CLAUDE.md, hooks and skills still come from the user (ADR-0002). The policy
// covers the whole Claude Code process, so the Session's Subagents get the same set. It does not
// cover servers passed in `mcpServers`, so `worfy-canvas` is passed only when the list names it.
// Checked against Claude Code 2.1.289 / SDK 0.3.289 (the ticket's summary).
//
// The Harness (ADR-0040, ADR-0049, worfy-harness ticket 12): unless the old Harness is on the
// machine, a Session gets the Harness copy of this build inline (`plugins`, sessionHarnessPlugin).
// Its MCP servers (worfy-harness ticket 17, ADR-0048 item 4): no `serverName` lets a plugin's own
// server through the allowlist, so the plugin goes with `skipMcpDiscovery` and worfy registers the
// servers of its .mcp.json itself as `plugin_worfy_<server>` (pluginMcpServers). The allowlist then
// filters them by that name like the user's own, and their tools keep the names they have in a
// terminal session, where the installed plugin registers them: `mcp__plugin_worfy_qmd__…`.
//
// The draft Session of a Project's connection (worfy-harness ticket 24, draftSessionOptions) adds
// its structured answer (`outputFormat`, the draft schema), the tools it may use (`allowedTools`:
// Read, Glob, Grep) and the tools it runs without (`disallowedTools`: Bash and every tool that
// writes or reaches out; src/main/projects/connect.ts). It reads only the user's settings, not the
// `.claude/settings*.json` of the folder it reads, whose allow rules would let a tool past the
// Session's canUseTool; and it asks the policy tier to ignore every allow rule outside it
// (`allowManagedPermissionRulesOnly`), so the user's own allow rules do not either — that key is
// documented for the policy tier, but no real Claude Code run has confirmed it is kept.
//
// The autocompact window (worfy-polish ticket 24): a window in tokens goes as the flag settings of
// the query (`settings: { autoCompactWindow }`, the `--settings` flag of Claude Code). Claude Code
// takes CLAUDE_CODE_AUTO_COMPACT_WINDOW of the environment over it, and it over the user's
// settings.json; it compacts a little below the window, keeping room for the summary. With no
// window ("Claude Code default") no flag settings go at all.
//
// A Session's Claude Code process (worfy-week ticket 20, ADR-0064): with `spawned` given, worfy
// starts the process itself through the SDK's `spawnClaudeCodeProcess`, the way the SDK's own spawn
// does (watchedSpawn), and hands the process to the Session, which can then wait for its exit.
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, posix, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { McpServerConfig, McpStdioServerConfig, Options, OutputFormat, SettingSource, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS, type SessionSettings } from '../../shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../shared/canvas/tools'
import type { HarnessKind } from '../../shared/projects/action-templates'
import { bundledHarnessDir } from '../harness/bundled'
import { HARNESS_PLUGIN_NAME } from '../harness/locate'
import type { Env } from './env'
import type { CanUseToolHandler } from './permissions'

export interface RuntimeInfo {
  /** app.isPackaged */
  packaged: boolean
  /** process.resourcesPath: Contents/Resources of the .app */
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
}

/**
 * The Claude Code binary to run, or undefined to let the SDK find it (`pnpm dev`). In the
 * packaged app: <Resources>/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude,
 * on Windows …\claude-agent-sdk-win32-<arch>\claude.exe (ADR-0057). electron-builder.yml unpacks
 * that package (asarUnpack). The path is built with the separators of the runtime's platform, not
 * of the machine that runs this code, so tests of either platform run anywhere.
 */
export function claudeExecutablePath(runtime: RuntimeInfo): string | undefined {
  if (!runtime.packaged) return undefined
  const windows = runtime.platform === 'win32'
  const paths = windows ? win32 : posix
  return paths.join(runtime.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${runtime.platform}-${runtime.arch}`, windows ? 'claude.exe' : 'claude')
}

/**
 * The Claude Code binary of the SDK's platform package in any build, for commands worfy runs itself
 * (the Harness installer, src/main/harness/install.ts): claudeExecutablePath() in the packaged app,
 * otherwise the package next to the SDK in node_modules, found the way the SDK finds it. Undefined
 * when the package is not installed for this platform.
 */
export function bundledClaudeBinary(runtime: RuntimeInfo): string | undefined {
  const packaged = claudeExecutablePath(runtime)
  if (packaged !== undefined) return packaged
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    const manifest = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${runtime.platform}-${runtime.arch}/package.json`)
    // claude.exe in the Windows package (worfy-windows ticket 13: the installer's status ran a missing `claude` there).
    return join(dirname(manifest), runtime.platform === 'win32' ? 'claude.exe' : 'claude')
  } catch {
    return undefined
  }
}

/** How long the SDK's own spawn waits, after the process exited, for its stderr to close (SDK 0.3.289). */
const STDERR_DRAIN_MS = 200

/** The event the process answers the SDK's `exit` with: the exit, once stderr is read to its end. */
const EXIT_AFTER_STDERR = 'worfy-exit-after-stderr-drained'

/**
 * Starts Claude Code exactly as the SDK's own spawn does (ProcessTransport.spawnLocalProcess, SDK
 * 0.3.289): the command, arguments, folder, environment and abort signal the SDK hands over, three
 * pipes, `windowsHide`; stderr decoded as UTF-8 into `stderr`; and the exit reported to the SDK only
 * once stderr has closed, 200 ms after the exit at most, so an exit error carries the whole stderr
 * tail. `spawned` gets the process itself, whose own `exit` comes at the real exit (ADR-0064).
 */
export function watchedSpawn(spawned: (child: ChildProcess) => void, stderr?: (data: string) => void): (options: SpawnOptions) => SpawnedProcess {
  return ({ command, args, cwd, env, signal }) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], signal, env, windowsHide: true })
    spawned(child)
    const decoder = new StringDecoder('utf8')
    let stderrClosed = false
    let exited = false
    let delivered = false
    let timer: ReturnType<typeof setTimeout> | undefined
    child.stderr.on('data', (chunk: Buffer) => {
      if (delivered) return
      const text = decoder.write(chunk)
      if (text !== '') stderr?.(text)
    })
    child.stderr.on('error', (error) => console.warn('[agent] reading Claude Code stderr failed', error))
    const deliver = (): void => {
      if (delivered) return
      delivered = true
      clearTimeout(timer)
      child.emit(EXIT_AFTER_STDERR, child.exitCode, child.signalCode)
      const stream = child.stderr as typeof child.stderr & { unref?: () => void }
      if (typeof stream.unref === 'function') stream.unref()
      else stream.destroy()
    }
    child.stderr.once('close', () => {
      const rest = decoder.end()
      if (rest !== '') stderr?.(rest)
      stderrClosed = true
      if (exited) deliver()
    })
    child.once('exit', () => {
      exited = true
      if (stderrClosed) deliver()
      else timer = setTimeout(deliver, STDERR_DRAIN_MS)
    })
    const name = (event: string): string => (event === 'exit' ? EXIT_AFTER_STDERR : event)
    type Listener = (...args: unknown[]) => void
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      get killed() {
        return child.killed
      },
      get exitCode() {
        return child.exitCode
      },
      get signalCode() {
        return child.signalCode
      },
      kill: (killSignal: NodeJS.Signals) => child.kill(killSignal),
      on: (event: string, listener: Listener) => void child.on(name(event), listener),
      once: (event: string, listener: Listener) => void child.once(name(event), listener),
      off: (event: string, listener: Listener) => void child.off(name(event), listener),
    } as SpawnedProcess
  }
}

/** The canvas a Session in a Project works with. */
export interface CanvasAttachment {
  /** The `worfy-canvas` MCP server bound to the Project. */
  server: McpServerConfig
  /** `<Project data folder>/cards`, where the agent writes Cards. */
  cardsDir: string
  /** Appended to the claude_code system prompt (src/main/mcp/agent-instructions.md). */
  instructions: string
}

export interface SessionOptionsInput {
  /** Root of the Project the Session works in. */
  cwd: string
  /** The agent environment, without API keys (env.ts): the login shell on macOS and Linux, a new sign-in on Windows. */
  env: Env
  runtime: RuntimeInfo
  /** Session id to continue, when the Session is resumed. */
  resume?: string | undefined
  /**
   * The id of a new SDK session (worfy-daily ticket 24): Claude Code starts the conversation under
   * it and writes it to its entry in ~/.claude/sessions before system/init. Ignored with `resume`:
   * the SDK takes it there only together with forkSession, which worfy never asks for.
   */
  sessionId?: string | undefined
  /** Receives Claude Code's stderr, to explain a crash. */
  stderr?: ((data: string) => void) | undefined
  /** Gets the Claude Code process once started: worfy then starts it itself (watchedSpawn, ADR-0064). */
  spawned?: ((child: ChildProcess) => void) | undefined
  /** Absent when the Session's cwd is in no Project: it then runs without canvas tools. */
  canvas?: CanvasAttachment | null | undefined
  /** The model, effort and permission mode to start with; DEFAULT_SETTINGS when absent. */
  settings?: SessionSettings | undefined
  /** Answers permission requests outside bypassPermissions; without it Claude Code's own default applies. */
  canUseTool?: CanUseToolHandler | undefined
  /** No person is at the Session: it runs in bypassPermissions whatever `settings` say. */
  unattended?: boolean | undefined
  /**
   * The MCP servers the Project's Profile allows (ADR-0021). Absent or null — a Session outside a
   * Project — leaves the user's servers as they are.
   */
  mcpAllowlist?: readonly string[] | null | undefined
  /**
   * The folder of worfy's own Harness to pass inline (sessionHarnessPlugin). Absent or null — the
   * old Harness is on the machine — passes no plugins.
   */
  harnessPlugin?: string | null | undefined
  /** Where the reason a plugin server is left out goes; console.warn by default. */
  warn?: ((message: string) => void) | undefined
  /**
   * The structured answer the Session ends its turn with (the draft of a Project's connection,
   * src/main/projects/connect.ts): the `result` message then carries `structured_output`.
   */
  outputFormat?: OutputFormat | undefined
  /** Tools Claude Code runs without, Subagents included: the draft Session takes away Bash and those that write. */
  disallowedTools?: readonly string[] | undefined
  /** Tools Claude Code runs without asking: the draft Session's Read, Glob and Grep. */
  allowedTools?: readonly string[] | undefined
  /** Which settings files Claude Code reads; user + project + local when absent. */
  settingSources?: readonly SettingSource[] | undefined
  /** Only the policy tier may allow a tool: allow rules of every settings file are ignored. */
  permissionRulesFromPolicyOnly?: boolean | undefined
  /**
   * The autocompact window in tokens (worfy-polish ticket 24), passed as flag settings: above the
   * user's settings.json, below the policy tier and below CLAUDE_CODE_AUTO_COMPACT_WINDOW of the
   * environment. Absent or null — "Claude Code default" — passes no flag settings at all.
   */
  autoCompactWindow?: number | null | undefined
}

/** The options of the draft Session of a Project's connection; see the header. */
export type DraftSessionOptionsInput = Omit<SessionOptionsInput, 'settingSources' | 'permissionRulesFromPolicyOnly' | 'canvas' | 'mcpAllowlist' | 'outputFormat' | 'disallowedTools' | 'allowedTools'> & {
  outputFormat: OutputFormat
  allowedTools: readonly string[]
  disallowedTools: readonly string[]
}

/** The draft Session: no canvas, only the user's settings, allow rules from the policy tier alone. */
export function draftSessionOptions(input: DraftSessionOptionsInput): Options {
  return sessionOptions({ ...input, settingSources: ['user'], permissionRulesFromPolicyOnly: true })
}

/** The name worfy registers a server of the Harness plugin under: `plugin_worfy_qmd` for `qmd`. */
export const pluginServerName = (server: string): string => `plugin_${HARNESS_PLUGIN_NAME}_${server}`

const PLUGIN_ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * The stdio servers of `<pluginDir>/.mcp.json` (`{"mcpServers": {name: {command, args?, env?}}}`)
 * under pluginServerName(), with ${CLAUDE_PLUGIN_ROOT} in the command, the arguments and the
 * environment replaced by `pluginDir`. A file that cannot be read or parsed gives no servers and one
 * warning; a server without a string `command` is left out with a warning, the others stay.
 */
export function pluginMcpServers(pluginDir: string, warn: (message: string) => void): Record<string, McpServerConfig> {
  const file = join(pluginDir, '.mcp.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    warn(`[harness] ${file} is unreadable, the Session starts without the plugin's MCP servers: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    warn(`[harness] ${file} has no "mcpServers" object, the Session starts without the plugin's MCP servers`)
    return {}
  }
  const put = (text: string): string => text.split(PLUGIN_ROOT_VARIABLE).join(pluginDir)
  const servers: Record<string, McpServerConfig> = {}
  for (const [name, config] of Object.entries(parsed.mcpServers)) {
    const args = isRecord(config) ? config.args : undefined
    const env = isRecord(config) ? config.env : undefined
    const envOk = env === undefined || (isRecord(env) && Object.values(env).every((value) => typeof value === 'string'))
    if (!isRecord(config) || typeof config.command !== 'string' || (args !== undefined && !isStringArray(args)) || !envOk) {
      warn(`[harness] ${file}: the server "${name}" is not a stdio server with a command, the Session starts without it`)
      continue
    }
    const server: McpStdioServerConfig = { type: 'stdio', command: put(config.command) }
    if (args !== undefined) server.args = args.map(put)
    if (isRecord(env)) server.env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, put(String(value))]))
    servers[pluginServerName(name)] = server
  }
  return servers
}

/**
 * The Harness a Session of worfy carries inline (ADR-0040, item 2; ADR-0049): the copy of this
 * build (src/main/harness/bundled.ts — <resourcesPath>/harness in the .app, out/harness otherwise,
 * looked up on every Session start, so a moved .app still finds it), never the harness/ folder of a
 * source tree. With the plugin installed or no Harness at all the Session gets it: an inline plugin
 * named `worfy` silently replaces the installed one (ADR-0048). With the old Harness — on its own
 * or next to the plugin — it gets none: the old hooks are still written in ~/.claude/settings.json
 * and the plugin's would run a second time (ADR-0049).
 */
export function sessionHarnessPlugin(harness: HarnessKind, bundledDir: () => string = bundledHarnessDir): string | null {
  return harness === 'legacy' ? null : bundledDir()
}

export function sessionOptions(input: SessionOptionsInput): Options {
  const settings = input.settings ?? DEFAULT_SETTINGS
  const options: Options = {
    cwd: input.cwd,
    env: input.env,
    settingSources: [...(input.settingSources ?? ['user', 'project', 'local'])],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: input.unattended === true ? 'bypassPermissions' : settings.permissionMode,
    // Not required by SDK 0.3.289 (ticket 06, question 9), but documented as required with
    // bypassPermissions: passing it keeps a stricter SDK from silently falling back to prompts.
    // Passed in every mode, so the user can switch a Session to bypassPermissions mid-session.
    allowDangerouslySkipPermissions: true,
    // Live text (stream_event deltas) and every hook run, including Stop hooks that block a turn.
    includePartialMessages: true,
    includeHookEvents: true,
  }
  const executable = claudeExecutablePath(input.runtime)
  if (executable !== undefined) options.pathToClaudeCodeExecutable = executable
  if (settings.model !== null) options.model = settings.model
  if (settings.effort !== null) options.effort = settings.effort
  if (input.resume !== undefined) options.resume = input.resume
  else if (input.sessionId !== undefined) options.sessionId = input.sessionId
  // Read by Claude Code once, when the process starts: a running Session keeps its window.
  if (input.autoCompactWindow != null) options.settings = { autoCompactWindow: input.autoCompactWindow }
  if (input.stderr !== undefined) options.stderr = input.stderr
  if (input.spawned !== undefined) options.spawnClaudeCodeProcess = watchedSpawn(input.spawned, input.stderr)
  if (input.canUseTool !== undefined) options.canUseTool = input.canUseTool
  if (input.outputFormat !== undefined) options.outputFormat = input.outputFormat
  if (input.disallowedTools !== undefined && input.disallowedTools.length > 0) options.disallowedTools = [...input.disallowedTools]
  if (input.allowedTools !== undefined && input.allowedTools.length > 0) options.allowedTools = [...input.allowedTools]
  const allowlist = input.mcpAllowlist ?? null
  const allowed = (name: string): boolean => allowlist === null || allowlist.includes(name)
  if (allowlist !== null) {
    options.managedSettings = { allowManagedMcpServersOnly: true, allowedMcpServers: allowlist.map((serverName) => ({ serverName })) }
  }
  if (input.permissionRulesFromPolicyOnly === true) options.managedSettings = { ...options.managedSettings, allowManagedPermissionRulesOnly: true }
  // Added to the user's own MCP servers from settingSources, not instead of them.
  const servers: Record<string, McpServerConfig> = {}
  if (input.canvas) {
    options.additionalDirectories = [input.canvas.cardsDir]
    if (allowed(CANVAS_SERVER_NAME)) {
      servers[CANVAS_SERVER_NAME] = input.canvas.server
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: input.canvas.instructions }
    }
  }
  if (input.harnessPlugin != null) {
    options.plugins = [{ type: 'local', path: input.harnessPlugin, skipMcpDiscovery: true }]
    const warn = input.warn ?? ((message: string) => console.warn(message))
    for (const [name, server] of Object.entries(pluginMcpServers(input.harnessPlugin, warn))) {
      if (allowed(name)) servers[name] = server
    }
  }
  if (Object.keys(servers).length > 0) options.mcpServers = servers
  return options
}
