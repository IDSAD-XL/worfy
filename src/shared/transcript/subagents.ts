// The Subagent tree of a Session (CONTEXT.md, «Subagent»): which Subagents the Session started,
// which of them started their own, and how each one is doing. Pure, so main and the renderer build
// the same tree from what each of them has:
//
// - signals: the few facts about Subagents in a stream of events (src/shared/agent/events.ts) —
//   a call of the Agent tool, its result, a Subagent started, a task-notification. A live Session
//   of worfy gives them as SDK events arrive; a transcript file gives them through parse.ts.
// - files: what `<sessionId>/subagents/agent-<agentId>.jsonl` and `agent-<agentId>.meta.json`
//   say about one Subagent (its type, name and parent; its own calls of the Agent tool; its model,
//   times and last answer).
//
// How a call, its Subagent and its end are linked (ticket 09, "Итог", section 3): the Agent
// tool's result names the Subagent (`toolUseResult.agentId`, a `subagent` event); `meta.toolUseId`
// names the call; a task-notification names both. A nested Subagent's call is in its parent's
// transcript, where the result has no `agentId`: `meta.parentAgentId` and `meta.toolUseId` link
// it, and in a live Session the call's `parentToolUseId` does.
import { z } from 'zod'
import type { AgentEvent } from '../agent/events'
import { parseTranscriptRecord } from './parse'

/** Names of the tool that starts a Subagent: `Agent` since 2.1.222; `Task` in older versions. */
const AGENT_TOOLS = new Set(['Agent', 'Task'])
/** Longest text kept from a result or an answer; the tree shows only its first line. */
const TEXT_MAX = 4000
const SHORT_MAX = 500
const SUMMARY_MAX = 160

const time = z.number().nullable()
const short = z.string().max(SHORT_MAX).nullable()
const long = z.string().max(TEXT_MAX).nullable()

