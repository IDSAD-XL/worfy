// The translation of Agent SDK messages into worfy's events lives in the Claude driver's own module
// (src/shared/vendors/claude/events.ts, worfy-multi-vendor ticket 14). Every recorded SDK message
// (test/fixtures/sdk-messages/) gives the events it gave before the move:
// test/fixtures/sdk-events/claude.json was written by sdkMessageToEvents of src/shared/agent/events.ts
// before ticket 14, each message received at AT. It pins the translation: a change of the translation
// on purpose, or new recorded messages, write the record anew in the same pull request.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as model from '../../src/shared/agent/events'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'

const MESSAGES = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages')
const BEFORE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sdk-events', 'claude.json'), 'utf8')) as Record<string, unknown[]>
const AT = 1_790_000_000_000

const recorded = readdirSync(MESSAGES)
  .filter((name) => name.endsWith('.jsonl'))
  .sort()

describe('the Claude translation of SDK messages', () => {
  it('has a record of the events before the move for every recorded file, and only those', () => {
    expect(Object.keys(BEFORE).sort()).toEqual(recorded)
  })

  it.each(recorded)('%s gives the same events as before the move', (file) => {
    const messages = readFileSync(join(MESSAGES, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
    expect(messages.map((message) => sdkMessageToEvents(message, AT))).toEqual(BEFORE[file])
  })

  it('every event it gives is one of the model', () => {
    for (const events of Object.values(BEFORE)) for (const each of events.flat()) expect(model.agentEvent.safeParse(each).success).toBe(true)
  })

  describe('work worfy does not show is a sign of life, not a line of the transcript (worfy-stuck-agents ticket 03)', () => {
    const system = (subtype: string, fields: Record<string, unknown> = {}) => ({ type: 'system', subtype, uuid: 'u-1', session_id: 's-1', ...fields })
    const hook = { hook_id: 'hook-1', hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse' }

    it.each([
      ['hook_started', system('hook_started', hook), { id: 'hook-1', phase: 'running' }],
      ['hook_progress', system('hook_progress', { ...hook, stdout: '', stderr: '', output: '' }), { id: 'hook-1', phase: 'running' }],
      ['thinking_tokens', system('thinking_tokens', { estimated_tokens: 120, estimated_tokens_delta: 20 }), null],
    ])('%s gives an alive event, which stays in main', (_name, message, signed) => {
      const events = sdkMessageToEvents(message, AT)
      expect(events).toEqual([{ type: 'alive', hook: signed }])
      for (const event of events) {
        expect(model.agentEvent.safeParse(event).success).toBe(true)
        expect(model.isMainOnlyEvent(event)).toBe(true)
      }
    })

    it.each(['hook_started', 'hook_progress'])('a %s that names no hook run gives nothing, not an unknown event', (subtype) => {
      const unnamed = { hook_name: hook.hook_name, hook_event: hook.hook_event }
      expect(sdkMessageToEvents(system(subtype, unnamed), AT)).toEqual([])
    })

    it('a hook_response ends the hook run: a silent one gives only that, one that said something its hook event too', () => {
      const response = (fields: Record<string, unknown>) => system('hook_response', { ...hook, output: '', stdout: '', stderr: '', exit_code: 0, outcome: 'success', ...fields })
      expect(sdkMessageToEvents(response({}), AT)).toEqual([{ type: 'alive', hook: { id: 'hook-1', phase: 'ended' } }])
      expect(sdkMessageToEvents(response({ exit_code: 2, stderr: 'no', outcome: 'error' }), AT)).toEqual([
        { type: 'alive', hook: { id: 'hook-1', phase: 'ended' } },
        { type: 'hook', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', exitCode: 2, outcome: 'error', stdout: '', stderr: 'no' },
      ])
    })
  })

  it('leaves only the model in src/shared/agent/events.ts', () => {
    expect(Object.keys(model)).not.toContain('sdkMessageToEvents')
    expect(Object.keys(model)).not.toContain('toolResultText')
    expect(Object.keys(model)).not.toContain('contextUsageOf')
  })
})
