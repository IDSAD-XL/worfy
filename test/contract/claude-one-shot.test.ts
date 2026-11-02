// The oneShot part of the Claude driver (src/main/vendors/claude/one-shot.ts, worfy-multi-vendor
// ticket 15): the Claude Code of the Project profile draft moved there from src/main/ipc/projects.ts
// (sdkDraftQuery). The regression check: the options the driver hands to the SDK's query() — above
// all allowedTools, disallowedTools, outputFormat and the Harness plugin — are the ones sdkDraftQuery
// handed before the move, both for the draft's own request (claudeOneShotQuery) and for the neutral
// oneShot given the draft's read-only tools and schema (claudeOneShot). The SDK, the app, the login
// shell environment and the Harness on the machine are stood in: nothing starts Claude Code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { QueryRequest } from '../../src/main/agent/session'
import type { DraftRequest } from '../../src/main/projects/connect'

const mocks = vi.hoisted(() => ({
  calls: [] as { prompt: unknown; options: Record<string, unknown> }[],
  messages: [] as unknown[],
  closed: 0,
  /** Ends the stream of the next query without a message once released (a stopped request). */
  hold: null as Promise<void> | null,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: { prompt: unknown; options: Record<string, unknown> }) => {
    mocks.calls.push(params)
    const messages = [...mocks.messages]
    const hold = mocks.hold
    return {
      async *[Symbol.asyncIterator]() {
        if (hold !== null) await hold
        else for (const message of messages) yield message
      },
      close: () => void (mocks.closed += 1),
    }
  },
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin:/bin', HOME: '/home/u' }, from: 'login-shell', error: null }) }))
// The plugin Harness on the machine: the Session gets the Harness copy of this build inline.
vi.mock('../../src/main/harness/locate', async (original) => ({ ...(await original<object>()), currentHarness: () => ({ kind: 'plugin' }) }))

const { claudeOneShot, claudeOneShotQuery } = await import('../../src/main/vendors/claude/one-shot')
const { DRAFT_DISALLOWED_TOOLS, DRAFT_TOOLS, draftCanUseTool, sessionSchema } = await import('../../src/main/projects/connect')
const { draftSessionOptions, sessionHarnessPlugin } = await import('../../src/main/agent/options')
const { currentHarness } = await import('../../src/main/harness/locate')
const { bundledHarnessDir } = await import('../../src/main/harness/bundled')
const { agentEnv } = await import('../../src/main/agent/env')
const { app } = await import('electron')

const SCHEMA = sessionSchema({ type: 'object', required: ['profile'], properties: { profile: { type: 'object' } } })
const FOLDER = '/repos/shop'

/**
 * What sdkDraftQuery of src/main/ipc/projects.ts gave the SDK before the move, written out as it
 * was: the draft Session's options with the Harness of this build.
 */
async function before(request: DraftRequest): Promise<Record<string, unknown>> {
  return draftSessionOptions({
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
  }) as Record<string, unknown>
}

/** The options as data: a function becomes its key, so two option sets compare field by field. */
const snapshot = (options: Record<string, unknown>): unknown => JSON.parse(JSON.stringify(options, (key, value: unknown) => (typeof value === 'function' ? `[function ${key}]` : value)))

const prompt: QueryRequest['prompt'] = { [Symbol.asyncIterator]: async function* () {} }

/** The draft's request, as ProjectConnector.draft builds it (src/main/projects/connect.ts). */
const draftRequest = (): DraftRequest => ({
  prompt,
  cwd: FOLDER,
  resume: undefined,
  stderr: () => undefined,
  settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
  canUseTool: draftCanUseTool,
  unattended: false,
  outputFormat: { type: 'json_schema', schema: SCHEMA },
  allowedTools: DRAFT_TOOLS,
  disallowedTools: DRAFT_DISALLOWED_TOOLS,
})

const result = { type: 'result', subtype: 'success', result: 'done', structured_output: { profile: { name: 'shop' } } }

beforeEach(() => {
  mocks.calls.length = 0
  mocks.messages = []
  mocks.closed = 0
  mocks.hold = null
})

afterEach(() => vi.clearAllMocks())

describe('the draft through the oneShot part of the Claude driver', () => {
  it('claudeOneShotQuery gives query() the options sdkDraftQuery gave, the prompt as it is', async () => {
    const request = draftRequest()
    await claudeOneShotQuery(request)
    expect(mocks.calls).toHaveLength(1)
    const sent = mocks.calls[0]!
    expect(sent.prompt).toBe(prompt)
    expect(snapshot(sent.options)).toEqual(snapshot(await before(request)))
    // The four the ticket names, spelled out: a change of the reference above would hide them.
    expect(sent.options.allowedTools).toEqual(['Read', 'Glob', 'Grep'])
    expect(sent.options.disallowedTools).toEqual(['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'])
    expect(sent.options.outputFormat).toEqual({ type: 'json_schema', schema: SCHEMA })
    expect(sent.options.plugins).toEqual([{ type: 'local', path: bundledHarnessDir(), skipMcpDiscovery: true }])
    expect(sent.options.canUseTool).toBe(draftCanUseTool)
    expect(sent.options.stderr).toBe(request.stderr)
  })

  it('claudeOneShot with the draft\'s read-only tools and schema gives query() the same options', async () => {
    mocks.messages = [result]
    await claudeOneShot('draft it', { cwd: FOLDER, readOnlyTools: DRAFT_TOOLS, outputSchema: SCHEMA })
    const sent = mocks.calls[0]!
    expect(snapshot(sent.options)).toEqual(snapshot(await before(draftRequest())))
    // Its own canUseTool lets through the same tools and refuses the same ones.
    const canUseTool = sent.options.canUseTool as typeof draftCanUseTool
    const signal = new AbortController().signal
    for (const tool of ['Read', 'Glob', 'Grep', 'StructuredOutput']) expect((await canUseTool(tool, {}, { signal })).behavior, tool).toBe('allow')
    for (const tool of ['Bash', 'Write', 'Edit', 'WebFetch', 'Task', 'Agent', 'mcp__x__y', 'Skill']) expect((await canUseTool(tool, {}, { signal })).behavior, tool).toBe('deny')
  })
})

describe('claudeOneShot', () => {
  it('sends the prompt as one user message, tells the activity and answers the structured output', async () => {
    mocks.messages = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${FOLDER}/package.json` } }] } },
      result,
    ]
    const activity: string[] = []
    const answer = await claudeOneShot('draft it', { cwd: FOLDER, readOnlyTools: DRAFT_TOOLS, outputSchema: SCHEMA, onActivity: (text) => activity.push(text) })
    expect(answer).toEqual({ text: 'done', structured: { profile: { name: 'shop' } } })
    expect(activity).toEqual(['Claude Code started', `Read ${FOLDER}/package.json`, 'The draft is ready'])
    const sent: unknown[] = []
    for await (const message of mocks.calls[0]!.prompt as AsyncIterable<unknown>) sent.push(message)
    expect(sent).toEqual([{ type: 'user', message: { role: 'user', content: 'draft it' }, parent_tool_use_id: null }])
    expect(mocks.closed).toBe(1)
  })

  it('rejects when Claude Code ends without an answer or answers with an error', async () => {
    await expect(claudeOneShot('x', { cwd: FOLDER, outputSchema: SCHEMA })).rejects.toThrow('Claude Code ended before the answer')
    mocks.messages = [{ type: 'result', subtype: 'error_max_turns', errors: ['too long'] }]
    await expect(claudeOneShot('x', { cwd: FOLDER, outputSchema: SCHEMA })).rejects.toThrow('Claude Code gave no answer (error_max_turns: too long)')
    expect(mocks.closed).toBe(2)
  })

  it('a stopped request closes Claude Code and rejects; one stopped before it starts starts nothing', async () => {
    let release: () => void = () => undefined
    mocks.hold = new Promise<void>((resolve) => (release = resolve))
    const stop = new AbortController()
    const asked = claudeOneShot('x', { cwd: FOLDER, outputSchema: SCHEMA, signal: stop.signal })
    await vi.waitFor(() => expect(mocks.calls).toHaveLength(1))
    stop.abort()
    expect(mocks.closed).toBe(1)
    release()
    await expect(asked).rejects.toThrow('stopped')
    await expect(claudeOneShot('x', { cwd: FOLDER, outputSchema: SCHEMA, signal: stop.signal })).rejects.toThrow('stopped')
    expect(mocks.calls).toHaveLength(1)
  })

  it('a request without outputSchema is refused before Claude Code starts', async () => {
    await expect(claudeOneShot('x', { cwd: FOLDER })).rejects.toThrow(/outputSchema/)
    expect(mocks.calls).toHaveLength(0)
  })
})
