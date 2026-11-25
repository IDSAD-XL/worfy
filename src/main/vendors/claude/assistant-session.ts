// The Session of the Assistant on Claude Code (worfy-assistant ticket 10; ADR-0114, point 2 and boundary 1; spec, the
// Session of the Assistant). One Claude Code per wake, started here and closed after its result
// (src/main/assistant/session/runner.ts); the Assistant on Codex is not in this Epic.
//
// - Where: a folder of its own in worfy's data folder, outside every Project (assistantSessionDir), and no settings
//   file at all (`settingSources: []`): no Project's CLAUDE.md, hooks or settings load, nor the user's.
// - Its rules: the third kind of Session for the Harness, WORFY_SESSION_KIND=assistant
//   (ASSISTANT_SESSION_KIND). The Harness plugin of this build comes along, as in every Session of worfy; its rules
//   hook gives such a Session harness/hooks/rules/assistant.md.
// - Its tools: only those of `worfy-app` (src/main/mcp/app-server.ts). No built-in tool at all (`tools: []`) — so no
//   Bash, no file write, no web — and the tools that would be anyway are named in `disallowedTools` too. One MCP server,
//   worfy-app, in-process; the policy tier lets no other server in (`allowedMcpServers: []` cuts the user's servers and
//   the connectors of claude.ai; an SDK server is not cut by it), and none of the Harness plugin is passed. The tools of
//   worfy-app are allowed by name (`allowedTools`) under `dontAsk`, which denies every other tool without asking:
//   containment rests on `tools: []`, `dontAsk` and `allowedTools`. No canUseTool: under dontAsk Claude Code never
//   calls it. No `allowManagedPermissionRulesOnly` either: it makes Claude Code ignore allowedTools, and dontAsk then
//   denies every tool of worfy-app (test/contract/assistant-session-claude.test.ts runs the real Claude Code); with
//   `settingSources: []` no allow rule of a settings file loads anyway.
// - Its model: the strong one (ASSISTANT_SESSION_MODEL). Haiku 5.5 only sorts the text of outside sources (ticket 11).
// - Each wake is a new Session: the id it is given, never `resume` or `continue`, and no transcript under
//   ~/.claude/projects (`persistSession: false`) — what the next Session must know is in the memory file.
// - No API key: it runs on the user's subscription, as every Session of worfy.
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { APP_TOOL_NAMES, appToolUseName, WORFY_APP_SERVER_NAME } from '../../../shared/assistant/app-tools'
import { withoutApiKeys, type Env } from '../../agent/env'
import { sdkServerConfig, type ClaudeMcpServer } from './mcp'
import { ONE_SHOT_DISALLOWED_TOOLS } from './one-shot'
import { ASSISTANT_SESSION_KIND, claudeExecutablePath, SESSION_KIND_VARIABLE, type RuntimeInfo } from './options'

/**
 * The model the Assistant reasons on: the alias of the strongest one, as a Product Session's (PRODUCT_SESSION_MODEL).
 * Decided without the owner (ticket 10, result section).
 */
export const ASSISTANT_SESSION_MODEL = 'opus'
/** The folder the Sessions of the Assistant run in, under `<WORFY_DATA_DIR>/assistant/`: empty, worfy's own. */
export const ASSISTANT_SESSION_DIR = 'session'
export const assistantSessionDir = (dataDir: string): string => join(dataDir, 'assistant', ASSISTANT_SESSION_DIR)
/**
 * The most turns one Session of the Assistant may take: reading items, threads and tails, a few proposals, an action,
 * the answer. A ceiling against a Session that loops, not a spend. Decided without the owner.
 */
export const ASSISTANT_MAX_TURNS = 40

/** What one Session of the Assistant is started for. */
export interface AssistantSessionSpec {
  /** The id of the new Session: a new one on each wake. */
  sessionId: string
  /** The wake it answers (AssistantWake.id). */
  wakeId: string
}

/** The part of a query of the SDK a Session of the Assistant uses: its messages, and close. */
export interface AssistantQuery extends AsyncIterable<unknown> {
  close(): void
}

/** Starts the Claude Code of one Session with `prompt` as its one message: claudeAssistantQuery, or a fake in tests. */
export type AssistantQueryStarter = (spec: AssistantSessionSpec, prompt: string) => Promise<AssistantQuery>

export interface AssistantSessionOptionsInput {
  cwd: string
  /** The agent environment (agentEnv); its API keys are taken out. */
  env: Env
  runtime: RuntimeInfo
  sessionId: string
  /** The server `worfy-app` of this Session (worfyAppForSession). */
  server: ClaudeMcpServer
  /** worfy-app's instructions, appended to the system prompt. */
  instructions: string
  /** The folder of this build's Harness plugin (sessionHarnessPlugin); null with the old Harness: none. */
  harnessPlugin: string | null
  stderr?: ((data: string) => void) | undefined
}

const ALLOWED_TOOLS: readonly string[] = APP_TOOL_NAMES.map(appToolUseName)

/** The options of one Session of the Assistant; see the header. */
export function assistantSessionOptions(input: AssistantSessionOptionsInput): Options {
  const executable = claudeExecutablePath(input.runtime)
  return {
    cwd: input.cwd,
    env: { ...withoutApiKeys(input.env), [SESSION_KIND_VARIABLE]: ASSISTANT_SESSION_KIND },
    model: ASSISTANT_SESSION_MODEL,
    sessionId: input.sessionId,
    persistSession: false,
    settingSources: [],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: input.instructions },
    tools: [],
    mcpServers: { [WORFY_APP_SERVER_NAME]: sdkServerConfig(input.server) },
    managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [] },
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...ONE_SHOT_DISALLOWED_TOOLS],
    permissionMode: 'dontAsk',
    maxTurns: ASSISTANT_MAX_TURNS,
    ...(input.harnessPlugin === null ? {} : { plugins: [{ type: 'local' as const, path: input.harnessPlugin, skipMcpDiscovery: true }] }),
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  }
}

/**
 * Claude Code of one Session of the Assistant, through the Agent SDK, with its server `worfy-app`. Loaded at the call:
 * the SDK, the app and the server load much of main.
 */
export const claudeAssistantQuery: AssistantQueryStarter = async (spec, prompt) => {
  const [{ query }, { app }, { agentEnv }, { mkdirSync }, { dataRoot }, { currentHarness }, { sessionHarnessPlugin }, { worfyAppForSession }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('electron'),
    import('../../agent/env'),
    import('node:fs'),
    import('../../storage/paths'),
    import('../../harness/locate'),
    import('./options'),
    import('../../mcp/app-server'),
  ])
  const cwd = assistantSessionDir(dataRoot())
  mkdirSync(cwd, { recursive: true })
  const { server, instructions } = await worfyAppForSession({ sessionId: spec.sessionId })
  const options = assistantSessionOptions({
    cwd,
    env: (await agentEnv()).env,
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    sessionId: spec.sessionId,
    server,
    instructions,
    harnessPlugin: sessionHarnessPlugin(currentHarness().kind),
  })
  return query({ prompt, options })
}
