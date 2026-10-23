// Turns a Session's events (src/shared/agent/events.ts) into the rows of its transcript. The
// events may come from the live Session (store.ts) or from a transcript file: this file does not
// know which. Each row takes the time of its event (`at`): the record's time for a file, the time
// it arrived for a live event (ticket 14).
//
// Only the main thread of the Session is folded: text, thinking and tool calls of a subagent
// (parentToolUseId set) belong to the subagent tree (ticket 15). Bookkeeping events (init,
// status, commands, account, rate limits, unknown SDK messages) draw nothing.
import type { AgentEvent } from '../../shared/agent/events'
import { AGENT_TOOLS } from '../../shared/transcript/subagents'
import { INTERRUPT_NOTICE } from './history'

type EventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>

/** A subagent the Session started, and how it ended once it did. */
export interface SubagentRun {
  taskId: string
  description: string | null
  subagentType: string | null
  /** null while it runs. */
  status: string | null
  summary: string | null
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
  /** null until the result arrives. */
  result: { content: string; isError: boolean } | null
  /** The subagent this call started (the Agent tool). */
  subagent: SubagentRun | null
}

/**
 * A row of the transcript. `at`: when the event that opened the row happened (the event's `at`,
 * ms since the epoch), the whole block's time for an answer; null when the event has none.
 */
export type TranscriptItem = { at: number | null } & (
  | { kind: 'prompt'; key: string; text: string }
  /** `streaming`: still being written (deltas), replaced by the whole block when it arrives. */
  | { kind: 'text'; key: string; text: string; synthetic: boolean; streaming: boolean }
  | { kind: 'thinking'; key: string; text: string; streaming: boolean }
  /** Consecutive tool calls, drawn as one group. */
  | { kind: 'tools'; key: string; calls: ToolCall[] }
  /** `toolUseId`: the Agent call that started it, when that call is not among the events (it is in the part of the file not read). */
  | { kind: 'subagent'; key: string; run: SubagentRun; toolUseId?: string }
  | { kind: 'hook'; key: string; event: EventOf<'hook'> }
  | { kind: 'notice'; key: string; noticeKind: 'synthetic' | 'local_command' | 'notification'; text: string }
  | { kind: 'result'; key: string; event: EventOf<'result'> }
  | { kind: 'error'; key: string; text: string }
  /** An event drawn by a row of src/renderer/session/rows/ (rows/index.ts). */
  | { kind: 'extension'; key: string; event: AgentEvent }
)

/**
 * Folds events into transcript rows. `extensionTypes` are the event types a row file draws; they
 * become `extension` items whatever else this file would do with them. `firstIndex` is the
 * position of `events[0]` in the whole Session (store.ts drops the oldest events): a row's key is
 * the position of the event that opened it, so it stays the same when older events are dropped.
 */
