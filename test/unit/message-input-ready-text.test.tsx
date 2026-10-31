// The ready text of Getting started in a Session's input field (worfy-onboarding tickets 07 and 14):
// what the field records in pending-input.ts about it — `ready` while the step's text (or the user's
// edit of it) lies in the field, `offered` once the field is emptied, `sent` after any send from the
// field until a step's button offers a text again — so the Getting started ring never stays on the
// step's button while the turn it started runs.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { OutgoingMessage } from '../../src/renderer/session/MessageInput'

const NODE = 'orchestrator-node'
const QUESTION = 'What is planned in this project?'

beforeEach(() => {
  vi.resetModules()
  const answers: Record<string, unknown> = {
    'agent.commands': { commands: [] },
    'agent.controls': { settings: { model: null, effort: null, permissionMode: 'bypassPermissions' }, queue: { items: [], paused: false } },
    'agent.models': { models: [] },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => Promise.resolve(channel in answers ? { ok: true, value: answers[channel] } : { ok: false, error: `no ${channel}` }),
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** The field of Node NODE, with `onSend` answering each send; the pending-input module the field uses. */
async function mount(onSend: (message: OutgoingMessage) => Promise<string | null> = () => Promise.resolve(null)) {
  const pending = await import('../../src/renderer/session/pending-input')
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  const send = vi.fn(onSend)
  render(<MessageInput nodeId={NODE} sessionId="s" busy={false} history={[]} recipient="Orchestrator" onSend={send} onInterrupt={() => undefined} />)
  const field = screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement
  const type = async (value: string) => {
    await act(async () => {
      fireEvent.change(field, { target: { value } })
    })
  }
  const offer = async (text: string) => {
    await act(async () => {
      pending.setPendingInput(NODE, text)
    })
  }
  const clickSend = async () => {
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-send'))
    })
  }
  const phase = () => pending.usePendingInput.getState().fields[NODE]
  return { field, send, type, offer, clickSend, phase, pending }
}

describe('the ready text of a step in the input field', () => {
  it('a text offered before the field opens is put in and marked ready; the Send button names its Node', async () => {
    const pending = await import('../../src/renderer/session/pending-input')
    pending.setPendingInput(NODE, QUESTION)
    expect(pending.usePendingInput.getState().fields[NODE]).toBe('offered')
    const { field, phase } = await mount()
    expect(field.value).toBe(QUESTION)
    expect(phase()).toBe('ready')
    const button = screen.getByTestId('input-send')
    expect(button.getAttribute('data-getting-started-target')).toBe('send')
    expect(button.getAttribute('data-getting-started-node')).toBe(NODE)
  })

  it('sending the ready text marks it sent', async () => {
    const { offer, clickSend, phase, send } = await mount()
    await offer(QUESTION)
    expect(phase()).toBe('ready')
    await clickSend()
    expect(send).toHaveBeenCalledWith({ text: QUESTION, attachments: [] })
    expect(phase()).toBe('sent')
  })

  it('the text edited, then offered again by the step button: the edit stays, ready again, and its send is marked sent', async () => {
    const { field, type, offer, clickSend, phase, send } = await mount()
    await offer(QUESTION)
    await type('What is planned here, briefly?')
    expect(phase()).toBe('ready')
    await offer(QUESTION)
    expect(field.value).toBe('What is planned here, briefly?')
    expect(phase()).toBe('ready')
    await clickSend()
    expect(send).toHaveBeenCalledWith({ text: 'What is planned here, briefly?', attachments: [] })
    expect(phase()).toBe('sent')
  })

  it('the field emptied by the user drops the ready mark; a text the user types then and sends is marked sent all the same', async () => {
    const { type, offer, clickSend, phase, send } = await mount()
    await offer(QUESTION)
    await type('')
    expect(phase()).toBe('offered')
    await type('Something of my own')
    expect(phase()).toBe('offered')
    await clickSend()
    expect(send).toHaveBeenCalledWith({ text: 'Something of my own', attachments: [] })
    expect(phase()).toBe('sent')
  })

  it('a send that fails brings the ready mark back with the text', async () => {
    const { field, offer, clickSend, phase } = await mount(() => Promise.resolve('The Session is not running'))
    await offer(QUESTION)
    await clickSend()
    expect(field.value).toBe(QUESTION)
    expect(phase()).toBe('ready')
  })

  it('after a send, a new offer starts again: the next step text is ready', async () => {
    const { field, offer, clickSend, phase } = await mount()
    await offer(QUESTION)
    await clickSend()
    expect(phase()).toBe('sent')
    await offer('/worfy:ship-ticket todo 01')
    expect(field.value).toBe('/worfy:ship-ticket todo 01')
    expect(phase()).toBe('ready')
  })

  it('a field with no offered text marks nothing when it sends', async () => {
    const { type, clickSend, phase } = await mount()
    await type('Hello')
    await clickSend()
    expect(phase()).toBeUndefined()
  })
})
