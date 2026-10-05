// The boundary between the Agent SDK and worfy: every SDK message captured by ticket 06
// (test/fixtures/sdk-messages/) turns into worfy's own events, and nothing the SDK sends can
// throw out of the mapper.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { agentEvent, sdkMessageToEvents, type AgentEvent } from '../../src/shared/agent/events'

const fixturesDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'sdk-messages')

type Message = Record<string, unknown>

/** SDK messages of one fixture file; the spike's own `probe_error` records are not SDK messages. */
function fixture(name: string): Message[] {
  return readFileSync(join(fixturesDir, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Message)
    .filter((message) => !('probe_error' in message))
}

function first(name: string, match: (message: Message) => boolean): Message {
  const found = fixture(name).find(match)
  if (!found) throw new Error(`no matching message in ${name}`)
  return found
}

const isSystem = (subtype: string) => (m: Message) => m.type === 'system' && m.subtype === subtype
const contentTypes = (m: Message): string[] => {
  const content = (m.message as { content?: unknown } | undefined)?.content
  return Array.isArray(content) ? content.map((block: { type?: string }) => String(block.type)) : [typeof content]
}

const allFixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.jsonl'))

describe('SDK messages → agent events', () => {
  it('turns system/init into an init event with the session facts', () => {
    const message = first('stop-hook.jsonl', isSystem('init'))
    expect(sdkMessageToEvents(message)).toEqual([
      {
        type: 'init',
        sdkSessionId: '00000000-0000-4000-8000-000000000142',
        model: 'claude-haiku-4-5-20251001',
        permissionMode: 'bypassPermissions',
        apiKeySource: 'none',
        cwd: '<repo>',
        claudeCodeVersion: '2.1.289',
        slashCommands: message.slash_commands,
      },
    ])
  })

  it('keeps every slash command of system/init, including ship-ticket when the user has it', () => {
    const message = { ...first('init.jsonl', isSystem('init')), slash_commands: ['ship-ticket', 'epic-wave', 'compact'] }
    const [event] = sdkMessageToEvents(message)
    expect(event?.type === 'init' && event.slashCommands).toEqual(['ship-ticket', 'epic-wave', 'compact'])
  })

  it('turns an assistant text block into a text event and a thinking block into a thinking event', () => {
    const text = first('controls.jsonl', (m) => m.type === 'assistant' && contentTypes(m).includes('text'))
    expect(sdkMessageToEvents(text)).toEqual([{ type: 'text', text: 'YES', messageId: expect.any(String) as string, parentToolUseId: null, synthetic: false }])
    const thinking = first('controls.jsonl', (m) => m.type === 'assistant' && contentTypes(m).includes('thinking'))
    expect(sdkMessageToEvents(thinking)).toEqual([{ type: 'thinking', text: '', messageId: expect.any(String) as string, parentToolUseId: null }])
  })

  it('marks the answer Claude Code writes itself (model <synthetic>) as synthetic text', () => {
    const message = first('no-login.jsonl', (m) => m.type === 'assistant')
    expect(sdkMessageToEvents(message)).toEqual([
      { type: 'text', text: 'Not logged in · Please run /login', messageId: expect.any(String) as string, parentToolUseId: null, synthetic: true },
    ])
  })

  it('turns tool_use and tool_result into their events', () => {
    const use = first('permissions.jsonl', (m) => m.type === 'assistant' && contentTypes(m).includes('tool_use'))
    const [useEvent] = sdkMessageToEvents(use)
    expect(useEvent).toMatchObject({ type: 'tool_use', name: 'Bash', parentToolUseId: null })
    expect(useEvent?.type === 'tool_use' && useEvent.input).toMatchObject({ command: expect.stringContaining('mkdir -p') as string })

    const result = first('permissions.jsonl', (m) => m.type === 'user' && contentTypes(m).includes('tool_result'))
    const [resultEvent] = sdkMessageToEvents(result)
    expect(resultEvent).toMatchObject({ type: 'tool_result', isError: false, parentToolUseId: null })
    expect(resultEvent?.type === 'tool_result' && resultEvent.toolUseId).toBe(useEvent?.type === 'tool_use' && useEvent.id)
  })

  it('turns a Stop hook that blocked the turn into a hook event and drops silent hooks', () => {
    const responses = fixture('stop-hook.jsonl').filter(isSystem('hook_response'))
    const events = responses.flatMap((m) => sdkMessageToEvents(m))
    // Two blocks (exit 2) and one additionalContext answer: the three continuations of ticket 06.
    expect(events.map((e) => e.type === 'hook' && e.exitCode)).toEqual([2, 2, 0])
    expect(events[0]).toMatchObject({ type: 'hook', hookEvent: 'Stop', outcome: 'error', stderr: expect.stringContaining('Гейт качества красный') as string })
    expect(events[2]).toMatchObject({ type: 'hook', stdout: expect.stringContaining('additionalContext') as string })
    // The quiet SessionStart and Stop hooks that printed nothing.
    const silent = responses.filter((m) => m.exit_code === 0 && m.stdout === '' && m.stderr === '')
    expect(silent.length).toBeGreaterThan(0)
    for (const message of silent) expect(sdkMessageToEvents(message)).toEqual([])
  })

  it('shows the Stop hook feedback Claude Code feeds back to the model as a synthetic notice', () => {
    const message = first('stop-hook.jsonl', (m) => m.type === 'user' && m.isSynthetic === true)
    expect(sdkMessageToEvents(message)).toEqual([{ type: 'notice', kind: 'synthetic', text: expect.stringContaining('Stop hook feedback') as string }])
  })

  it('shows the interruption marker and local command output as notices', () => {
    const interrupted = first('controls.jsonl', (m) => m.type === 'user' && contentTypes(m).includes('text'))
    expect(sdkMessageToEvents(interrupted)).toEqual([{ type: 'notice', kind: 'user', text: '[Request interrupted by user]' }])
    const local = first('controls.jsonl', (m) => m.type === 'user' && contentTypes(m).includes('string'))
    expect(sdkMessageToEvents(local)).toEqual([{ type: 'notice', kind: 'local_command', text: expect.stringContaining('Set model to') as string }])
  })

  it('turns rate_limit_event into a rate_limit event with both windows', () => {
    const message = first('controls.jsonl', (m) => m.type === 'rate_limit_event')
    expect(sdkMessageToEvents(message)).toEqual([
      { type: 'rate_limit', status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1791184200, fiveHourUtilization: 0.07, sevenDayUtilization: 0.62 },
    ])
  })

  it('turns a successful result into a result event with cost, tokens and duration', () => {
    const message = first('controls.jsonl', (m) => m.type === 'result')
    expect(sdkMessageToEvents(message)).toEqual([
      {
        type: 'result',
        subtype: 'success',
        isError: false,
        error: null,
        text: 'YES',
        costUsd: 0.0023546,
        durationMs: 3651,
        numTurns: 1,
        usage: {
          inputTokens: expect.any(Number) as number,
          outputTokens: expect.any(Number) as number,
          cacheCreationInputTokens: expect.any(Number) as number,
          cacheReadInputTokens: expect.any(Number) as number,
        },
        terminalReason: 'completed',
        interrupted: false,
      },
    ])
  })

  it('carries the error of a failed result: interrupted turn, Not logged in, Prompt is too long', () => {
    const interrupted = first('controls.jsonl', (m) => m.type === 'result' && m.subtype === 'error_during_execution')
    expect(sdkMessageToEvents(interrupted)[0]).toMatchObject({ type: 'result', isError: true, error: expect.stringContaining('ede_diagnostic') as string, interrupted: true })
    const noLogin = first('no-login.jsonl', (m) => m.type === 'result')
    expect(sdkMessageToEvents(noLogin)[0]).toMatchObject({ type: 'result', subtype: 'success', isError: true, error: 'Not logged in · Please run /login', interrupted: false })
    const tooLong = fixture('init.jsonl').filter((m) => m.type === 'result')[1]
    expect(sdkMessageToEvents(tooLong)[0]).toMatchObject({ type: 'result', isError: true, error: 'Prompt is too long', terminalReason: 'prompt_too_long' })
  })

  it('turns live text deltas into delta events and ignores the other stream events', () => {
    const delta = { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1 2 ' } }, parent_tool_use_id: null, session_id: 's', uuid: 'u' }
    expect(sdkMessageToEvents(delta)).toEqual([{ type: 'delta', kind: 'text', text: '1 2 ', parentToolUseId: null }])
    const others = fixture('controls.jsonl').filter((m) => m.type === 'stream_event' && (m.event as { type: string }).type !== 'content_block_delta')
    expect(others.length).toBeGreaterThan(0)
    for (const message of others) expect(sdkMessageToEvents(message)).toEqual([])
  })

  it('turns system/status, notification and commands_changed into their events', () => {
    const status = fixture('init.jsonl')
      .filter(isSystem('status'))
      .find((m) => m.status === 'compacting')
    expect(sdkMessageToEvents(status)).toEqual([{ type: 'status', status: 'compacting', permissionMode: null }])
    const notification = first('stop-hook.jsonl', isSystem('notification'))
    expect(sdkMessageToEvents(notification)).toEqual([{ type: 'notice', kind: 'notification', text: 'Stop hook error occurred · ctrl+o to see' }])
    const commands = first('init.jsonl', isSystem('commands_changed'))
    const [event] = sdkMessageToEvents(commands)
    expect(event?.type).toBe('commands')
    expect(event?.type === 'commands' && event.slashCommands).toContain('cloudflare')
  })

  it('turns a subagent start and its task-notification into subagent events', () => {
    // Shapes from sdk.d.ts (SDKTaskStartedMessage, SDKTaskNotificationMessage): ticket 06 did not
    // start a subagent, so no fixture has them.
    const started = { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_1', description: 'Map the IPC layer', subagent_type: 'scout', uuid: 'u', session_id: 's' }
    expect(sdkMessageToEvents(started)).toEqual([
      { type: 'subagent', phase: 'started', taskId: 't1', toolUseId: 'toolu_1', description: 'Map the IPC layer', subagentType: 'scout', status: null, summary: null },
    ])
    const finished = { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', output_file: '/tmp/x', summary: 'done', uuid: 'u', session_id: 's' }
    expect(sdkMessageToEvents(finished)).toEqual([
      { type: 'subagent', phase: 'finished', taskId: 't1', toolUseId: null, description: null, subagentType: null, status: 'completed', summary: 'done' },
    ])
  })

  it.each(allFixtures)('maps every message of %s without unknown events or exceptions', (name) => {
    for (const message of fixture(name)) {
      const events = sdkMessageToEvents(message)
      expect(
        events.filter((e) => e.type === 'unknown'),
        JSON.stringify(message).slice(0, 200),
      ).toEqual([])
      // Each event is already in the shape the IPC contract describes.
      for (const event of events) expect(agentEvent.parse(event)).toEqual(event)
    }
  })

  it.each([
    ['an unknown type', { type: 'brand_new_message', session_id: 's' }, 'brand_new_message'],
    ['an unknown system subtype', { type: 'system', subtype: 'teleported', session_id: 's' }, 'system/teleported'],
    ['a known type in a shape that changed', { type: 'system', subtype: 'init', session_id: 42 }, 'system/init'],
    ['a value that is not an object', 'garbage', 'string'],
    ['null', null, 'null'],
  ])('turns %s into an unknown event instead of throwing', (_label, message, sdkType) => {
    expect(sdkMessageToEvents(message)).toEqual([{ type: 'unknown', sdkType }])
  })

  it('copies only the declared fields: extra SDK keys never reach the renderer', () => {
    const message = { ...first('stop-hook.jsonl', isSystem('init')), secret_token: 'leak-me' }
    expect(JSON.stringify(sdkMessageToEvents(message))).not.toContain('leak-me')
  })
})

describe('agent event schema', () => {
  const event: AgentEvent = { type: 'state', state: 'idle', error: null }

  it('rejects an event of the wrong shape', () => {
    expect(agentEvent.safeParse({ type: 'state', state: 'sleeping', error: null }).success).toBe(false)
    expect(agentEvent.safeParse({ type: 'result', subtype: 'success', isError: 'no' }).success).toBe(false)
  })

  it('strips keys the schema does not declare', () => {
    expect(agentEvent.parse({ ...event, extra: 'x' })).toStrictEqual(event)
  })
})
