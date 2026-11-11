// Codex's notifications and approvals as worfy's events (src/main/vendors/codex/items.ts, approvals.ts;
// worfy-multi-vendor ticket 20), on the records of the fake app-server's scripts
// (test/fixtures/codex-scripts/*.jsonl): each notification a script sends goes through the translator
// in order, and what comes out for each is compared whole. Nothing here starts a process.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentEvent, type AgentEvent } from '../../src/shared/agent/events'
import { approvalAsk, CODEX_APPROVAL_OPTIONS, decisionOf, isApprovalRequest, type CodexApprovalRequest } from '../../src/main/vendors/codex/approvals'
import { boundedText, CodexItems, contextUsageOf, ERROR_TEXT_LIMIT, toolResult, toolUse, type CodexTurnContext } from '../../src/main/vendors/codex/items'
import type { ServerNotification } from '../../src/main/vendors/codex/protocol/ts/ServerNotification'
import type { ServerRequest } from '../../src/main/vendors/codex/protocol/ts/ServerRequest'
import type { ThreadItem } from '../../src/main/vendors/codex/protocol/ts/v2/ThreadItem'
import { exitText, userInput } from '../../src/main/vendors/codex/session'
import { turnFailureKind } from '../../src/shared/agent/turn-failure'

const SCRIPTS = join(import.meta.dirname, '..', 'fixtures', 'codex-scripts')
/** The recordings of the live pinned Codex (scripts/codex-capture.mjs): the same line shape as the scripts. */
const RECORDINGS = join(import.meta.dirname, '..', 'fixtures', 'codex-messages')

interface Step {
  notify?: string
  request?: string
  params?: unknown
}

