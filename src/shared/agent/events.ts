// worfy's own events of a Session: the neutral model every Vendor's agent is translated into
// (ADR-0094 item 1). The renderer never sees a Vendor's own message: the driver of each Vendor turns
// its messages into these events — Claude's in src/shared/vendors/claude/events.ts — and main sends
// them on `agent.event`.
import { z } from 'zod'
import { messageAttachmentSchema } from './attachments'
import { AUTO_APPROVAL_LINE_MODES, AUTO_APPROVAL_OUTCOMES } from './auto-approval'
import { limitStateSchema, limitWindowSchema } from './limits'
import { questionSchema } from './questions'
import { sessionSettingsSchema } from './settings'

/** Lifecycle of a Session as the renderer shows it. */
export const sessionState = z.enum(['starting', 'busy', 'idle', 'needs_permission', 'error', 'closed'])
export type SessionState = z.infer<typeof sessionState>

const nullableString = z.string().nullable()

/**
 * Strings keyed by any text, "__proto__" too. z.record builds its output by assignment into a plain
 * {}, where "__proto__" sets the prototype and the key is lost; this keeps the input object, whose
 * keys come from JSON or a structured clone as own keys.
 */
const stringMap = z.custom<Record<string, string>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((each) => typeof each === 'string'),
  'Expected an object of strings',
)

/** A message waiting in a Session's queue; `id` tells two messages with the same text apart. */
export const queuedMessageSchema = z.object({ id: z.string().min(1), text: z.string() })
export type QueuedMessage = z.output<typeof queuedMessageSchema>

/** A Session's queue: its messages, oldest first, and whether it is held (after Interrupt). */
export const queueSnapshotSchema = z.object({ items: z.array(queuedMessageSchema), paused: z.boolean() })
export type QueueSnapshot = z.output<typeof queueSnapshotSchema>

/**
 * How full a Session's context window is, as Claude Code's getContextUsage() reports it — the
 * numbers of `/context` (worfy-polish ticket 23). `windowTokens` is the window the percentage is
 * measured against: the autocompact window, which on a 1M model may be smaller than the model's
 * own. `autoCompactThreshold`: the tokens at which Claude Code compacts; null when it does not say.
 */
export const contextUsageSchema = z.object({
  percentage: z.number(),
  totalTokens: z.number(),
  windowTokens: z.number(),
  autoCompactThreshold: z.number().nullable(),
  autoCompactEnabled: z.boolean(),
})
export type ContextUsage = z.output<typeof contextUsageSchema>

/**
 * What an option of a permission request does: lets this one request through (`allow`), lets it and
 * every later request of the same subject in this Session through (`allow_always`), or refuses it
 * (`deny`). The transcript styles the option's button by it.
 */
export const permissionOptionKindSchema = z.enum(['allow', 'allow_always', 'deny'])
export type PermissionOptionKind = z.infer<typeof permissionOptionKindSchema>

/**
 * One answer a Vendor offers to a permission request, in its own words (ADR-0094 item 2): `id` goes
 * back to the Vendor through `agent.permission`, `label` is the button's text. Claude offers Allow,
 * Always allow and Deny (src/main/vendors/claude/session.ts).
 */
export const permissionOptionSchema = z.object({ id: z.string().min(1), label: z.string().min(1), kind: permissionOptionKindSchema })
export type PermissionOption = z.output<typeof permissionOptionSchema>

/** The id of the option the user picked for a permission request (ticket 21; worfy-multi-vendor ticket 14). */
export const permissionOptionIdSchema = z.string().min(1)

/**
 * When an event happened, in ms since the epoch: the record's `timestamp` for an event read from a
 * transcript file (src/shared/transcript/parse.ts), the time the renderer received a live event
 * (src/renderer/session/store.ts). Absent when nothing says; the transcript then shows no time.
 */
const at = z.number().optional()

/** A member of `agentEvent`: its own fields, and when it happened. */
const timed = <Shape extends z.ZodRawShape>(shape: Shape) => z.object({ ...shape, at })

/**
 * The Vendor's agent asks before it acts (src/main/agent/permissions.ts; Claude Code's canUseTool,
 * src/main/vendors/claude/session.ts); the Session is `needs_permission` until every open request
 * is resolved. `subject`: what is asked about, as the card names it (Claude: the tool's name).
 * `options`: the answers the Vendor offers, in the order the card shows them. `suggestions`: what
 * Claude Code proposed and where it would write; worfy applies none of them. `parked`: the approval
 * policy of an unattended Session left the request to the owner (worfy-auto-approve ticket 07,
 * src/main/agent/auto-approve/park.ts) — the id of its rule and the paths it judged; absent otherwise.
 * `productWrite`: a Product Session wants to write a file outside its folder (worfy-polish ticket 82,
 * src/main/agent/product-guard.ts) — the file's real path and its folder, which the `allow_always`
 * option adds to the Project's list «Product Session may also write here» instead of this Session's
 * memory; absent otherwise.
 */
