// The popovers of the composer during an agent turn (worfy-ui-kit ticket 10, ADR-0106 item 7): Queued
// messages (session/composer/Queue.tsx) and Effort (session/composer/Pickers.tsx) are Popovers of the kit
// under the message field (session/MessageInput.tsx), whose Esc interrupts a busy Session. One press, one
// action: Esc in an open popover closes it, gives the focus back to its button and does not interrupt
// the turn; the next Esc in the field does. A press outside closes the list too. The ProductSessionPanel
// shows neither popover (product-session.ts, PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS), so it has no case here.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { SessionSettings } from '../../src/shared/agent/settings'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const DEFAULTS: SessionSettings = { model: null, effort: null, permissionMode: 'bypassPermissions' }
const MODELS = [{ value: null, displayName: 'Default (recommended)', efforts: ['low', 'medium', 'high'] }]

const handlers = new Map<string, (payload: unknown) => void>()

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  const answers: Record<string, () => unknown> = {
    'agent.controls': () => ({ settings: DEFAULTS, queue: { items: [], paused: false } }),
    'agent.models': () => ({ models: MODELS }),
    'agent.capabilities': () => undefined,
  }
  const bridge = {
    invoke: (channel: string) => {
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer() } : { ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const emit = (event: AgentEvent) => act(() => handlers.get('agent.event')?.({ sessionId: 's', event }))
/** Lets Base UI's effects and timers run: the focus goes in and back after the event. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

/** A pointer press as a browser sends it: Base UI hears a press outside by its pointerdown. */
function press(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

/** The message field of Session `s` with an agent turn running and two messages queued after it. */
async function mountBusy() {
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  const onInterrupt = vi.fn()
  render(<MessageInput sessionId="s" busy history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={onInterrupt} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  emit({ type: 'settings', settings: DEFAULTS })
  emit({ type: 'queue', items: [{ id: 'q1', text: 'first' }, { id: 'q2', text: 'second' }], paused: false })
  const field = screen.getByRole('textbox', { name: 'Message Orchestrator' })
  return { field, onInterrupt }
}

describe('Esc in a popover of the composer while the agent works', () => {
  it('Queued messages: the focus goes in; Esc closes the list and gives the focus back to the chip, the turn goes on; the next Esc in the field interrupts', async () => {
    const { field, onInterrupt } = await mountBusy()
    const chip = screen.getByTestId('queue-chip')
    act(() => chip.focus())
    press(chip)
    await settle()
    const list = screen.getByRole('dialog', { name: 'Queued messages' })
    expect(list.getAttribute('data-testid')).toBe('queue-list')
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(list.contains(document.activeElement)).toBe(true)

    const pressed = fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await settle()
    expect(pressed).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Queued messages' })).toBeNull()
    expect(document.activeElement).toBe(chip)
    expect(onInterrupt).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  it('Queued messages: a press outside closes the list, and the turn goes on', async () => {
    const { onInterrupt } = await mountBusy()
    press(screen.getByTestId('queue-chip'))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Queued messages' })).toBeTruthy()
    press(document.body)
    await settle()
    expect(screen.queryByRole('dialog', { name: 'Queued messages' })).toBeNull()
    expect(onInterrupt).not.toHaveBeenCalled()
  })

  it('Effort: Esc on the slider closes the popover and gives the focus back to the button, the turn goes on; the next Esc in the field interrupts', async () => {
    const { field, onInterrupt } = await mountBusy()
    const button = screen.getByTestId<HTMLButtonElement>('picker-effort')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    press(button)
    await settle()
    const slider = screen.getByTestId('effort-slider')
    expect(document.activeElement).toBe(slider)

    fireEvent.keyDown(slider, { key: 'Escape' })
    await settle()
    expect(screen.queryByTestId('effort-popover')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(onInterrupt).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })
})
