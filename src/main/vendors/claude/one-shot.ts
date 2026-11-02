// The oneShot part of the Claude driver: a single request to Claude Code that is not a Session. Its
// one caller today is the draft of a Project's profile (src/main/projects/connect.ts): Claude Code in
// the folder with read-only tools and a structured answer, with the options of the draft Session
// (draftSessionOptions, src/main/agent/options.ts) and the Harness plugin of this build, as a
// Session outside every Project.
//
// claudeOneShotQuery is that query as the draft starts it (src/main/ipc/projects.ts): the draft
// passes its own allowedTools, disallowedTools, outputFormat and canUseTool and reads Claude Code's
// messages through readOneShot. claudeOneShot is the same query behind the neutral OneShot of the
// driver: it sets those options from `readOnlyTools` and `outputSchema` the way the draft sets them,
// and reads the messages through the same readOneShot. The draft moves onto the neutral
// vendorDriver('claude').oneShot with worfy-multi-vendor ticket 23.
//
// The index of the driver imports this file while the Session registry loads (app-registry.ts): the
// SDK, the app and the options are loaded at the call.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS } from '../../../shared/agent/settings'
import type { CanUseToolHandler } from '../../agent/permissions'
import type { QueryHandle, QueryRequest } from '../../agent/session'
import type { OneShot } from '../one-shot'

/** A Claude Code query of a single request: a Session's request plus the request's tools and structured answer. */
export interface ClaudeOneShotRequest extends QueryRequest {
  /** The structured answer (SDK option `outputFormat`). */
  outputFormat: { type: 'json_schema'; schema: Record<string, unknown> }
  /** The tools Claude Code may use without asking. */
  allowedTools: readonly string[]
  /** The tools Claude Code runs without. */
  disallowedTools: readonly string[]
}

/**
 * Claude Code of a single request, through the Agent SDK: the options of the draft Session with the
 * Harness of this build, so the skills of the Harness (/worfy:connect-project) come with it, as in
 * every Session.
 */
export async function claudeOneShotQuery(request: ClaudeOneShotRequest): Promise<QueryHandle> {
  const [{ query }, { app }, { agentEnv }, { draftSessionOptions, sessionHarnessPlugin }, { currentHarness }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('electron'),
    import('../../agent/env'),
    import('../../agent/options'),
    import('../../harness/locate'),
  ])
  const options = draftSessionOptions({
    cwd: request.cwd,
    env: (await agentEnv()).env,
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    stderr: request.stderr,
    settings: request.settings,
    canUseTool: request.canUseTool,
    unattended: request.unattended,
    harnessPlugin: sessionHarnessPlugin(currentHarness().kind),
    outputFormat: request.outputFormat,
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
  })
  return query({ prompt: request.prompt, options }) as QueryHandle
}

/**
 * The tools a single request runs without (and its Subagents): no shell, nothing that writes,
 * nothing that reaches the network or starts other agents.
 */
export const ONE_SHOT_DISALLOWED_TOOLS: readonly string[] = Object.freeze([
  'Bash',
  'BashOutput',
  'KillShell',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
])

/** The tool Claude Code answers an `outputFormat` turn with. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'

/** canUseTool of a single request: the tools of `allowed` and the structured answer; anything else is refused with `denied`. */
export const readOnlyCanUseTool =
  (allowed: readonly string[], denied: string): CanUseToolHandler =>
  (toolName, input) =>
    Promise.resolve(allowed.includes(toolName) || toolName === STRUCTURED_OUTPUT_TOOL ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: denied })

/** An input that gives Claude Code one message and then ends. */
export function oneMessage(text: string): AsyncIterable<SDKUserMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve()
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A line of what Claude Code is doing, from one of its messages; null for a message that says nothing new. */
export function activityOf(message: unknown): string | null {
  if (!isRecord(message)) return null
  if (message.type === 'system' && message.subtype === 'init') return 'Claude Code started'
  if (message.type === 'result') return 'The draft is ready'
  if (message.type !== 'assistant' || !isRecord(message.message) || !Array.isArray(message.message.content)) return null
  const tools = message.message.content.filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'tool_use')
  const tool = tools.at(-1)
  if (tool === undefined) return null
  const input = isRecord(tool.input) ? tool.input : {}
  const detail = [input.file_path, input.path, input.command, input.pattern, input.skill].find((value): value is string => typeof value === 'string' && value !== '')
  const name = typeof tool.name === 'string' ? tool.name : 'tool'
  return detail === undefined ? name : `${name} ${detail.length > 120 ? `${detail.slice(0, 119)}…` : detail}`
}

