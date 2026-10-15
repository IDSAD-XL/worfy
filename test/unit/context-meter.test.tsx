// The context meter under the input field (src/renderer/session/composer/ContextMeter.tsx,
// worfy-polish ticket 23): a ring with the share of the autocompact window a Session uses, by the
// last `context` event main sent. The colour follows the levels of the Limits bars; the tooltip
// has the tokens, the window and the autocompact threshold, or "autocompact off". main is replaced
// by a bridge that delivers the events.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ContextUsage } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const handlers = new Map<string, (payload: unknown) => void>()

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  const bridge = {
    invoke: () => Promise.resolve({ ok: false, error: 'not in this test' }),
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

const emit = (sessionId: string, event: AgentEvent) => act(() => handlers.get('agent.event')?.({ sessionId, event }))

const usage = (change: Partial<ContextUsage> = {}): ContextUsage => ({
  percentage: 10,
  totalTokens: 20_000,
  windowTokens: 200_000,
  autoCompactThreshold: 167_000,
  autoCompactEnabled: true,
  ...change,
})

async function mount(sessionId: string | null = 's') {
  const { default: ContextMeter } = await import('../../src/renderer/session/composer/ContextMeter')
  return render(<ContextMeter sessionId={sessionId} busy={false} text="" setText={() => undefined} />)
}

const meter = () => screen.getByTestId('context-meter')
const value = () => screen.getByTestId('context-meter-value').textContent
const arc = () => screen.queryByTestId('context-meter-arc')
/** The share of the ring the arc covers, from its dash array. */
const arcShare = (): number => {
  const [dash, gap] = (arc()?.getAttribute('stroke-dasharray') ?? '0 1').split(' ').map(Number)
  return Math.round(((dash ?? 0) / (gap ?? 1)) * 100)
}

describe('the context meter', () => {
  it('shows no data until main reports the usage', async () => {
    await mount()
    expect(value()).toBe('no data')
    expect(meter().dataset.level).toBe('none')
    expect(meter().getAttribute('title')).toBe('Context window: no data')
    expect(meter().getAttribute('role')).toBeNull()
    expect(arc()).toBeNull()
  })

  it('fills the ring to the percentage and says it', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 42, totalTokens: 84_200 }) })
    expect(value()).toBe('42%')
    expect(arcShare()).toBe(42)
    expect(meter().getAttribute('role')).toBe('meter')
    expect(meter().getAttribute('aria-valuenow')).toBe('42')
  })

  it('a ring over the window is full, and says the real share', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 112, totalTokens: 224_000 }) })
    expect(value()).toBe('112%')
    expect(arcShare()).toBe(100)
  })

  it('takes the colour of the Limits levels: normal, nearer the threshold, at it', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 10, totalTokens: 20_000 }) })
    expect(meter().dataset.level).toBe('normal')
    expect(arc()?.getAttribute('stroke')).toBe('var(--text-secondary)')

    emit('s', { type: 'context', usage: usage({ percentage: 59, totalTokens: 118_000 }) })
    expect(meter().dataset.level).toBe('normal')

    emit('s', { type: 'context', usage: usage({ percentage: 75, totalTokens: 150_000 }) })
    expect(meter().dataset.level).toBe('working')
    expect(arc()?.getAttribute('stroke')).toBe('var(--working-dot)')

    emit('s', { type: 'context', usage: usage({ percentage: 95, totalTokens: 190_000 }) })
    expect(meter().dataset.level).toBe('blocked')
    expect(arc()?.getAttribute('stroke')).toBe('var(--blocked-ring)')
  })

  it('is at the threshold once the tokens reach the autocompact threshold, below the blocked share', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 84, totalTokens: 168_000, autoCompactThreshold: 167_000 }) })
    expect(meter().dataset.level).toBe('blocked')
    // With autocompact off the threshold does not count.
    emit('s', { type: 'context', usage: usage({ percentage: 84, totalTokens: 168_000, autoCompactEnabled: false }) })
    expect(meter().dataset.level).toBe('working')
  })

  it('has the tokens, the window and the threshold in its tooltip', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 42, totalTokens: 84_200 }) })
    expect(meter().getAttribute('title')).toBe('84.2K / 200K tokens · autocompact at 167K')

    emit('s', { type: 'context', usage: usage({ percentage: 9, totalTokens: 90_500, windowTokens: 1_000_000, autoCompactThreshold: 967_000 }) })
    expect(meter().getAttribute('title')).toBe('90.5K / 1M tokens · autocompact at 967K')
  })

  it('says "autocompact off" when Claude Code does not compact', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ autoCompactEnabled: false, autoCompactThreshold: null }) })
    expect(meter().getAttribute('title')).toBe('20K / 200K tokens · autocompact off')
  })

  it('goes back to no data when an ask failed', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage({ percentage: 42 }) })
    expect(value()).toBe('42%')
    emit('s', { type: 'context', usage: null })
    expect(value()).toBe('no data')
    expect(arc()).toBeNull()
  })

  it('shows its own Session only, and nothing without one', async () => {
    const view = await mount('s')
    emit('other', { type: 'context', usage: usage({ percentage: 80 }) })
    expect(value()).toBe('no data')
    view.unmount()
    await mount(null)
    expect(screen.queryByTestId('context-meter')).toBeNull()
  })

  it('keeps the usage of a Session that got its id from Claude Code', async () => {
    await mount('real')
    emit('pending-1', { type: 'context', usage: usage({ percentage: 33 }) })
    emit('real', { type: 'renamed', from: 'pending-1' })
    expect(value()).toBe('33%')
  })

  it('is not part of the transcript', async () => {
    await mount()
    emit('s', { type: 'context', usage: usage() })
    const { useSessionLogs } = await import('../../src/renderer/session/store')
    expect(useSessionLogs.getState().logs.s?.events).toEqual([])
  })
})
