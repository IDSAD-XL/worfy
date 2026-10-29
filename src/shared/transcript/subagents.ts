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
// How a call, its Subagent and its end are linked (ticket 09, its result section, part 3): the Agent
// tool's result names the Subagent (`toolUseResult.agentId`, a `subagent` event); `meta.toolUseId`
// names the call; a task-notification names both. A nested Subagent's call is in its parent's
// transcript, where the result has no `agentId`: `meta.parentAgentId` and `meta.toolUseId` link
// it, and in a live Session the call's `parentToolUseId` does.
//
// Agents of a workflow script (ticket worfy-daily/17, ADR-0035) have no `meta.toolUseId` and no
// `meta.parentAgentId`: they live in `<sessionId>/subagents/workflows/<runId>/`, and the Workflow
// call's result names the run (`Run ID: wf_…`). The run is one entry of the tree, of type
// `workflow`, with its agents under it; the run's `journal.jsonl` says how each agent ended.
import { z } from 'zod'
import type { AgentEvent } from '../agent/events'
import { lastPathSegment } from '../paths'
import { parseTranscriptRecord, type TranscriptEntry } from './parse'

/** Names of the tool that starts a Subagent: `Agent` since 2.1.222; `Task` in older versions. */
export const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
/** The tool that runs a workflow script; its agents are in `subagents/workflows/<runId>/`. */
const WORKFLOW_TOOL = 'Workflow'
/** The type of the tree entry that stands for one run of a workflow script. */
export const WORKFLOW_TYPE = 'workflow'
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
  /** The Workflow tool was called: a workflow script runs in the background; `name` is the script's. */
  z.object({ kind: z.literal('workflow'), toolUseId: z.string(), at: time, name: short }),
  /** The Agent tool's result: the Subagent's answer, or "launched" for one that runs in the background. Also the Workflow tool's. */
  z.object({ kind: z.literal('result'), toolUseId: z.string(), at: time, text: z.string().max(TEXT_MAX), isError: z.boolean(), launched: z.boolean() }),
  z.object({ kind: z.literal('started'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, subagentType: short, description: short }),
  /** A task-notification (or a synchronous call's result) says the Subagent ended. */
  z.object({ kind: z.literal('finished'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, status: short, summary: short, result: long }),
  /**
   * The Session's Claude Code process is not running (main reads `sessions/<pid>.json`): its
   * Subagents live in that process, so one that has not ended by now never will (ADR-0031).
   * Counts only among the Session's own signals.
   */
  z.object({ kind: z.literal('session-closed') }),
  // The start of the Session's running process is not a signal: it travels as `processStartedAt`
  // next to the signals, which a Linked machine of an older build drops (ADR-0085, ADR-0079).
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
  /** Set for an agent of a workflow script: its run, and what the run's journal says about it. */
  workflow: z
    .object({
      runId: z.string().max(SHORT_MAX),
      /** `label` of its `started` record (`impl:03`); older journals have none. */
      label: short,
      phase: short,
      /** `completed` after a `result` record, `failed` after a `failed` one. */
      end: z.enum(['completed', 'failed']).nullable(),
      /** Its result when it is text, or the `summary` of a structured one. */
      result: long,
    })
    .nullable(),
})
export type SubagentFile = z.infer<typeof subagentFileSchema>
export type WorkflowAgent = Omit<NonNullable<SubagentFile['workflow']>, 'runId'>

/**
 * `interrupted`: it has no end, and the Session's current process started after its last record —
 * it died with an earlier process of the Session; not a failure (ADR-0085).
 */
export type SubagentStatus = 'running' | 'done' | 'error' | 'interrupted'

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

/** A run id as Claude Code names a run's folder: `wf_` and letters, digits, `-` and `_`. */
export const WORKFLOW_RUN_ID = /^wf_[A-Za-z0-9_-]{1,128}$/

/**
 * The name of a workflow script from the Workflow call's input: `meta.name` of an inline script,
 * or the script file's name without the `-<runId>.js` Claude Code adds to it.
 */
