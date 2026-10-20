// Claude Code transcript lines (~/.claude/projects/<dir>/<sessionId>.jsonl) → worfy's events.
//
// The events are those of a live Session (src/shared/agent/events.ts, `AgentEvent`): one schema
// for both sources, so the transcript view draws a file the way it draws a running Session. Two
// kinds exist only in files — `command` (a slash command the user typed) and `title` — and are
// part of that schema too. What a record says about itself and not about its content (uuid, time,
// whether a Subagent wrote it) travels next to the event, in a `TranscriptEntry`.
//
// The transcript format is internal to Claude Code and changes between versions (ticket 09,
// its result section). The core has been stable from 2.1.222 to 2.1.286: `type`, `uuid`, `timestamp`,
// `isSidechain`, `message.content[]` with `text`, `thinking`, `tool_use`, `tool_result` blocks.
// Everything else is optional here: a record or a content block this module does not know
// becomes an `unknown` event, and parsing goes on. Nothing in this file throws on input.
//
// The function is pure and runs in any process; the main process reads the files (tail.ts).
import { z } from 'zod'
import { agentEvent, hookSaidSomething, LOCAL_COMMAND, toolResultText, type AgentEvent } from '../agent/events'

/** One event of a transcript and the record it came from. */
export const transcriptEntrySchema = z.object({
  /** `uuid` of the record the event came from, when the record has one. */
  uuid: z.string().optional(),
  /** ISO time of the record, when it has one. */
  timestamp: z.string().optional(),
  /** True for records written by a Subagent (`isSidechain`); its tree is built by ticket 15. */
  sidechain: z.boolean(),
  /** The Subagent that wrote the record (`agentId`), when there is one. */
  agentId: z.string().optional(),
  event: agentEvent,
})

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>

type Json = Record<string, unknown>
type Meta = Omit<TranscriptEntry, 'event'>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Drops keys whose value is undefined, so entries compare and serialise cleanly. */
function compact<T extends Json>(value: T): T {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
  return value
}

function metaOf(record: Json): Meta {
  return compact({
    uuid: str(record.uuid),
    timestamp: str(record.timestamp),
    sidechain: record.isSidechain === true,
    agentId: str(record.agentId),
  })
}

/**
 * An event worfy does not know. `sdkType` names what it was: the record's type and the content
 * block, system subtype or attachment type (`attachment/invoked_skills`), `<type>:invalid` for a
 * known record of an unexpected shape, `line:unparsable` for a line that is not JSON.
 */
const unknown = (sdkType: string): AgentEvent => ({ type: 'unknown', sdkType })
const unknownType = (recordType: string, subtype?: string): AgentEvent => unknown(subtype === undefined ? recordType || 'untyped' : `${recordType}/${subtype}`)
const invalid = (recordType: string): AgentEvent => unknown(`${recordType || 'record'}:invalid`)

/** Text inside `<tag>…</tag>`, trimmed; undefined when the tag is absent. */
function tag(text: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  return match?.[1]?.trim()
}

const orNull = (value: string | undefined): string | null => value ?? null

function userString(record: Json, text: string): AgentEvent[] {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<task-notification>')) {
    const taskId = tag(trimmed, 'task-id')
    if (taskId !== undefined) {
      return [
        {
          type: 'subagent',
          phase: 'finished',
          taskId,
          toolUseId: orNull(tag(trimmed, 'tool-use-id')),
          description: null,
          subagentType: null,
          status: orNull(tag(trimmed, 'status')),
          summary: orNull(tag(trimmed, 'summary')),
          result: orNull(tag(trimmed, 'result')),
        },
      ]
    }
  }
  const command = tag(trimmed, 'command-name')
  if (command !== undefined) return [{ type: 'command', name: command, args: tag(trimmed, 'command-args') ?? '' }]
  const local = LOCAL_COMMAND.exec(text)
  if (local) return [{ type: 'notice', kind: 'local_command', text: local[2] ?? '' }]
  // Text the harness injected (a skill's body, a reminder) is marked `isMeta`, as the SDK marks it synthetic.
  return [{ type: 'notice', kind: record.isMeta === true ? 'synthetic' : 'user', text }]
}