export function foldTranscript(events: readonly AgentEvent[], extensionTypes: ReadonlySet<string> = new Set(), firstIndex = 0): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const calls = new Map<string, ToolCall>()
  const subagents = new Map<string, SubagentRun>()
  let streamingText: number | null = null
  let streamingThinking: number | null = null
  // The open group of tool calls: the next tool_use joins it until another row comes between.
  let group: Extract<TranscriptItem, { kind: 'tools' }> | null = null

  const push = (item: TranscriptItem): void => {
    items.push(item)
    group = null
  }
  const replace = (index: number, item: TranscriptItem): void => {
    items[index] = item
  }
  const endStreaming = (): void => {
    for (const index of [streamingText, streamingThinking]) {
      const item = index === null ? undefined : items[index]
      if (item && (item.kind === 'text' || item.kind === 'thinking')) replace(index as number, { ...item, streaming: false })
    }
    streamingText = null
    streamingThinking = null
  }

  events.forEach((event, index) => {
    const key = `e${firstIndex + index}`
    const at = event.at ?? null
    if (extensionTypes.has(event.type)) {
      push({ kind: 'extension', key, at, event })
      return
    }
    switch (event.type) {
      case 'notice':
        if (event.kind === 'user') {
          // The interruption is shown once, by the turn's result.
          if (!INTERRUPT_NOTICE.test(event.text)) push({ kind: 'prompt', key, at, text: event.text })
        } else {
          push({ kind: 'notice', key, at, noticeKind: event.kind, text: event.text })
        }
        return
      case 'delta': {
        if (event.parentToolUseId !== null) return
        const slot = event.kind === 'text' ? streamingText : streamingThinking
        const current = slot === null ? undefined : items[slot]
        if (current && (current.kind === 'text' || current.kind === 'thinking')) {
          replace(slot as number, { ...current, text: current.text + event.text })
          return
        }
        push(event.kind === 'text' ? { kind: 'text', key, at, text: event.text, synthetic: false, streaming: true } : { kind: 'thinking', key, at, text: event.text, streaming: true })
        if (event.kind === 'text') streamingText = items.length - 1
        else streamingThinking = items.length - 1
        return
      }
      case 'text': {
        if (event.parentToolUseId !== null) return
        const slot = event.synthetic ? null : streamingText
        const current = slot === null ? undefined : items[slot]
        if (current?.kind === 'text') {
          // The whole block replaces the streamed one, and so does its time: a transcript file
          // has only the block, and the row reads the same after a restart.
          replace(slot as number, { ...current, at: at ?? current.at, text: event.text, streaming: false })
          streamingText = null
        } else {
          push({ kind: 'text', key, at, text: event.text, synthetic: event.synthetic, streaming: false })
        }
        return
      }
      case 'thinking': {
        if (event.parentToolUseId !== null) return
        const current = streamingThinking === null ? undefined : items[streamingThinking]
        if (current?.kind === 'thinking') {
          replace(streamingThinking as number, { ...current, at: at ?? current.at, text: event.text, streaming: false })
          streamingThinking = null
        } else {
          push({ kind: 'thinking', key, at, text: event.text, streaming: false })
        }
        return
      }
      case 'tool_use': {
        if (event.parentToolUseId !== null) return
        const call: ToolCall = { id: event.id, name: event.name, input: event.input, result: null, subagent: null }
        calls.set(event.id, call)
        if (group === null) {
          const opened: Extract<TranscriptItem, { kind: 'tools' }> = { kind: 'tools', key, at, calls: [call] }
          push(opened)
          group = opened
        } else {
          group.calls.push(call)
        }
        return
      }
      case 'tool_result': {
        const call = calls.get(event.toolUseId)
        if (call) call.result = { content: event.content, isError: event.isError }
        return
      }
      case 'subagent': {
        const known = subagents.get(event.taskId)
        if (known) {
          if (event.phase === 'finished') {
            known.status = event.status
            known.summary = event.summary
          }
          return
        }
        const run: SubagentRun = {
          taskId: event.taskId,
          description: event.description,
          subagentType: event.subagentType,
          status: event.phase === 'finished' ? event.status : null,
          summary: event.summary,
        }
        subagents.set(event.taskId, run)
        // A subagent started by an Agent tool call of this thread is shown on that call's row.
        const call = event.toolUseId === null ? undefined : calls.get(event.toolUseId)
        if (call) call.subagent = run
        else push({ kind: 'subagent', key, at, run, ...(event.toolUseId === null ? {} : { toolUseId: event.toolUseId }) })
        return
      }
      case 'hook':
        push({ kind: 'hook', key, at, event })
        return
      case 'result':
        endStreaming()
        push({ kind: 'result', key, at, event })
        return
      case 'state':
        if (event.state === 'error') {
          endStreaming()
          push({ kind: 'error', key, at, text: event.error ?? 'The Session stopped with an error' })
        }
        return
      default:
        return
    }
  })
  return items
}

/** A stretch of a run with tools hidden: calls folded into one «N tools» line, or calls drawn as they are. */
export interface ToolSegment {
  folded: boolean
  calls: ToolCall[]
}

/**
 * The calls of a `tools` row with tools hidden (worfy-ui ticket 25), in the order of the run. A
 * call with an error and a call that starts a Subagent (the Subagent's row) stay in sight; they
 * split the run, and each stretch of ordinary calls between them folds into its own «N tools» line
 * at its place: Bash ✓, Edit ✗, Grep ✓ is «1 tool», Edit, «1 tool».
 */
export function toolSegments(calls: readonly ToolCall[]): ToolSegment[] {
  const segments: ToolSegment[] = []
  for (const call of calls) {
    const folded = !(call.result?.isError === true || call.subagent !== null || AGENT_TOOLS.has(call.name))
    const last = segments.at(-1)
    if (last !== undefined && last.folded === folded) last.calls.push(call)
    else segments.push({ folded, calls: [call] })
  }
  return segments
}
