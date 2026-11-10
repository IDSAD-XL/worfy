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
// as they are, so CLAUDE.md and hooks still come from the user (ADR-0002), and skills too unless the
// Profile lists them (below). The policy
// covers the whole Claude Code process, so the Session's Subagents get the same set. It does not
// cover servers passed in `mcpServers`, so `worfy-canvas` is passed only when the list names it.
// Checked against Claude Code 2.1.289 / SDK 0.3.289 (the ticket's summary).
// The Browser server `worfy-browser` (worfy-browser ticket 04, src/main/mcp/browser-server.ts) is
// passed the same way, only when the list names it; a Profile list that names `worfy-canvas` names
// it too (withBrowserServer, the owner's decision 6: the existing lists get it without an edit).
// The Mind map server `worfy-mind-map` (worfy-product-session ticket 04, src/main/mcp/mind-map-server.ts)
// goes to a Product Session only, whatever its Profile's list names (withMindMapServer): a plain Session
// and the Orchestrator never get it, so they have no tool that changes a Mind map (the owner's answer Q2).
//
// Plugins and skills (ADR-0084, worfy-throughput ticket 38): a Session in a Project whose Profile
// has `skills.allowed` gets, of the user's plugins and own skills, only those on the list; worfy's
// own plugin and the skills built into Claude Code always. Their descriptions went into the first
// request of every Session and Subagent: about 7k tokens on the owner's Mac. Every plugin the
// user's, the project's or the local settings enable and the list does not name is turned off
// (`enabledPlugins: {id: false}`), every skill of <claude home>/skills likewise (`skillOverrides:
// {name: 'off'}`), and the skills and plugins synced from claude.ai unless the list names
// `claude.ai`. All of it goes as flag settings (`settings`, the `--settings` flag): they rank above
// those settings files and cover the whole process, Subagents included. Never the policy tier:
// there `syncClaudeAiSkills: false` moves the synced skills to ~/.claude/skills/.trash, while in
// flag settings it only hides them for this process (SDK 0.3.289, Settings). The SDK's `skills`
// option is not used: it filters the main session's listing only, not a Subagent's.
//
// The Project's private skills (ADR-0102, worfy-human-review ticket 05): the team reviewer lives in
// `<Profile folder>/state/human-review/.claude/skills/`, never in the repository nor in ~/.claude/skills.
// That folder goes as a second extra directory (`additionalDirectories`, the `--add-dir` flag), after the
// Cards folder, and Claude Code loads the `.claude/skills/` of an extra directory as it loads a project's
// (checked on Claude Code 2.1.289). The skills list above does not touch it: `skillOverrides` names only
// the skills of <claude home>/skills. An unattended Session and the draft Session never get the folder.
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
// documented for the policy tier, but no real Claude Code run has confirmed it is kept. It gets no
// MCP server (an empty allowlist, worfy-throughput ticket 45): canUseTool refuses every MCP tool, so
// the user's servers and the claude.ai connectors would only add their tools to its first request.
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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, posix, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { McpServerConfig, McpStdioServerConfig, Options, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS, EFFORT_LEVELS, PERMISSION_MODES, type EffortChoice, type PermissionModeChoice, type SessionSettings } from '../../../shared/agent/settings'
import { BROWSER_SERVER_NAME } from '../../../shared/browser/tools'
import { CANVAS_SERVER_NAME } from '../../../shared/canvas/tools'
import type { SessionKind } from '../../../shared/ipc/sessions'
import { MIND_MAP_SERVER_NAME } from '../../../shared/product/tools'
import type { HarnessKind } from '../../../shared/projects/action-templates'
import type { Env } from '../../agent/env'
import type { CanUseToolHandler } from '../../agent/permissions'
import { productToolDecision, type ProductToolDecision, type ProductWriteAsker, type ProductWriteList } from '../../agent/product-guard'
import type { ToolUseFacts } from '../../agent/session/types'
import { bundledHarnessDir } from '../../harness/bundled'
import { HARNESS_PLUGIN_NAME } from '../../harness/locate'
import { sdkServerConfig, type ClaudeMcpServer } from './mcp'

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

/** How long the SDK's own spawn waits, after the process exited, for its stderr to close (SDK 0.3.289 and 0.3.322). */
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
  /** The `worfy-canvas` MCP server bound to the Project (createCanvasServer). */
  server: ClaudeMcpServer
  /** `<Project data folder>/cards`, where the agent writes Cards. */
  cardsDir: string
  /** Appended to the claude_code system prompt (src/main/mcp/agent-instructions.md). */
  instructions: string
}

