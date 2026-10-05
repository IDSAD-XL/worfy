// worfy's own events of a Session, and the mapping from Agent SDK messages to them.
//
// The renderer never sees an SDK message: main turns each one into zero or more of these events
// (sdkMessageToEvents) and sends them on `agent.event`. The mapping reads SDK messages through
// lenient zod schemas of the fields it needs and copies only those fields, so a new SDK field
// never leaks to the renderer and a changed or unknown message becomes an `unknown` event
// instead of an exception. Field names of the SDK messages are those recorded in ticket 06
// (SDK 0.3.289, test/fixtures/sdk-messages/).
import { z } from 'zod'

/** Lifecycle of a Session as the renderer shows it. */
export const sessionState = z.enum(['starting', 'busy', 'idle', 'needs_permission', 'error', 'closed'])
export type SessionState = z.infer<typeof sessionState>

const nullableString = z.string().nullable()

export const agentEvent = z.discriminatedUnion('type', [
  /** system/init: arrives at the start of every turn with the current model and mode. */
  z.object({
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
  z.object({ type: z.literal('renamed'), from: z.string() }),
  /** Login of Claude Code, from accountInfo() (ADR-0009). */
  z.object({
    type: z.literal('account'),
    loggedIn: z.boolean(),
    subscriptionType: nullableString,
    apiProvider: nullableString,
    tokenSource: nullableString,
  }),
  /** A whole text block of an assistant message. `synthetic`: written by Claude Code, not the model. */
  z.object({ type: z.literal('text'), text: z.string(), messageId: z.string(), parentToolUseId: nullableString, synthetic: z.boolean() }),
  z.object({ type: z.literal('thinking'), text: z.string(), messageId: z.string(), parentToolUseId: nullableString }),
  /** A piece of text or thinking while the block is still being written (partial messages). */
  z.object({ type: z.literal('delta'), kind: z.enum(['text', 'thinking']), text: z.string(), parentToolUseId: nullableString }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown(), parentToolUseId: nullableString }),
  z.object({ type: z.literal('tool_result'), toolUseId: z.string(), content: z.string(), isError: z.boolean(), parentToolUseId: nullableString }),
  /** A hook that said something: a non-zero exit, a failed outcome, or output (e.g. a Stop hook blocking the turn). */
  z.object({
    type: z.literal('hook'),
    hookEvent: z.string(),
    hookName: z.string(),
    exitCode: z.number().nullable(),
    outcome: z.string(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  /** Text in the transcript that neither the user typed nor the model wrote. */
  z.object({ type: z.literal('notice'), kind: z.enum(['synthetic', 'user', 'local_command', 'notification']), text: z.string() }),
  /** A subagent (Agent tool) started, or its task-notification arrived. */
  z.object({
    type: z.literal('subagent'),
    phase: z.enum(['started', 'finished']),
    taskId: z.string(),
    toolUseId: nullableString,
    description: nullableString,
    subagentType: nullableString,
    status: nullableString,
    summary: nullableString,
  }),
  z.object({
    type: z.literal('rate_limit'),
    status: z.string(),
    rateLimitType: nullableString,
    resetsAt: z.number().nullable(),
    fiveHourUtilization: z.number().nullable(),
    sevenDayUtilization: z.number().nullable(),
  }),
  /** system/status: `requesting`, `compacting` or null, and the permission mode after a change. */
  z.object({ type: z.literal('status'), status: nullableString, permissionMode: nullableString }),
  /** system/commands_changed: the slash commands now available. */
  z.object({ type: z.literal('commands'), slashCommands: z.array(z.string()) }),
  /** The end of a turn, after every Stop hook continuation. */
  z.object({
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
  z.object({ type: z.literal('state'), state: sessionState, error: nullableString }),
  /** An SDK message worfy does not know (or whose shape changed): visible for debugging only. */
  z.object({ type: z.literal('unknown'), sdkType: z.string() }),
])
export type AgentEvent = z.infer<typeof agentEvent>

/** What travels on `agent.event`: one event of one Session. */
export const agentEventEnvelope = z.object({ sessionId: z.string(), event: agentEvent })
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelope>

// ---------------------------------------------------------------------------------------------
// SDK messages, read leniently: only the fields worfy uses; everything else is ignored.

const str = z.string()
const optStr = z.string().nullish()
const optNum = z.number().nullish()

const sdkInit = z.object({
  session_id: str,
  model: str,
  permissionMode: str,
  apiKeySource: str,
  cwd: str,
  claude_code_version: optStr,
  slash_commands: z.array(str),
})

const contentBlock = z.object({ type: str }).loose()
const sdkAssistant = z.object({
  message: z.object({ id: str, model: optStr, content: z.array(contentBlock) }),
  parent_tool_use_id: optStr,
})
const textBlock = z.object({ type: z.literal('text'), text: str })
const thinkingBlock = z.object({ type: z.literal('thinking'), thinking: str })
const toolUseBlock = z.object({ type: z.literal('tool_use'), id: str, name: str, input: z.unknown() })
const toolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: str,
  content: z.union([str, z.array(contentBlock)]).nullish(),
  is_error: z.boolean().nullish(),
})

const sdkUser = z.object({
  message: z.object({ content: z.union([str, z.array(contentBlock)]) }),
  parent_tool_use_id: optStr,
  isSynthetic: z.boolean().nullish(),
})

const sdkHookResponse = z.object({
  hook_name: str,
  hook_event: str,
  stdout: str.catch(''),
  stderr: str.catch(''),
  exit_code: optNum,
  outcome: str,
})

const sdkStatus = z.object({ status: optStr, permissionMode: optStr })
const sdkNotification = z.object({ text: str })
// Entries that are not command objects are skipped (the fixtures shorten the list with a "<N more>" string).
const commandName = z.object({ name: str })
const sdkCommandsChanged = z.object({ commands: z.array(z.unknown()) })
const sdkTaskStarted = z.object({ task_id: str, tool_use_id: optStr, description: optStr, subagent_type: optStr })
const sdkTaskNotification = z.object({ task_id: str, tool_use_id: optStr, status: str, summary: optStr })

const window = z.object({ utilization: optNum }).nullish()
const sdkRateLimit = z.object({
  rate_limit_info: z.object({
    status: str,
    rateLimitType: optStr,
    resetsAt: optNum,
    unifiedWindows: z.object({ five_hour: window, seven_day: window }).nullish(),
  }),
})

const tokens = z.number().catch(0)
const sdkResult = z.object({
  subtype: str,
  is_error: z.boolean(),
  result: optStr,
  errors: z.array(str).nullish(),
  total_cost_usd: z.number().catch(0),
  duration_ms: z.number().catch(0),
  num_turns: z.number().catch(0),
  usage: z
    .object({ input_tokens: tokens, output_tokens: tokens, cache_creation_input_tokens: tokens, cache_read_input_tokens: tokens })
    .catch({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  terminal_reason: optStr,
})

const streamDelta = z.object({
  event: z.object({
    type: z.literal('content_block_delta'),
    delta: z.discriminatedUnion('type', [
      z.object({ type: z.literal('text_delta'), text: str }),
      z.object({ type: z.literal('thinking_delta'), thinking: str }),
    ]),
  }),
  parent_tool_use_id: optStr,
})

/** Thrown inside the mapper when a known message no longer has the shape worfy reads. */
class ShapeChanged extends Error {}

function read<T>(schema: z.ZodType<T>, message: unknown): T {
  const parsed = schema.safeParse(message)
  if (!parsed.success) throw new ShapeChanged()
  return parsed.data
}

const orNull = <T>(value: T | null | undefined): T | null => value ?? null

/** Concatenated text of a tool_result's content, whatever form the SDK sent it in. */
function flattenContent(content: string | readonly { type: string }[] | null | undefined): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      const text = textBlock.safeParse(block)
      return text.success ? text.data.text : `[${block.type}]`
    })
    .join('\n')
}

// Messages whose content worfy does not show: they produce no event (and are not `unknown`).
const QUIET_SYSTEM = new Set(['hook_started', 'hook_progress', 'thinking_tokens', 'task_progress', 'task_updated'])

function mapSystem(subtype: string, message: unknown): AgentEvent[] {
  if (QUIET_SYSTEM.has(subtype)) return []
  switch (subtype) {
    case 'init': {
      const m = read(sdkInit, message)
      return [
        {
          type: 'init',
          sdkSessionId: m.session_id,
          model: m.model,
          permissionMode: m.permissionMode,
          apiKeySource: m.apiKeySource,
          cwd: m.cwd,
          claudeCodeVersion: orNull(m.claude_code_version),
          slashCommands: m.slash_commands,
        },
      ]
    }
    case 'hook_response': {
      const m = read(sdkHookResponse, message)
      const exitCode = orNull(m.exit_code)
      const said = (exitCode !== null && exitCode !== 0) || m.outcome !== 'success' || m.stdout.trim() !== '' || m.stderr.trim() !== ''
      if (!said) return []
      return [{ type: 'hook', hookEvent: m.hook_event, hookName: m.hook_name, exitCode, outcome: m.outcome, stdout: m.stdout, stderr: m.stderr }]
    }
    case 'status': {
      const m = read(sdkStatus, message)
      return [{ type: 'status', status: orNull(m.status), permissionMode: orNull(m.permissionMode) }]
    }
    case 'notification':
      return [{ type: 'notice', kind: 'notification', text: read(sdkNotification, message).text }]
    case 'commands_changed':
      return [
        {
          type: 'commands',
          slashCommands: read(sdkCommandsChanged, message).commands.flatMap((entry) => {
            const command = commandName.safeParse(entry)
            return command.success ? [command.data.name] : []
          }),
        },
      ]
    case 'task_started': {
      const m = read(sdkTaskStarted, message)
      return [
        {
          type: 'subagent',
          phase: 'started',
          taskId: m.task_id,
          toolUseId: orNull(m.tool_use_id),
          description: orNull(m.description),
          subagentType: orNull(m.subagent_type),
          status: null,
          summary: null,
        },
      ]
    }
    case 'task_notification': {
      const m = read(sdkTaskNotification, message)
      return [
        {
          type: 'subagent',
          phase: 'finished',
          taskId: m.task_id,
          toolUseId: orNull(m.tool_use_id),
          description: null,
          subagentType: null,
          status: m.status,
          summary: orNull(m.summary),
        },
      ]
    }
    default:
      return [{ type: 'unknown', sdkType: `system/${subtype}` }]
  }
}

function mapAssistant(message: unknown): AgentEvent[] {
  const m = read(sdkAssistant, message)
  const parentToolUseId = orNull(m.parent_tool_use_id)
  const messageId = m.message.id
  const synthetic = m.message.model === '<synthetic>'
  return m.message.content.map((block): AgentEvent => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: read(textBlock, block).text, messageId, parentToolUseId, synthetic }
      case 'thinking':
        return { type: 'thinking', text: read(thinkingBlock, block).thinking, messageId, parentToolUseId }
      case 'tool_use': {
        const use = read(toolUseBlock, block)
        return { type: 'tool_use', id: use.id, name: use.name, input: use.input, parentToolUseId }
      }
      default:
        return { type: 'unknown', sdkType: `assistant/${block.type}` }
    }
  })
}

