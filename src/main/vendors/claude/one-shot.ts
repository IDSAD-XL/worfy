// The oneShot part of the Claude driver: a single request to Claude Code that is not a Session, through
// the neutral vendorDriver(<vendor>).oneShot (worfy-multi-vendor ticket 23). Its callers today are the
// draft of a Project's profile (src/main/projects/connect.ts) and the Code story
// (src/main/stories/one-shot.ts). Both run in worfy's own folder outside every Project and read their
// folder as an extra one (`readFolders`), with read-only tools and a structured answer, with the options
// of the draft Session (draftSessionOptions, options.ts). The Harness plugin of this build comes only
// with a request that asks for it (`harness`: the draft, which runs /worfy:connect-project).
//
// A request with readFolders reads only inside them, its cwd and the plugin's folder when it has the
// plugin (read-guard.ts): its canUseTool checks the path of each Read, Glob and Grep, and those three
// stay out of `allowedTools`, so every call reaches it. Such a request is also offered only its own tools
// and the structured answer (SDK option `tools`), and reads the plugin's folder as an extra one. A request
// without readFolders allows its tools by name.
//
// claudeOneShotQuery is that query, with allowedTools, disallowedTools, outputFormat and canUseTool
// set; claudeOneShotOver sets them from `readOnlyTools` and `outputSchema` and reads Claude Code's
// messages through readOneShot, over a query of its caller's (the fake agent's in the e2e runs of the
// draft, src/main/ipc/projects.ts); claudeOneShot is it over claudeOneShotQuery.
//
// The index of the driver imports this file while the Session registry loads (app-registry.ts): the
// SDK, the app and the options are loaded at the call.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS } from '../../../shared/agent/settings'
import type { CanUseToolHandler } from '../../agent/permissions'
import type { QueryHandle, QueryRequest } from '../../agent/session'
import { noteOneTurnResult } from '../../agent/turn-cost'
import type { OneShot } from '../one-shot'
import { GUARDED_TOOLS, readScope, type ReadScope } from './read-guard'

/** A Claude Code query of a single request: a Session's request plus the request's tools and structured answer. */
export interface ClaudeOneShotRequest extends QueryRequest {
  /** The structured answer (SDK option `outputFormat`). */
  outputFormat: { type: 'json_schema'; schema: Record<string, unknown> }
  /** The tools Claude Code may use without asking. */
  allowedTools: readonly string[]
  /** The tools Claude Code runs without. */
  disallowedTools: readonly string[]
  /** Folders the tools may read besides the cwd (SDK option `additionalDirectories`); none when absent. */
  additionalDirectories?: readonly string[] | undefined
  /** False: Claude Code keeps no transcript of the request (SDK option `persistSession`); absent: it does. */
  persistSession?: false | undefined
  /**
   * The folder of the Harness plugin the request loads (sessionHarnessPlugin); absent or null: none, and
   * the copy the user installed (`worfy@worfy-harness`) is turned off for the request too.
   */
  harnessPlugin?: string | null | undefined
  /** The only built-in tools Claude Code offers the model (SDK option `tools`); absent: its default set. */
  tools?: readonly string[] | undefined
}

/**
 * Claude Code of a single request, through the Agent SDK: the options of the draft Session, with the
 * Harness plugin `request.harnessPlugin` when it names one, so the skills of the Harness
 * (/worfy:connect-project) come with it, as in every Session. Without it, the plugin the user installed
 * is turned off too: the request reads the user's settings (`settingSources: ['user']`), which enable
 * it, and flag settings (`settings`, the `--settings` flag) rank above them.
 */
export async function claudeOneShotQuery(request: ClaudeOneShotRequest): Promise<QueryHandle> {
  const [{ query }, { app }, { agentEnv }, { draftSessionOptions }, { HARNESS_PLUGIN_ID }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('electron'),
    import('../../agent/env'),
    import('./options'),
    import('../../harness/install'),
  ])
  const options = draftSessionOptions({
    cwd: request.cwd,
    env: (await agentEnv()).env,
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    stderr: request.stderr,
    settings: request.settings,
    canUseTool: request.canUseTool,
    unattended: request.unattended,
    harnessPlugin: request.harnessPlugin ?? null,
    outputFormat: request.outputFormat,
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
    additionalDirectories: request.additionalDirectories,
    persistSession: request.persistSession,
  })
  if (request.tools !== undefined) options.tools = [...request.tools]
  if (request.harnessPlugin == null) {
    const flag = options.settings !== undefined && typeof options.settings !== 'string' ? options.settings : {}
    options.settings = { ...flag, enabledPlugins: { ...flag.enabledPlugins, [HARNESS_PLUGIN_ID]: false } }
  }
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

/**
 * canUseTool of a single request: the tools of `allowed` and the structured answer; anything else is
 * refused with `denied`. With `scope`, a tool of `allowed` whose path leads outside the scope's folders
 * is refused too, with the scope's reason.
 */
export const readOnlyCanUseTool =
  (allowed: readonly string[], denied: string, scope?: ReadScope): CanUseToolHandler =>
  (toolName, input) => {
    if (toolName === STRUCTURED_OUTPUT_TOOL) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    if (!allowed.includes(toolName)) return Promise.resolve({ behavior: 'deny', message: denied })
    const outside = scope?.check(toolName, input) ?? null
    return Promise.resolve(outside === null ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: outside })
  }