/** The Browser server a Session in a Project drives Browsers with. */
export interface BrowserAttachment {
  /** The `worfy-browser` MCP server bound to the Project (createBrowserServer). */
  server: ClaudeMcpServer
  /** Appended to the claude_code system prompt after the canvas instructions (src/main/mcp/browser-instructions.md). */
  instructions: string
}

/** The Mind map server a Product Session changes its topics' Mind maps with (worfy-product-session ticket 04). */
export interface MindMapAttachment {
  /** The `worfy-mind-map` MCP server bound to the Project's Product Session folder (mindMapForSession). */
  server: ClaudeMcpServer
  /** Appended to the claude_code system prompt after the other servers' (src/main/mcp/agent-instructions-mind-map.md). */
  instructions: string
}

/** A Profile's list of MCP servers with `worfy-mind-map` in it: a Product Session's own server, whatever the list names. */
export function withMindMapServer(allowlist: readonly string[]): readonly string[] {
  return allowlist.includes(MIND_MAP_SERVER_NAME) ? allowlist : [...allowlist, MIND_MAP_SERVER_NAME]
}

/**
 * A Profile's list of MCP servers with `worfy-browser` in it when it names `worfy-canvas` (the
 * owner's decision 6 of worfy-browser ticket 04): the lists Profiles already have — written before
 * the Browser existed — let the built-in Browser in next to the built-in canvas without an edit. A
 * list without `worfy-canvas` (the user took the built-in servers out, or `[]`) stays as it is.
 */
export function withBrowserServer(allowlist: readonly string[]): readonly string[] {
  return allowlist.includes(CANVAS_SERVER_NAME) && !allowlist.includes(BROWSER_SERVER_NAME) ? [...allowlist, BROWSER_SERVER_NAME] : allowlist
}

/** The structured answer a turn ends with: a JSON Schema the `result` message's `structured_output` follows. */
export interface ClaudeOutputFormat {
  type: 'json_schema'
  schema: Record<string, unknown>
}

/** A settings file Claude Code reads: the user's, the project's or the local one. */
export type ClaudeSettingSource = 'user' | 'project' | 'local'

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
  /**
   * The private folder of the Project's own skills (worfy-human-review ticket 05, ADR-0102):
   * `<Profile folder>/state/human-review/`, whose `.claude/skills/` Claude Code loads from an extra
   * directory. Added after the Cards folder; never to an unattended Session. Absent or null: none.
   */
  privateSkills?: string | null | undefined
  /** The Browser server of the Session's Project; absent outside a Project. */
  browser?: BrowserAttachment | null | undefined
  /** The Mind map server of a Product Session (worfy-product-session ticket 04); read only with `kind: 'product'`. */
  mindMap?: MindMapAttachment | null | undefined
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
   * The plugins and skills of the user the Project's Profile allows (`skills.allowed`, ADR-0084):
   * plugin names or ids, skill names, `claude.ai` for what is synced from there. Absent or null — a
   * Session outside a Project, or a Profile without the field — leaves them as they are.
   */
  skillsAllowlist?: readonly string[] | null | undefined
  /** What the user's settings bring (userExtensions); the list turns off what it does not name. */
  userExtensions?: UserExtensions | undefined
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
  outputFormat?: ClaudeOutputFormat | undefined
  /** Tools Claude Code runs without, Subagents included: the draft Session takes away Bash and those that write. */
  disallowedTools?: readonly string[] | undefined
  /** Tools Claude Code runs without asking: the draft Session's Read, Glob and Grep. */
  allowedTools?: readonly string[] | undefined
  /** Which settings files Claude Code reads; user + project + local when absent. */
  settingSources?: readonly ClaudeSettingSource[] | undefined
  /** Only the policy tier may allow a tool: allow rules of every settings file are ignored. */
  permissionRulesFromPolicyOnly?: boolean | undefined
  /**
   * The autocompact window in tokens (worfy-polish ticket 24), passed as flag settings: above the
   * user's settings.json, below the policy tier and below CLAUDE_CODE_AUTO_COMPACT_WINDOW of the
   * environment. Absent or null — "Claude Code default" — passes no flag settings at all.
   */
  autoCompactWindow?: number | null | undefined
  /**
   * Variables over `env` (worfy-auto-approve ticket 04): the Run's TMPDIR and git environment of an
   * unattended Session. Absent: `env` as it is.
   */
  environment?: Readonly<Record<string, string>> | undefined
  /**
   * Told where the shell stands for each tool call, before canUseTool is asked about it: a PreToolUse
   * hook of the query that answers nothing, so Claude Code goes on as without it (toolUseHooks).
   * Absent: no hook.
   */
  toolUse?: ((use: ToolUseFacts) => void) | undefined
  /**
   * The SessionKind (worfy-product-session ticket 01). `product`: the PreToolUse hook refuses what a Product
   * Session may not do (productToolDecision, ticket 02) and the environment carries
   * `WORFY_SESSION_KIND=product`. Absent: a plain Session, as before.
   */
  kind?: SessionKind | undefined
  /**
   * The Product Session folder of the Project (src/shared/product/paths.ts productFolder), the one place a
   * Product Session writes files; absent or null with `kind: 'product'` — it could not be found — refuses
   * every file write. Read only with `kind: 'product'`.
   */
  productFolder?: string | null | undefined
  /**
   * What a Product Session's write outside its folder needs (worfy-polish ticket 82): the Project's list,
   * the closed folders and the person to ask. Absent: nothing listed, nothing closed beyond `.git`, and
   * no one to ask — every write outside the folder is refused. Read only with `kind: 'product'`.
   */
  productWrites?: ProductWrites | undefined
  /**
   * Text appended to the system prompt after the servers' instructions: the place of the Product Session
   * rules when the SessionStart hook does not see the Session's environment (the Epic spec, risk 1; the
   * rules themselves come with ticket 10). Absent: nothing.
   */
  instructions?: string | undefined
}