const LOCAL_COMMAND = /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/

function mapUser(message: unknown): AgentEvent[] {
  const m = read(sdkUser, message)
  const parentToolUseId = orNull(m.parent_tool_use_id)
  const kind = m.isSynthetic === true ? 'synthetic' : 'user'
  const { content } = m.message
  if (typeof content === 'string') {
    const local = LOCAL_COMMAND.exec(content)
    return [local ? { type: 'notice', kind: 'local_command', text: local[2] ?? '' } : { type: 'notice', kind, text: content }]
  }
  return content.map((block): AgentEvent => {
    switch (block.type) {
      case 'tool_result': {
        const result = read(toolResultBlock, block)
        return { type: 'tool_result', toolUseId: result.tool_use_id, content: flattenContent(result.content), isError: result.is_error === true, parentToolUseId }
      }
      case 'text':
        return { type: 'notice', kind, text: read(textBlock, block).text }
      default:
        return { type: 'unknown', sdkType: `user/${block.type}` }
    }
  })
}

function mapResult(message: unknown): AgentEvent[] {
  const m = read(sdkResult, message)
  const errorText = m.errors && m.errors.length > 0 ? m.errors.join('\n') : (m.result ?? m.subtype)
  return [
    {
      type: 'result',
      subtype: m.subtype,
      isError: m.is_error,
      error: m.is_error ? errorText : null,
      text: m.is_error ? null : orNull(m.result),
      costUsd: m.total_cost_usd,
      durationMs: m.duration_ms,
      numTurns: m.num_turns,
      usage: {
        inputTokens: m.usage.input_tokens,
        outputTokens: m.usage.output_tokens,
        cacheCreationInputTokens: m.usage.cache_creation_input_tokens,
        cacheReadInputTokens: m.usage.cache_read_input_tokens,
      },
      terminalReason: orNull(m.terminal_reason),
      // An interrupted turn ends with one of these reasons (ticket 06: aborted_streaming after
      // interrupt() on the first delta; aborted_tools when a tool was running).
      interrupted: m.terminal_reason === 'aborted_streaming' || m.terminal_reason === 'aborted_tools',
    },
  ]
}

