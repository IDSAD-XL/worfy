// The Claude driver's translation of Agent SDK messages into worfy's events (src/shared/agent/events.ts;
// ADR-0094 item 1, worfy-multi-vendor ticket 14).
//
// The renderer never sees an SDK message: the Claude driver (src/main/vendors/claude/session.ts) turns
// each one into zero or more AgentEvents (sdkMessageToEvents). The mapping reads SDK messages through
// lenient zod schemas of the fields it needs and copies only those fields, so a new SDK field never
// leaks to the renderer and a changed or unknown message becomes an `unknown` event instead of an
// exception. Field names of the SDK messages are those recorded in ticket 06 (SDK 0.3.289,
// test/fixtures/sdk-messages/).
//
// A pure module without the SDK's import, in shared: the reader of Claude's transcript files
// (src/shared/transcript/parse.ts) uses its helpers too.
import { z } from 'zod'
import type { AgentEvent, ContextUsage } from '../../agent/events'
import { mcpSourceOf, type McpServerRow } from '../../agent/mcp-status'
import { limitStateOf, limitUpdatesFromSdk, limitWindows } from '../../agent/limits'

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
const sdkTaskStarted = z.object({
  task_id: str,
  tool_use_id: optStr,
  description: optStr,
  subagent_type: optStr,
  is_backgrounded: z.boolean().nullish(),
  task_type: optStr,
  ambient: z.boolean().nullish(),
})
const sdkTaskNotification = z.object({ task_id: str, tool_use_id: optStr, status: str, summary: optStr, reason: optStr, ambient: z.boolean().nullish() })
const sdkBackgroundTasks = z.object({
  tasks: z.array(z.object({ task_id: str, task_type: optStr, description: optStr, ambient: z.boolean().nullish() })),
})
const sdkTaskProgress = z.object({ task_id: str })
const sdkTaskUpdated = z.object({ task_id: str, patch: z.object({ is_backgrounded: z.boolean().nullish() }).loose().nullish() })

// The shape a rate_limit_event must have, or it becomes `unknown`; its windows are then read
// leniently by limitUpdatesFromSdk, the reader the Limits store uses.
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

/** Reads a known message; throws when its shape changed, and the caller turns that into `unknown`. */
function read<T>(schema: z.ZodType<T>, message: unknown): T {
  const parsed = schema.safeParse(message)
  if (!parsed.success) throw new Error(`unexpected shape of ${describe(message)}`)
  return parsed.data
}

const orNull = <T>(value: T | null | undefined): T | null => value ?? null

/** The Vendor every SDK message here comes from. */
const CLAUDE = 'claude'


/**
 * A hook is shown only when it said something: a non-zero exit, an outcome other than success, or
 * output. The same rule holds for hooks read from a transcript file (src/shared/transcript/parse.ts).
 */
export function hookSaidSomething(hook: { exitCode: number | null; outcome: string; stdout: string; stderr: string }): boolean {
  return (hook.exitCode !== null && hook.exitCode !== 0) || hook.outcome !== 'success' || hook.stdout.trim() !== '' || hook.stderr.trim() !== ''
}

/** Concatenated text of a tool_result's content; a block that is not text shows as `[type]`. */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      const text = textBlock.safeParse(block)
      if (text.success) return text.data.text
      const type = typeof block === 'object' && block !== null && typeof (block as { type?: unknown }).type === 'string' ? (block as { type: string }).type : 'unknown'
      return `[${type}]`
    })
    .join('\n')
}

// Messages whose content worfy does not show: they produce no event (and are not `unknown`).
// session_state_changed comes only with an env flag worfy does not set; its `idle` arrives while
// background tasks still run, so worfy does not use it (ADR-0029).
const QUIET_SYSTEM = new Set(['hook_started', 'hook_progress', 'thinking_tokens', 'session_state_changed'])

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
      if (!hookSaidSomething({ exitCode, outcome: m.outcome, stdout: m.stdout, stderr: m.stderr })) return []
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
          isBackgrounded: orNull(m.is_backgrounded),
          taskType: orNull(m.task_type),
          ambient: orNull(m.ambient),
          reason: null,
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
          isBackgrounded: null,
          taskType: null,
          ambient: orNull(m.ambient),
          reason: orNull(m.reason),
        },
      ]
    }
    case 'background_tasks_changed':
      return [
        {
          type: 'background_tasks_changed',
          tasks: read(sdkBackgroundTasks, message).tasks.map((task) => ({
            taskId: task.task_id,
            taskType: orNull(task.task_type),
            description: orNull(task.description),
            ambient: task.ambient === true,
          })),
        },
      ]
    case 'task_progress':
      return [{ type: 'task_activity', taskId: read(sdkTaskProgress, message).task_id, backgrounded: false }]
    case 'task_updated': {
      const m = read(sdkTaskUpdated, message)
      return [{ type: 'task_activity', taskId: m.task_id, backgrounded: m.patch?.is_backgrounded === true }]
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

/** Output of a local command (`!ls`, `/cost`) as Claude Code records it in a user message. */
export const LOCAL_COMMAND = /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/

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
        return { type: 'tool_result', toolUseId: result.tool_use_id, content: toolResultText(result.content), isError: result.is_error === true, parentToolUseId }
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

/**
 * A rate_limit_event: `limits` with the windows it reports, read as the Limits store reads them
 * (limitUpdatesFromSdk), and with its status, rateLimitType and resetsAt exactly as sent, the three
 * fields the `rate_limit` event before it carried (a status may come without rateLimitType). For a
 * refusal, then `limit_reached` for the same window and reset time. Claude's windows all reset, so
 * its refusal is always `window`; without a reset time, Autopilot waits by the one the Limits store
 * keeps (resumeAt).
 */
function mapRateLimit(message: unknown, receivedAt: number): AgentEvent[] {
  const info = read(sdkRateLimit, message).rate_limit_info
  const reported = limitUpdatesFromSdk(message, receivedAt).map(({ window, state }) => [window, state] as const)
  const windows = limitWindows(CLAUDE, { windows: Object.fromEntries(reported) })
  const status = { text: info.status, state: limitStateOf(info.status), windowId: orNull(info.rateLimitType), resetsAt: orNull(info.resetsAt) }
  const events: AgentEvent[] = [{ type: 'limits', vendor: CLAUDE, windows, status }]
  if (status.state !== 'reached') return events
  return [...events, { type: 'limit_reached', vendor: CLAUDE, windowId: status.windowId, resetsAt: status.resetsAt, reason: 'window' }]
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
 * whose shape changed, becomes a single `unknown` event. `receivedAt` (ms since the epoch, now when
 * omitted) stamps the Limits windows of a rate_limit_event.
 */
export function sdkMessageToEvents(message: unknown, receivedAt?: number): AgentEvent[] {
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
        return mapRateLimit(message, receivedAt ?? Date.now())
      default:
        return [{ type: 'unknown', sdkType: describe(message) }]
    }
  } catch {
    // A known message whose shape changed: shown like an unknown one, never thrown.
    return [{ type: 'unknown', sdkType: describe(message) }]
  }
}

