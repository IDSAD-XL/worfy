// The facts of the transcripts for the span model (worfy-flight-recorder ticket 14): the work of the
// agents the Orchestrator started and the Orchestrator's turns, from the lines of its transcript
// and of its Subagents' files. Pure: the reader in main (src/main/flight-recorder/transcripts.ts)
// finds and reads the files, makes the worktree paths canonical and keeps what lies in the Run.
//
// - An agent's span is one stretch of active work (decision 03, Q4): from the `Agent` call, or from
//   a `SendMessage` that resumes an agent which has reported, to its report (a task-notification,
//   or the result of a call in the foreground). A message to an agent that still works adds none.
//   Each stretch is its own fact; the model numbers the attempts of one agent (`#2`) and links
//   the cause (a rejecting verifier). A new `Agent` call under the same name — a restart after a
//   `session-error` — is the next attempt of that name the same way.
// - How it ended: `failed` for a failed task-notification or a call that errs, `stopped` for one
//   that was killed, `rejected` for a verifier whose report starts with REJECTED.
// - The Ticket: the agent's name (`impl-NN`, `verify-NN`), else `ticket NN` in its description,
//   else the branch `<epic>/<NN>`, the path `.scratch/<epic>/issues/<NN>-…` or `ticket NN` in its
//   prompt — when the Run has that Ticket. Otherwise the worktree of its report or the folder it
//   moved to is handed over with no Ticket (the reader in main gives it the Ticket of an agent in
//   that worktree, else `null`), and with neither the agent is the Run's (`null`).
// - An attempt still open when a new `Agent` call of the same name starts (a restart after a
//   `session-error`) is over: `cut-off` at its last own record.
// - A turn of the Orchestrator runs from a prompt (a typed one, a delivered report, a message of
//   another agent) to its last answer before the next one, and names the Tickets it touched.
//
// Times are the `timestamp` of the records, never the time a file changed.
//
// A live Run is parsed a part at a time (worfy-flight-recorder ticket 27): TranscriptParse keeps
// what the lines so far say and takes only the lines appended since, SubagentParse the same for a
// Subagent's file; `transcriptFacts` is the same parse fed all the lines at once.
import type { SpanOutcome, TurnFact, WorkFact } from './facts'
import { agentSubkind } from './spans'
import { parseTranscriptRecord } from '../transcript/parse'
import { AGENT_TOOLS, readSubagentMeta, summaryLine } from '../transcript/subagents'

type Iso = string
type Json = Record<string, unknown>

/** One Subagent's files: its meta (parsed JSON, or null without a meta file) and its transcript lines. */
export interface SubagentLines {
  meta: unknown
  lines: readonly string[]
}

export interface TranscriptInput {
  /** The Orchestrator Session the transcript is of. */
  session: string
  /** The Epic of the Run: a Ticket is `<epic>/<NN>`. */
  epic: string
  /** The Tickets of the Run as the Journal names them; a number outside them is not a Ticket of this Run. Empty — any. */
  tickets?: readonly string[]
  /** The lines of the Orchestrator's transcript, in file order. */
  lines: readonly string[]
  /** The Subagents' files by agent id. */
  subagents?: ReadonlyMap<string, SubagentLines>
}

export interface TranscriptFacts {
  work: WorkFact[]
  turns: TurnFact[]
}

const SEND_TOOL = 'SendMessage'
/** Statuses of the Agent tool's result that say the agent runs on in the background. */
const STILL_RUNNING = new Set(['async_launched', 'running'])
const FAILED = new Set(['failed', 'error'])
const STOPPED = new Set(['killed', 'stopped', 'cancelled'])
const AGENT_NAME_TICKET = /^(?:impl|implementer|verify|verifier|review|reviewer)-0*(\d{1,5})(?!\d)/iu
const DESCRIPTION_TICKET = /\bticket\s+0*(\d{1,5})\b/iu
const WAVE_TICKETS = /\btickets?\s+(\d{1,5}(?:\s*,\s*\d{1,5})*)\s+of\s+epic\s+([A-Za-z0-9._-]+)/iu
const AGENT_MESSAGE = /<agent-message from="([^"]{1,200})">/u
const VERDICT = /^(VERIFIED|REJECTED)\b/u
/** How much of a prompt is kept to look for its Ticket. */
const PROMPT_MAX = 20_000
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const REPORT_WORKTREE = /"worktree"\s*:\s*("(?:[^"\\]|\\.){1,1000}")/u
const REPORT_PR = /"pr"\s*:\s*(\d{1,9})\b/u

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

