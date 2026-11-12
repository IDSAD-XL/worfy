// Esc in the chat's message field (session/MessageInput.tsx, worfy-ui-kit ticket 02): one press, one
// action. A popup of the field that already took the press (it called preventDefault) closes, and the
// agent's turn goes on; a bare Esc during a turn interrupts it, as before.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const undo: (() => void)[] = []

beforeEach(() => {
  vi.resetModules()
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
      if (channel === 'agent.commands') return Promise.resolve({ ok: true, value: { commands: [] } })
      return Promise.resolve({ ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  for (const each of undo.splice(0)) each()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(busy: boolean) {
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  const interrupt = vi.fn()
  render(<MessageInput sessionId="s" busy={busy} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={interrupt} />)
  const field = screen.getByRole('textbox', { name: 'Message Orchestrator' })
  /** Presses Esc in the field; true when nothing took it (its default was not prevented). */
  const escape = async (): Promise<boolean> => {
    let free = true
    await act(async () => {
      free = fireEvent.keyDown(field, { key: 'Escape' })
    })
    return free
  }
  return { interrupt, escape }
}

/** A popup of the field that closes on Esc and marks the press as taken before the field sees it. */
function popupTakesEscape(): void {
  const take = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') event.preventDefault()
  }
  document.addEventListener('keydown', take, true)
  undo.push(() => document.removeEventListener('keydown', take, true))
}

describe('Esc in the message field', () => {
  it('a press a popup of the field already took does not interrupt the turn', async () => {
    const { interrupt, escape } = await mount(true)
    popupTakesEscape()
    expect(await escape()).toBe(false)
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('a bare Esc while the agent is busy interrupts the turn, as before', async () => {
    const { interrupt, escape } = await mount(true)
    expect(await escape()).toBe(false)
    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it('Esc with the agent idle interrupts nothing and stays free', async () => {
    const { interrupt, escape } = await mount(false)
    expect(await escape()).toBe(true)
    expect(interrupt).not.toHaveBeenCalled()
  })
})