// ---------------------------------------------------------------------------------------------
// Answers of Query.getContextUsage() and the compaction message (worfy-polish ticket 23).

const sdkContextUsage = z.object({
  totalTokens: z.number(),
  rawMaxTokens: z.number(),
  percentage: z.number(),
  autoCompactThreshold: optNum,
  isAutoCompactEnabled: z.boolean(),
})

/**
 * The context usage in a getContextUsage() answer (SDKControlGetContextUsageResponse); null when
 * the answer lacks the numbers. The window is `rawMaxTokens`, the one `percentage` is measured
 * against (the autocompact window), not `maxTokens`.
 */
export function contextUsageOf(answer: unknown): ContextUsage | null {
  const parsed = sdkContextUsage.safeParse(answer)
  if (!parsed.success) return null
  const m = parsed.data
  return {
    percentage: m.percentage,
    totalTokens: m.totalTokens,
    windowTokens: m.rawMaxTokens,
    autoCompactThreshold: orNull(m.autoCompactThreshold),
    autoCompactEnabled: m.isAutoCompactEnabled,
  }
}

/** Whether an SDK message is system/compact_boundary: Claude Code has just compacted the Session's history. */
export function isCompactBoundary(message: unknown): boolean {
  if (message === null || typeof message !== 'object') return false
  const { type, subtype } = message as { type?: unknown; subtype?: unknown }
  return type === 'system' && subtype === 'compact_boundary'
}

// ---------------------------------------------------------------------------------------------
// The MCP servers of a Session (worfy-mcp-live ticket 02): Query.mcpServerStatus() and the
// `mcp_servers` of system/init, as the rows of src/shared/agent/mcp-status.ts. Only the fields a row
// shows are read: the server's `config` (its URL and headers), `scope` and `serverInfo` go nowhere.

/** The statuses of the SDK's McpServerStatus type. */
const SDK_MCP_STATUSES = ['connected', 'failed', 'needs-auth', 'pending', 'disabled'] as const
type SdkMcpStatus = (typeof SDK_MCP_STATUSES)[number]
const isSdkMcpStatus = (status: string): status is SdkMcpStatus => (SDK_MCP_STATUSES as readonly string[]).includes(status)

const sdkMcpServer = z.object({
  name: z.string().min(1),
  // Any word: Claude Code's mcp_status passes its own connection states through, not only the SDK type's five.
  status: z.string().min(1),
  error: optStr,
  source: optStr,
  tools: z.array(z.unknown()).nullish(),
})

/**
 * The row of a server of Claude Code. Reconnect is offered to a failed server only; Turn off and
 * Turn on are not offered: Claude Code's toggleMcpServer writes the user's .claude.json, so they come
 * as a Restart of the Session (ticket 03), and worfy never calls it. A status outside the SDK's type
 * (Claude Code's own `blocked`, say) is a row all the same — disabled, with Claude Code's word in its
 * error — so that the server does not vanish from the list.
 */
function mcpRow(server: z.infer<typeof sdkMcpServer>): McpServerRow {
  const known = isSdkMcpStatus(server.status) ? server.status : null
  return {
    name: server.name,
    status: known ?? 'disabled',
    tools: server.tools === null || server.tools === undefined ? null : server.tools.length,
    error: known === null ? `Claude Code reports this server as “${server.status}”.` : orNull(server.error),
    ...mcpSourceOf(server.source),
    actions: server.status === 'failed' ? ['reconnect'] : [],
  }
}

/**
 * The rows of an mcpServerStatus() answer (McpServerStatus[] of the SDK); null when the answer is no
 * list. An entry worfy cannot read — no name, no status — is left out.
 */
export function mcpServerRowsOf(answer: unknown): McpServerRow[] | null {
  if (!Array.isArray(answer)) return null
  return answer.flatMap((entry) => {
    const server = sdkMcpServer.safeParse(entry)
    return server.success ? [mcpRow(server.data)] : []
  })
}

/**
 * The servers a system/init names (`mcp_servers`: name, status, source; no tools), as rows; null
 * for any other message, or an init without the list.
 */
export function initMcpServers(message: unknown): McpServerRow[] | null {
  if (message === null || typeof message !== 'object') return null
  const { type, subtype, mcp_servers: servers } = message as { type?: unknown; subtype?: unknown; mcp_servers?: unknown }
  if (type !== 'system' || subtype !== 'init') return null
  return mcpServerRowsOf(servers)
}