function mapStream(message: unknown): AgentEvent[] {
  const parsed = streamDelta.safeParse(message)
  // Only text and thinking deltas carry something to show; message_start, content_block_start,
  // content_block_stop, message_delta and message_stop are bookkeeping of the stream.
  if (!parsed.success) return []
  const { delta } = parsed.data.event
  const parentToolUseId = orNull(parsed.data.parent_tool_use_id)
  return delta.type === 'text_delta'
    ? [{ type: 'delta', kind: 'text', text: delta.text, parentToolUseId }]
    : [{ type: 'delta', kind: 'thinking', text: delta.thinking, parentToolUseId }]
}

function mapRateLimit(message: unknown): AgentEvent[] {
  const info = read(sdkRateLimit, message).rate_limit_info
  return [
    {
      type: 'rate_limit',
      status: info.status,
      rateLimitType: orNull(info.rateLimitType),
      resetsAt: orNull(info.resetsAt),
      fiveHourUtilization: orNull(info.unifiedWindows?.five_hour?.utilization),
      sevenDayUtilization: orNull(info.unifiedWindows?.seven_day?.utilization),
    },
  ]
}

/** `type` or `type/subtype` of an SDK message, for `unknown` events. */
function describe(message: unknown): string {
  if (message === null) return 'null'
  if (typeof message !== 'object') return typeof message
  const { type, subtype } = message as { type?: unknown; subtype?: unknown }
  const base = typeof type === 'string' ? type : 'untyped'
  return typeof subtype === 'string' ? `${base}/${subtype}` : base
}

/**
 * Turns one SDK message into worfy's events. Never throws: an unknown message, or a known one
 * whose shape changed, becomes a single `unknown` event.
 */
export function sdkMessageToEvents(message: unknown): AgentEvent[] {
  try {
    if (message === null || typeof message !== 'object') return [{ type: 'unknown', sdkType: describe(message) }]
    const { type, subtype } = message as { type?: unknown; subtype?: unknown }
    switch (type) {
      case 'system':
        return typeof subtype === 'string' ? mapSystem(subtype, message) : [{ type: 'unknown', sdkType: 'system' }]
      case 'assistant':
        return mapAssistant(message)
      case 'user':
        return mapUser(message)
      case 'result':
        return mapResult(message)
      case 'stream_event':
        return mapStream(message)
      case 'rate_limit_event':
        return mapRateLimit(message)
      default:
        return [{ type: 'unknown', sdkType: describe(message) }]
    }
  } catch (error) {
    if (error instanceof ShapeChanged) return [{ type: 'unknown', sdkType: describe(message) }]
    return [{ type: 'unknown', sdkType: describe(message) }]
  }
}