/** The variable a Product Session's Claude Code, its hooks and its shell commands see (read by the rules hook, ticket 10). */
export const SESSION_KIND_VARIABLE = 'WORFY_SESSION_KIND'

/** The tool call a guard decides on, besides its tool, input and folder: its id, and the signal Claude Code aborts when it gives up on the call. */
export interface ToolUseCall {
  toolUseId: string | null
  signal: AbortSignal
}

/**
 * Decides on one tool call before Claude Code runs it: `tool_name`, `tool_input` and the shell's folder
 * (`cwd`); it may wait for a person (a Product Session's write outside its folder, worfy-polish ticket 82).
 */
export type ToolUseGuard = (tool: string, input: unknown, cwd: string | null, call: ToolUseCall) => ProductToolDecision | Promise<ProductToolDecision>

/**
 * How long Claude Code waits for the PreToolUse hook, in seconds: a guard may wait for a person's answer
 * (worfy-polish ticket 82). In SDK 0.3.289 a hook that runs out stops the call («The tool call was not
 * executed»), so the default 60 s would refuse a write the person was still reading about. A day, as long
 * as a question in the window may stand. Only a hook callback that throws lets the call go on, and the
 * hook below catches every error of the guard and refuses instead.
 */
export const TOOL_USE_HOOK_TIMEOUT_S = 24 * 60 * 60

/** What Claude Code reads when the person at the Session allowed a call the guard asked about. */
export const ASKED_ALLOW_REASON = 'The user allowed this tool call in worfy.'

/**
 * The PreToolUse hook that tells `observe` the shell folder (`cwd`) and the scratchpad
 * (`scratchpad_dir`) of each tool call (worfy-auto-approve ticket 04), and asks `guard` whether the call
 * may run (a Product Session, worfy-product-session ticket 02). Claude Code runs PreToolUse hooks before
 * it asks canUseTool, and gives no folder to canUseTool itself. Without a refusal the hook answers `{}`:
 * no decision and no output, so the tool call goes on as without it, and no `hook` event is made of it
 * (hookSaidSomething, src/shared/vendors/claude/events.ts). A refusal answers `permissionDecision: deny`
 * with the reason, which Claude Code gives the agent in every permission mode, bypassPermissions too. A
 * guard that throws refuses: the hook catches it, because Claude Code lets the call go on after a
 * callback that throws. A call the person allowed when the guard asked (`asked`, worfy-polish ticket 82)
 * answers `permissionDecision: allow`, so Claude Code does not ask canUseTool about it a second time;
 * the hook waits for that answer up to TOOL_USE_HOOK_TIMEOUT_S, after which Claude Code stops the call.
 */