const lastLine = (text: string): string => text.trim().split('\n').at(-1) ?? ''

/** How a single request ended: Claude Code's structured answer, a result without one, or no result at all. */
export type OneShotEnd =
  | { kind: 'answer'; text: string; structured: unknown }
  /** `detail`: the result's subtype and its errors, as "<subtype>: <error>; <error>". */
  | { kind: 'no-answer'; detail: string }
  | { kind: 'ended' }

/**
 * Reads Claude Code's messages of a single request up to its result, telling `onActivity` what it
 * does. The one reading of the SDK's result: claudeOneShot and the profile draft
 * (src/main/projects/connect.ts) both read through it, each with its own texts. Does not close
 * `query`.
 */
export async function readOneShot(query: AsyncIterable<unknown>, onActivity?: (text: string) => void): Promise<OneShotEnd> {
  for await (const message of query) {
    const activity = activityOf(message)
    if (activity !== null) onActivity?.(activity)
    if (!isRecord(message) || message.type !== 'result') continue
    if (message.subtype !== 'success' || message.structured_output === undefined) {
      const errors = Array.isArray(message.errors) ? message.errors.map(String).join('; ') : ''
      return { kind: 'no-answer', detail: `${String(message.subtype)}${errors ? `: ${errors}` : ''}` }
    }
    return { kind: 'answer', text: typeof message.result === 'string' ? message.result : '', structured: message.structured_output }
  }
  return { kind: 'ended' }
}

/**
 * One request through claudeOneShotQuery: the tools of `readOnlyTools` and nothing that writes
 * (ONE_SHOT_DISALLOWED_TOOLS), the answer in the shape of `outputSchema`. Rejects when Claude Code
 * ends without an answer, answers with an error, or `signal` stops it.
 */
export const claudeOneShot: OneShot = async (prompt, opts) => {
  // shortcut: a request without outputSchema is refused, as the draft (structured) is its only
  // caller and draftSessionOptions needs a structured answer; redo when a text request (Terminal AI)
  // moves onto oneShot.
  if (opts.outputSchema === undefined) throw new Error('oneShot of the Claude driver answers only in the shape of an outputSchema')
  if (opts.signal?.aborted === true) throw new Error('the request was stopped')
  const allowed = opts.readOnlyTools ?? []
  const stderr: string[] = []
  const query = await claudeOneShotQuery({
    prompt: oneMessage(prompt),
    cwd: opts.cwd,
    resume: undefined,
    stderr: (data) => stderr.push(data),
    settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
    canUseTool: readOnlyCanUseTool(allowed, `This request only reads files${allowed.length > 0 ? ` with ${allowed.join(', ')}` : ''}.`),
    unattended: false,
    outputFormat: { type: 'json_schema', schema: { ...opts.outputSchema } },
    allowedTools: allowed,
    disallowedTools: ONE_SHOT_DISALLOWED_TOOLS,
  })
  let stopped = false
  const stop = (): void => {
    stopped = true
    query.close()
  }
  opts.signal?.addEventListener('abort', stop, { once: true })
  let end: OneShotEnd
  try {
    end = await readOneShot(query, opts.onActivity)
  } finally {
    opts.signal?.removeEventListener('abort', stop)
    query.close()
  }
  if (stopped) throw new Error('the request was stopped')
  if (end.kind === 'ended') throw new Error(`Claude Code ended before the answer${stderr.length > 0 ? `: ${lastLine(stderr.join(''))}` : ''}`)
  if (end.kind === 'no-answer') throw new Error(`Claude Code gave no answer (${end.detail})`)
  return { text: end.text, structured: end.structured }
}