function parseLine(line: string): Json | null {
  try {
    const record: unknown = JSON.parse(line)
    return isObject(record) ? record : null
  } catch {
    return null
  }
}

/** The text of a user message: its string content, or its text blocks; null for tool results. */
function userText(record: Json): string | null {
  if (record.type !== 'user' || !isObject(record.message)) return null
  const content = record.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  if (content.some((block) => isObject(block) && block.type === 'tool_result')) return null
  const texts = content.flatMap((block) => (isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
  return texts.length === 0 ? null : texts.join('\n')
}

/** A task-notification that waited in Claude Code's queue (an enqueue, a queued command), as the user message it stands for. */
function queuedNotification(record: Json): Json | null {
  const attachment = isObject(record.attachment) ? record.attachment : undefined
  const text =
    record.type === 'queue-operation' && record.operation === 'enqueue'
      ? record.content
      : record.type === 'attachment' && attachment?.type === 'queued_command'
        ? attachment.prompt
        : undefined
  if (typeof text !== 'string' || !text.trimStart().startsWith('<task-notification>')) return null
  return { type: 'user', timestamp: record.timestamp, message: { role: 'user', content: text } }
}

/** A prompt as typed: a slash command is recorded as its tags, an early prompt as a queue operation. */
function promptOf(record: Json): string | null {
  const text = record.type === 'queue-operation' && record.operation === 'enqueue' ? str(record.content) : userText(record)
  if (text === undefined || text === null) return null
  const name = /<command-name>([\s\S]*?)<\/command-name>/u.exec(text)?.[1]?.trim()
  if (name === undefined) return text.trim()
  const args = /<command-args>([\s\S]*?)<\/command-args>/u.exec(text)?.[1]?.trim() ?? ''
  return `${name} ${args}`.trim()
}

const sameText = (a: string, b: string): boolean => a.replace(/\s+/gu, ' ').trim() === b.replace(/\s+/gu, ' ').trim()

/** The times of the prompts in a transcript whose text is `text` (`wave-started.text`): how a Wave's Session is found without its id. */
export function wavePromptTimes(lines: readonly string[], text: string): Iso[] {
  const times: Iso[] = []
  for (const line of lines) {
    if (!line.includes('"user"') && !line.includes('queue-operation')) continue
    const record = parseLine(line)
    if (record === null || record.isSidechain === true) continue
    const at = str(record.timestamp)
    const typed = promptOf(record)
    if (at !== undefined && typed !== null && sameText(typed, text)) times.push(at)
  }
  return times
}

/** The first `cwd` a transcript's records name. */
export function transcriptCwd(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    if (!line.includes('"cwd"')) continue
    const cwd = str(parseLine(line)?.cwd)
    if (cwd !== undefined) return cwd
  }
  return undefined
}

/** What a transcript's tool calls say of its Subagents: when each was started or resumed, by id. */
class AgentCalls {
  private readonly callAt = new Map<string, Iso>()
  private readonly started: { at: Iso; id: string }[] = []

  /** One record of the Orchestrator's own (no Subagent's record in the file), with its time. */
  take(record: Json, at: Iso): void {
    if (!isObject(record.message) || !Array.isArray(record.message.content)) return
    for (const block of record.message.content) {
      if (!isObject(block)) continue
      if (block.type === 'tool_use' && typeof block.id === 'string' && (AGENT_TOOLS.has(String(block.name)) || block.name === SEND_TOOL)) this.callAt.set(block.id, at)
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const called = this.callAt.get(block.tool_use_id)
      const result = isObject(record.toolUseResult) ? record.toolUseResult : {}
      const id = str(result.agentId) ?? str(result.resumedAgentId)
      if (called !== undefined && id !== undefined) this.started.push({ at: called, id })
    }
  }

  idsIn(inside: (at: Iso) => boolean): Set<string> {
    const ids = new Set<string>()
    for (const { at, id } of this.started) if (inside(at)) ids.add(id)
    return ids
  }
}

/**
 * The ids of the Subagents whose `Agent` call or resuming `SendMessage` lies `inside` (the Run's
 * Waves): the only Subagent files a Run needs. Reads only the lines of tool calls and their results.
 */
export function agentIdsIn(lines: readonly string[], inside: (at: Iso) => boolean): Set<string> {
  const calls = new AgentCalls()
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('toolUseResult')) continue
    const record = parseLine(line)
    const at = str(record?.timestamp)
    if (record === null || at === undefined || record.isSidechain === true) continue
    calls.take(record, at)
  }
  return calls.idsIn(inside)
}