/** The folder of this build's Harness plugin for a Session outside every Project; null with the old Harness. */
async function harnessPluginFolder(): Promise<string | null> {
  const [{ sessionHarnessPlugin }, { currentHarness }] = await Promise.all([import('./options'), import('../../harness/locate')])
  return sessionHarnessPlugin(currentHarness().kind)
}

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
 * (src/main/projects/connect.ts) both read through it, each with its own texts. The result's cost, answer or not, goes
 * to the cost of the turns that are not the Assistant's (turn-cost.ts): a single request is one process of one turn.
 * Does not close `query`.
 */
export async function readOneShot(query: AsyncIterable<unknown>, onActivity?: (text: string) => void): Promise<OneShotEnd> {
  for await (const message of query) {
    const activity = activityOf(message)
    if (activity !== null) onActivity?.(activity)
    if (!isRecord(message) || message.type !== 'result') continue
    noteOneTurnResult(message)
    if (message.subtype !== 'success' || message.structured_output === undefined) {
      const errors = Array.isArray(message.errors) ? message.errors.map(String).join('; ') : ''
      return { kind: 'no-answer', detail: `${String(message.subtype)}${errors ? `: ${errors}` : ''}` }
    }
    return { kind: 'answer', text: typeof message.result === 'string' ? message.result : '', structured: message.structured_output }
  }
  return { kind: 'ended' }
}

/** Whether `signal` has stopped the request; a call, so the second look is not narrowed away by the first. */
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true

/** Starts the Claude Code of a single request: claudeOneShotQuery, or the fake agent in tests. */
export type ClaudeOneShotQuery = (request: ClaudeOneShotRequest) => Promise<QueryHandle>

/**
 * One request through `start`: the tools of `readOnlyTools` and nothing that writes
 * (ONE_SHOT_DISALLOWED_TOOLS), the answer in the shape of `outputSchema`, the Harness plugin
 * (`harnessFolder`) only when `harness` asks for it. With `readFolders`, Read, Glob and Grep read only
 * inside them, the cwd and the plugin's folder (read-guard.ts). Rejects when Claude Code ends without an
 * answer, answers with an error, or `signal` stops it; Claude Code is closed in every case.
 */
export const claudeOneShotOver = (start: ClaudeOneShotQuery, harnessFolder: () => Promise<string | null> = harnessPluginFolder): OneShot => async (prompt, opts) => {
  // shortcut: a request without outputSchema is refused, as the draft (structured) is its only
  // caller and draftSessionOptions needs a structured answer; redo when a text request (Terminal AI)
  // moves onto oneShot.
  if (opts.outputSchema === undefined) throw new Error('oneShot of the Claude driver answers only in the shape of an outputSchema')
  if (isAborted(opts.signal)) throw new Error('the request was stopped')
  const allowed = opts.readOnlyTools ?? []
  const harnessPlugin = opts.harness === true ? await harnessFolder() : null
  const folders = opts.readFolders ?? []
  // The folders besides the cwd a request with readFolders reads: they and the plugin's folder.
  const readable = harnessPlugin === null ? folders : [...folders, harnessPlugin]
  const scope = folders.length > 0 ? readScope(opts.cwd, readable) : undefined
  const stderr: string[] = []
  const query = await start({
    prompt: oneMessage(prompt),
    cwd: opts.cwd,
    resume: undefined,
    stderr: (data) => stderr.push(data),
    settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
    canUseTool: readOnlyCanUseTool(allowed, `This request only reads files${allowed.length > 0 ? ` with ${allowed.join(', ')}` : ''}.`, scope),
    unattended: false,
    outputFormat: { type: 'json_schema', schema: { ...opts.outputSchema } },
    // With a scope, the guarded tools ask canUseTool on every call: an allowed tool would skip it.
    allowedTools: scope === undefined ? allowed : allowed.filter((tool) => !GUARDED_TOOLS.has(tool)),
    disallowedTools: ONE_SHOT_DISALLOWED_TOOLS,
    // With a scope, Claude Code offers only these tools: one added later (Monitor, Workflow) is absent, not
    // just missing from the deny list. StructuredOutput is the tool of the structured answer.
    ...(scope === undefined ? {} : { tools: [...allowed, STRUCTURED_OUTPUT_TOOL] }),
    // The plugin's folder too, so the draft reads its schema and README as it reads the folder.
    ...(scope === undefined ? {} : { additionalDirectories: readable }),
    ...(opts.ephemeral === true ? { persistSession: false as const } : {}),
    ...(harnessPlugin === null ? {} : { harnessPlugin }),
  })
  // Stopped while Claude Code was starting: the listener below would never hear it.
  if (isAborted(opts.signal)) {
    query.close()
    throw new Error('the request was stopped')
  }
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

/** One request to Claude Code through the Agent SDK (claudeOneShotQuery): the oneShot part of the Claude driver. */
export const claudeOneShot: OneShot = claudeOneShotOver(claudeOneShotQuery)
