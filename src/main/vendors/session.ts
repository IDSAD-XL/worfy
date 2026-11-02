// The session part of a Vendor driver (ADR-0094 item 2): how worfy starts and drives the Vendor's
// agent for a Session. The Session (src/main/agent/session.ts) talks to its agent only through these
// types: a SessionHandle per process of the agent, worfy's AgentEvents out of it, worfy's message
// and permission types into it. The Vendor's own messages never leave its driver.
import type { Attachment } from '../../shared/agent/attachments'
import type { SlashCommand } from '../../shared/agent/commands'
import type { AgentEvent } from '../../shared/agent/events'
import type { Question } from '../../shared/agent/questions'
import type { ModelOption, SessionSettings } from '../../shared/agent/settings'

/** A message of the user, in worfy's types rather than the Vendor's. */
export interface SessionMessage {
  text: string
  attachments: readonly Attachment[]
}

/**
 * A process the Vendor's agent runs in, as far as a Session waits for its exit (Node's ChildProcess
 * has all of it). A process without a pid never started (spawn failed) and is not waited for.
 */
export interface AgentProcess {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'exit', listener: () => void): unknown
}

type PermissionRequestEvent = Extract<AgentEvent, { type: 'permission_request' }>

/**
 * A request for the user's permission as the Vendor's driver puts it: the `permission_request`
 * event without its id, which the Session gives it, and the signal with which the Vendor withdraws it.
 */
export type PermissionAsk = Omit<PermissionRequestEvent, 'type' | 'requestId' | 'at'> & { signal: AbortSignal }

/** Questions with answer options to the user (Claude Code's AskUserQuestion), and the signal that withdraws them. */
export interface QuestionAsk {
  toolUseId: string | null
  questions: Question[]
  signal: AbortSignal
}

/** What became of questions: answered (question text → the answer), declined by the user, or cancelled. */
export type QuestionReply = { outcome: 'answered'; answers: Record<string, string> } | { outcome: 'declined' } | { outcome: 'cancelled' }

/** Who asked and why, as an unattended refusal reports them; a field the Vendor did not give is absent. */
export interface RefusalDetails {
  agent?: string
  reason?: string
}

/**
 * Where a driver takes the user's answers from: the Session's own gate (src/main/agent/permissions.ts),
 * which outlives the processes of the Session.
 */
export interface PermissionAsker {
  /**
   * Asks the user; answers the id of the option picked, or null when the request was cancelled
   * (Interrupt, the close, a crash, or the Vendor's own signal). An option of kind `allow_always`
   * picked once answers every later request of the same subject in this Session at once.
   */
  ask(request: PermissionAsk): Promise<string | null>
  askQuestions(request: QuestionAsk): Promise<QuestionReply>
}

/** What the agent of a Session is started with; the same for a start and a resume. */
export interface SessionStart {
  cwd: string
  /** The model, effort and permission preset the agent starts with; null model and effort: the Vendor's default. */
  settings: SessionSettings
  /** No person is at the Session (Autopilot): nothing may wait for the UI, a permission request is refused at once. */
  unattended: boolean
  /** The Session is a Project's Orchestrator (SessionLaunch.orchestrator). */
  orchestrator: boolean
  /** Answers the agent's permission requests and questions; not asked when `unattended`. */
  permissions: PermissionAsker
  /** Told of each request an unattended Session refused: what was asked about, the refusal given, who asked and why. */
  refused(subject: string, message: string, details: RefusalDetails): void
  /** The agent's process' stderr, kept to explain a crash. */
  stderr(data: string): void
  /** Told of each process the agent starts, so the Session can wait for its exit. */
  spawned(process: AgentProcess): void
  /**
   * The handle of the process before this one in the same Session, if any: what the driver keeps of
   * a Session across its processes comes over from it (Claude: the catalog of slash commands).
   */
  previous?: SessionHandle | undefined
}

/**
 * One live process of a Vendor's agent for a Session, in worfy's types only: the Vendor's own messages
 * never come out of it. A Session whose process died gets a new handle from `resume`.
 */
export interface SessionHandle {
  /** Sends a message: queued while a turn runs, or into the turn when the Vendor can steer. */
  send(message: SessionMessage): Promise<void>
  interrupt(): Promise<void>
  /** Ends the process: its events end, and a permission request it still has open is withdrawn. */
  close(): void
  /** null: the Vendor's default model (for Claude, the user's own model from settings.json). */
  setModel(model: string | null): Promise<void>
  /** A level of the Vendor's `effortLevels`; null: the model's default (for Claude, the user's own). */
  setEffort(effort: string | null): Promise<void>
  /** The id of one of the Vendor's `permissionPresets`. */
  setPermissionPreset(id: string): Promise<void>
  /** The model picker's rows the running agent offers; empty when it cannot say. The default model is `value: null`. */
  models(): Promise<ModelOption[]>
  /** The slash menu's rows: those the running agent lists, else what it last said of them. */
  commands(): Promise<SlashCommand[]>
  /**
   * What the agent does, as worfy's events. `account` comes once the agent answered its start check:
   * until then the Session is `starting`. `init` comes at the start of every turn and `result` at its
   * end; `context` after each `result` and each compaction (the Session passes on only a change).
   * Ends when the process is gone, with an error that says why; a start the agent never confirmed —
   * the start check failed before any message was sent and any turn began — ends it with that error.
   */
  events: AsyncIterable<AgentEvent>
}

export interface SessionPart {
  /**
   * Starts the agent of a new Session. `sessionId`: the id the Session gives it, where the Vendor
   * lets worfy name its session (Claude); the Vendor's own id comes with `init` in any case.
   */
  start(opts: SessionStart & { sessionId?: string | undefined }): Promise<SessionHandle>
  /** Starts the agent again on the Vendor's session `id`: a Session reopened, or one whose process died. */
  resume(id: string, opts: SessionStart): Promise<SessionHandle>
}