// ── the agents ───────────────────────────────────────────────────────────────

interface Stretch {
  round: number
  start: Iso
  end: Iso | null
  outcome?: SpanOutcome
  reason?: string
  /** The report as the Orchestrator got it: a foreground result, the `<result>` of a task-notification. */
  report: string | null
  /** The Orchestrator's folder at the start: the agent's own records in another one say it moved there. */
  cwd: string | undefined
}

interface Agent {
  /** Its place among the agents, in the order of their calls. */
  index: number
  callId: string
  agentId: string | null
  /** When the agent got its id: the number of ids given before it and with it (AgentState.ids). */
  idAt: number
  name: string | null
  type: string | null
  description: string | null
  prompt: string | null
  stretches: Stretch[]
}

/**
 * A Ticket a turn touched, kept as what named it: the Run's Tickets, the Subagents' meta and the
 * Epic are those of the facts asked for (TranscriptParse.facts), as a parse of all the lines at once
 * would read them. `ids` is how many agents had their id at that line: the meta of an agent counts
 * only from its id on, as it did when the line was read.
 */
type Touch =
  | { kind: 'agent'; agent: Agent; ids: number }
  | { kind: 'wave'; epic: string; numbers: string[] }
  /** An `<agent-message>`: the newest of the first `count` agents with that name, else the name itself. */
  | { kind: 'from'; name: string; count: number; ids: number }
  /** A message that resumed none: the newest of the first `count` agents with that name, else the one with that id. */
  | { kind: 'to'; name: string; count: number; ids: number; byId: Agent | undefined }

interface Turn {
  start: Iso
  end: Iso | null
  touches: Touch[]
}

interface OwnRecord {
  at: Iso
  ms: number
  cwd: string | undefined
  text: string | null
}

const ms = (iso: Iso): number => Date.parse(iso)

/**
 * The records of a Subagent's own transcript that have a time — when, where, and its answer's text —
 * taken a part at a time: each line is parsed once (worfy-flight-recorder ticket 27).
 */
export class SubagentParse {
  readonly records: OwnRecord[] = []

