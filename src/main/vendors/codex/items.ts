// Codex's notifications as worfy's events (worfy-multi-vendor ticket 20; spec of the epic, the neutral
// events and how Codex maps to them). A pure module: the Codex SessionHandle (session.ts) gives it every notification of
// its thread, in order, and sends on what comes out; those of the process's other threads (Subagents)
// only through follow(), which keeps their running tools for their approvals and gives no events.
//
// - `item/agentMessage/delta` → `delta` (text); `item/reasoning/summaryTextDelta` → `delta` (thinking);
// - a completed `agentMessage` → `text`, and so a completed `exitedReviewMode` (the review of `/review`,
//   ticket 22): each is the turn's answer; a completed `reasoning` with a summary → `thinking`;
// - `commandExecution`, `fileChange`, `mcpToolCall` and `collabAgentToolCall` (a call about the turn's
//   Subagents: spawn, wait, send…; worfy-retry ticket 08) → `tool_use` when they start and `tool_result`
//   when they complete (a tool that completes without having started gets both then);
// - `turn/started` → `init` (the thread's id as the Vendor's session id); `turn/completed` → `result`,
//   an interrupted or failed turn with its text; `error` → a `result` with the error, after which the
//   `turn/completed` of the same turn gives nothing more; an `error` Codex retries by itself → `notice`.
//   The `result`'s `terminalReason` is the error's `codexErrorInfo` key, with its HTTP status when Codex
//   gives one (`responseTooManyFailedAttempts:429`): turnFailureKind reads both (worfy-retry ticket 08);
// - `thread/tokenUsage/updated` → `context`;
// - a notification or an item of a kind worfy does not know → `unknown`, named by its method or
//   `item/<type>`. Those that only repeat what the events above already say give nothing.
//
// A text that came from Codex and goes into a `result` or a `notice` is bounded (boundedText): an
// error message of the app-server may carry a whole response body.
import type { AgentEvent, ContextUsage } from '../../../shared/agent/events'
import type { ServerNotification } from './protocol/ts/ServerNotification'
import type { ErrorNotification } from './protocol/ts/v2/ErrorNotification'
import type { ThreadItem } from './protocol/ts/v2/ThreadItem'
import type { ThreadTokenUsage } from './protocol/ts/v2/ThreadTokenUsage'
import type { Turn } from './protocol/ts/v2/Turn'
import type { TurnError } from './protocol/ts/v2/TurnError'

/** How many characters of a Codex error a `result` or a `notice` keeps. */
export const ERROR_TEXT_LIMIT = 2_000