const permissionRequestEvent = timed({
  type: z.literal('permission_request'),
  requestId: z.string().min(1),
  subject: z.string(),
  toolName: z.string(),
  toolUseId: nullableString,
  input: z.unknown(),
  title: nullableString,
  description: nullableString,
  blockedPath: nullableString,
  suggestions: z.array(z.object({ type: z.string(), destination: nullableString })),
  options: z.array(permissionOptionSchema).min(1),
  parked: z.object({ rule: z.string().min(1), targets: z.array(z.string()) }).optional(),
  productWrite: z.object({ path: z.string().min(1), folder: z.string().min(1) }).optional(),
})

/**
 * Claude Code asks the user questions with answer options (its AskUserQuestion tool, through
 * canUseTool; worfy-ui ticket 17, src/shared/agent/questions.ts). Counts as an open request: the
 * Session is `needs_permission` until it is resolved. Never offers "Always allow".
 */
const questionRequestEvent = timed({ type: z.literal('question_request'), requestId: z.string().min(1), toolUseId: nullableString, questions: z.array(questionSchema).min(1) })

/**
 * The events that open a request the user answers: what `agent.requests` answers for a window that did not see
 * them go out (worfy-product-session ticket 30).
 */
export const openRequestEvent = z.discriminatedUnion('type', [permissionRequestEvent, questionRequestEvent])
export type OpenRequestEvent = z.infer<typeof openRequestEvent>

