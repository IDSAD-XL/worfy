import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { joinPastAndLive } from '../../src/renderer/session/store'

// The turns a resumed Session had before (its transcript file) joined with the live events of the
// Session (worfy-daily ticket 22): a turn that is in both shows once.

const user = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const text = (messageId: string, body: string): AgentEvent => ({ type: 'text', text: body, messageId, parentToolUseId: null, synthetic: false })
const toolUse = (id: string): AgentEvent => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' }, parentToolUseId: null })
const toolResult = (toolUseId: string): AgentEvent => ({ type: 'tool_result', toolUseId, content: 'ok', isError: false, parentToolUseId: null })
const delta = (body: string): AgentEvent => ({ type: 'delta', kind: 'text', text: body, parentToolUseId: null })
const init: AgentEvent = {
  type: 'init',
  sdkSessionId: 's',
  model: 'claude-opus-5-5',
  permissionMode: 'default',
  apiKeySource: 'none',
  cwd: '/p',
  claudeCodeVersion: null,
  slashCommands: [],
}
const result: AgentEvent = {
  type: 'result',
  subtype: 'success',
  isError: false,
  error: null,
  text: 'Third answer',
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted: false,
}

/** Two turns from before Resume. */
const before: AgentEvent[] = [user('First question'), text('msg_1', 'First answer'), user('Second question'), toolUse('tool_1'), toolResult('tool_1'), text('msg_2', 'Second answer')]
/** The turn after Resume, as the live Session brings it. */
const liveTurn: AgentEvent[] = [user('go on'), init, delta('Third '), toolUse('tool_3'), toolResult('tool_3'), text('msg_3', 'Third answer'), result]
/** The same turn as the transcript file records it. */
const writtenTurn: AgentEvent[] = [user('go on'), toolUse('tool_3'), toolResult('tool_3'), text('msg_3', 'Third answer')]

describe('joinPastAndLive', () => {
  it('shows the turns before Resume first, then the live ones', () => {
    expect(joinPastAndLive(before, liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows a turn that is in the transcript and in the live events once, from the live events', () => {
    expect(joinPastAndLive([...before, ...writtenTurn], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a turn whose prompt the transcript has and whose answer it does not have yet', () => {
    expect(joinPastAndLive([...before, user('go on')], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a turn the transcript has only partly written', () => {
    expect(joinPastAndLive([...before, user('go on'), toolUse('tool_3')], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once every live turn the transcript has, a later turn after a turn without an answer too', () => {
    const failed: AgentEvent[] = [user('try'), init]
    const live = [...failed, ...liveTurn]
    expect(joinPastAndLive([...before, user('try'), ...writtenTurn], live)).toEqual([...before, ...live])
  })

  it('shows once a turn whose prompt the transcript follows with an event the live events do not have', () => {
    const notice: AgentEvent = { type: 'notice', kind: 'synthetic', text: 'Hook context' }
    expect(joinPastAndLive([...before, user('go on'), notice, ...writtenTurn.slice(1)], liveTurn)).toEqual([...before, ...liveTurn])
  })

  it('shows once a slash command the transcript records as a command', () => {
    const live: AgentEvent[] = [user('/compact now'), init, text('msg_4', 'Compacted')]
    const written: AgentEvent[] = [{ type: 'command', name: '/compact', args: 'now' }, text('msg_4', 'Compacted')]
    expect(joinPastAndLive([...before, ...written], live)).toEqual([...before, ...live])
  })

  it('keeps a turn before Resume whose prompt reads like a live one but which has an answer', () => {
    const past = [...before, user('go on'), text('msg_old', 'Old answer')]
    expect(joinPastAndLive(past, liveTurn)).toEqual([...past, ...liveTurn])
  })

  it('shows once a prompt with an image, which the live events name and the transcript sends as a block of its own', () => {
    const live: AgentEvent[] = [user('look\n\nAttached images: a.png'), init, text('msg_5', 'A cat')]
    expect(joinPastAndLive([...before, user('look')], live)).toEqual([...before, ...live])
    expect(joinPastAndLive([...before, user('look'), text('msg_5', 'A cat')], live)).toEqual([...before, ...live])
  })

  it('shows once a prompt with files, whose line both the live events and the transcript have', () => {
    const prompt = 'read these\n\nAttached files: /p/a.md'
    const live: AgentEvent[] = [user(prompt), init, text('msg_6', 'Read')]
    expect(joinPastAndLive([...before, user(prompt)], live)).toEqual([...before, ...live])
  })

  it('keeps a prompt from before Resume that an interruption closed, when the live turn has the same text', () => {
    const past = [...before, user('hi'), user('[Request interrupted by user]')]
    const live: AgentEvent[] = [user('hi'), init, text('msg_7', 'Hello')]
    expect(joinPastAndLive(past, live)).toEqual([...past, ...live])
    expect(joinPastAndLive([...past, user('hi'), text('msg_7', 'Hello')], live)).toEqual([...past, ...live])
  })

  it('takes from the transcript only as many prompts as the live events open with', () => {
    const live: AgentEvent[] = [user('hi'), init, text('msg_8', 'Hello')]
    expect(joinPastAndLive([...before, user('hi'), user('hi'), text('msg_8', 'Hello')], live)).toEqual([...before, user('hi'), ...live])
  })

  it('cannot tell a prompt from before Resume without answer or interruption from the same live one, and shows it once', () => {
    // A known gap: nothing in the file tells the two apart.
    const live: AgentEvent[] = [user('hi'), init, text('msg_9', 'Hello')]
    expect(joinPastAndLive([...before, user('hi')], live)).toEqual([...before, ...live])
  })

  it('keeps every turn before Resume when no live event has come yet', () => {
    expect(joinPastAndLive(before, [])).toEqual(before)
  })

  it('shows only the live events while there is no transcript', () => {
    expect(joinPastAndLive([], liveTurn)).toEqual(liveTurn)
  })

  it('shows once a live turn the transcript has entirely, when the live events start in its middle', () => {
    // The oldest live events were dropped (KEEP_EVENTS): the transcript still has the whole turn.
    const live = liveTurn.slice(3)
    expect(joinPastAndLive([...before, ...writtenTurn], live)).toEqual([...before, user('go on'), ...live])
  })
})