function workflowName(input: Json): string | null {
  if (typeof input.script === 'string') {
    const named = /\bname\s*:\s*(['"`])([^'"`\n]{1,200})\1/.exec(input.script)
    if (named) return shortOf(named[2])
  }
  if (typeof input.scriptPath === 'string') {
    // With `/` or, on Windows, `\` (worfy-windows ticket 08).
    const file = lastPathSegment(input.scriptPath)
    return shortOf(file.replace(/\.[cm]?[jt]s$/, '').replace(/-wf_[A-Za-z0-9_-]+$/, ''))
  }
  return null
}

/** The run a Workflow call started, by its result: `Run ID: wf_…`, or the run's folder in `Transcript dir:`. */
function workflowRunOf(text: string): string | null {
  const id = /^Run ID: (\S+)\s*$/m.exec(text)?.[1] ?? /[\\/]subagents[\\/]workflows[\\/]([^\\/\s]+)\s*$/m.exec(text)?.[1]
  return id !== undefined && WORKFLOW_RUN_ID.test(id) ? id : null
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
    if (event.type === 'tool_use' && event.name === WORKFLOW_TOOL) {
      calls.add(event.id)
      signals.push({ kind: 'workflow', toolUseId: event.id, at, name: workflowName(isObject(event.input) ? event.input : {}) })
    } else if (event.type === 'tool_use' && AGENT_TOOLS.has(event.name)) {
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

/**
 * A task-notification that waited in Claude Code's queue, as the user message it stands for; the
 * record itself otherwise. A notification that comes while the Session is busy is written as a
 * `queue-operation` (`enqueue`) and, once delivered, as an `attachment` of type `queued_command` —
 * often with no user message at all (ticket worfy-daily/08, its result section: 310 of 311 Subagents stuck in
 * `running` on Auction ended this way). Read as a user message, it gives the same `subagent` event.
 */
function asNotification(record: Json): Json {
  const attachment = isObject(record.attachment) ? record.attachment : undefined
  const text =
    record.type === 'queue-operation' && record.operation === 'enqueue'
      ? record.content
      : record.type === 'attachment' && attachment?.type === 'queued_command'
        ? attachment.prompt
        : undefined
  if (typeof text !== 'string' || !text.trimStart().startsWith('<task-notification>')) return record
  return { type: 'user', timestamp: record.timestamp, isSidechain: record.isSidechain, message: { role: 'user', content: text } }
}

/** The events of one transcript record (parsed JSON), a queued task-notification included. */
function recordEvents(record: Json): TranscriptEntry[] {
  return parseTranscriptRecord(asNotification(record))
}

/**
 * The Subagent signals of the Session's own transcript lines (JSONL): lines that are not JSON and
 * records an older Claude Code wrote for a Subagent into the Session's file (`isSidechain`) are
 * skipped. `calls` as in subagentSignals().
 */
export function subagentSignalsOfLines(lines: readonly string[], calls: Set<string> = new Set()): SubagentSignal[] {
  const entries: TranscriptEntry[] = []
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (isObject(record)) entries.push(...recordEvents(record).filter((entry) => !entry.sidechain))
  }
  return subagentSignals(entries, calls)
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
  return { agentId, meta: readSubagentMeta(meta), transcript, firstAt: null, lastAt: null, model: null, finalText: null, ended: false, signals: [], workflow: null }
}

/** A journal result as text: itself when it is text, the `summary` of a structured one; null otherwise. */
function journalResult(value: unknown): string | null {
  if (typeof value === 'string') return longOf(value)
  return isObject(value) && typeof value.summary === 'string' ? longOf(value.summary) : null
}

/**
 * What a workflow run's `journal.jsonl` says about each of its agents, by agentId, in the order
 * they started: `started` (newer journals add `label` and `phase`), `result`, `failed`.
 * `agents` is updated: a reader that goes through the journal in chunks passes the same map. Lines
 * that are not JSON, records without an agentId and other types (`launched`) are skipped.
 */
export function readWorkflowJournal(lines: readonly string[], agents: Map<string, WorkflowAgent> = new Map()): Map<string, WorkflowAgent> {
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(record) || typeof record.agentId !== 'string' || record.agentId === '') continue
    if (record.type !== 'started' && record.type !== 'result' && record.type !== 'failed') continue
    const agent = agents.get(record.agentId) ?? { label: null, phase: null, end: null, result: null }
    if (record.type === 'started') {
      agent.label = shortOf(record.label) ?? agent.label
      agent.phase = shortOf(record.phase) ?? agent.phase
    } else if (record.type === 'result') {
      agent.end = 'completed'
      agent.result = journalResult(record.result)
    } else {
      agent.end = 'failed'
    }
    agents.set(record.agentId, agent)
  }
  return agents
}

/** A workflow agent's file summary with its run and its journal entry (none yet: it has not started by the journal). */
export function workflowAgentFile(file: SubagentFile, runId: string, journal: WorkflowAgent | undefined): SubagentFile {
  return { ...file, workflow: { runId, label: journal?.label ?? null, phase: journal?.phase ?? null, end: journal?.end ?? null, result: journal?.result ?? null } }
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
    next.signals.push(...subagentSignals(recordEvents(record), calls))
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
 * and emphasis anywhere in the line — `**x**` and `*x*`, and `__x__` only at word boundaries, as in
 * CommonMark, so a tool name like `mcp__qmd__get` keeps its underscores (worfy-week ticket 12).
 * Null when there is no line.
 */
export function summaryLine(text: string | null | undefined): string | null {
  if (!text) return null
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, '$1')
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
  /** Set for a run of a workflow script: the Workflow call (absent when only the run's folder is known). */
  workflow?: Signal<'workflow'>
  /** The run this record stands for, once known; set on the run's record, not on its agents. */
  runId?: string
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
      for (const key of ['call', 'callThread', 'result', 'started', 'finished', 'file', 'workflow'] as const) if (a[key] === undefined && t[key] !== undefined) Object.assign(a, { [key]: t[key] })
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

  /** A record for a workflow run known only by its folder: no Workflow call names it. */
  runWithoutCall(runId: string): Gathered {
    const record: Gathered = { agentId: null, agentIds: new Set(), toolUseId: null, runId }
    this.all.push(record)
    return record
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
      case 'workflow': {
        const record = index.get(null, signal.toolUseId)
        record.workflow = signal
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
      case 'session-closed':
        break
    }
  }
}

/** The first value that is neither null nor undefined. */
function firstOf<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value
  return null
}

