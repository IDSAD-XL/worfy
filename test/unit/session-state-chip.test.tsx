// The state chip of the Session view's header (src/renderer/session/SessionStateChip.tsx, the label from
// stateChip of src/renderer/session/format.ts): `busy` while a turn runs, and `busy · quiet N min` once main
// reports the turn quiet (the `quiet` event, worfy-stuck-agents ticket 06), N in whole minutes that go on by
// the clock. The renderer's event store takes the events as `agent.event` delivers them; no main process.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const SESSION = 'quiet-session'
const MIN = 60_000
/** 2026-11-17 12:00:00 local time: the clock of every test. */
const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  const bridge: WorfyBridge = {
    invoke: () => Promise.resolve({ ok: false, error: 'no main here' } as never),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetModules()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(state: 'busy' | 'idle' | 'needs_permission', events: AgentEvent[]) {
  const { acceptAgentEvent } = await import('../../src/renderer/session/store')
  const { SessionStateChip } = await import('../../src/renderer/session/SessionStateChip')
  for (const event of events) acceptAgentEvent({ sessionId: SESSION, event })
  const view = render(<SessionStateChip sessionId={SESSION} state={state} />)
  await act(async () => {
    vi.advanceTimersByTime(0)
  })
  return view
}

describe('the state chip of a Session (worfy-stuck-agents ticket 06)', () => {
  it('reads `busy · quiet 14 min` once main reports the turn quiet for 14 minutes, and the minutes go on', async () => {
    const view = await mount('busy', [{ type: 'state', state: 'busy', error: null }, { type: 'quiet', quietSince: NOW - 14 * MIN }])
    expect(view.container.textContent).toBe('busy · quiet 14 min')
    act(() => {
      vi.advanceTimersByTime(MIN)
    })
    expect(view.container.textContent).toBe('busy · quiet 15 min')
  })

  it('reads `busy` without a quiet turn, and again once the turn shows a sign of life', async () => {
    const view = await mount('busy', [{ type: 'state', state: 'busy', error: null }])
    expect(view.container.textContent).toBe('busy')
    const { acceptAgentEvent } = await import('../../src/renderer/session/store')
    act(() => acceptAgentEvent({ sessionId: SESSION, event: { type: 'quiet', quietSince: NOW - 12 * MIN } }))
    expect(view.container.textContent).toBe('busy · quiet 12 min')
    act(() => acceptAgentEvent({ sessionId: SESSION, event: { type: 'quiet', quietSince: null } }))
    expect(view.container.textContent).toBe('busy')
  })

  it('a state other than busy keeps its own label', async () => {
    await mount('needs_permission', [{ type: 'quiet', quietSince: NOW - 14 * MIN }])
    expect(screen.getByText('needs permission')).toBeTruthy()
    expect(screen.queryByText(/quiet/u)).toBeNull()
  })
})

describe('stateChip', () => {
  it('adds the quiet minutes to busy only', async () => {
    const { stateChip } = await import('../../src/renderer/session/format')
    expect(stateChip('busy', 14)).toEqual({ status: 'working', label: 'busy · quiet 14 min' })
    expect(stateChip('busy', null)).toEqual({ status: 'working', label: 'busy' })
    expect(stateChip('idle', 14)).toEqual({ status: 'ready', label: 'idle' })
  })
})