  /** Takes the lines that follow those taken so far, in file order. */
  append(lines: readonly string[]): this {
    for (const line of lines) {
      const record = parseLine(line)
      const at = str(record?.timestamp)
      if (record === null || at === undefined) continue
      let text: string | null = null
      if (record.type === 'assistant' && isObject(record.message) && Array.isArray(record.message.content)) {
        const texts = record.message.content.flatMap((block) => (isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
        if (texts.length > 0) text = texts.join('\n')
      }
      this.records.push({ at, ms: ms(at), cwd: str(record.cwd), text })
    }
    return this
  }
}

function outcomeOf(status: string | null): SpanOutcome | undefined {
  if (status === null) return undefined
  const value = status.toLowerCase()
  if (FAILED.has(value)) return 'failed'
  if (STOPPED.has(value)) return 'stopped'
  return undefined
}

const firstLine = (text: string): string | undefined => summaryLine(text) ?? undefined

function reportWorktree(report: string | null): string | undefined {
  const quoted = report === null ? undefined : REPORT_WORKTREE.exec(report)?.[1]
  if (quoted === undefined) return undefined
  try {
    return str(JSON.parse(quoted))
  } catch {
    return undefined
  }
}

/** Which Ticket of the Run a number names: the Run's own spelling (`03`), else `<epic>/<NN>` when the Run names none. */
function ticketByNumber(digits: string | undefined, epic: string, tickets: readonly string[]): string | null {
  if (digits === undefined) return null
  const number = Number(digits)
  if (tickets.length === 0) return `${epic}/${String(number).padStart(2, '0')}`
  return tickets.find((ticket) => Number(/(\d+)$/u.exec(ticket)?.[1]) === number) ?? null
}

/** What the facts of a parse are asked for with: the Run, and the Subagents' files as they are now. */
export interface ParseInput {
  session: string
  epic: string
  /** The Tickets of the Run as the Journal names them; a number outside them is not a Ticket of this Run. Empty — any. */
  tickets?: readonly string[]
  /** The Subagents' files by agent id: the meta as read now, and the parse of the lines. */
  subagents?: ReadonlyMap<string, { meta: unknown; parse: SubagentParse }>
  /** Only the facts that start inside (the Run's Waves); all by default. The others are not built. */
  inside?: (at: Iso) => boolean
}

/**
 * The parse of an Orchestrator's transcript that keeps its state (worfy-flight-recorder ticket 27):
 * `append` takes the lines that came since the last part, `facts` gives what a parse of all the lines
 * at once gives, field for field, wherever the lines were cut. What a line says depends only on the
 * lines before it; what depends on the Run — its Tickets, the Subagents' meta, the Epic — is read
 * when the facts are asked for, so a Wave that adds Tickets, or a meta file that comes late, changes
 * nothing the earlier parts took. A live Run (src/main/flight-recorder/transcripts.ts) parses each
 * line once; a file truncated or replaced needs a new parse.
 */
export class TranscriptParse {
  private cwd: string | undefined
  /** How many agents have got their id so far. */
  private ids = 0
  private readonly agents: Agent[] = []
  private readonly calls = new Map<string, Agent>()
  private readonly byAgentId = new Map<string, Agent>()
  private readonly sends = new Map<string, { at: Iso; to: string | undefined; cwd: string | undefined }>()
  /** The stretch a tool use started: the call, or the SendMessage that resumed the agent. */
  private readonly stretchOfToolUse = new Map<string, { agent: Agent; stretch: Stretch }>()
  private readonly turns: Turn[] = []
  private readonly agentCalls = new AgentCalls()

  /** Takes the lines that follow those taken so far, in file order. */
  append(lines: readonly string[]): this {
    for (const line of lines) this.take(line)
    return this
  }

  /** agentIdsIn of the lines taken so far. */
  agentIdsIn(inside: (at: Iso) => boolean): Set<string> {
    return this.agentCalls.idsIn(inside)
  }

  private touch(touch: Touch): void {
    this.turns.at(-1)?.touches.push(touch)
  }

  private take(line: string): void {
    const raw = parseLine(line)
    if (raw === null || raw.isSidechain === true) return
    const at = str(raw.timestamp)
    if (at === undefined) return
    this.agentCalls.take(raw, at)
    this.cwd = str(raw.cwd) ?? this.cwd
    const record = queuedNotification(raw) ?? raw

    // A turn begins with a prompt: typed, a delivered report, another agent's message.
    if (raw.isMeta !== true && raw.isCompactSummary !== true) {
      const text = userText(raw)
      if (text !== null) {
        this.turns.push({ start: at, end: null, touches: [] })
        const wave = WAVE_TICKETS.exec(text)
        if (wave !== null) this.touch({ kind: 'wave', epic: wave[2]!, numbers: wave[1]!.split(',').map((digits) => digits.trim()) })
        const from = AGENT_MESSAGE.exec(text)?.[1]
        if (from !== undefined) this.touch({ kind: 'from', name: from, count: this.agents.length, ids: this.ids })
      }
    }
    if (raw.type === 'assistant' && this.turns.length > 0) this.turns.at(-1)!.end = at

    for (const { event } of parseTranscriptRecord(record)) {
      if (event.type === 'tool_use' && AGENT_TOOLS.has(event.name)) {
        const input_ = isObject(event.input) ? event.input : {}
        const agent: Agent = {
          index: this.agents.length,
          callId: event.id,
          agentId: null,
          idAt: Infinity,
          name: str(input_.name) ?? null,
          type: str(input_.subagent_type) ?? null,
          description: str(input_.description) ?? null,
          prompt: str(input_.prompt)?.slice(0, PROMPT_MAX) ?? null,
          stretches: [],
        }
        const stretch: Stretch = { round: 1, start: at, end: null, report: null, cwd: this.cwd }
        agent.stretches.push(stretch)
        this.agents.push(agent)
        this.calls.set(event.id, agent)
        this.stretchOfToolUse.set(event.id, { agent, stretch })
        this.touch({ kind: 'agent', agent, ids: this.ids })
      } else if (event.type === 'tool_use' && event.name === SEND_TOOL) {
        const input_ = isObject(event.input) ? event.input : {}
        this.sends.set(event.id, { at, to: str(input_.to) ?? str(input_.recipient), cwd: this.cwd })
      } else if (event.type === 'tool_result' && this.calls.has(event.toolUseId)) {
        const agent = this.calls.get(event.toolUseId)!
        const stretch = agent.stretches[0]!
        const result = isObject(raw.toolUseResult) ? raw.toolUseResult : {}
        const agentId = str(result.agentId)
        if (agentId !== undefined && agent.agentId === null) {
          agent.agentId = agentId
          agent.idAt = ++this.ids
          this.byAgentId.set(agentId, agent)
        }
        const status = str(result.status)
        const launched = (status !== undefined && STILL_RUNNING.has(status)) || /^\s*Async agent launched/iu.test(event.content)
        if (stretch.end !== null) continue
        if (event.isError) Object.assign(stretch, { end: at, outcome: 'failed', reason: firstLine(event.content) })
        else if (!launched) Object.assign(stretch, { end: at, outcome: outcomeOf(status ?? null), report: event.content })
      } else if (event.type === 'tool_result' && this.sends.has(event.toolUseId)) {
        if (event.isError) continue
        const sent = this.sends.get(event.toolUseId)!
        const result = isObject(raw.toolUseResult) ? raw.toolUseResult : {}
        const resumed = str(result.resumedAgentId)
        if (resumed === undefined) {
          // The message waits for an agent that still works: it only names the agent's Ticket.
          if (sent.to !== undefined) this.touch({ kind: 'to', name: sent.to, count: this.agents.length, ids: this.ids, byId: this.byAgentId.get(sent.to) })
          continue
        }
        const agent = this.byAgentId.get(resumed)
        if (agent === undefined) continue
        this.touch({ kind: 'agent', agent, ids: this.ids })
        const last = agent.stretches.at(-1)!
        // Only a resumed agent works again: without `resumedAgentId` the message waits for an agent that still works.
        if (last.end === null) continue
        const stretch: Stretch = { round: last.round + 1, start: sent.at, end: null, report: null, cwd: sent.cwd }
        agent.stretches.push(stretch)
        this.stretchOfToolUse.set(event.toolUseId, { agent, stretch })
      } else if (event.type === 'subagent' && event.phase === 'finished') {
        const agent = this.byAgentId.get(event.taskId)
        if (agent === undefined) continue
        this.touch({ kind: 'agent', agent, ids: this.ids })
        const named = event.toolUseId === null ? undefined : this.stretchOfToolUse.get(event.toolUseId)
        const stretch = named?.agent === agent ? named.stretch : agent.stretches.findLast((item) => item.end === null)
        if (stretch === undefined || stretch.end !== null) continue
        const outcome = outcomeOf(event.status)
        Object.assign(stretch, { end: at, outcome, reason: outcome === undefined ? undefined : (event.summary ?? undefined), report: event.result ?? null })
      }
    }
  }

  /** The facts of the lines taken so far, for this Run and the Subagents' files as they are now. Changes nothing of the parse. */
  facts(input: ParseInput): TranscriptFacts {
    const tickets = input.tickets ?? []
    const subagents = input.subagents ?? new Map<string, { meta: unknown; parse: SubagentParse }>()
    const keep = input.inside ?? (() => true)
    const agents = this.agents
    const metas = new Map<string, ReturnType<typeof readSubagentMeta>>()
    const metaOf = (agentId: string | null) => {
      if (agentId === null) return null
      if (!metas.has(agentId)) metas.set(agentId, readSubagentMeta(subagents.get(agentId)?.meta))
      return metas.get(agentId)!
    }
    /** The agent's id as a line read it: known from the line that gave it on. */
    const idAt = (agent: Agent, ids: number): string | null => (agent.idAt <= ids ? agent.agentId : null)
    // An agent has two names and two Tickets at most: before its id is known, and after.
    const memo = <T>(of: (agent: Agent, agentId: string | null) => T) => {
      const before = new Map<Agent, T>()
      const after = new Map<Agent, T>()
      return (agent: Agent, agentId: string | null): T => {
        const known = agentId === null ? before : after
        if (!known.has(agent)) known.set(agent, of(agent, agentId))
        return known.get(agent)!
      }
    }
    const nameOf = memo((agent, agentId) => agent.name ?? metaOf(agentId)?.name ?? agent.description ?? metaOf(agentId)?.description ?? agentId ?? agent.callId)
    const ticketOfName = (name: string | null): string | null => ticketByNumber(name === null ? undefined : AGENT_NAME_TICKET.exec(name)?.[1], input.epic, tickets)
    const branchOrIssue = new RegExp(`(?:\\.scratch/${escape(input.epic)}/issues/|\\b${escape(input.epic)}/)0*(\\d{1,5})(?!\\d)`, 'u')
    const ticketOf = memo((agent, agentId) => {
      const meta = metaOf(agentId)
      const prompt = agent.prompt ?? ''
      return (
        ticketOfName(agent.name ?? meta?.name ?? null) ??
        ticketByNumber(DESCRIPTION_TICKET.exec(agent.description ?? meta?.description ?? '')?.[1], input.epic, tickets) ??
        ticketByNumber(branchOrIssue.exec(prompt)?.[1], input.epic, tickets) ??
        ticketByNumber(DESCRIPTION_TICKET.exec(prompt)?.[1], input.epic, tickets)
      )
    })
    // The agents by any name they had, newest first: who a message by name meant at its line.
    let byAnyName: Map<string, Agent[]> | undefined
    const byName = (name: string, count: number, ids: number): Agent | undefined => {
      if (byAnyName === undefined) {
        byAnyName = new Map()
        for (let index = agents.length - 1; index >= 0; index--) {
          const agent = agents[index]!
          for (const each of new Set([nameOf(agent, null), ...(agent.agentId === null ? [] : [nameOf(agent, agent.agentId)])])) {
            const list = byAnyName.get(each) ?? []
            list.push(agent)
            byAnyName.set(each, list)
          }
        }
      }
      return byAnyName.get(name)?.find((agent) => agent.index < count && nameOf(agent, idAt(agent, ids)) === name)
    }
    const touched = (touch: Touch): (string | null)[] => {
      switch (touch.kind) {
        case 'agent':
          return [ticketOf(touch.agent, idAt(touch.agent, touch.ids))]
        case 'wave':
          return touch.epic === input.epic ? touch.numbers.map((digits) => ticketByNumber(digits, input.epic, tickets)) : []
        case 'from': {
          const agent = byName(touch.name, touch.count, touch.ids)
          return [agent === undefined ? ticketOfName(touch.name) : ticketOf(agent, idAt(agent, touch.ids))]
        }
        case 'to': {
          const agent = byName(touch.name, touch.count, touch.ids) ?? touch.byId
          return agent === undefined ? [] : [ticketOf(agent, idAt(agent, touch.ids))]
        }
      }
    }

    // An attempt open when a new call of its name starts was replaced: the restart after a session-error.
    const replacedAt = new Map<Agent, Iso>()
    const ofName = new Map<string, Agent[]>()
    for (const agent of agents) {
      const name = nameOf(agent, agent.agentId)
      const list = ofName.get(name) ?? []
      list.push(agent)
      ofName.set(name, list)
    }
    for (const agent of agents) {
      const last = agent.stretches.at(-1)!
      if (last.end !== null) continue
      const later = ofName.get(nameOf(agent, agent.agentId))!.find((other) => other.index > agent.index && ms(other.stretches[0]!.start) >= ms(last.start))
      if (later !== undefined) replacedAt.set(agent, later.stretches[0]!.start)
    }

    const work: WorkFact[] = []
    for (const agent of agents) {
      if (!agent.stretches.some((stretch) => keep(stretch.start))) continue
      const meta = metaOf(agent.agentId)
      const own = agent.agentId === null ? [] : (subagents.get(agent.agentId)?.parse.records ?? [])
      const name = nameOf(agent, agent.agentId)
      const agentType = agent.type ?? meta?.agentType
      const verifier = agentSubkind(name, agentType ?? undefined) === 'verifier'
      const ticket = ticketOf(agent, agent.agentId)
      agent.stretches.forEach((stretch, index) => {
        if (!keep(stretch.start)) return
        const next = agent.stretches[index + 1]
        const replaced = next === undefined ? replacedAt.get(agent) : undefined
        const bound = next?.start ?? replaced
        const from = ms(stretch.start)
        const to = bound === undefined ? undefined : ms(bound)
        const inside = own.filter((record) => record.ms >= from && (to === undefined || record.ms < to))
        const endMs = stretch.end === null ? undefined : ms(stretch.end)
        const until = endMs === undefined ? inside : inside.filter((record) => record.ms <= endMs)
        const report = stretch.report ?? (stretch.end === null ? null : (until.findLast((record) => record.text !== null)?.text ?? null))
        let { end, outcome, reason } = stretch
        let lastSeenAt: Iso | undefined
        if (end === null && replaced !== undefined) {
          end = inside.at(-1)?.at ?? replaced
          outcome = 'cut-off'
          reason = `replaced by a new call of ${name}`
        } else if (end === null && meta?.stoppedByUser === true && next === undefined && inside.length > 0) {
          end = inside.at(-1)!.at
          outcome = 'stopped'
        } else if (end === null) {
          lastSeenAt = inside.at(-1)?.at
        }
        let verdict: string | undefined
        if (verifier && report !== null && end !== null) {
          const first = summaryLine(report) ?? ''
          verdict = VERDICT.exec(first)?.[1]
          if (verdict === 'REJECTED' && outcome === undefined) {
            outcome = 'rejected'
            reason = first
          }
        }
        const moved = until.findLast((record) => record.cwd !== undefined)?.cwd
        const worktree = reportWorktree(report) ?? (moved !== undefined && moved !== stretch.cwd ? moved : undefined)
        const pr = report === null ? undefined : REPORT_PR.exec(report)?.[1]
        const fact: WorkFact = {
          id: `${agent.agentId ?? agent.callId}#${stretch.round}`,
          kind: 'agent',
          name,
          start: stretch.start,
          end,
          startSource: 'transcript',
          session: input.session,
        }
        // Reader 14 reports only this Run's agents: with no Ticket and nothing to place it by, the Run's;
        // with a worktree, the reader in main places it (transcripts.ts) and never leaves it absent.
        if (ticket !== null) fact.ticket = ticket
        else if (worktree === undefined) fact.ticket = null
        if (agentType !== undefined && agentType !== null) fact.agentType = agentType
        if (agent.agentId !== null) fact.agent = agent.agentId
        if (end !== null) fact.endSource = 'transcript'
        if (lastSeenAt !== undefined) fact.lastSeenAt = lastSeenAt
        if (outcome !== undefined) fact.outcome = outcome
        if (reason !== undefined) fact.reason = reason
        if (verdict !== undefined) fact.verdict = verdict
        if (worktree !== undefined) fact.worktree = worktree
        if (pr !== undefined) fact.pr = Number(pr)
        work.push(fact)
      })
    }

    return {
      work: work.sort((a, b) => ms(a.start) - ms(b.start)),
      turns: this.turns.flatMap((turn, index) => {
        if (!keep(turn.start)) return []
        const named = new Set<string>()
        for (const touch of turn.touches) for (const ticket of touched(touch)) if (ticket !== null) named.add(ticket)
        const fact: TurnFact = {
          id: `${input.session}:${index + 1}`,
          start: turn.start,
          // shortcut: a turn ends at its last answer, so the last turn of a live Session reads as over until the next prompt; ticket 17 (live re-read) redoes it with the Session's state.
          end: turn.end,
          ...(turn.end === null ? { lastSeenAt: turn.start } : {}),
          tickets: [...named],
          session: input.session,
          startSource: 'transcript' as const,
          ...(turn.end === null ? {} : { endSource: 'transcript' as const }),
        }
        return [fact]
      }),
    }
  }
}

/** The facts of the Orchestrator's transcript and its Subagents' files: all the lines parsed at once. */
export function transcriptFacts(input: TranscriptInput): TranscriptFacts {
  const subagents = new Map([...(input.subagents ?? new Map<string, SubagentLines>())].map(([id, file]) => [id, { meta: file.meta, parse: new SubagentParse().append(file.lines) }]))
  return new TranscriptParse().append(input.lines).facts({ session: input.session, epic: input.epic, ...(input.tickets === undefined ? {} : { tickets: input.tickets }), subagents })
}