/** One fact about a Subagent from a stream of events. `at`: ms since the epoch, when known. */
export const subagentSignalSchema = z.discriminatedUnion('kind', [
  /** The Agent tool was called; `parentToolUseId` is set when a Subagent made the call (live SDK events). */
  z.object({
    kind: z.literal('call'),
    toolUseId: z.string(),
    at: time,
    parentToolUseId: z.string().nullable(),
    subagentType: short,
    description: short,
    name: short,
    model: short,
    background: z.boolean(),
  }),
  /** The Agent tool's result: the Subagent's answer, or "launched" for one that runs in the background. */
  z.object({ kind: z.literal('result'), toolUseId: z.string(), at: time, text: z.string().max(TEXT_MAX), isError: z.boolean(), launched: z.boolean() }),
  z.object({ kind: z.literal('started'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, subagentType: short, description: short }),
  /** A task-notification (or a synchronous call's result) says the Subagent ended. */
  z.object({ kind: z.literal('finished'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, status: short, summary: short, result: long }),
])
export type SubagentSignal = z.infer<typeof subagentSignalSchema>

const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

/** `agent-<id>.meta.json`, read leniently: a field of another type is left out, unknown fields are dropped. */
export const subagentMetaSchema = z.object({
  agentType: loose(z.string().max(SHORT_MAX)),
  description: loose(z.string().max(SHORT_MAX)),
  name: loose(z.string().max(SHORT_MAX)),
  model: loose(z.string().max(SHORT_MAX)),
  toolUseId: loose(z.string().max(SHORT_MAX)),
  parentAgentId: loose(z.string().max(SHORT_MAX)),
  /** `foreground` or `background`. */
  requestShape: loose(z.string().max(SHORT_MAX)),
  spawnDepth: loose(z.number().int().nonnegative()),
  /** The user stopped the Subagent: it ends without a task-notification. */
  stoppedByUser: loose(z.boolean()),
})
export type SubagentMeta = z.infer<typeof subagentMetaSchema>

/** What one Subagent's files say. */
export const subagentFileSchema = z.object({
  agentId: z.string(),
  meta: subagentMetaSchema.nullable(),
  /** `agent-<id>.jsonl` exists (the transcript can be opened). */
  transcript: z.boolean(),
  /** Times of the first and the last record that has one. */
  firstAt: time,
  lastAt: time,
  /** The model of its last answer. */
  model: short,
  /** Text of its last answer. */
  finalText: long,
  /** Its last record is an answer that ended the turn (`stop_reason: end_turn`). */
  ended: z.boolean(),
  /** Its own calls of the Agent tool and what came of them. */
  signals: z.array(subagentSignalSchema),
})
export type SubagentFile = z.infer<typeof subagentFileSchema>

export type SubagentStatus = 'running' | 'done' | 'error'

/** One Subagent in the tree. */
export interface SubagentInfo {
  /** Stable while the Subagent lives: its call's id, or `agent:<agentId>` when no call is known. */
  id: string
  /** Null until the Agent tool's result or the Subagent's files name it. */
  agentId: string | null
  toolUseId: string | null
  parentAgentId: string | null
  name: string | null
  subagentType: string | null
  model: string | null
  description: string | null
  status: SubagentStatus
  /** Started with `run_in_background`: it ends with a task-notification. */
  background: boolean
  /** ms since the epoch. */
  startedAt: number | null
  /** Null while it runs or when a time is missing. */
  durationMs: number | null
  /** First line of its final answer (a reviewer's starts with VERIFIED or REJECTED). */
  summary: string | null
  verdict: 'VERIFIED' | 'REJECTED' | null
  /** 1 for a Subagent of the Session, 2 for one of its Subagents, … */
  depth: number
  /** Its transcript file exists. */
  transcript: boolean
  children: SubagentInfo[]
}

// ── signals ─────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const cap = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)
const shortOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? cap(value, SHORT_MAX) : null)
const longOf = (value: string | null | undefined): string | null => (value === null || value === undefined ? null : cap(value, TEXT_MAX))
const msOf = (iso: string | undefined): number | null => {
  if (iso === undefined) return null
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : null
}

/** An event and when it happened: the record's ISO `timestamp` (a file) or `at` in ms (a live event). */
export interface TimedEvent {
  event: AgentEvent
  timestamp?: string | undefined
  at?: number | null | undefined
}

/**
 * The Subagent signals in a stream of events, in order. `calls` holds the ids of the Agent calls
 * seen so far and is updated: a reader that goes through a file in chunks passes the same set, so
 * a result in a later chunk is still recognised.
 */
export function subagentSignals(events: readonly TimedEvent[], calls: Set<string> = new Set()): SubagentSignal[] {
  const signals: SubagentSignal[] = []
  for (const { event, timestamp, at: given } of events) {
    const at = given ?? msOf(timestamp)
    if (event.type === 'tool_use' && AGENT_TOOLS.has(event.name)) {
      calls.add(event.id)
      const input = isObject(event.input) ? event.input : {}
      signals.push({
        kind: 'call',
        toolUseId: event.id,
        at,
        parentToolUseId: event.parentToolUseId,
        subagentType: shortOf(input.subagent_type),
        description: shortOf(input.description),
        name: shortOf(input.name),
        model: shortOf(input.model),
        background: input.run_in_background === true,
      })
    } else if (event.type === 'tool_result' && calls.has(event.toolUseId)) {
      signals.push({
        kind: 'result',
        toolUseId: event.toolUseId,
        at,
        text: cap(event.content, TEXT_MAX),
        isError: event.isError,
        launched: /^\s*Async agent launched/i.test(event.content),
      })
    } else if (event.type === 'subagent' && event.phase === 'started') {
      signals.push({ kind: 'started', agentId: event.taskId, toolUseId: event.toolUseId, at, subagentType: shortOf(event.subagentType), description: shortOf(event.description) })
    } else if (event.type === 'subagent') {
      signals.push({
        kind: 'finished',
        agentId: event.taskId,
        toolUseId: event.toolUseId,
        at,
        status: shortOf(event.status),
        summary: shortOf(event.summary),
        result: longOf(event.result),
      })
    }
  }
  return signals
}

// ── one Subagent's files ────────────────────────────────────────────────────

/** `agent-<id>.meta.json` as parsed JSON → its known fields; null for anything but an object. */
export function readSubagentMeta(value: unknown): SubagentMeta | null {
  if (!isObject(value)) return null
  const parsed = subagentMetaSchema.safeParse(value)
  if (!parsed.success) return null
  const meta: SubagentMeta = {}
  for (const [key, field] of Object.entries(parsed.data)) if (field !== undefined) (meta as Record<string, unknown>)[key] = field
  return meta
}

/** A Subagent's file summary before any line of its transcript was read. */
export function emptySubagentFile(agentId: string, meta: unknown, transcript = false): SubagentFile {
  return { agentId, meta: readSubagentMeta(meta), transcript, firstAt: null, lastAt: null, model: null, finalText: null, ended: false, signals: [] }
}

/** The summary after more lines of the Subagent's transcript (JSONL); lines that are not JSON are skipped. */
export function extendSubagentFile(file: SubagentFile, lines: readonly string[]): SubagentFile {
  const next: SubagentFile = { ...file, transcript: true, signals: [...file.signals] }
  const calls = new Set(file.signals.flatMap((signal) => (signal.kind === 'call' ? [signal.toolUseId] : [])))
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(record)) continue
    const at = msOf(typeof record.timestamp === 'string' ? record.timestamp : undefined)
    if (at !== null) {
      next.firstAt ??= at
      next.lastAt = at
    }
    const message = isObject(record.message) ? record.message : undefined
    if (record.type === 'assistant' && message) {
      if (typeof message.model === 'string' && message.model !== '<synthetic>') next.model = shortOf(message.model)
      const content = Array.isArray(message.content) ? message.content : []
      const texts = content.flatMap((block) => (isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
      if (texts.length > 0) next.finalText = cap(texts.join('\n'), TEXT_MAX)
      next.ended = message.stop_reason === 'end_turn'
    } else if (record.type === 'user') {
      // A tool's result, or a message sent to the Subagent: it is working again.
      next.ended = false
    }
    next.signals.push(...subagentSignals(parseTranscriptRecord(record), calls))
  }
  return next
}

/** The summary of a Subagent's files: its meta (parsed JSON, or null without a meta file) and its transcript lines. */
export function subagentFile(agentId: string, meta: unknown, lines: readonly string[]): SubagentFile {
  return extendSubagentFile(emptySubagentFile(agentId, meta), lines)
}

// ── the tree ────────────────────────────────────────────────────────────────

/**
 * The first line of a final answer without markdown marks: heading and quote marks at the start,
 * and emphasis (`**x**`, `__x__`, `*x*`) anywhere in the line. Null when there is no line.
 */
export function summaryLine(text: string | null | undefined): string | null {
  if (!text) return null
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
      .replace(/(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/g, '$1')
      .replace(/^[\s#>*_`-]+/, '')
      .replace(/[\s*_`]+$/, '')
      .trim()
    if (line !== '') return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
  }
  return null
}

function verdictOf(summary: string | null): SubagentInfo['verdict'] {
  const match = summary === null ? null : /\b(VERIFIED|REJECTED)\b/.exec(summary)
  return (match?.[1] as SubagentInfo['verdict'] | undefined) ?? null
}

type Signal<K extends SubagentSignal['kind']> = Extract<SubagentSignal, { kind: K }>

/** Everything known about one Subagent, gathered from every source. */
interface Gathered {
  agentId: string | null
  /** Every Subagent id this record was found by: a live task id and the id of its files may differ. */
  agentIds: Set<string>
  toolUseId: string | null
  call?: Signal<'call'>
  /** The agentId of the transcript the call is in; null for the Session's own. */
  callThread?: string | null
  result?: Signal<'result'>
  started?: Signal<'started'>
  finished?: Signal<'finished'>
  file?: SubagentFile
}

class Index {
  readonly all: Gathered[] = []
  private readonly byAgent = new Map<string, Gathered>()
  private readonly byTool = new Map<string, Gathered>()

  /** The record of a Subagent named by its id, its call's id, or both; records found by each are merged. */
  get(agentId: string | null | undefined, toolUseId: string | null | undefined): Gathered {
    const a = agentId ? this.byAgent.get(agentId) : undefined
    const t = toolUseId ? this.byTool.get(toolUseId) : undefined
    let record = a ?? t
    if (a && t && a !== t) {
      for (const key of ['call', 'callThread', 'result', 'started', 'finished', 'file'] as const) if (a[key] === undefined && t[key] !== undefined) Object.assign(a, { [key]: t[key] })
      a.toolUseId ??= t.toolUseId
      a.agentId ??= t.agentId
      if (t.toolUseId) this.byTool.set(t.toolUseId, a)
      for (const id of t.agentIds) {
        a.agentIds.add(id)
        this.byAgent.set(id, a)
      }
      this.all.splice(this.all.indexOf(t), 1)
      record = a
    }
    if (!record) {
      record = { agentId: null, agentIds: new Set(), toolUseId: null }
      this.all.push(record)
    }
    if (agentId) {
      record.agentId ??= agentId
      record.agentIds.add(agentId)
      this.byAgent.set(agentId, record)
    }
    if (toolUseId) record.toolUseId ??= toolUseId
    if (record.toolUseId) this.byTool.set(record.toolUseId, record)
    return record
  }

  /** Binds a Subagent's files to its record. The files' id names the Subagent: its transcript is `agent-<id>.jsonl`. */
  bindFile(file: SubagentFile): void {
    const record = this.get(file.agentId, file.meta?.toolUseId)
    record.file = file
    record.agentId = file.agentId
  }

  byToolUse(toolUseId: string): Gathered | undefined {
    return this.byTool.get(toolUseId)
  }

  byAgentId(agentId: string): Gathered | undefined {
    return this.byAgent.get(agentId)
  }
}

function gather(index: Index, signals: readonly SubagentSignal[], thread: string | null): void {
  for (const signal of signals) {
    switch (signal.kind) {
      case 'call': {
        const record = index.get(null, signal.toolUseId)
        record.call = signal
        record.callThread = thread
        break
      }
      case 'result':
        index.get(null, signal.toolUseId).result = signal
        break
      case 'started': {
        const record = index.get(signal.agentId, signal.toolUseId)
        record.started ??= signal
        break
      }
      case 'finished':
        index.get(signal.agentId, signal.toolUseId).finished = signal
        break
    }
  }
}

/** The first value that is neither null nor undefined. */
function firstOf<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value
  return null
}

function statusOf(record: Gathered, background: boolean): SubagentStatus {
  const { finished, result, file } = record
  if (finished) return finished.status === null || finished.status === 'completed' ? 'done' : 'error'
  if (result?.isError || file?.meta?.stoppedByUser === true) return 'error'
  if (result && !background) return 'done'
  if (file?.ended) return 'done'
  return 'running'
}

function describe(record: Gathered): Omit<SubagentInfo, 'parentAgentId' | 'depth' | 'children'> {
  const { call, result, started, finished, file } = record
  const meta = file?.meta ?? null
  const background = meta?.requestShape === 'background' || call?.background === true || result?.launched === true
  const status = statusOf(record, background)
  // The final answer: the notification's, a synchronous call's result, the last answer in its
  // file, a failed call's error, and the notification's one-line summary last.
  const answer = firstOf(
    finished?.result,
    result && !background && !result.isError ? result.text : null,
    status !== 'running' ? file?.finalText : null,
    result?.isError ? result.text : null,
    finished?.summary,
  )
  const summary = summaryLine(answer)
  const startedAt = firstOf(call?.at, started?.at, file?.firstAt)
  const endedAt = status === 'running' ? null : firstOf(finished?.at, background ? null : result?.at, file?.lastAt)
  return {
    id: record.toolUseId ?? `agent:${record.agentId ?? ''}`,
    agentId: record.agentId,
    toolUseId: record.toolUseId,
    name: meta?.name ?? call?.name ?? null,
    subagentType: meta?.agentType ?? call?.subagentType ?? started?.subagentType ?? null,
    model: file?.model ?? meta?.model ?? call?.model ?? null,
    description: meta?.description ?? call?.description ?? started?.description ?? null,
    status,
    background,
    startedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    summary,
    verdict: verdictOf(summary),
    transcript: file?.transcript === true,
  }
}

const byStart = (a: SubagentInfo, b: SubagentInfo): number =>
  (a.startedAt ?? Number.POSITIVE_INFINITY) - (b.startedAt ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id)

/**
 * The Session's Subagent tree: its own Subagents, each with the Subagents it started, ordered by
 * start time. `signals` come from the Session's own events (a live Session or its transcript),
 * `files` from its `subagents/` folder; either may be missing something the other has.
 */
export function buildSubagentTree({ signals, files }: { signals: readonly SubagentSignal[]; files: readonly SubagentFile[] }): SubagentInfo[] {
  const index = new Index()
  gather(index, signals, null)
  for (const file of files) gather(index, file.signals, file.agentId)
  for (const file of files) index.bindFile(file)

  // Background tasks that are not Subagents (a Bash run in the background) also send
  // task-notifications: only what has an Agent call, files or a Subagent type is kept.
  const kept = index.all.filter((record) => record.call !== undefined || record.file !== undefined || (record.started?.subagentType ?? null) !== null)
  const keptSet = new Set(kept)

  const parentOf = (record: Gathered): Gathered | undefined => {
    const byMeta = record.file?.meta?.parentAgentId
    if (byMeta) return index.byAgentId(byMeta)
    if (record.callThread) return index.byAgentId(record.callThread)
    const parentCall = record.call?.parentToolUseId
    return parentCall ? index.byToolUse(parentCall) : undefined
  }

  const infos = new Map<Gathered, SubagentInfo>()
  for (const record of kept) infos.set(record, { ...describe(record), parentAgentId: null, depth: 1, children: [] })

  const roots: SubagentInfo[] = []
  for (const record of kept) {
    const info = infos.get(record)!
    let parent = parentOf(record)
    // A parent that is not in the tree, or a loop of parents, puts the Subagent at the top.
    for (let seen = new Set<Gathered>([record]), step = parent; step !== undefined; step = parentOf(step)) {
      if (seen.has(step)) {
        parent = undefined
        break
      }
      seen.add(step)
    }
    if (parent && keptSet.has(parent)) {
      info.parentAgentId = parent.agentId
      infos.get(parent)!.children.push(info)
    } else {
      roots.push(info)
    }
  }
  const settle = (list: SubagentInfo[], depth: number): void => {
    list.sort(byStart)
    for (const info of list) {
      info.depth = depth
      settle(info.children, depth + 1)
    }
  }
  settle(roots, 1)
  return roots
}

/** Every Subagent of a tree, parents before their children. */
export function flattenSubagents(roots: readonly SubagentInfo[]): SubagentInfo[] {
  return roots.flatMap((info) => [info, ...flattenSubagents(info.children)])
}