export function toolUseHooks(observe?: ((use: ToolUseFacts) => void) | undefined, guard?: ToolUseGuard | undefined): NonNullable<Options['hooks']> {
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  return {
    PreToolUse: [
      {
        ...(guard === undefined ? {} : { timeout: TOOL_USE_HOOK_TIMEOUT_S }),
        hooks: [
          async (input, _toolUseId, { signal }) => {
            const fields = input as unknown as Record<string, unknown>
            const toolUseId = text(fields['tool_use_id'])
            if (observe !== undefined && toolUseId !== null) observe({ toolUseId, cwd: text(fields['cwd']), scratchpad: text(fields['scratchpad_dir']) })
            if (guard === undefined) return {}
            let decision: ProductToolDecision
            try {
              decision = await guard(String(fields['tool_name']), fields['tool_input'], text(fields['cwd']), { toolUseId, signal })
            } catch (error) {
              decision = { allow: false, reason: `The tool call is refused: its check failed (${error instanceof Error ? error.message : String(error)}).` }
            }
            if (decision.allow && decision.asked !== true) return {}
            return {
              hookSpecificOutput: decision.allow
                ? { hookEventName: 'PreToolUse' as const, permissionDecision: 'allow' as const, permissionDecisionReason: ASKED_ALLOW_REASON }
                : { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: decision.reason },
            }
          },
        ],
      },
    ],
  }
}

/**
 * What a Product Session's write outside its folder needs (worfy-polish ticket 82): the Project's list
 * (null outside a Project: nothing is listed and «Always allow» is not offered), the folders no write
 * reaches, and the person to ask (absent: no one, the write is refused).
 */
export interface ProductWrites {
  list: ProductWriteList | null
  closed: readonly string[]
  ask?: ProductWriteAsker | undefined
}

/** What the agent reads when the person answered «Deny» to a write outside the Product Session folder. */
export const productWriteDeniedMessage = (path: string): string =>
  `The user denied writing ${path} in worfy. A Product Session writes outside its Product Session folder only with the user's leave; name the change instead, or ask the user to make it.`

/**
 * The guard of a Product Session in `cwd` whose folder is `productFolder` (null: unknown, every write
 * refused). A write outside the folder and outside the Project's list (`writes`, worfy-polish ticket 82)
 * is put to the person: «Allow once» lets it through, «Always allow in <folder>» adds the folder to the
 * list first, «Deny» refuses it with productWriteDeniedMessage. With no one to ask, the refusal stands
 * and says so.
 */
export function productGuard(productFolder: string | null, cwd: string, platform: NodeJS.Platform, writes?: ProductWrites): ToolUseGuard {
  return async (tool, input, at, call) => {
    const list = writes?.list ?? null
    const place = { productDir: productFolder, cwd: at ?? cwd, alsoWritable: list?.read() ?? [], closed: writes?.closed ?? [] }
    const decision = productToolDecision(tool, input, place, platform)
    if (decision.allow || decision.ask === undefined) return decision
    const target = decision.ask
    const answer = writes?.ask === undefined ? 'unattended' : await writes.ask({ toolName: tool, toolUseId: call.toolUseId, input, target, alwaysOffered: list !== null, signal: call.signal })
    switch (answer) {
      case 'always':
        // The person allowed this write whether or not the list could be saved: a list that failed asks next time.
        try {
          list?.add(target.folder)
        } catch (error) {
          console.warn(`[product] could not add ${target.folder} to the Project's list; the next write there is asked about again`, error)
        }
        return { allow: true, asked: true }
      case 'once':
        return { allow: true, asked: true }
      case 'deny':
        return { allow: false, reason: productWriteDeniedMessage(target.path) }
      case 'cancelled':
        return { allow: false, reason: `The question about writing ${target.path} was cancelled: the user interrupted the turn or closed the Session.` }
      case 'unattended':
        return { allow: false, reason: `${decision.reason} No one is at this Session to allow a write outside it, so it is refused.` }
    }
  }
}

/** The user's plugins and own skills a Session would get without a list (ADR-0084). */
export interface UserExtensions {
  /** Plugin ids (`name@marketplace`) that the user's, the project's or the local settings enable. */
  plugins: readonly string[]
  /**
   * The skills of <claude home>/skills: the folders that hold a SKILL.md. The skills synced from
   * claude.ai lie a level deeper (`synced/<organization>_<user>/<skill>`) and go by `claude.ai`.
   */
  skills: readonly string[]
}

/** Settings Claude Code takes as its flag settings (`--settings`). */
type FlagSettings = Exclude<Options['settings'], string | undefined>

