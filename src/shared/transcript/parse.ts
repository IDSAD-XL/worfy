// Claude Code transcript lines (~/.claude/projects/<dir>/<sessionId>.jsonl) → worfy events.
//
// The transcript format is internal to Claude Code and changes between versions (ticket 09,
// "Итог"). The core has been stable from 2.1.222 to 2.1.286: `type`, `uuid`, `timestamp`,
// `isSidechain`, `message.content[]` with `text`, `thinking`, `tool_use`, `tool_result` blocks.
// Everything else is optional here: a record or a content block this module does not know
// becomes an `unknown` event, and parsing goes on. Nothing in this file throws on input.
//
// The function is pure and runs in any process; the main process reads the files (tail.ts).
import { z } from 'zod'

const eventBase = {
  /** `uuid` of the record the event came from, when the record has one. */
  uuid: z.string().optional(),
  /** ISO time of the record, when it has one. */
  timestamp: z.string().optional(),
  /** True for records written by a Subagent (`isSidechain`); its tree is built by ticket 15. */
  sidechain: z.boolean(),
  /** The Subagent that wrote the record (`agentId`), when there is one. */
  agentId: z.string().optional(),
}

export const transcriptEventSchema = z.discriminatedUnion('kind', [
  /** Plain text of a user prompt or of the assistant. `isMeta` marks text the harness injected. */
  z.object({ ...eventBase, kind: z.literal('text'), role: z.enum(['user', 'assistant']), text: z.string(), isMeta: z.boolean() }),
  /** A slash command typed by the user: `<command-name>/name</command-name>`. */
  z.object({ ...eventBase, kind: z.literal('command'), name: z.string(), args: z.string() }),
  z.object({ ...eventBase, kind: z.literal('thinking'), text: z.string() }),
  z.object({ ...eventBase, kind: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  /** A tool's answer; `text` joins the text parts of the result. */
  z.object({ ...eventBase, kind: z.literal('tool_result'), toolUseId: z.string(), text: z.string(), isError: z.boolean() }),
  /**
   * A hook ran: `system/stop_hook_summary` (commands only, its output is not kept) or a `hook_*`
   * attachment (`outcome` is the part after `hook_`, e.g. `success`).
   */
  z.object({
    ...eventBase,
    kind: z.literal('hook'),
    source: z.enum(['stop_hook_summary', 'attachment']),
    hookEvent: z.string(),
    commands: z.array(z.string()),
    outcome: z.string().optional(),
    exitCode: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    durationMs: z.number().optional(),
    preventedContinuation: z.boolean().optional(),
  }),
  /**
   * A Subagent was started by the Agent tool (`started`: the tool result carries its agentId) or
   * reported back through a task-notification (`notification`).
   */
  z.object({
    ...eventBase,
    kind: z.literal('subagent'),
    phase: z.enum(['started', 'notification']),
    subagentId: z.string(),
    toolUseId: z.string().optional(),
    status: z.string().optional(),
    agentType: z.string().optional(),
    description: z.string().optional(),
    summary: z.string().optional(),
    result: z.string().optional(),
  }),
  /** The Session got a title: `custom-title`, `ai-title` or `agent-name`. */
  z.object({ ...eventBase, kind: z.literal('title'), source: z.enum(['custom', 'ai', 'agent']), title: z.string() }),
  /**
   * Anything else. `recordType` is the record's `type` (`attachment`, `queue-operation`, …),
   * `subtype` the system subtype, attachment type or content block type, `reason` why it is here.
   */
  z.object({
    ...eventBase,
    kind: z.literal('unknown'),
    reason: z.enum(['unknown-type', 'unparsable', 'invalid-shape']),
    recordType: z.string(),
    subtype: z.string().optional(),
  }),
])

export type TranscriptEvent = z.infer<typeof transcriptEventSchema>
export type TranscriptEventKind = TranscriptEvent['kind']

type Json = Record<string, unknown>
type Base = { uuid?: string; timestamp?: string; sidechain: boolean; agentId?: string }

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

/** Drops keys whose value is undefined, so events compare and serialise cleanly. */
function compact<T extends Json>(value: T): T {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
  return value
}

function baseOf(record: Json): Base {
  return compact({
    uuid: str(record.uuid),
    timestamp: str(record.timestamp),
    sidechain: record.isSidechain === true,
    agentId: str(record.agentId),
  })
}

const unknownEvent = (base: Base, reason: 'unknown-type' | 'unparsable' | 'invalid-shape', recordType: string, subtype?: string): TranscriptEvent =>
  compact({ ...base, kind: 'unknown' as const, reason, recordType, subtype })

/** Text inside `<tag>…</tag>`, trimmed; undefined when the tag is absent. */
function tag(text: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  return match?.[1]?.trim()
}

/** Joins the text parts of a tool_result's `content` (a string or a list of blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is Json => isObject(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

function userString(base: Base, record: Json, text: string): TranscriptEvent[] {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<task-notification>')) {
    const subagentId = tag(trimmed, 'task-id')
    if (subagentId !== undefined) {
      return [
        compact({
          ...base,
          kind: 'subagent' as const,
          phase: 'notification' as const,
          subagentId,
          toolUseId: tag(trimmed, 'tool-use-id'),
          status: tag(trimmed, 'status'),
          summary: tag(trimmed, 'summary'),
          result: tag(trimmed, 'result'),
        }),
      ]
    }
  }
  const command = tag(trimmed, 'command-name')
  if (command !== undefined) return [{ ...base, kind: 'command', name: command, args: tag(trimmed, 'command-args') ?? '' }]
  return [{ ...base, kind: 'text', role: 'user', text, isMeta: record.isMeta === true }]
}

function subagentStarted(base: Base, toolUseId: string, outcome: Json): TranscriptEvent | undefined {
  const subagentId = str(outcome.agentId)
  if (subagentId === undefined) return undefined
  return compact({
    ...base,
    kind: 'subagent' as const,
    phase: 'started' as const,
    subagentId,
    toolUseId,
    status: str(outcome.status),
    agentType: str(outcome.agentType),
    description: str(outcome.description),
  })
}

function userRecord(base: Base, record: Json): TranscriptEvent[] {
  const message = record.message
  if (!isObject(message)) return [unknownEvent(base, 'invalid-shape', 'user')]
  const content = message.content
  if (typeof content === 'string') return userString(base, record, content)
  if (!Array.isArray(content)) return [unknownEvent(base, 'invalid-shape', 'user')]

  const events: TranscriptEvent[] = []
  for (const block of content) {
    if (!isObject(block)) {
      events.push(unknownEvent(base, 'invalid-shape', 'user'))
    } else if (block.type === 'text' && typeof block.text === 'string') {
      events.push(...userString(base, record, block.text))
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      events.push({ ...base, kind: 'tool_result', toolUseId: block.tool_use_id, text: resultText(block.content), isError: block.is_error === true })
      // The Agent tool's result names the Subagent it started (ticket 09, "Subagent-ы").
      const outcome = record.toolUseResult
      const started = isObject(outcome) ? subagentStarted(base, block.tool_use_id, outcome) : undefined
      if (started) events.push(started)
    } else {
      events.push(unknownEvent(base, 'unknown-type', 'user', str(block.type)))
    }
  }
  return events
}

function assistantRecord(base: Base, record: Json): TranscriptEvent[] {
  const message = record.message
  const content = isObject(message) ? message.content : undefined
  if (!Array.isArray(content)) return [unknownEvent(base, 'invalid-shape', 'assistant')]

  const events: TranscriptEvent[] = []
  for (const block of content) {
    if (!isObject(block)) {
      events.push(unknownEvent(base, 'invalid-shape', 'assistant'))
    } else if (block.type === 'text' && typeof block.text === 'string') {
      events.push({ ...base, kind: 'text', role: 'assistant', text: block.text, isMeta: false })
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      events.push({ ...base, kind: 'thinking', text: block.thinking })
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      events.push({ ...base, kind: 'tool_use', id: block.id, name: block.name, input: block.input })
    } else {
      events.push(unknownEvent(base, 'unknown-type', 'assistant', str(block.type)))
    }
  }
  return events
}

function systemRecord(base: Base, record: Json): TranscriptEvent[] {
  const subtype = str(record.subtype)
  if (subtype === 'stop_hook_summary') {
    const infos = Array.isArray(record.hookInfos) ? record.hookInfos : []
    const commands = infos.filter(isObject).flatMap((info) => (typeof info.command === 'string' ? [info.command] : []))
    return [
      compact({
        ...base,
        kind: 'hook' as const,
        source: 'stop_hook_summary' as const,
        hookEvent: 'Stop',
        commands,
        preventedContinuation: bool(record.preventedContinuation),
      }),
    ]
  }
  return [unknownEvent(base, 'unknown-type', 'system', subtype)]
}

function attachmentRecord(base: Base, record: Json): TranscriptEvent[] {
  const attachment = record.attachment
  if (!isObject(attachment)) return [unknownEvent(base, 'invalid-shape', 'attachment')]
  const type = str(attachment.type)
  if (type?.startsWith('hook_')) {
    const command = str(attachment.command)
    return [
      compact({
        ...base,
        kind: 'hook' as const,
        source: 'attachment' as const,
        hookEvent: str(attachment.hookEvent) ?? str(attachment.hookName) ?? '',
        commands: command === undefined ? [] : [command],
        outcome: type.slice('hook_'.length),
        exitCode: num(attachment.exitCode),
        stdout: str(attachment.stdout),
        stderr: str(attachment.stderr),
        durationMs: num(attachment.durationMs),
      }),
    ]
  }
  return [unknownEvent(base, 'unknown-type', 'attachment', type)]
}

const TITLE_FIELDS = {
  'custom-title': ['custom', 'customTitle'],
  'ai-title': ['ai', 'aiTitle'],
  'agent-name': ['agent', 'agentName'],
} as const

/** One parsed transcript record (a JSON value) → its events. Never throws. */
export function parseTranscriptRecord(record: unknown): TranscriptEvent[] {
  if (!isObject(record)) return [unknownEvent({ sidechain: false }, 'invalid-shape', '')]
  const base = baseOf(record)
  const type = str(record.type) ?? ''
  switch (type) {
    case 'user':
      return userRecord(base, record)
    case 'assistant':
      return assistantRecord(base, record)
    case 'system':
      return systemRecord(base, record)
    case 'attachment':
      return attachmentRecord(base, record)
    case 'custom-title':
    case 'ai-title':
    case 'agent-name': {
      const [source, field] = TITLE_FIELDS[type]
      const title = str(record[field])
      return title === undefined ? [unknownEvent(base, 'invalid-shape', type)] : [{ ...base, kind: 'title', source, title }]
    }
    default:
      return [unknownEvent(base, 'unknown-type', type)]
  }
}

/** One JSONL line → its events. A line that is not JSON gives one `unknown` event. */
export function parseTranscriptLine(line: string): TranscriptEvent[] {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return [unknownEvent({ sidechain: false }, 'unparsable', '')]
  }
  return parseTranscriptRecord(record)
}

/** Many lines → their events, in order. */
export function parseTranscriptLines(lines: readonly string[]): TranscriptEvent[] {
  return lines.flatMap(parseTranscriptLine)
}