/** `text`, cut to `limit` characters with a note of how much was left out. */
export function boundedText(text: string, limit = ERROR_TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)} … (${text.length - limit} more characters)`
}

/** What a turn's `init` says besides the thread: the model and preset it runs with. */
export interface CodexTurnContext {
  threadId(): string
  cwd(): string
  /** The version of Codex that runs the thread (`cliVersion`), when known. */
  version(): string | null
  model(): string
  /** The id of the permission preset the thread runs with. */
  preset(): string
}

type Result = Extract<AgentEvent, { type: 'result' }>
type Usage = Result['usage']

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

/** Notifications that only repeat what the events of other notifications say. */
const QUIET = new Set([
  'thread/started',
  'thread/status/changed',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'item/mcpToolCall/progress',
  'serverRequest/resolved',
  'turn/diff/updated',
])

const textOf = (error: TurnError | null | undefined): string | null => {
  const message = typeof error?.message === 'string' && error.message.trim() !== '' ? error.message : null
  const details = typeof error?.additionalDetails === 'string' && error.additionalDetails.trim() !== '' ? error.additionalDetails : null
  if (message === null) return details
  return details === null ? message : `${message}\n${details}`
}

/**
 * The kind of a Codex error, as a `result` names its end: `usageLimitExceeded`, `httpConnectionFailed:503`, …
 * — the `codexErrorInfo` key, and `:<status>` when its fields carry an `httpStatusCode`.
 */
const errorKind = (error: TurnError | null | undefined): string | null => {
  const info = error?.codexErrorInfo
  if (typeof info === 'string') return info
  if (info === null || typeof info !== 'object') return null
  const key = Object.keys(info)[0]
  if (key === undefined) return null
  const fields = (info as Record<string, unknown>)[key]
  const status = fields !== null && typeof fields === 'object' ? (fields as { httpStatusCode?: unknown }).httpStatusCode : undefined
  return Number.isInteger(status) ? `${key}:${String(status)}` : key
}

/** How full the context window is after the turn's latest request; null when Codex did not give the window. */
export function contextUsageOf(usage: ThreadTokenUsage): ContextUsage | null {
  const window = usage.modelContextWindow
  if (typeof window !== 'number' || window <= 0) return null
  const totalTokens = usage.last.totalTokens
  // Codex does not say over the protocol when it compacts.
  return { percentage: Math.round((totalTokens / window) * 100), totalTokens, windowTokens: window, autoCompactThreshold: null, autoCompactEnabled: false }
}

/** The text of an MCP tool's result: its text parts, else the whole content as JSON. */
function mcpContent(item: Extract<ThreadItem, { type: 'mcpToolCall' }>): string {
  if (item.error !== null && item.error !== undefined) return item.error.message
  const content = item.result?.content ?? []
  const texts = content.flatMap((part) => {
    const record = part as { type?: unknown; text?: unknown } | null
    return record !== null && typeof record === 'object' && record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
  })
  return texts.length === content.length ? texts.join('\n') : JSON.stringify(content)
}

/** The `tool_use` of a tool item: its name and what it was given. */
export function toolUse(item: ThreadItem): Extract<AgentEvent, { type: 'tool_use' }> | null {
  switch (item.type) {
    case 'commandExecution':
      return { type: 'tool_use', id: item.id, name: 'commandExecution', input: { command: item.command, cwd: item.cwd }, parentToolUseId: null }
    case 'fileChange':
      return { type: 'tool_use', id: item.id, name: 'fileChange', input: { changes: item.changes }, parentToolUseId: null }
    case 'mcpToolCall':
      return { type: 'tool_use', id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments, parentToolUseId: null }
    case 'collabAgentToolCall':
      // Not `Agent`: that name is Claude Code's, and the Subagent tree and the Flight Recorder read it as
      // Claude's. Any name outside continue-plan.ts LOCAL_TOOLS is an external action there.
      return { type: 'tool_use', id: item.id, name: 'collabAgentToolCall', input: { tool: item.tool, receiverThreadIds: item.receiverThreadIds, prompt: item.prompt }, parentToolUseId: null }
    default:
      return null
  }
}

/** The `tool_result` of a completed tool item: its output, and whether it failed or was declined. */
export function toolResult(item: ThreadItem): Extract<AgentEvent, { type: 'tool_result' }> | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        type: 'tool_result',
        toolUseId: item.id,
        content: item.aggregatedOutput ?? '',
        isError: item.status !== 'completed' || (typeof item.exitCode === 'number' && item.exitCode !== 0),
        parentToolUseId: null,
      }
    case 'fileChange':
      return {
        type: 'tool_result',
        toolUseId: item.id,
        content: (item.changes ?? []).map((change) => `${change.kind.type} ${change.path}`).join('\n'),
        isError: item.status !== 'completed',
        parentToolUseId: null,
      }
    case 'mcpToolCall':
      return {
        type: 'tool_result',
        toolUseId: item.id,
        content: mcpContent(item),
        isError: item.status !== 'completed' || (item.error !== null && item.error !== undefined),
        parentToolUseId: null,
      }
    case 'collabAgentToolCall':
      return {
        type: 'tool_result',
        toolUseId: item.id,
        content: Object.entries(item.agentsStates)
          .map(([agent, state]) => `${agent}: ${state?.status ?? 'unknown'}${state?.message ? ` — ${state.message}` : ''}`)
          .join('\n'),
        isError: item.status !== 'completed',
        parentToolUseId: null,
      }
    default:
      return null
  }
}

/** The events of the notifications of one thread, in order; keeps what a later notification needs. */
export class CodexItems {
  /** Items that started and have not completed, by id: an approval names its item only by id. */
  private readonly started = new Map<string, ThreadItem>()
  /** The text of the last agent message of each running turn: its `result` carries it. */
  private readonly answers = new Map<string, string>()
  /** The usage of the last request of each running turn. */
  private readonly usages = new Map<string, Usage>()
  /** Turns whose `result` was already given (by an `error`): their `turn/completed` gives none. */
  private readonly ended = new Set<string>()

  constructor(private readonly context: CodexTurnContext) {}

  /** The item `id` while it runs. */
  item(id: string): ThreadItem | undefined {
    return this.started.get(id)
  }

  /**
   * A notification of another thread of the same process (a Subagent's): gives no events, but keeps its
   * tool items while they run, as take() does — that thread's approvals name their item only by id.
   */
  follow(notification: ServerNotification): void {
    if (notification.method === 'item/started' && toolUse(notification.params.item) !== null) this.started.set(notification.params.item.id, notification.params.item)
    if (notification.method === 'item/completed') this.started.delete(notification.params.item.id)
  }

  take(notification: ServerNotification): AgentEvent[] {
    switch (notification.method) {
      case 'turn/started':
        return [this.init()]
      case 'turn/completed':
        return this.completed(notification.params.turn)
      case 'error':
        return this.error(notification.params)
      case 'item/agentMessage/delta':
        return [{ type: 'delta', kind: 'text', text: notification.params.delta, parentToolUseId: null }]
      case 'item/reasoning/summaryTextDelta':
        return [{ type: 'delta', kind: 'thinking', text: notification.params.delta, parentToolUseId: null }]
      case 'item/started':
        return this.itemStarted(notification.params.item)
      case 'item/completed':
        return this.itemCompleted(notification.params.item, notification.params.turnId)
      case 'thread/tokenUsage/updated': {
        const { last } = notification.params.tokenUsage
        this.usages.set(notification.params.turnId, {
          inputTokens: last.inputTokens,
          outputTokens: last.outputTokens,
          cacheCreationInputTokens: last.cacheWriteInputTokens ?? 0,
          cacheReadInputTokens: last.cachedInputTokens,
        })
        return [{ type: 'context', usage: contextUsageOf(notification.params.tokenUsage) }]
      }
      default:
        return QUIET.has(notification.method) ? [] : [{ type: 'unknown', sdkType: notification.method }]
    }
  }

  private init(): AgentEvent {
    const { context } = this
    return {
      type: 'init',
      sdkSessionId: context.threadId(),
      model: context.model(),
      permissionMode: context.preset(),
      apiKeySource: 'none',
      cwd: context.cwd(),
      claudeCodeVersion: context.version(),
      slashCommands: [],
    }
  }

  /** A tool's start is its `tool_use`; any other item says what it is when it completes. */
  private itemStarted(item: ThreadItem): AgentEvent[] {
    const use = toolUse(item)
    if (use === null) return []
    this.started.set(item.id, item)
    return [use]
  }

  private itemCompleted(item: ThreadItem, turnId: string): AgentEvent[] {
    const wasStarted = this.started.delete(item.id)
    switch (item.type) {
      case 'agentMessage':
        this.answers.set(turnId, item.text)
        return [{ type: 'text', text: item.text, messageId: item.id, parentToolUseId: null, synthetic: false }]
      case 'exitedReviewMode':
        // The review of `/review` (review/start): Codex gives its findings in this item, not in an agent message.
        this.answers.set(turnId, item.review)
        return [{ type: 'text', text: item.review, messageId: item.id, parentToolUseId: null, synthetic: false }]
      case 'reasoning': {
        const summary = (item.summary ?? []).filter((part) => part.trim() !== '').join('\n\n')
        return summary === '' ? [] : [{ type: 'thinking', text: summary, messageId: item.id, parentToolUseId: null }]
      }
      case 'userMessage':
        // The Session gave the message itself (`prompt`).
        return []
      default: {
        const result = toolResult(item)
        if (result === null) return [{ type: 'unknown', sdkType: `item/${item.type}` }]
        const use = wasStarted ? null : toolUse(item)
        return use === null ? [result] : [use, result]
      }
    }
  }

  private error(params: ErrorNotification): AgentEvent[] {
    const message = textOf(params.error) ?? 'Codex reported an error.'
    if (params.willRetry) return [{ type: 'notice', kind: 'notification', text: boundedText(`Codex: ${message} It tries again.`) }]
    if (this.ended.has(params.turnId)) return []
    this.ended.add(params.turnId)
    return [this.result(params.turnId, { subtype: 'error', error: message, terminalReason: errorKind(params.error) ?? 'error', interrupted: false, durationMs: 0 })]
  }

  private completed(turn: Turn): AgentEvent[] {
    if (this.ended.delete(turn.id)) return []
    const durationMs = typeof turn.durationMs === 'number' ? turn.durationMs : 0
    switch (turn.status) {
      case 'completed':
        return [this.result(turn.id, { subtype: 'success', error: null, terminalReason: 'completed', interrupted: false, durationMs })]
      case 'interrupted':
        return [this.result(turn.id, { subtype: 'interrupted', error: textOf(turn.error) ?? 'The turn was interrupted.', terminalReason: 'interrupted', interrupted: true, durationMs })]
      case 'failed':
        return [this.result(turn.id, { subtype: 'error', error: textOf(turn.error) ?? 'The turn failed.', terminalReason: errorKind(turn.error) ?? 'failed', interrupted: false, durationMs })]
      default:
        return [{ type: 'unknown', sdkType: `turn/completed/${String(turn.status)}` }]
    }
  }

  private result(turnId: string, end: { subtype: string; error: string | null; terminalReason: string; interrupted: boolean; durationMs: number }): Result {
    const text = end.error === null ? (this.answers.get(turnId) ?? null) : null
    const usage = this.usages.get(turnId) ?? NO_USAGE
    this.answers.delete(turnId)
    this.usages.delete(turnId)
    return {
      type: 'result',
      subtype: end.subtype,
      isError: end.error !== null,
      error: end.error === null ? null : boundedText(end.error),
      text,
      costUsd: 0,
      durationMs: end.durationMs,
      numTurns: 1,
      usage: { ...usage },
      terminalReason: end.terminalReason,
      interrupted: end.interrupted,
    }
  }
}
