// Turns a Session's events (src/shared/agent/events.ts) into the rows of its transcript. The
// events may come from the live Session (store.ts) or from a transcript file: this file does not
// know which. Each row takes the time of its event (`at`): the record's time for a file, the time
// it arrived for a live event (ticket 14).
//
// Only the main thread of the Session is folded: text, thinking and tool calls of a subagent
// (parentToolUseId set) belong to the subagent tree (ticket 15). Bookkeeping events (init,
// status, commands, account, rate limits, unknown SDK messages) draw nothing.
import type { MessageAttachment } from '../../shared/agent/attachments'
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
  /** The user's message: the text as typed, and what went with it (worfy-ui ticket 28). */
  | { kind: 'prompt'; key: string; text: string; attachments: MessageAttachment[] }
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

/** The position in the Session of the event that opened a row (its key, foldTranscript): rows in order have growing positions. */
export const rowOrder = (key: string): number => Number(key.slice(1))

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
          if (!INTERRUPT_NOTICE.test(event.text)) push({ kind: 'prompt', key, at, text: event.text, attachments: event.attachments ?? [] })
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

// ── the rows the Transcript draws (worfy-ui ticket 22) ──────────────────────────

/** Up to this many rows every row is drawn; past it, only those in sight and OVERSCAN px around them (Transcript.tsx). */
export const DRAW_ALL_UP_TO = 150
/** How far above and below the visible part rows are drawn, in px. */
export const OVERSCAN = 1000
/** Rows drawn at most, whatever their heights. */
export const MAX_DRAWN = 250
/** The height a row not measured yet is taken to have, while no row is measured. */
export const ROW_ESTIMATE = 60
/** Rows drawn before the log is measured: the newest, where it opens. */
export const FIRST_DRAWN = 40

/** The room a row of height `size` takes in the log with the gap after it: none for a row that draws nothing (`.w-tr__item:empty`). */
export const stepOf = (size: number, gap: number): number => (size > 0 ? size + gap : 0)

/** The height of the space that stands for rows [from, to) of `sizes`: their room, without the gap after the last (the space has its own). */
export function spanOf(sizes: readonly number[], gap: number, from: number, to: number): number {
  let total = 0
  for (let row = from; row < to; row += 1) total += stepOf(sizes[row] ?? 0, gap)
  return Math.max(0, total - gap)
}

/**
 * The rows to draw, [start, end) of `sizes` (each row's height, px, without the `gap` between
 * rows): those that cover `height` px of the log from row `at` placed `offset` px below its top,
 * or the last ones with `at` -1 (the reader at the bottom), with OVERSCAN px more on each side.
 */
export function rowWindow(sizes: readonly number[], gap: number, at: number, offset: number, height: number): { start: number; end: number } {
  const n = sizes.length
  const size = (row: number): number => stepOf(sizes[row] ?? 0, gap)
  if (at < 0) {
    let start = n
    for (let space = height + OVERSCAN; start > 0 && space > 0; ) space -= size((start -= 1))
    return { start: Math.max(start, n - MAX_DRAWN), end: n }
  }
  let start = at
  for (let space = offset + OVERSCAN; start > 0 && space > 0; ) space -= size((start -= 1))
  let end = at
  for (let reach = offset; end < n && reach < height + OVERSCAN; end += 1) reach += size(end)
  start = Math.max(start, at - Math.floor(MAX_DRAWN / 4))
  return { start, end: Math.max(Math.min(end, start + MAX_DRAWN), at + 1) }
}

/**
 * The row of `rows` that stands for row `key` when that row is gone: the last one whose key comes
 * before it, which holds its event now (a run of tool calls that an earlier call, read later,
 * joined starts at that call's key), else the first one (the cap of the events dropped it). -1
 * without rows.
 */
export function rowFor(rows: readonly TranscriptItem[], key: string): number {
  const order = rowOrder(key)
  let holder = -1
  for (let row = 0; row < rows.length && rowOrder(rows[row]!.key) <= order; row += 1) holder = row
  return holder >= 0 ? holder : rows.length > 0 ? 0 : -1
}
