// The types at the boundary of Claude Code under the Claude driver's SessionHandle
// (src/main/vendors/claude/session.ts): what it reads of the SDK's query and how a query is started.
// Structural, without the SDK's import (ADR-0094 item 4). The Session's own types (EventSink,
// SessionInfo, SessionControls) live here too, as importers read them from src/main/agent/session.ts.
import type { AgentEvent, QueueSnapshot, SessionState } from '../../../shared/agent/events'
import type { EffortChoice, PermissionModeChoice, SessionSettings } from '../../../shared/agent/settings'
import type { AgentProcess } from '../../vendors/session'
import type { UserContent } from '../attachments'
import type { CommandInfoLike } from '../commands'
import type { Session } from '../session'

/** What accountInfo() returns, as far as worfy reads it (ADR-0009). */
export interface AccountInfoLike {
  email?: string | undefined
  subscriptionType?: string | undefined
  tokenSource?: string | undefined
  apiProvider?: string | undefined
}

/** A row of supportedModels(), as far as worfy reads it (ticket 06, question 6). */
export interface ModelInfoLike {
  value: string
  displayName?: string | undefined
  supportsEffort?: boolean | undefined
  supportedEffortLevels?: readonly string[] | undefined
}

/** A Claude Code process as far as a Session watches it (AgentProcess). */
export type ClaudeCodeProcess = AgentProcess

/**
 * A user message as worfy gives it to Claude Code: the part of the SDK's SDKUserMessage it fills.
 * `content` is the text alone, or image blocks and then the text (attachments.ts, userContent).
 */
export interface ClaudeUserMessage {
  type: 'user'
  message: { role: 'user'; content: UserContent }
  parent_tool_use_id: null
  origin: { kind: 'human' }
}

/** The options of canUseTool that worfy reads (SDK 0.3.289, test/fixtures/sdk-messages/can-use-tool.json). */
export interface PermissionRequestOptions {
  signal: AbortSignal
  suggestions?: readonly unknown[] | undefined
  toolUseID?: string | undefined
  title?: string | undefined
  description?: string | undefined
  blockedPath?: string | undefined
  /** Claude Code says the request must not offer a lasting "don't ask again". */
  suppressAlwaysAllowRule?: boolean | undefined
  /** Why Claude Code asks: which of its checks fired. */
  decisionReason?: string | undefined
  /** The Subagent that asks; absent for the Session's own turn. */
  agentID?: string | undefined
  /** The tool's card is where the user answers (AskUserQuestion); worfy reads the tool's name instead. */
  requiresUserInteraction?: boolean | undefined
}

/** The answer canUseTool gives Claude Code; a subset of the SDK's PermissionResult. */
export type PermissionAnswer = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string; interrupt?: boolean }

/** canUseTool as the Claude driver hands it to the query (options.ts passes it to the SDK). */
export type CanUseToolHandler = (toolName: string, input: Record<string, unknown>, options: PermissionRequestOptions) => Promise<PermissionAnswer>

/** The part of the SDK's Query a Session uses; fake-query.ts implements it too. */
export interface QueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>
  close(): void
  accountInfo(): Promise<AccountInfoLike>
  /** undefined: Claude Code's default model. */
  setModel(model?: string): Promise<void>
  setPermissionMode(mode: PermissionModeChoice): Promise<void>
  /** How the SDK changes effort mid-session (ticket 06); null goes back to the model's default. */
  applyFlagSettings(settings: { effortLevel?: EffortChoice | null }): Promise<void>
  supportedModels(): Promise<ModelInfoLike[]>
  /** The slash commands and skills (ticket 20); optional, as a query that lacks it lists those of system/init. */
  supportedCommands?(): Promise<CommandInfoLike[]>
  /**
   * How full the context window is (worfy-polish ticket 23), read leniently (contextUsageOf);
   * optional, as a query that lacks it reports no usage.
   */
  getContextUsage?(opts?: { detail?: 'summary' | 'full' }): Promise<unknown>
}