const steps = (script: string, folder = SCRIPTS): Step[] =>
  readFileSync(join(folder, `${script}.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Step)

const notificationsOf = (script: string, folder = SCRIPTS): ServerNotification[] =>
  steps(script, folder).flatMap((step) => (step.notify === undefined ? [] : [{ method: step.notify, params: step.params } as ServerNotification]))

const CONTEXT: CodexTurnContext = {
  threadId: () => 'thr_fake_1',
  cwd: () => '/fake/project',
  version: () => '0.166.0',
  model: () => 'gpt-5.5-codex',
  preset: () => 'auto',
}

/** Each notification of `notifications` with the events it gave, through one translator. */
function play(notifications: readonly ServerNotification[]): [string, AgentEvent[]][] {
  const items = new CodexItems(CONTEXT)
  return notifications.map((notification) => [notification.method, items.take(notification)])
}

const INIT: AgentEvent = {
  type: 'init',
  sdkSessionId: 'thr_fake_1',
  model: 'gpt-5.5-codex',
  permissionMode: 'auto',
  apiKeySource: 'none',
  cwd: '/fake/project',
  claudeCodeVersion: '0.166.0',
  slashCommands: [],
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

const result = (fields: Partial<Extract<AgentEvent, { type: 'result' }>>): AgentEvent => ({
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: null,
  costUsd: 0,
  durationMs: 3000,
  numTurns: 1,
  usage: NO_USAGE,
  terminalReason: 'completed',
  interrupted: false,
  ...fields,
})

describe('the events of a turn (items.ts), on the scripts of the fake', () => {
  it('turn: init, the message in deltas and whole, the context, and the result with the answer and the usage of the last request', () => {
    expect(play(notificationsOf('turn'))).toEqual([
      ['thread/started', []],
      ['turn/started', [INIT]],
      ['item/started', []],
      ['item/agentMessage/delta', [{ type: 'delta', kind: 'text', text: 'Hello', parentToolUseId: null }]],
      ['item/agentMessage/delta', [{ type: 'delta', kind: 'text', text: ' from the fake Codex.', parentToolUseId: null }]],
      ['item/completed', [{ type: 'text', text: 'Hello from the fake Codex.', messageId: 'msg_1', parentToolUseId: null, synthetic: false }]],
      ['thread/tokenUsage/updated', [{ type: 'context', usage: { percentage: 0, totalTokens: 1240, windowTokens: 272000, autoCompactThreshold: null, autoCompactEnabled: false } }]],
      ['turn/completed', [result({ text: 'Hello from the fake Codex.', usage: { inputTokens: 1200, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } })]],
    ])
  })

  it('review: the exitedReviewMode item of /review is a text event and the answer of the turn\'s result', () => {
    const review = (id: string, text: string): AgentEvent => ({ type: 'text', text, messageId: id, parentToolUseId: null, synthetic: false })
    expect(play(notificationsOf('review'))).toEqual([
      ['thread/started', []],
      ['turn/started', [INIT]],
      ['item/completed', [review('review_r1', 'No problems in the uncommitted changes.')]],
      ['turn/completed', [result({ text: 'No problems in the uncommitted changes.' })]],
      ['turn/started', [INIT]],
      ['item/completed', [review('review_r2', 'The tests miss the empty case.')]],
      ['turn/completed', [result({ text: 'The tests miss the empty case.' })]],
    ])
  })

  it('items: reasoning → thinking; MCP tools, a command and a file change → tool_use and tool_result; a plan and an unknown notification → unknown', () => {
    expect(play(notificationsOf('items'))).toEqual([
      ['thread/started', []],
      ['turn/started', [INIT]],
      ['item/started', []],
      ['item/reasoning/summaryTextDelta', [{ type: 'delta', kind: 'thinking', text: 'Looking at the files', parentToolUseId: null }]],
      ['item/completed', [{ type: 'thinking', text: 'Looking at the files', messageId: 'rs_1', parentToolUseId: null }]],
      ['item/started', [{ type: 'tool_use', id: 'mcp_1', name: 'mcp__docs__search', input: { query: 'limits' }, parentToolUseId: null }]],
      ['item/completed', [{ type: 'tool_result', toolUseId: 'mcp_1', content: 'Two windows.', isError: false, parentToolUseId: null }]],
      ['item/started', [{ type: 'tool_use', id: 'mcp_2', name: 'mcp__docs__fetch', input: { url: 'https://example.com' }, parentToolUseId: null }]],
      ['item/completed', [{ type: 'tool_result', toolUseId: 'mcp_2', content: 'the server is not running', isError: true, parentToolUseId: null }]],
      [
        'item/completed',
        [
          { type: 'tool_use', id: 'cmd_2', name: 'commandExecution', input: { command: 'pnpm lint', cwd: '/fake/project' }, parentToolUseId: null },
          { type: 'tool_result', toolUseId: 'cmd_2', content: '1 problem\n', isError: true, parentToolUseId: null },
        ],
      ],
      [
        'item/completed',
        [
          { type: 'tool_use', id: 'patch_2', name: 'fileChange', input: { changes: [{ path: '/fake/project/notes.md', kind: { type: 'add' }, diff: '+hello\n' }] }, parentToolUseId: null },
          { type: 'tool_result', toolUseId: 'patch_2', content: 'add /fake/project/notes.md', isError: true, parentToolUseId: null },
        ],
      ],
      ['item/completed', [{ type: 'unknown', sdkType: 'item/plan' }]],
      ['turn/plan/updated', [{ type: 'unknown', sdkType: 'turn/plan/updated' }]],
      ['item/started', []],
      ['item/agentMessage/delta', [{ type: 'delta', kind: 'text', text: 'Two windows.', parentToolUseId: null }]],
      ['item/completed', [{ type: 'text', text: 'Two windows.', messageId: 'msg_1', parentToolUseId: null, synthetic: false }]],
      ['thread/tokenUsage/updated', [{ type: 'context', usage: { percentage: 20, totalTokens: 40120, windowTokens: 200000, autoCompactThreshold: null, autoCompactEnabled: false } }]],
      ['turn/completed', [result({ text: 'Two windows.', usage: { inputTokens: 40000, outputTokens: 120, cacheCreationInputTokens: 500, cacheReadInputTokens: 30000 } })]],
    ])
  })

  it('approval: a command and a file change, each a tool_use when it starts and a tool_result when it completes', () => {
    const tools = play(notificationsOf('approval')).filter(([method]) => method.startsWith('item/') && method !== 'item/agentMessage/delta')
    expect(tools.slice(0, 4)).toEqual([
      ['item/started', [{ type: 'tool_use', id: 'cmd_1', name: 'commandExecution', input: { command: 'pnpm test', cwd: '/fake/project' }, parentToolUseId: null }]],
      ['item/completed', [{ type: 'tool_result', toolUseId: 'cmd_1', content: 'all tests passed\n', isError: false, parentToolUseId: null }]],
      [
        'item/started',
        [{ type: 'tool_use', id: 'patch_1', name: 'fileChange', input: { changes: [{ path: '/fake/project/README.md', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new\n' }] }, parentToolUseId: null }],
      ],
      ['item/completed', [{ type: 'tool_result', toolUseId: 'patch_1', content: 'update /fake/project/README.md', isError: false, parentToolUseId: null }]],
    ])
  })

  it('interrupt: an interrupted turn is a result with its text, marked interrupted', () => {
    expect(play(notificationsOf('interrupt')).at(-1)).toEqual([
      'turn/completed',
      [result({ subtype: 'interrupted', isError: true, error: 'The turn was interrupted.', terminalReason: 'interrupted', interrupted: true })],
    ])
  })

  it('turn-failed: an error Codex retries is a notice; one it does not is the result with the error, and the failed turn after it gives no second one', () => {
    expect(play(notificationsOf('turn-failed')).slice(2)).toEqual([
      ['error', [{ type: 'notice', kind: 'notification', text: 'Codex: Reconnecting 1/5 It tries again.' }]],
      [
        'error',
        [result({ subtype: 'error', isError: true, error: 'The model is overloaded.\nTry again in a minute.', durationMs: 0, terminalReason: 'serverOverloaded' })],
      ],
      ['turn/completed', []],
    ])
  })

  it('a failed turn with no error before it is the result with the turn\'s error', () => {
    const failedTurn = notificationsOf('turn-failed').filter((notification) => notification.method !== 'error')
    expect(play(failedTurn).at(-1)).toEqual([
      'turn/completed',
      [result({ subtype: 'error', isError: true, error: 'The model is overloaded.\nTry again in a minute.', terminalReason: 'serverOverloaded' })],
    ])
  })

  it('every event of every script passes the schema of worfy\'s events', () => {
    for (const script of ['turn', 'items', 'approval', 'interrupt', 'steer', 'turn-failed', 'resume', 'settings', 'approval-interrupt']) {
      for (const [, events] of play(notificationsOf(script))) for (const event of events) expect(agentEvent.parse(event)).toEqual(event)
    }
  })
})

describe('the events of a turn: what the scripts do not play', () => {
  const turnCompleted = (turn: Record<string, unknown>): ServerNotification => ({ method: 'turn/completed', params: { threadId: 'thr_fake_1', turn: { id: 'turn_9', items: [], ...turn } } }) as unknown as ServerNotification

  it('a failed turn without any error text, and an interrupted one with Codex\'s, keep their own words', () => {
    expect(play([turnCompleted({ status: 'failed', error: null })])[0]?.[1]).toEqual([result({ subtype: 'error', isError: true, error: 'The turn failed.', durationMs: 0, terminalReason: 'failed' })])
    expect(play([turnCompleted({ status: 'interrupted', error: { message: 'Stopped by the user.', codexErrorInfo: null } })])[0]?.[1]).toEqual([
      result({ subtype: 'interrupted', isError: true, error: 'Stopped by the user.', durationMs: 0, terminalReason: 'interrupted', interrupted: true }),
    ])
  })

  it('names an error of a kind with fields by its key and its HTTP status (worfy-retry ticket 08), and a failed turn of no kind "failed"', () => {
    const error = { message: 'No connection.', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } }, additionalDetails: '  ' }
    expect(play([turnCompleted({ status: 'failed', error })])[0]?.[1]).toEqual([result({ subtype: 'error', isError: true, error: 'No connection.', durationMs: 0, terminalReason: 'httpConnectionFailed:503' })])
    const reasonOf = (codexErrorInfo: unknown): unknown => (play([turnCompleted({ status: 'failed', error: { message: 'x', codexErrorInfo } })])[0]?.[1][0] as { terminalReason?: unknown }).terminalReason
    expect(reasonOf({ responseTooManyFailedAttempts: { httpStatusCode: 429 } })).toBe('responseTooManyFailedAttempts:429')
    expect(reasonOf({ responseStreamDisconnected: { httpStatusCode: null } })).toBe('responseStreamDisconnected')
    expect(reasonOf({ responseStreamConnectionFailed: {} })).toBe('responseStreamConnectionFailed')
    expect(reasonOf({ activeTurnNotSteerable: { turnKind: 'review' } })).toBe('activeTurnNotSteerable')
    expect(reasonOf('serverOverloaded')).toBe('serverOverloaded')
    const detailsOnly = { message: ' ', codexErrorInfo: {}, additionalDetails: 'Only details.' }
    expect(play([turnCompleted({ status: 'failed', error: detailsOnly, durationMs: 12 })])[0]?.[1]).toEqual([result({ subtype: 'error', isError: true, error: 'Only details.', durationMs: 12, terminalReason: 'failed' })])
  })

  it('an error without any text says that Codex reported one; an error of a turn already ended gives nothing', () => {
    const error = (turnId: string): ServerNotification => ({ method: 'error', params: { threadId: 'thr_fake_1', turnId, willRetry: false, error: { message: '', codexErrorInfo: null } } }) as ServerNotification
    const events = play([error('turn_1'), error('turn_1')])
    expect(events[0]?.[1]).toEqual([result({ subtype: 'error', isError: true, error: 'Codex reported an error.', durationMs: 0, terminalReason: 'error' })])
    expect(events[1]?.[1]).toEqual([])
  })

  it('a turn/completed in a status worfy does not know still ends the turn: its answer, or its error (worfy-multi-vendor ticket 47)', () => {
    expect(play([turnCompleted({ status: 'paused' })])[0]?.[1]).toEqual([result({ durationMs: 0, terminalReason: 'paused' })])
    expect(play([turnCompleted({ status: 'inProgress', error: { message: 'Lost the stream.', codexErrorInfo: 'responseStreamDisconnected' } })])[0]?.[1]).toEqual([
      result({ subtype: 'error', isError: true, error: 'Lost the stream.', durationMs: 0, terminalReason: 'responseStreamDisconnected' }),
    ])
  })

  it('the live failed turn of 0.166.0: the thread\'s systemError comes first and gives nothing; the error ends the turn with Codex\'s words and kind, its turn/completed gives no second result', () => {
    const events = play(notificationsOf('turn-failed', RECORDINGS).filter((notification) => (notification.params as { threadId?: string } | undefined)?.threadId !== undefined))
    const order = events.map(([method]) => method).filter((method) => ['thread/status/changed', 'error', 'turn/completed'].includes(method))
    expect(order.slice(-3)).toEqual(['thread/status/changed', 'error', 'turn/completed'])
    const results = events.flatMap(([, given]) => given).filter((event): event is Extract<AgentEvent, { type: 'result' }> => event.type === 'result')
    expect(results).toHaveLength(1)
    const end = results[0] as Extract<AgentEvent, { type: 'result' }>
    expect(end).toMatchObject({
      subtype: 'error',
      isError: true,
      error: "The 'worfy-capture-no-such-model' model is not supported when using Codex with a ChatGPT account.",
      terminalReason: 'modelNotFound',
      interrupted: false,
    })
    expect(events.find(([method]) => method === 'error')?.[1]).toEqual([end])
    // Auto-continue reads the kind of the error, not a system error of the thread: not a temporary failure, as before.
    expect(turnFailureKind({ vendor: 'codex', isError: end.isError, interrupted: end.interrupted, error: end.error, terminalReason: end.terminalReason })).toEqual({ kind: 'other' })
  })

  it('a thread status gives nothing: neither systemError nor idle ends a turn by itself', () => {
    const status = (type: string): ServerNotification => ({ method: 'thread/status/changed', params: { threadId: 'thr_fake_1', status: { type } } }) as unknown as ServerNotification
    expect(play([status('systemError'), status('idle')])).toEqual([
      ['thread/status/changed', []],
      ['thread/status/changed', []],
    ])
  })

  it('names the turn each result ended, whichever notification gave it', () => {
    const items = new CodexItems(CONTEXT)
    expect(items.lastEnded).toBeNull()
    items.take(turnCompleted({ status: 'completed' }))
    expect(items.lastEnded).toBe('turn_9')
    items.take({ method: 'error', params: { threadId: 'thr_fake_1', turnId: 'turn_10', willRetry: false, error: { message: 'x', codexErrorInfo: null } } } as ServerNotification)
    expect(items.lastEnded).toBe('turn_10')
  })

  it('a Stop hook is a hook event while it runs; a run that ends silent closes it, one that said something is shown; other silent runs give nothing', () => {
    const run = (fields: Record<string, unknown>) => ({
      id: 'stop:0:/codex/plugins/worfy/hooks/hooks.json',
      eventName: 'stop',
      handlerType: 'command',
      executionMode: 'sync',
      scope: 'turn',
      sourcePath: '/codex/plugins/worfy/hooks/hooks.json',
      source: 'plugin',
      displayOrder: 0,
      status: 'running',
      statusMessage: null,
      startedAt: 1793000000,
      completedAt: null,
      durationMs: null,
      entries: [],
      ...fields,
    })
    const hook = (method: 'hook/started' | 'hook/completed', fields: Record<string, unknown> = {}): ServerNotification =>
      ({ method, params: { threadId: 'thr_fake_1', turnId: 'turn_1', run: run(fields) } }) as unknown as ServerNotification
    const shown = (outcome: string, stdout = '', stderr = '', hookEvent = 'Stop', hookName = 'stop:0:/codex/plugins/worfy/hooks/hooks.json'): AgentEvent => ({ type: 'hook', hookEvent, hookName, exitCode: null, outcome, stdout, stderr })
    expect(
      play([
        hook('hook/started'),
        hook('hook/completed', { status: 'completed' }),
        hook('hook/started'),
        hook('hook/completed', { status: 'blocked', entries: [{ kind: 'stop', text: '[gate] red (fast): lint' }, { kind: 'context', text: 'Fix the lint first.' }] }),
        hook('hook/started', { id: 'pre:1', eventName: 'preToolUse' }),
        hook('hook/completed', { id: 'pre:1', eventName: 'preToolUse', status: 'completed' }),
        hook('hook/completed', { id: 'pre:2', eventName: 'preToolUse', status: 'failed' }),
      ]),
    ).toEqual([
      ['hook/started', [shown('running')]],
      ['hook/completed', [shown('completed')]],
      ['hook/started', [shown('running')]],
      ['hook/completed', [shown('blocked', 'Fix the lint first.', '[gate] red (fast): lint')]],
      ['hook/started', []],
      ['hook/completed', []],
      ['hook/completed', [shown('failed', '', '', 'PreToolUse', 'pre:2')]],
    ])
  })

  it('a reasoning item without a summary gives nothing; empty parts of a summary are left out', () => {
    const reasoning = (summary: string[]): ServerNotification =>
      ({ method: 'item/completed', params: { threadId: 'thr_fake_1', turnId: 'turn_1', completedAtMs: 1, item: { type: 'reasoning', id: 'rs', summary, content: ['raw'] } } }) as ServerNotification
    expect(play([reasoning([]), reasoning(['First', ' ', 'Second'])]).map(([, events]) => events)).toEqual([[], [{ type: 'thinking', text: 'First\n\nSecond', messageId: 'rs', parentToolUseId: null }]])
  })

  it('a user message item gives nothing: the Session gave the prompt itself', () => {
    const user = { method: 'item/completed', params: { threadId: 'thr_fake_1', turnId: 'turn_1', completedAtMs: 1, item: { type: 'userMessage', id: 'u', content: [] } } } as unknown as ServerNotification
    expect(play([user])[0]?.[1]).toEqual([])
  })

  it('the result of a turn carries only its own answer and usage, not those of the turn before', () => {
    const items = new CodexItems(CONTEXT)
    for (const notification of notificationsOf('turn')) items.take(notification)
    expect(items.take(turnCompleted({ status: 'completed' }))).toEqual([result({ durationMs: 0 })])
  })

  it('keeps a tool item while it runs, and forgets it once it completes', () => {
    const items = new CodexItems(CONTEXT)
    const [started, completed] = notificationsOf('approval').filter((notification) => notification.method === 'item/started' || notification.method === 'item/completed')
    items.take(started as ServerNotification)
    expect(items.item('cmd_1')).toMatchObject({ type: 'commandExecution', command: 'pnpm test' })
    items.take(completed as ServerNotification)
    expect(items.item('cmd_1')).toBeUndefined()
    const message = notificationsOf('turn').find((notification) => notification.method === 'item/started') as ServerNotification
    items.take(message)
    expect(items.item('msg_1')).toBeUndefined()
  })

  it('follows another thread\'s tool items the same way without giving events, so their approvals find them', () => {
    const items = new CodexItems(CONTEXT)
    const [started, completed] = notificationsOf('approval').filter((notification) => notification.method === 'item/started' || notification.method === 'item/completed')
    items.follow(started as ServerNotification)
    expect(items.item('cmd_1')).toMatchObject({ type: 'commandExecution', command: 'pnpm test' })
    items.follow(completed as ServerNotification)
    expect(items.item('cmd_1')).toBeUndefined()
    items.follow(notificationsOf('turn').find((notification) => notification.method === 'item/started') as ServerNotification)
    expect(items.item('msg_1')).toBeUndefined()
    // Nothing of what it followed shows up in the thread's own events.
    expect(items.take(completed as ServerNotification)).toEqual([expect.objectContaining({ type: 'tool_use', id: 'cmd_1' }), expect.objectContaining({ type: 'tool_result', toolUseId: 'cmd_1' })])
  })
})

describe('the pieces of the translation', () => {
  it('has no context usage without the model\'s window', () => {
    const usage = { last: { totalTokens: 10, inputTokens: 10, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }
    expect(contextUsageOf({ ...usage, total: usage.last, modelContextWindow: null })).toBeNull()
    expect(contextUsageOf({ ...usage, total: usage.last, modelContextWindow: 0 })).toBeNull()
    expect(contextUsageOf({ ...usage, total: usage.last, modelContextWindow: 40 })?.percentage).toBe(25)
  })

  it('a command\'s result: no output is empty; a completed one that exited non-zero failed, one without an exit code did not', () => {
    const command = { type: 'commandExecution', id: 'c', command: 'ls', cwd: '/p', commandActions: [], status: 'completed' } as unknown as ThreadItem
    expect(toolResult(command)).toEqual({ type: 'tool_result', toolUseId: 'c', content: '', isError: false, parentToolUseId: null })
    expect(toolResult({ ...command, exitCode: 0 } as ThreadItem)?.isError).toBe(false)
    expect(toolResult({ ...command, exitCode: 2 } as ThreadItem)?.isError).toBe(true)
    expect(toolResult({ ...command, status: 'declined' } as ThreadItem)?.isError).toBe(true)
  })

  it('an MCP result with parts that are not text is its content as JSON; an error fails even a completed call', () => {
    const call = { type: 'mcpToolCall', id: 'm', server: 's', tool: 't', status: 'completed', arguments: {}, result: { content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'y' }] }, error: null } as unknown as ThreadItem
    expect(toolResult(call)?.content).toBe('[{"type":"image","data":"x"},{"type":"text","text":"y"}]')
    expect(toolResult({ ...call, result: null } as ThreadItem)?.content).toBe('')
    expect(toolResult({ ...call, result: { content: [null] } } as unknown as ThreadItem)?.content).toBe('[null]')
    expect(toolResult({ ...call, error: { message: 'gone' } } as ThreadItem)).toMatchObject({ content: 'gone', isError: true })
  })

  it('a Subagent call (collabAgentToolCall) is a tool_use when it starts and a tool_result when it completes (worfy-retry ticket 08)', () => {
    const call = { type: 'collabAgentToolCall', id: 'call_1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: 'thr_1', receiverThreadIds: ['thr_2'], prompt: 'Implement Ticket 01.', model: null, reasoningEffort: null, agentsStates: {} } as unknown as ThreadItem
    expect(toolUse(call)).toEqual({ type: 'tool_use', id: 'call_1', name: 'collabAgentToolCall', input: { tool: 'spawnAgent', receiverThreadIds: ['thr_2'], prompt: 'Implement Ticket 01.' }, parentToolUseId: null })
    const done = { ...call, status: 'completed', agentsStates: { thr_2: { status: 'running', message: null } } } as unknown as ThreadItem
    expect(toolResult(done)).toEqual({ type: 'tool_result', toolUseId: 'call_1', content: 'thr_2: running', isError: false, parentToolUseId: null })
    const failed = { ...call, status: 'failed', agentsStates: { thr_2: { status: 'errored', message: 'No slot for a new agent.' } } } as unknown as ThreadItem
    expect(toolResult(failed)).toMatchObject({ content: 'thr_2: errored — No slot for a new agent.', isError: true })
  })

  it('a file change without changes has an empty result; only tools have a tool_use and a tool_result', () => {
    expect(toolResult({ type: 'fileChange', id: 'f', status: 'completed' } as unknown as ThreadItem)?.content).toBe('')
    const plan = { type: 'plan', id: 'p', text: 'x' } as ThreadItem
    expect(toolUse(plan)).toBeNull()
    expect(toolResult(plan)).toBeNull()
  })

  it('bounds a text of Codex, saying how much it left out', () => {
    expect(boundedText('short')).toBe('short')
    expect(boundedText('x'.repeat(ERROR_TEXT_LIMIT))).toBe('x'.repeat(ERROR_TEXT_LIMIT))
    expect(boundedText('x'.repeat(ERROR_TEXT_LIMIT + 5))).toBe(`${'x'.repeat(ERROR_TEXT_LIMIT)} … (5 more characters)`)
    expect(boundedText('abcdef', 2)).toBe('ab … (4 more characters)')
  })

  it('names how the process ended, without its stderr', () => {
    expect(exitText({ code: 3, signal: null })).toBe('Codex app-server exited with code 3')
    expect(exitText({ code: null, signal: null })).toBe('Codex app-server exited with code unknown')
    expect(exitText({ code: null, signal: 'SIGKILL' })).toBe('Codex app-server was stopped by SIGKILL')
  })

  it('gives Codex the message as text with the attached files, and each image as a data URL before it', () => {
    expect(userInput({ text: 'Say hello', attachments: [] })).toEqual([{ type: 'text', text: 'Say hello', text_elements: [] }])
    const image = { kind: 'image' as const, name: 'shot.png', mediaType: 'image/png' as const, size: 3, data: 'AAAA' }
    const [first, second] = userInput({ text: 'Look', attachments: [image] })
    expect(first).toEqual({ type: 'image', url: 'data:image/png;base64,AAAA' })
    expect(second).toMatchObject({ type: 'text', text: expect.stringContaining('Look') as unknown as string })
    const file = { kind: 'file' as const, name: 'a.txt', path: '/p/a.txt', size: 1, copied: false }
    expect(userInput({ text: '', attachments: [file] })).toEqual([{ type: 'text', text: expect.stringContaining('/p/a.txt') as unknown as string, text_elements: [] }])
    expect(userInput({ text: '', attachments: [] })).toEqual([{ type: 'text', text: '', text_elements: [] }])
    expect(userInput({ text: ' ', attachments: [image] }).map((input) => input.type)).toEqual(['image', 'text'])
  })
})

describe('approvals (approvals.ts), on the requests of the fake', () => {
  /** The approval requests of `script`, each with the item that started before it. */
  function approvalsOf(script: string): { request: CodexApprovalRequest; item: ThreadItem | undefined }[] {
    const items = new CodexItems(CONTEXT)
    const found: { request: CodexApprovalRequest; item: ThreadItem | undefined }[] = []
    let id = 0
    for (const step of steps(script)) {
      if (step.notify !== undefined) items.take({ method: step.notify, params: step.params } as ServerNotification)
      if (step.request === undefined) continue
      const request = { id: ++id, method: step.request, params: step.params } as ServerRequest
      if (!isApprovalRequest(request)) throw new Error(`not an approval: ${step.request}`)
      found.push({ request, item: items.item(request.params.itemId) })
    }
    return found
  }

  const OPTIONS = [
    { id: 'accept', label: 'Accept', kind: 'allow' },
    { id: 'acceptForSession', label: 'Accept for this Session', kind: 'allow_always' },
    { id: 'decline', label: 'Decline', kind: 'deny' },
    { id: 'cancel', label: 'Decline and stop the turn', kind: 'deny' },
  ]
  /** An approval whose command or files no one named: no answer the gate would remember for the Session. */
  const UNNAMED_OPTIONS = OPTIONS.filter((option) => option.id !== 'acceptForSession')

  it('a command: the command is the subject, with Codex\'s four answers', () => {
    const [command] = approvalsOf('approval')
    expect(approvalAsk(command!.request, command!.item)).toEqual({
      subject: 'pnpm test',
      toolName: 'commandExecution',
      toolUseId: 'cmd_1',
      input: { command: 'pnpm test', cwd: '/fake/project' },
      title: 'Codex wants to run a command',
      description: 'The command runs outside the sandbox.',
      blockedPath: null,
      suggestions: [],
      options: OPTIONS,
    })
  })

  it('a file change: the files of its item are the subject, the changes the input', () => {
    const [, patch] = approvalsOf('approval')
    expect(approvalAsk(patch!.request, patch!.item)).toEqual({
      subject: '/fake/project/README.md',
      toolName: 'fileChange',
      toolUseId: 'patch_1',
      input: { changes: [{ path: '/fake/project/README.md', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new\n' }] },
      title: 'Codex wants to change files',
      description: 'The change writes a file.',
      blockedPath: null,
      suggestions: [],
      options: OPTIONS,
    })
    expect(CODEX_APPROVAL_OPTIONS).toEqual(OPTIONS)
  })

  it('takes the command and folder from the item when the request leaves them out; when nothing names them, the item\'s id does, with no answer for the Session', () => {
    const [command] = approvalsOf('approval')
    const bare = { ...command!.request, params: { ...command!.request.params, command: null, cwd: undefined, reason: '  ' } } as CodexApprovalRequest
    expect(approvalAsk(bare, command!.item)).toMatchObject({ subject: 'pnpm test', input: { command: 'pnpm test', cwd: '/fake/project' }, description: null })
    expect(approvalAsk(bare, undefined)).toMatchObject({ subject: 'a command (item cmd_1)', input: { command: null, cwd: null }, options: UNNAMED_OPTIONS })
    const other = { type: 'fileChange', id: 'x', changes: [], status: 'inProgress' } as unknown as ThreadItem
    expect(approvalAsk(bare, other)).toMatchObject({ subject: 'a command (item cmd_1)', input: { command: null, cwd: null }, options: UNNAMED_OPTIONS })
  })

  it('a file change without its item or files is named by its item\'s id, with no answer for the Session; one of several files, and one asking for a folder', () => {
    const [, patch] = approvalsOf('approval')
    expect(approvalAsk(patch!.request, undefined)).toMatchObject({ subject: 'file changes (item patch_1)', input: { changes: [] }, options: UNNAMED_OPTIONS })
    const command = { type: 'commandExecution', id: 'patch_1', command: 'x', cwd: '/', commandActions: [], status: 'inProgress' } as unknown as ThreadItem
    expect(approvalAsk(patch!.request, command)).toMatchObject({ subject: 'file changes (item patch_1)', options: UNNAMED_OPTIONS })
    const empty = { type: 'fileChange', id: 'patch_1', status: 'inProgress', changes: [] } as unknown as ThreadItem
    expect(approvalAsk(patch!.request, empty)).toMatchObject({ subject: 'file changes (item patch_1)', options: UNNAMED_OPTIONS })
    const two = { type: 'fileChange', id: 'patch_1', status: 'inProgress', changes: [{ path: 'a.md', kind: { type: 'add' }, diff: '' }, { path: 'b.md', kind: { type: 'delete' }, diff: '' }] } as unknown as ThreadItem
    const grant = { ...patch!.request, params: { ...patch!.request.params, grantRoot: '/outside' } } as CodexApprovalRequest
    expect(approvalAsk(grant, two)).toMatchObject({ subject: 'a.md, b.md', blockedPath: '/outside', options: OPTIONS })
  })

  it('knows the two approvals and no other request', () => {
    expect(approvalsOf('approval').map(({ request }) => request.method)).toEqual(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'])
    expect(isApprovalRequest({ id: 1, method: 'item/tool/requestUserInput', params: {} } as unknown as ServerRequest)).toBe(false)
  })

  it('sends back the decision picked: cancel for a cancelled request, decline for an id Codex does not offer', () => {
    expect(['accept', 'acceptForSession', 'decline', 'cancel'].map(decisionOf)).toEqual(['accept', 'acceptForSession', 'decline', 'cancel'])
    expect(decisionOf(null)).toBe('cancel')
    expect(decisionOf('allow')).toBe('decline')
  })
})