/** What the Session's own signals say about its process. */
interface SessionState {
  /** Its process is not running (ADR-0031). */
  closed: boolean
  /** When its running process started, ms since the epoch; null when not known (ADR-0085). */
  processStartedAt: number | null
}

/** The time of the last record known of a Subagent: its file's last record, else its call's or its start's. */
const lastSeen = ({ file, call, started, result }: Gathered): number | null => file?.lastAt ?? firstOf(result?.at, started?.at, call?.at)

/** Something without an end, last seen at `last`, from before the Session's running process started (ADR-0085). */
const before = (state: SessionState, last: number | null): boolean => state.processStartedAt !== null && last !== null && state.processStartedAt > last

/**
 * `closed`: the Session's process is not running. A Subagent that has not ended by then was cut off
 * with it — an error, like one the user stopped (ADR-0031). While the Session runs, a Subagent
 * without an end stays `running`, however long its file has not changed — unless the running
 * process started after its last record: then it died with an earlier process of the Session and
 * is `interrupted` (ADR-0085).
 */
function statusOf(record: Gathered, background: boolean, state: SessionState): SubagentStatus {
  const { finished, result, file } = record
  if (finished) return finished.status === null || finished.status === 'completed' ? 'done' : 'error'
  // An agent of a workflow script: its run's journal says how it ended (ADR-0035).
  if (file?.workflow?.end) return file.workflow.end === 'completed' ? 'done' : 'error'
  if (result?.isError || file?.meta?.stoppedByUser === true) return 'error'
  if (result && !background) return 'done'
  if (file?.ended) return 'done'
  if (state.closed) return 'error'
  return before(state, lastSeen(record)) ? 'interrupted' : 'running'
}

