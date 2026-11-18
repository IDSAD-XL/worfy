// The window «Quitting worfy» (src/renderer/shell/QuittingDialog.tsx, worfy-continuity ticket 04) over a fake bridge:
// nothing while main does not quit; the calls main waits for, with the time left that counts down by the window's
// clock; Quit now asks main to quit at once; the stage that stops the agents has no Quit now; a change that came
// before the answer to the window's first read is not overwritten by that older answer.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { QuitGraceView } from '../../src/shared/ipc/quit-grace'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const WAITING: QuitGraceView = { stage: 'waiting', calls: [{ id: 'toolu_1', description: 'git push origin demo/01' }], total: 3, leftMs: 60_000 }

let invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<Answer>>>
let handlers: Map<string, (payload: unknown) => void>
let stateAnswer: Promise<Answer>

beforeEach(() => {
  vi.resetModules()
  handlers = new Map()
  stateAnswer = Promise.resolve({ ok: true, value: null })
  invoke = vi.fn((channel: string) => {
    if (channel === 'quitGrace.state') return stateAnswer
    if (channel === 'quitGrace.quitNow') return Promise.resolve({ ok: true, value: undefined })
    return Promise.resolve({ ok: false, error: `${channel}: not in this test` })
  })
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke,
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(): Promise<void> {
  const { QuittingDialog } = await import('../../src/renderer/shell/QuittingDialog')
  render(<QuittingDialog />)
  await act(async () => {
    await stateAnswer
  })
}

const change = (view: QuitGraceView): void =>
  act(() => {
    handlers.get('quitGrace.changed')?.(view)
  })

describe('the window «Quitting worfy»', () => {
  it('shows nothing while main does not quit', async () => {
    await mount()
    expect(screen.queryByTestId('quitting-worfy')).toBeNull()
  })

  it('names the calls main waits for, the ones beyond the list as a count, and the time left; Quit now asks main to quit at once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    await mount()
    change(WAITING)
    expect(screen.getByRole('heading', { name: 'Quitting worfy' })).toBeTruthy()
    expect(screen.getByTestId('quitting-worfy-calls').textContent).toBe('git push origin demo/01and 2 more')
    expect(screen.getByTestId('quitting-worfy-left').textContent).toContain('worfy quits in 1:00 at the latest')
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByTestId('quitting-worfy-left').textContent).toContain('worfy quits in 0:55 at the latest')
    fireEvent.click(screen.getByTestId('quitting-worfy-quit-now'))
    expect(invoke.mock.calls.filter(([channel]) => channel === 'quitGrace.quitNow')).toHaveLength(1)
  })

  it('while the agents are stopped: no list, no time, and Quit now is disabled; the window closes with a null view', async () => {
    await mount()
    change({ stage: 'stopping', calls: [], total: 0, leftMs: 0 })
    expect(screen.getByTestId('quitting-worfy-stopping').textContent).toBe('Stopping the agents…')
    expect(screen.queryByTestId('quitting-worfy-calls')).toBeNull()
    expect((screen.getByTestId('quitting-worfy-quit-now') as HTMLButtonElement).disabled).toBe(true)
    change(null)
    expect(screen.queryByTestId('quitting-worfy')).toBeNull()
  })

  it('a change before the answer to the first read wins over that older answer', async () => {
    let answer: (value: Answer) => void = () => undefined
    stateAnswer = new Promise((done) => (answer = done))
    const { QuittingDialog } = await import('../../src/renderer/shell/QuittingDialog')
    render(<QuittingDialog />)
    change(WAITING)
    await act(async () => {
      answer({ ok: true, value: null })
      await stateAnswer
    })
    expect(screen.getByTestId('quitting-worfy')).toBeTruthy()
  })
})