/** The entry of `skills.allowed` that keeps the skills and plugins synced from claude.ai. */
export const SYNCED_EXTENSIONS = 'claude.ai'

/** The ids a settings file enables in `enabledPlugins`; none when it is absent or not JSON. */
function enabledPluginIds(file: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  if (!isRecord(parsed) || !isRecord(parsed.enabledPlugins)) return []
  // An entry is on when it is not `false`: `true`, a version list or the extended object form.
  return Object.entries(parsed.enabledPlugins).filter(([, value]) => value !== false && value != null).map(([id]) => id)
}

/**
 * What the user's settings bring into a Session started in `cwd`: the plugins enabled in
 * <claude home>/settings.json and in `<cwd>/.claude/settings.json` and `settings.local.json`, and
 * the skills of <claude home>/skills. Only reads; a file that is missing or not JSON gives nothing.
 * shortcut: the project settings are read from `cwd` only and a skill goes by its folder name, while
 * Claude Code also looks in parent folders and lists a skill by its SKILL.md `name`; redo when a
 * Profile list leaves through a plugin or skill that is there.
 */
export function userExtensions(claudeHome: string, cwd: string): UserExtensions {
  const plugins = [join(claudeHome, 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')].flatMap(enabledPluginIds)
  let skills: string[]
  try {
    skills = readdirSync(join(claudeHome, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(claudeHome, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => entry.name)
  } catch {
    // No skills folder.
    skills = []
  }
  return { plugins: [...new Set(plugins)], skills }
}

/**
 * The flag settings that turn off, of `extensions`, what `allowlist` does not name (ADR-0084):
 * a plugin is named by its name or its id, a skill by its name; worfy's plugin stays whatever the
 * list says. Empty when the list lets everything through.
 */
function extensionSettings(allowlist: readonly string[], extensions: UserExtensions): FlagSettings {
  const named = new Set(allowlist)
  const plugins = extensions.plugins.filter((id) => {
    const name = id.split('@')[0] ?? id
    return name !== HARNESS_PLUGIN_NAME && !named.has(name) && !named.has(id)
  })
  const skills = extensions.skills.filter((name) => !named.has(name))
  const settings: FlagSettings = {}
  if (plugins.length > 0) settings.enabledPlugins = Object.fromEntries(plugins.map((id) => [id, false]))
  if (skills.length > 0) settings.skillOverrides = Object.fromEntries(skills.map((name) => [name, 'off']))
  // Hides them for this process only; the same keys in the policy tier would move them to the trash.
  if (!named.has(SYNCED_EXTENSIONS)) {
    settings.syncClaudeAiSkills = false
    settings.syncClaudeAiPlugins = false
  }
  return settings
}

/** The options of the draft Session of a Project's connection; see the header. */
export type DraftSessionOptionsInput = Omit<SessionOptionsInput, 'settingSources' | 'permissionRulesFromPolicyOnly' | 'canvas' | 'privateSkills' | 'browser' | 'mcpAllowlist' | 'skillsAllowlist' | 'userExtensions' | 'outputFormat' | 'disallowedTools' | 'allowedTools'> & {
  outputFormat: ClaudeOutputFormat
  allowedTools: readonly string[]
  disallowedTools: readonly string[]
}

/**
 * The draft Session: no canvas, only the user's settings, allow rules from the policy tier alone,
 * and no MCP server at all (an empty allowlist): it may use only Read, Glob and Grep, so the user's
 * servers and the claude.ai connectors only filled its first request (worfy-throughput ticket 45).
 * Nor the Project's private skills (ADR-0102): it is a one-off read of a folder, not a person's Session.
 */
export function draftSessionOptions(input: DraftSessionOptionsInput): Options {
  return sessionOptions({ ...input, settingSources: ['user'], permissionRulesFromPolicyOnly: true, mcpAllowlist: [], privateSkills: null })
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

/**
 * The Claude Code mode that stands for each permission preset another Vendor's Sessions save (Codex's,
 * src/main/vendors/codex/capabilities.ts, which maps the other way): an Orchestrator moved to Claude
 * Code keeps how much it may do without asking (worfy-multi-vendor ticket 37).
 */
const MODE_OF_OTHER_PRESET: Readonly<Record<string, PermissionModeChoice>> = {
  'full-access': 'bypassPermissions',
  auto: 'acceptEdits',
  'read-only': 'default',
}

/**
 * A Session's settings in Claude Code's terms (SessionPart.settingsFor): another Vendor's permission
 * preset becomes the Claude Code mode that stands for it; anything else stays as it is.
 */
export function claudeSettings(settings: SessionSettings): SessionSettings {
  const mode = MODE_OF_OTHER_PRESET[settings.permissionMode]
  return mode === undefined ? settings : { ...settings, permissionMode: mode }
}

/**
 * The permission mode Claude Code starts in: the Session's setting when it is one of Claude Code's
 * modes. A setting of another Vendor's preset (a saved pick the Session never refused) starts in
 * `default`, which asks before each tool.
 */
function claudeMode(setting: string): PermissionModeChoice {
  return (PERMISSION_MODES as readonly string[]).includes(setting) ? (setting as PermissionModeChoice) : 'default'
}

/** The effort Claude Code starts with: the Session's setting when it is one of Claude Code's levels, else none (the model's default). */
function claudeEffort(setting: string | null): EffortChoice | null {
  return setting !== null && (EFFORT_LEVELS as readonly string[]).includes(setting) ? (setting as EffortChoice) : null
}

/** The environment of a Session's Claude Code: `env`, the Run's variables over it, and the kind of a Product Session. */
function sessionEnv(input: SessionOptionsInput): Env {
  const kind: Env = input.kind === 'product' ? { [SESSION_KIND_VARIABLE]: 'product' } : {}
  return input.environment === undefined && input.kind !== 'product' ? input.env : { ...input.env, ...input.environment, ...kind }
}

export function sessionOptions(input: SessionOptionsInput): Options {
  const settings = input.settings ?? DEFAULT_SETTINGS
  const options: Options = {
    cwd: input.cwd,
    env: sessionEnv(input),
    settingSources: [...(input.settingSources ?? ['user', 'project', 'local'])],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: input.unattended === true ? 'bypassPermissions' : claudeMode(settings.permissionMode),
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
  const effort = claudeEffort(settings.effort)
  if (effort !== null) options.effort = effort
  if (input.resume !== undefined) options.resume = input.resume
  else if (input.sessionId !== undefined) options.sessionId = input.sessionId
  // Read by Claude Code once, when the process starts: a running Session keeps its window.
  const flagSettings: FlagSettings = {}
  if (input.autoCompactWindow != null) flagSettings.autoCompactWindow = input.autoCompactWindow
  if (input.skillsAllowlist != null) Object.assign(flagSettings, extensionSettings(input.skillsAllowlist, input.userExtensions ?? { plugins: [], skills: [] }))
  if (Object.keys(flagSettings).length > 0) options.settings = flagSettings
  if (input.stderr !== undefined) options.stderr = input.stderr
  if (input.spawned !== undefined) options.spawnClaudeCodeProcess = watchedSpawn(input.spawned, input.stderr)
  if (input.canUseTool !== undefined) options.canUseTool = input.canUseTool
  const guard = input.kind === 'product' ? productGuard(input.productFolder ?? null, input.cwd, input.runtime.platform, input.productWrites) : undefined
  if (input.toolUse !== undefined || guard !== undefined) options.hooks = toolUseHooks(input.toolUse, guard)
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
  const appended: string[] = []
  const directories: string[] = []
  if (input.canvas) directories.push(input.canvas.cardsDir)
  // The Project's private skills (ADR-0102): nobody at an unattended Session can say "yes" to what they draft.
  if (input.privateSkills != null && input.unattended !== true) directories.push(input.privateSkills)
  if (directories.length > 0) options.additionalDirectories = directories
  if (input.canvas) {
    if (allowed(CANVAS_SERVER_NAME)) {
      servers[CANVAS_SERVER_NAME] = sdkServerConfig(input.canvas.server)
      appended.push(input.canvas.instructions)
    }
  }
  if (input.browser && allowed(BROWSER_SERVER_NAME)) {
    servers[BROWSER_SERVER_NAME] = sdkServerConfig(input.browser.server)
    appended.push(input.browser.instructions)
  }
  if (input.kind === 'product' && input.mindMap && allowed(MIND_MAP_SERVER_NAME)) {
    servers[MIND_MAP_SERVER_NAME] = sdkServerConfig(input.mindMap.server)
    appended.push(input.mindMap.instructions)
  }
  if (input.instructions !== undefined && input.instructions !== '') appended.push(input.instructions)
  if (appended.length > 0) options.systemPrompt = { type: 'preset', preset: 'claude_code', append: appended.join('\n') }
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