function describe(record: Gathered, state: SessionState): Omit<SubagentInfo, 'parentAgentId' | 'depth' | 'children'> {
  const { call, result, started, finished, file } = record
  const meta = file?.meta ?? null
  const background = meta?.requestShape === 'background' || call?.background === true || result?.launched === true
  const status = statusOf(record, background, state)
  // The final answer: the notification's, a synchronous call's result, the last answer in its
  // file, a failed call's error, and the notification's one-line summary last.
  const answer = firstOf(
    finished?.result,
    file?.workflow?.result,
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
    name: meta?.name ?? call?.name ?? file?.workflow?.label ?? null,
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

/** A run of a workflow script has ended: its task-notification came, or the Workflow call failed. */
const runEnded = (run: Gathered | undefined): boolean => run !== undefined && (run.finished !== undefined || run.result?.isError === true)

/**
 * One run of a workflow script as a tree entry of type `workflow` (ADR-0035): named by the script,
 * described by the Workflow call's `Summary:` line, ended by its task-notification. It has no
 * transcript of its own and no agentId (the notification's task id is not a Subagent's).
 */
function describeRun(record: Gathered, closed: boolean): Omit<SubagentInfo, 'parentAgentId' | 'depth' | 'children'> {
  const { workflow, result, finished } = record
  const failed = result?.isError === true
  // A run without an end is `running` here; its agents may yet make it `interrupted` (buildSubagentTree).
  const status: SubagentStatus = finished ? (finished.status === null || finished.status === 'completed' ? 'done' : 'error') : failed || closed ? 'error' : 'running'
  const startedAt = firstOf(workflow?.at, result?.at)
  const endedAt = status === 'running' ? null : firstOf(finished?.at, failed ? result?.at : null)
  const summary = summaryLine(firstOf(finished?.summary, failed ? result?.text : null))
  const description = result && !failed ? (/^Summary: (.+)$/m.exec(result.text)?.[1]?.trim() ?? null) : null
  return {
    id: record.toolUseId ?? `workflow:${record.runId ?? ''}`,
    agentId: null,
    toolUseId: record.toolUseId,
    name: workflow?.name ?? record.runId ?? null,
    subagentType: WORKFLOW_TYPE,
    model: null,
    description: description === null ? null : cap(description, SHORT_MAX),
    status,
    background: true,
    startedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    summary,
    verdict: null,
    transcript: false,
  }
}

const byStart =(a: SubagentInfo, b: SubagentInfo): number =>
  (a.startedAt ?? Number.POSITIVE_INFINITY) - (b.startedAt ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id)

/**
 * The Session's Subagent tree: its own Subagents, each with the Subagents it started, ordered by
 * start time. `signals` come from the Session's own events (a live Session or its transcript),
 * `files` from its `subagents/` folder; either may be missing something the other has. A
 * `session-closed` signal among `signals` ends every Subagent that has not ended (ADR-0031).
 * `processStartedAt`: when the Session's running process started (ms), when main knows it; a
 * Subagent without an end last seen before it is `interrupted` (ADR-0085).
 */
export function buildSubagentTree({
  signals,
  files,
  processStartedAt,
}: {
  signals: readonly SubagentSignal[]
  files: readonly SubagentFile[]
  processStartedAt?: number | undefined
}): SubagentInfo[] {
  const closed = signals.some((signal) => signal.kind === 'session-closed')
  const state: SessionState = { closed, processStartedAt: processStartedAt ?? null }
  const index = new Index()
  gather(index, signals, null)
  for (const file of files) gather(index, file.signals, file.agentId)
  for (const file of files) index.bindFile(file)

  // Runs of workflow scripts, by run id. A resumed run reuses its run id: the latest Workflow call
  // that names it stands for it, the earlier ones are left out. A run known only by its folder
  // gets a record of its own, so its agents still hang together.
  const runs = new Map<string, Gathered>()
  const replaced = new Set<Gathered>()
  for (const record of index.all) {
    const runId = record.workflow !== undefined && record.result !== undefined ? workflowRunOf(record.result.text) : null
    if (runId === null) continue
    const earlier = runs.get(runId)
    if (earlier) replaced.add(earlier)
    record.runId = runId
    runs.set(runId, record)
  }
  const withoutCall = new Set<Gathered>()
  for (const file of files) {
    const runId = file.workflow?.runId
    if (runId === undefined || runs.has(runId)) continue
    const record = index.runWithoutCall(runId)
    runs.set(runId, record)
    withoutCall.add(record)
  }
  const runOf = (record: Gathered): Gathered | undefined => (record.file?.workflow ? runs.get(record.file.workflow.runId) : undefined)

  // Background tasks that are not Subagents (a Bash run in the background) also send
  // task-notifications: only what has an Agent call, files or a Subagent type is kept, and the
  // runs of workflow scripts.
  const kept = index.all.filter(
    (record) =>
      !replaced.has(record) &&
      (record.call !== undefined || record.file !== undefined || (record.started?.subagentType ?? null) !== null || record.workflow !== undefined || withoutCall.has(record)),
  )
  const keptSet = new Set(kept)

  const parentOf = (record: Gathered): Gathered | undefined => {
    const run = runOf(record)
    if (run) return run
    const byMeta = record.file?.meta?.parentAgentId
    if (byMeta) return index.byAgentId(byMeta)
    if (record.callThread) return index.byAgentId(record.callThread)
    const parentCall = record.call?.parentToolUseId
    return parentCall ? index.byToolUse(parentCall) : undefined
  }

  const infos = new Map<Gathered, SubagentInfo>()
  for (const record of kept) {
    // An agent of a run that has ended was cut off with it, as one of a closed Session is.
    const described =
      record.workflow !== undefined || withoutCall.has(record) ? describeRun(record, closed) : describe(record, { ...state, closed: closed || runEnded(runOf(record)) })
    infos.set(record, { ...described, parentAgentId: null, depth: 1, children: [] })
  }

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
      const parentInfo = infos.get(parent)!
      info.parentAgentId = parentInfo.agentId
      parentInfo.children.push(info)
    } else {
      roots.push(info)
    }
  }
  // A run without a known call has no end of its own: it runs while an agent of it runs, and one
  // cut off by the closed Session ends it with an error, one interrupted with an earlier process of
  // the Session (ADR-0085) with `interrupted`.
  for (const record of withoutCall) {
    const info = infos.get(record)!
    const agents = kept.filter((each) => runOf(each) === record)
    const starts = agents.flatMap((agent) => {
      const at = infos.get(agent)!.startedAt
      return at === null ? [] : [at]
    })
    info.startedAt = starts.length > 0 ? Math.min(...starts) : null
    const statuses = agents.map((agent) => infos.get(agent)!.status)
    const cutOff = agents.some((agent) => infos.get(agent)!.status === 'error' && agent.file?.workflow?.end === null)
    info.status = statuses.includes('running') ? 'running' : cutOff ? 'error' : statuses.includes('interrupted') ? 'interrupted' : 'done'
  }
  // A run with a Workflow call but no end yet died with an earlier process of the Session when none
  // of its agents runs and one was interrupted; a run without agents, when the process started after
  // its call (ADR-0085).
  for (const record of kept) {
    const info = infos.get(record)!
    if (record.workflow === undefined || info.status !== 'running') continue
    const statuses = kept.filter((each) => runOf(each) === record).map((agent) => infos.get(agent)!.status)
    const interrupted = statuses.length > 0 ? !statuses.includes('running') && statuses.includes('interrupted') : before(state, firstOf(record.workflow?.at, record.result?.at))
    if (interrupted) info.status = 'interrupted'
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
