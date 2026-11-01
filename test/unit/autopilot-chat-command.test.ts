// The Autopilot command typed in a chat (worfy-flight-recorder ticket 22): which messages are a
// command, with what Epic and Tickets, and which go to the agent as before. The Russian forms are
// the older forms of the Harness skill epic-wave, which the command still takes.
import { describe, expect, it } from 'vitest'
import { CHAT_COMMAND_TOAST, chatCommandToast, chatStartedText, parseChatCommand, type ChatCommand } from '../../src/shared/autopilot/chat-command'
import { MAX_NAMED_TICKETS } from '../../src/shared/ipc/autopilot'

describe('parseChatCommand', () => {
  it.each<[string, ChatCommand]>([
    ['/worfy:epic-wave tickets 05, 06 of epic demo', { kind: 'tickets', epic: 'demo', tickets: [5, 6] }],
    ['/worfy:epic-wave tickets 01 of epic worfy-flight-recorder', { kind: 'tickets', epic: 'worfy-flight-recorder', tickets: [1] }],
    ['  /worfy:epic-wave   Tickets 7,8 ,9  of  Epic demo_2.x \n', { kind: 'tickets', epic: 'demo_2.x', tickets: [7, 8, 9] }],
    ['/worfy:epic-wave tickets 06, 05, 06 of epic demo', { kind: 'tickets', epic: 'demo', tickets: [6, 5] }],
    ['/worfy:epic-wave wave 2 of epic demo', { kind: 'wave', epic: 'demo', wave: 2 }],
    ['/worfy:epic-wave run wave 12 of epic demo', { kind: 'wave', epic: 'demo', wave: 12 }],
    ['/worfy:epic-wave epic demo', { kind: 'epic', epic: 'demo', bare: false }],
    ['/worfy:epic-wave demo', { kind: 'epic', epic: 'demo', bare: true }],
    // The older forms of the skill, still in old transcripts and saved templates.
    ['/worfy:epic-wave Ticket-ы 05, 06 эпика demo', { kind: 'tickets', epic: 'demo', tickets: [5, 6] }],
    ['/worfy:epic-wave ticket-ы 11 эпика worfy-guide', { kind: 'tickets', epic: 'worfy-guide', tickets: [11] }],
    ['/worfy:epic-wave волна 3 эпика demo', { kind: 'wave', epic: 'demo', wave: 3 }],
    ['/worfy:epic-wave Волна 3 эпика demo', { kind: 'wave', epic: 'demo', wave: 3 }],
    // A sentence's closing mark is not part of the Epic's name.
    ['/worfy:epic-wave tickets 05 of epic demo.', { kind: 'tickets', epic: 'demo', tickets: [5] }],
    ['/worfy:epic-wave wave 2 of epic worfy-guide!?', { kind: 'wave', epic: 'worfy-guide', wave: 2 }],
    ['/worfy:epic-wave demo.', { kind: 'epic', epic: 'demo', bare: true }],
  ])('%j is a command', (text, command) => {
    expect(parseChatCommand(text)).toEqual(command)
  })

  it.each([
    '/worfy:epic-wave resume after a session break',
    '/worfy:epic-wave tickets 05, 06 of epic demo depth medium',
    '/worfy:epic-wave tickets of epic demo',
    '/worfy:epic-wave wave two of epic demo',
    '/worfy:epic-wave tickets 05 06 of epic demo',
    '/worfy:epic-wave tickets 05, 06 of epic ../demo',
    '/worfy:epic-wave',
    '/worfy:epic-wave   ',
    '/worfy:epic-waves demo',
    '/worfy:epic-wavedemo',
    '/epic-wave tickets 05 of epic demo',
    'please run /worfy:epic-wave tickets 05 of epic demo',
    'tickets 05, 06 of epic demo',
    'hello',
    '',
  ])('%j is not a command', (text) => {
    expect(parseChatCommand(text)).toBeNull()
  })

  it('takes as many Tickets as a run takes, and no more', () => {
    const list = (count: number) => Array.from({ length: count }, (_, at) => at + 1).join(', ')
    expect(parseChatCommand(`/worfy:epic-wave tickets ${list(MAX_NAMED_TICKETS)} of epic demo`)).toMatchObject({ kind: 'tickets' })
    expect(parseChatCommand(`/worfy:epic-wave tickets ${list(MAX_NAMED_TICKETS + 1)} of epic demo`)).toBeNull()
  })
})

describe('chatCommandToast', () => {
  it('a start is a success, a start after the turn a note, a refusal an error; one toast for all of them', () => {
    expect(chatCommandToast({ kind: 'started', message: chatStartedText('demo') })).toEqual({
      kind: 'success',
      text: 'Autopilot started on Epic demo',
      key: CHAT_COMMAND_TOAST,
      testId: CHAT_COMMAND_TOAST,
    })
    expect(chatCommandToast({ kind: 'after-turn', message: 'Autopilot starts after this turn' })).toMatchObject({ kind: 'info', text: 'Autopilot starts after this turn' })
    expect(chatCommandToast({ kind: 'refused', message: 'Autopilot is already running Epic demo. Stop it first.' })).toMatchObject({
      kind: 'error',
      text: 'Autopilot is already running Epic demo. Stop it first.',
    })
  })
})