/** Statuses of the Agent tool's result that say the Subagent is still running. */
const STILL_RUNNING = new Set(['async_launched', 'running'])

/** The Agent tool's result names the Subagent it started (ticket 09, "Subagents"). */
function subagentStarted(toolUseId: string, outcome: Json): AgentEvent[] {
  const taskId = str(outcome.agentId)
  if (taskId === undefined) return []
  const status = str(outcome.status)
  const started: AgentEvent = {
    type: 'subagent',
    phase: 'started',
    taskId,
    toolUseId,
    description: orNull(str(outcome.description)),
    subagentType: orNull(str(outcome.agentType)),
    status: null,
    summary: null,
  }
  // A synchronous call returns when the Subagent is done: the same record says how it ended.
  if (status === undefined || STILL_RUNNING.has(status)) return [started]
  return [started, { ...started, phase: 'finished', description: null, subagentType: null, status }]
}

function userRecord(record: Json): AgentEvent[] {
  const message = record.message
  if (!isObject(message)) return [invalid('user')]
  const content = message.content
  if (typeof content === 'string') return userString(record, content)
  if (!Array.isArray(content)) return [invalid('user')]

  const events: AgentEvent[] = []
  for (const block of content) {
    if (!isObject(block)) {
      events.push(invalid('user'))
    } else if (block.type === 'text' && typeof block.text === 'string') {
      events.push(...userString(record, block.text))
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      events.push({ type: 'tool_result', toolUseId: block.tool_use_id, content: toolResultText(block.content), isError: block.is_error === true, parentToolUseId: null })
      const outcome = record.toolUseResult
      if (isObject(outcome)) events.push(...subagentStarted(block.tool_use_id, outcome))
    } else {
      events.push(unknownType('user', str(block.type)))
    }
  }
  return events
}

function assistantRecord(record: Json): AgentEvent[] {
  const message = record.message
  const content = isObject(message) ? message.content : undefined
  if (!isObject(message) || !Array.isArray(content)) return [invalid('assistant')]
  const messageId = str(message.id) ?? str(record.uuid) ?? ''
  const synthetic = message.model === '<synthetic>'

  const events: AgentEvent[] = []
  for (const block of content) {
    if (!isObject(block)) {
      events.push(invalid('assistant'))
    } else if (block.type === 'text' && typeof block.text === 'string') {
      events.push({ type: 'text', text: block.text, messageId, parentToolUseId: null, synthetic })
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      events.push({ type: 'thinking', text: block.thinking, messageId, parentToolUseId: null })
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      events.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input, parentToolUseId: null })
    } else {
      events.push(unknownType('assistant', str(block.type)))
    }
  }
  return events
}

/**
 * A hook, kept only when it said something (hookSaidSomething, the rule of a live Session): the
 * transcript records every hook that ran, twice for a Stop hook from 2.1.247 on.
 */
function hookEvent(hook: { hookEvent: string; hookName: string; exitCode: number | null; outcome: string; stdout: string; stderr: string }): AgentEvent[] {
  return hookSaidSomething(hook) ? [{ type: 'hook', ...hook }] : []
}

function systemRecord(record: Json): AgentEvent[] {
  const subtype = str(record.subtype)
  if (subtype === 'stop_hook_summary') {
    const infos = Array.isArray(record.hookInfos) ? record.hookInfos.filter(isObject) : []
    const errors = Array.isArray(record.hookErrors) ? record.hookErrors.map((error) => (typeof error === 'string' ? error : JSON.stringify(error))) : []
    const commands = infos.flatMap((info) => (typeof info.command === 'string' ? [info.command] : []))
    const outcome = errors.length > 0 ? 'error' : record.preventedContinuation === true ? 'blocked' : 'success'
    return hookEvent({
      hookEvent: 'Stop',
      hookName: commands.join(', ') || 'Stop',
      exitCode: null,
      outcome,
      stdout: str(record.stopReason) ?? '',
      stderr: errors.join('\n'),
    })
  }
  return [unknownType('system', subtype)]
}

