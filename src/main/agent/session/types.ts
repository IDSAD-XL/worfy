// The types at a Session's boundary (session.ts): what it reads of the SDK's query and of a Claude
// Code process, how it is started, and what it tells its subscribers.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../../shared/agent/events'
import type { EffortChoice, PermissionModeChoice, SessionSettings } from '../../../shared/agent/settings'
import type { CommandInfoLike } from '../commands'
import type { CanUseToolHandler } from '../permissions'
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

/**
 * A Claude Code process as far as a Session watches it: Node's ChildProcess has all of it. A process
 * without a pid never started (spawn failed) and is not waited for.
 */
export interface ClaudeCodeProcess {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'exit', listener: () => void): unknown
}

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
  prompt: AsyncIterable<SDKUserMessage>
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
  /** Answers Claude Code's permission requests (permissions.ts); one gate per Session, across its queries. */
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