export const agentEvent = z.discriminatedUnion('type', [
  // Events of worfy itself, not of an SDK message (ticket 19).
  /**
   * worfy gave Claude Code a message of the user: sent at once, or taken from the queue when the
   * turn before it ended. Not sent for a message that only went into the queue. `text` is what the
   * user typed; `attachments`, what went with it, shown without paths or bytes (worfy-ui ticket 28).
   */
  timed({ type: z.literal('prompt'), text: z.string(), attachments: z.array(messageAttachmentSchema).optional() }),
  /** The Session's message queue (src/main/agent/queue.ts) changed; the whole queue, oldest first. */
  timed({ type: z.literal('queue'), items: z.array(queuedMessageSchema), paused: z.boolean() }),
  /** The model, effort and permission mode the Session now runs with, as worfy set them. */
  timed({ type: z.literal('settings'), settings: sessionSettingsSchema }),
  /**
   * How full the context window is, asked after each `result` and each compaction; `usage` null:
   * no data (the ask failed). Sent only when it differs from the Session's last one.
   */
  timed({ type: z.literal('context'), usage: contextUsageSchema.nullable() }),
  /**
   * The live summary of a Product Session's turn (worfy-product-session ticket 32, src/main/agent/narrator.ts):
   * the lines to show under the status line now, oldest first; empty when the turn ended. `first` numbers the first
   * of them among the lines of the turn, from 0, so each line keeps its number — and the window its element — as the
   * oldest go. Not part of the transcript: the window keeps only the latest, as it does a `queue` or `context` event.
   */
  timed({ type: z.literal('narration'), lines: z.array(z.string()), first: z.number().int().nonnegative() }),
  permissionRequestEvent,
  /**
   * A permission request was answered — `decision` is the id of the option picked — or `cancelled`
   * by Interrupt, by closing the Session or by the Vendor.
   */
  timed({ type: z.literal('permission_resolved'), requestId: z.string().min(1), decision: permissionOptionIdSchema }),
  questionRequestEvent,
  /**
   * A question request was `answered` (`answers`: question text → the answer Claude Code got),
   * `declined` by the user, or `cancelled` by Interrupt, by closing the Session or by Claude Code;
   * `answers` is empty unless answered.
   */
  timed({ type: z.literal('question_resolved'), requestId: z.string().min(1), outcome: z.enum(['answered', 'declined', 'cancelled']), answers: stringMap }),
  /**
   * An unattended Session (Autopilot, src/main/agent/session-settings.ts) refused something that
   * would have waited for a person, and showed nothing: a permission request (`subject`: the tool's
   * name) or a Card's `session.ask` (`subject`: the Card's id). `message`: the refusal given. For a
   * permission request, `agent`: the Subagent that asked (Claude Code's agentID), absent for the
   * Session's own turn; `reason`: why Claude Code asked (its decisionReason), when it said. A
   * `card_ask` has neither. The journal of an Autopilot run records it as `refused-dialog`.
   */
  timed({
    type: z.literal('refused_dialog'),
    dialog: z.enum(['permission_request', 'card_ask']),
    subject: z.string(),
    message: z.string(),
    agent: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  }),
  /**
   * The approval policy judged a permission request of an unattended Session while Auto-approval was
   * Shadow or On (worfy-auto-approve ticket 04, src/main/agent/auto-approve/policy.ts); at Off it is not
   * asked, and the refusal is `refused_dialog` as before. `mode`: the mode at the request; `outcome`:
   * what the agent got in On (`park`: the request waits for the owner on the Session's gate, ticket 07;
   * it ends with `park-answered` — `answer`: the kind of the option the owner picked — or with
   * `park-expired`: the wait limit or a stop of the run), what it would have got in Shadow (`would-*`;
   * a hard deny stays `hard-deny`), where the agent got the refusal of Off; `rule`: the id of the rule
   * that decided; `tool`; `targets`: the paths judged; `command`: the Bash command as asked, null for
   * another tool; `agent` and `reason` as in `refused_dialog`. The journal of an Autopilot run records
   * it as `auto-approval`, cleaned (journalCommand).
   */
  timed({
    type: z.literal('auto_approval'),
    mode: z.enum(AUTO_APPROVAL_LINE_MODES),
    outcome: z.enum(AUTO_APPROVAL_OUTCOMES),
    rule: z.string().min(1),
    tool: z.string(),
    targets: z.array(z.string()),
    command: z.string().nullable(),
    agent: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    answer: z.enum(['allow', 'deny']).optional(),
  }),
  /** system/init: arrives at the start of every turn with the current model and mode. */
  timed({
    type: z.literal('init'),
    sdkSessionId: z.string(),
    model: z.string(),
    permissionMode: z.string(),
    /** For display only: it is `none` both with a subscription login and without any (ADR-0009). */
    apiKeySource: z.string(),
    cwd: z.string(),
    claudeCodeVersion: nullableString,
    slashCommands: z.array(z.string()),
  }),
  /** The Session's temporary id was replaced by the id Claude Code gave it; `from` is the old one. */
  timed({ type: z.literal('renamed'), from: z.string() }),
  /** Login of Claude Code, from accountInfo() (ADR-0009). */
  timed({
    type: z.literal('account'),
    loggedIn: z.boolean(),
    subscriptionType: nullableString,
    apiProvider: nullableString,
    tokenSource: nullableString,
  }),
  /** A whole text block of an assistant message. `synthetic`: written by Claude Code, not the model. */
  timed({ type: z.literal('text'), text: z.string(), messageId: z.string(), parentToolUseId: nullableString, synthetic: z.boolean() }),
  timed({ type: z.literal('thinking'), text: z.string(), messageId: z.string(), parentToolUseId: nullableString }),
  /** A piece of text or thinking while the block is still being written (partial messages). */
  timed({ type: z.literal('delta'), kind: z.enum(['text', 'thinking']), text: z.string(), parentToolUseId: nullableString }),
  timed({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown(), parentToolUseId: nullableString }),
  timed({ type: z.literal('tool_result'), toolUseId: z.string(), content: z.string(), isError: z.boolean(), parentToolUseId: nullableString }),
  /** A hook that said something: a non-zero exit, a failed outcome, or output (e.g. a Stop hook blocking the turn). */
  timed({
    type: z.literal('hook'),
    hookEvent: z.string(),
    hookName: z.string(),
    exitCode: z.number().nullable(),
    outcome: z.string(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  /**
   * Text in the transcript that the model did not write. Of kind `user`: the user's message, its
   * text as typed and, read from a transcript file, its attachments (src/shared/transcript/parse.ts).
   */
  timed({
    type: z.literal('notice'),
    kind: z.enum(['synthetic', 'user', 'local_command', 'notification']),
    text: z.string(),
    attachments: z.array(messageAttachmentSchema).optional(),
  }),
  /**
   * A task of the Session started (task_started: a subagent of the Agent tool, a Bash or a workflow
   * script), or its task-notification arrived. The fields from `isBackgrounded` on come only from
   * the live Session's SDK messages (worfy-daily ticket 29), not from a transcript file.
   */
  timed({
    type: z.literal('subagent'),
    phase: z.enum(['started', 'finished']),
    taskId: z.string(),
    toolUseId: nullableString,
    description: nullableString,
    subagentType: nullableString,
    status: nullableString,
    summary: nullableString,
    /** The Subagent's final answer, as a transcript file's task-notification records it. */
    result: nullableString.optional(),
    /** Started in the background: the turn does not wait for it. */
    isBackgrounded: z.boolean().nullable().optional(),
    /** `local_agent`, `local_bash`, `local_workflow`, … */
    taskType: nullableString.optional(),
    /** Housekeeping, not work: it holds nothing (ADR-0029). */
    ambient: z.boolean().nullable().optional(),
    /** Why a task ended other than normally: `worker_restart` — the process restarted and the task was orphaned. */
    reason: nullableString.optional(),
  }),
  /**
   * system/background_tasks_changed: every live background task of the Claude Code process after a
   * change, ambient ones included. A level: it replaces the set before it (ADR-0029).
   */
  timed({
    type: z.literal('background_tasks_changed'),
    tasks: z.array(z.object({ taskId: z.string(), taskType: nullableString, description: nullableString, ambient: z.boolean() })),
  }),
  /**
   * system/task_progress or system/task_updated: a task of the Session is still at work. Shown
   * nowhere; Autopilot counts it as a sign of life. `backgrounded`: the task moved to the background.
   * Main-process only (isMainOnlyEvent): it never goes to a window.
   */
  timed({ type: z.literal('task_activity'), taskId: z.string(), backgrounded: z.boolean() }),
  /**
   * worfy's own count of the Session's live background tasks, ambient ones left out
   * (src/shared/agent/background-tasks.ts): sent by the Session whenever it changes, also when a
   * new Claude Code process empties it. Never made from an SDK message or a transcript record.
   */
  timed({
    type: z.literal('background_tasks'),
    tasks: z.array(z.object({ taskId: z.string(), taskType: nullableString, description: nullableString })),
  }),
  /** A slash command the user typed (`/name args`); only a transcript file records it as such. */
  timed({ type: z.literal('command'), name: z.string(), args: z.string() }),
  /** The Session got a title (`custom-title`, `ai-title`, `agent-name` records of a transcript file). */
  timed({ type: z.literal('title'), source: z.enum(['custom', 'ai', 'agent']), title: z.string() }),
  /**
   * What a Vendor told about its Limits (ADR-0094): the windows it named, in the neutral view, and
   * the status it reported with them, if any — in its own word (`text`), the state that word means,
   * the window it named and the reset time it gave, each as the Vendor sent it (null when absent).
   * The status may name no window, and its reset time may differ from that of its window.
   */
  timed({
    type: z.literal('limits'),
    vendor: z.string(),
    windows: z.array(limitWindowSchema),
    status: z.object({ text: z.string(), state: limitStateSchema.nullable(), windowId: nullableString, resetsAt: z.number().nullable() }).nullable(),
  }),
  /**
   * A Vendor refused a request by its Limits. `window`: a window ran out and resets (`windowId` and
   * `resetsAt` when the Vendor said which and when), so waiting helps; `quota`: a quota without a
   * reset, so waiting does not.
   */
  timed({
    type: z.literal('limit_reached'),
    vendor: z.string(),
    windowId: nullableString,
    resetsAt: z.number().nullable(),
    reason: z.enum(['window', 'quota']),
  }),
  /** system/status: `requesting`, `compacting` or null, and the permission mode after a change. */
  timed({ type: z.literal('status'), status: nullableString, permissionMode: nullableString }),
  /** system/commands_changed: the slash commands now available. */
  timed({ type: z.literal('commands'), slashCommands: z.array(z.string()) }),
  /** The end of a turn, after every Stop hook continuation. */
  timed({
    type: z.literal('result'),
    subtype: z.string(),
    isError: z.boolean(),
    /** The error text of a failed turn; null when the turn succeeded. */
    error: nullableString,
    /** The final answer of a successful turn. */
    text: nullableString,
    costUsd: z.number(),
    durationMs: z.number(),
    numTurns: z.number(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheCreationInputTokens: z.number(),
      cacheReadInputTokens: z.number(),
    }),
    terminalReason: nullableString,
    /** The turn was stopped by agent.interrupt. */
    interrupted: z.boolean(),
  }),
  timed({ type: z.literal('state'), state: sessionState, error: nullableString }),
  /**
   * An SDK message or a transcript record worfy does not know (or whose shape changed): visible
   * for debugging only. For a transcript record `sdkType` names the record (src/shared/transcript/parse.ts).
   */
  timed({ type: z.literal('unknown'), sdkType: z.string() }),
])
export type AgentEvent = z.infer<typeof agentEvent>

/**
 * Whether an event stays in the main process: the Session's observers get it (Autopilot), its
 * sink — the windows — does not. `task_activity` comes with every tool use of every background
 * task and is shown nowhere; in a window it would only push the Session's earlier events out of
 * the renderer's bounded event list.
 */
export function isMainOnlyEvent(event: AgentEvent): boolean {
  return event.type === 'task_activity'
}

/** What travels on `agent.event`: one event of one Session. */
export const agentEventEnvelope = z.object({ sessionId: z.string(), event: agentEvent })
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelope>

/** Whether two context usages are the same numbers; null is "no data". */
export function sameContextUsage(a: ContextUsage | null, b: ContextUsage | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.percentage === b.percentage &&
    a.totalTokens === b.totalTokens &&
    a.windowTokens === b.windowTokens &&
    a.autoCompactThreshold === b.autoCompactThreshold &&
    a.autoCompactEnabled === b.autoCompactEnabled
  )
}