function attachmentRecord(record: Json): AgentEvent[] {
  const attachment = record.attachment
  if (!isObject(attachment)) return [invalid('attachment')]
  const type = str(attachment.type)
  if (type?.startsWith('hook_')) {
    const kind = type.slice('hook_'.length)
    const blocking = isObject(attachment.blockingError) ? attachment.blockingError : {}
    const said = contentText(attachment.content)
    // What a hook said goes to stdout when it is its output and to stderr when it is an error.
    const output = HOOK_OUTPUTS.has(kind) ? said : kind === 'stopped_continuation' ? (str(attachment.message) ?? '') : ''
    const error = kind === 'error_during_execution' ? said : kind === 'blocking_error' ? (str(attachment.blockingError) ?? str(blocking.blockingError) ?? '') : ''
    return hookEvent({
      hookEvent: str(attachment.hookEvent) ?? str(attachment.hookName) ?? '',
      hookName: str(attachment.command) ?? str(blocking.command) ?? str(attachment.hookName) ?? '',
      exitCode: num(attachment.exitCode) ?? null,
      outcome: HOOK_OUTPUTS.has(kind) ? 'success' : kind,
      stdout: str(attachment.stdout) ?? output,
      stderr: str(attachment.stderr) ?? error,
    })
  }
  return [unknownType('attachment', type)]
}

/**
 * Attachments that carry the output of a hook that ran fine, in `content` (Claude Code 2.1.291):
 * a SessionStart hook's `systemMessage` and its `additionalContext` (worfy-daily ticket 25).
 */
const HOOK_OUTPUTS = new Set(['system_message', 'additional_context'])

/** The text of an attachment's `content`: a string, or the strings of an array one per line. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((each): each is string => typeof each === 'string').join('\n')
}

const TITLE_FIELDS = {
  'custom-title': ['custom', 'customTitle'],
  'ai-title': ['ai', 'aiTitle'],
  'agent-name': ['agent', 'agentName'],
} as const

function recordEvents(record: Json): AgentEvent[] {
  const type = str(record.type) ?? ''
  switch (type) {
    case 'user':
      return userRecord(record)
    case 'assistant':
      return assistantRecord(record)
    case 'system':
      return systemRecord(record)
    case 'attachment':
      return attachmentRecord(record)
    case 'custom-title':
    case 'ai-title':
    case 'agent-name': {
      const [source, field] = TITLE_FIELDS[type]
      const title = str(record[field])
      return title === undefined ? [invalid(type)] : [{ type: 'title', source, title }]
    }
    default:
      return [unknownType(type)]
  }
}

/** One parsed transcript record (a JSON value) → its events, each with the record's facts. Never throws. */
export function parseTranscriptRecord(record: unknown): TranscriptEntry[] {
  if (!isObject(record)) return [{ sidechain: false, event: invalid('') }]
  const meta = metaOf(record)
  return recordEvents(record).map((event) => ({ ...meta, event }))
}

/** One JSONL line → its entries. A line that is not JSON gives one `unknown` event. */
export function parseTranscriptLine(line: string): TranscriptEntry[] {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return [{ sidechain: false, event: unknown('line:unparsable') }]
  }
  return parseTranscriptRecord(record)
}

/** Many lines → their entries, in order. */
export function parseTranscriptLines(lines: readonly string[]): TranscriptEntry[] {
  return lines.flatMap(parseTranscriptLine)
}

/**
 * The events of the Session's own thread: what a Subagent wrote into the Session's file
 * (`isSidechain`, older versions) is left out, as a live Session's transcript leaves out the
 * events of its Subagents.
 */
export function mainThreadEvents(entries: readonly TranscriptEntry[]): AgentEvent[] {
  return entries.flatMap((entry) => (entry.sidechain ? [] : [timedEvent(entry)]))
}

/**
 * The event of an entry with the record's time in `at`, so a row read from the file shows when it
 * was written, the same after every restart (ticket 14). A record without a readable time leaves
 * the event as it is.
 */
export function timedEvent(entry: TranscriptEntry): AgentEvent {
  const at = entry.timestamp === undefined ? Number.NaN : Date.parse(entry.timestamp)
  return Number.isFinite(at) ? { ...entry.event, at } : entry.event
}