export interface QueryRequest {
  /**
   * The user's messages: ClaudeUserMessage, as the Claude driver writes them.
   * shortcut: typed `any` — the Project profile draft (src/main/projects/connect.ts) still passes the
   * SDK's own SDKUserMessage here, and this file may not name the SDK (ADR-0094 item 4);
   * test/contract/sdk-compat.test.ts holds ClaudeUserMessage to SDKUserMessage. Redo when
   * worfy-multi-vendor ticket 16 moves the queries into the Claude driver.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shortcut above
  prompt: AsyncIterable<any>
  cwd: string
  /** SDK session id to continue. */
  resume: string | undefined
  /**
   * The id a new SDK session is to have (SDK option `sessionId`): set when `resume` is not, so the
   * Session's id is known before system/init. Never set together with `resume`.
   */
  sessionId?: string | undefined
  /** Claude Code's stderr, kept to explain a crash. */
  stderr: (data: string) => void
  /** The model, effort and permission mode the query starts with. */
  settings: SessionSettings
  /** Answers Claude Code's permission requests: the Claude driver's canUseTool over the Session's gate (permissions.ts). */
  canUseTool: CanUseToolHandler
  /** No person is at the Session (session-settings.ts): Claude Code must run in bypassPermissions. A Session always sets it. */
  unattended?: boolean | undefined
  /**
   * Told of each Claude Code process the query starts (app-registry.ts, through the SDK's
   * spawnClaudeCodeProcess), so the Session can wait for its exit. A Session always sets it; a
   * factory with no process of its own (the fake agent) never calls it.
   */
  spawned?: ((process: ClaudeCodeProcess) => void) | undefined
  /**
   * The Session is a Project's Orchestrator, Autopilot's included (SessionLaunch.orchestrator): its
   * Claude Code gets the Orchestrator's autocompact window, any other Session the other one
   * (app-registry.ts). A Session always sets it.
   */
  orchestrator?: boolean | undefined
  /**
   * Variables Claude Code gets over the agent environment: the Run's TMPDIR and git environment
   * (worfy-auto-approve ticket 04). Absent: none.
   */
  environment?: Readonly<Record<string, string>> | undefined
  /**
   * Told, before Claude Code asks canUseTool about a tool call, where its shell stands for that call
   * (a PreToolUse hook of the query, options.ts): the approval policy judges a command in the folder
   * the agent's `cd`s left it in. Absent: no hook.
   */
  toolUse?: ((use: ToolUseFacts) => void) | undefined
  /**
   * Told the whole environment Claude Code's process starts with, before it starts: the approval policy
   * judges each request of the process in it (worfy-auto-approve ticket 04). Absent: not told.
   */
  processEnv?: ((env: Readonly<Record<string, string | undefined>>) => void) | undefined
}

/** What a PreToolUse hook of Claude Code tells of one tool call. */
export interface ToolUseFacts {
  toolUseId: string
  /** The shell's current folder; null when Claude Code did not say. */
  cwd: string | null
  /** The Session's scratchpad folder (scratchpad_dir); null when it has none. */
  scratchpad: string | null
}

/** Starts Claude Code for a Session: the real SDK, or the fake agent in tests. */
export type QueryFactory = (request: QueryRequest) => Promise<QueryHandle>

/** Receives every event of every Session, with the Session's current id. */
export type EventSink = (sessionId: string, event: AgentEvent) => void

/** Told when a person acts on a Session through the UI: what they did, in a few words. */
export type InputListener = (session: Session, what: string) => void

export interface SessionInfo {
  sessionId: string
  /** The SDK session it runs or will resume, once known: a resumed Session has it before its id is reported. */
  sdkSessionId: string | null
  cwd: string
  state: SessionState
}

/** What the input field shows of a Session besides its events: its settings and its queue. */
export interface SessionControls {
  settings: SessionSettings
  queue: QueueSnapshot
}
