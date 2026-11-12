// The countdown of Auto-continue over the Orchestrator's input field (src/renderer/session/composer/
// ContinueCountdown.tsx, worfy-retry ticket 07) over the real renderer IPC client and a fake preload.
// Three kinds of line — a retry after an API error with Retry now and Cancel, the Limits with a window
// and without one with Cancel only — counting down by the second in local time; nothing while nothing
// waits, and nothing in a regular Session. The buttons ask main (`autoContinue.retryNow`,
// `autoContinue.cancel`); on a read-only screen they ask nothing. A change of the wait in main
// (`autoContinue.waitChanged`, or the run's `autopilot.changed`) has the line read it again. What main
// answers is checked in test/contract/auto-continue-setting.test.ts, the waits themselves in
// test/contract/orchestrator-continue.test.ts and test/contract/autopilot-retry.test.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContinueWaitView } from '../../src/shared/ipc/auto-continue'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))
vi.mock('../../src/renderer/projects/read-only-now', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/read-only-now')>()),
  readOnlyNow: () => readOnly.hint,
}))

const PROJECT = 'demo-0000000d'
const SESSION = 'orch-session'
/** 2026-11-07 12:00:00 local time: the clock of every test. */
const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime()

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  /** What each autoContinue.wait answers, in turn (the last one again once they run out). */
  waits: ContinueWaitView[]
  emit: (channel: string, payload: unknown) => void
}

let main: FakeMain

function preload(waits: ContinueWaitView[]): FakeMain {
  const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const fake: FakeMain = {
    calls: [],
    waits,
    emit: (channel, payload) => {
      for (const [, each] of listeners) if (each.channel === channel) each.handler(payload)
    },
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      switch (channel) {
        case 'autoContinue.wait':
          return Promise.resolve({ ok: true, value: fake.waits.length > 1 ? fake.waits.shift() : fake.waits[0] } as never)
        case 'autoContinue.retryNow':
        case 'autoContinue.cancel':
          return Promise.resolve({ ok: true, value: { done: true } } as never)
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
      }
    },
    on: (channel, handler) => {
      const id = next++
      listeners.set(id, { channel, handler })
      return id
    },
    off: (id) => {
      listeners.delete(id)
    },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return fake
}

const view = (sessionId: string): OrchestratorView => ({ projectId: PROJECT, nodeId: 'orch-node', sessionId, state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 })

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** The line in the chat of Session `sessionId`, the window knowing the Orchestrator of PROJECT and its live Session SESSION. */
async function mount(sessionId: string | null = SESSION) {
  const { acceptOrchestratorView } = await import('../../src/renderer/canvas/nodes/orchestrator-view')
  const { default: ContinueCountdown } = await import('../../src/renderer/session/composer/ContinueCountdown')
  acceptOrchestratorView(view(SESSION))
  render(<ContinueCountdown sessionId={sessionId} busy={false} text="" setText={() => undefined} />)
  await settle()
}

const hhmm = (at: number): string => `${String(new Date(at).getHours()).padStart(2, '0')}:${String(new Date(at).getMinutes()).padStart(2, '0')}`
const asked = (channel: string) => main.calls.filter((call) => call.channel === channel)

const RETRY: ContinueWaitView = { kind: 'retry', attempt: 2, of: 5, error: 'overloaded', at: NOW + (4 * 60 + 12) * 1000, source: 'manual' }
const LIMITS: ContinueWaitView = { kind: 'limits', window: '7-day', at: NOW + (2 * 3600 + 13 * 60 + 5) * 1000, source: 'run' }
const NO_WINDOW: ContinueWaitView = { kind: 'limits', window: null, at: NOW + (27 * 60 + 40) * 1000, source: 'manual' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  readOnly.hint = null
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetModules()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the format of the countdown', () => {
  it('m:ss under an hour, h:mm:ss from an hour on, 0:00 once the time has passed; local time, with the date on another day', async () => {
    const { countdownText, localTime } = await import('../../src/shared/ipc/auto-continue')
    expect(countdownText(NOW + 252_000, NOW)).toBe('4:12')
    expect(countdownText(NOW + 1_660_000, NOW)).toBe('27:40')
    expect(countdownText(NOW + 7_985_000, NOW)).toBe('2:13:05')
    expect(countdownText(NOW + 3_600_000, NOW)).toBe('1:00:00')
    expect(countdownText(NOW + 59_001, NOW)).toBe('1:00')
    expect(countdownText(NOW + 5_000, NOW)).toBe('0:05')
    expect(countdownText(NOW, NOW)).toBe('0:00')
    expect(countdownText(NOW - 10_000, NOW)).toBe('0:00')
    expect(countdownText(NOW + 74 * 3_600_000, NOW)).toBe('74:00:00')
    expect(localTime(new Date(2026, 10, 7, 14, 20).getTime(), NOW)).toBe('14:20')
    expect(localTime(new Date(2026, 10, 9, 9, 5).getTime(), NOW)).toBe('2026-11-09 09:05')
  })
})

describe("the countdown in the Orchestrator's chat (worfy-retry ticket 07)", () => {
  it('a retry after an API error: the error, the retry of the count and the time left, with Retry now and Cancel; it counts down by the second', async () => {
    main = preload([RETRY])
    await mount()
    const line = screen.getByTestId('continue-countdown')
    expect(line.getAttribute('data-kind')).toBe('retry')
    expect(screen.getByTestId('continue-countdown-text').textContent).toBe('API error 529 (overloaded) · retry 2 of 5 in 4:12')
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(asked('autoContinue.wait')).toEqual([{ channel: 'autoContinue.wait', input: { projectId: PROJECT } }])

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('continue-countdown-text').textContent).toBe('API error 529 (overloaded) · retry 2 of 5 in 4:11')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('continue-countdown-text').textContent).toBe('API error 529 (overloaded) · retry 2 of 5 in 3:11')
  })

  it('the other errors by their words', async () => {
    const words = { 'api-500': 'API error 500', 'api-503': 'API error 503', connection: 'API connection lost', timeout: 'API request timed out', stream: 'API response stream broke off' } as const
    const { countdownLine } = await import('../../src/shared/ipc/auto-continue')
    for (const [error, text] of Object.entries(words)) {
      expect(countdownLine({ kind: 'retry', attempt: 1, of: 5, error: error as keyof typeof words, at: NOW + 60_000, source: 'run' }, NOW)).toBe(`${text} · retry 1 of 5 in 1:00`)
    }
  })

  it('the Limits with a window: its label, the local time it resumes and the time left, with Cancel only', async () => {
    main = preload([LIMITS])
    await mount()
    expect(screen.getByTestId('continue-countdown').getAttribute('data-kind')).toBe('limits')
    expect(screen.getByTestId('continue-countdown-text').textContent).toBe(`Limits: 7-day window · resumes ${hhmm(LIMITS!.at)} (in 2:13:05)`)
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('title')).toBe('Stop waiting: the run stops')
  })

  it('the Limits with no reset time reported: the next try and the time left, with Cancel only', async () => {
    main = preload([NO_WINDOW])
    await mount()
    expect(screen.getByTestId('continue-countdown-text').textContent).toBe('Limits: no reset time reported · next try in 27:40')
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('title')).toBe('Stop waiting: nothing is sent')
  })

  it('nothing waits: no line', async () => {
    main = preload([null])
    await mount()
    expect(asked('autoContinue.wait')).toHaveLength(1)
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
  })

  it('a regular Session: no line, and main is not asked', async () => {
    main = preload([RETRY])
    await mount('regular-session')
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
    expect(main.calls).toEqual([])
    await mount(null)
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
    expect(main.calls).toEqual([])
  })

  it('Retry now and Cancel ask main for the Project, and the wait is read again after each', async () => {
    main = preload([RETRY, RETRY, null])
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await settle()
    expect(asked('autoContinue.retryNow')).toEqual([{ channel: 'autoContinue.retryNow', input: { projectId: PROJECT } }])
    expect(asked('autoContinue.wait')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(asked('autoContinue.cancel')).toEqual([{ channel: 'autoContinue.cancel', input: { projectId: PROJECT } }])
    expect(asked('autoContinue.wait')).toHaveLength(3)
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
  })

  it('on a read-only screen the buttons show with the hint and ask nothing', async () => {
    readOnly.hint = 'Read only: Mini gave this Machine read access'
    main = preload([RETRY])
    await mount()
    for (const name of ['Retry now', 'Cancel']) {
      const button = screen.getByRole('button', { name })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.getAttribute('data-kit-hint')).toBe(readOnly.hint)
      fireEvent.click(button)
    }
    await settle()
    expect(asked('autoContinue.retryNow')).toEqual([])
    expect(asked('autoContinue.cancel')).toEqual([])
  })

  it("a change in main reads the wait again: a manual wait's waitChanged, a run's autopilot.changed; another Project's changes do not", async () => {
    main = preload([null, RETRY, LIMITS, null])
    await mount()
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
    act(() => main.emit('autoContinue.waitChanged', { projectId: 'other-0000000e', wait: RETRY }))
    act(() => main.emit('autopilot.changed', { projectId: 'other-0000000e' }))
    await settle()
    expect(asked('autoContinue.wait')).toHaveLength(1)

    act(() => main.emit('autoContinue.waitChanged', { projectId: PROJECT, wait: RETRY }))
    await settle()
    expect(screen.getByTestId('continue-countdown').getAttribute('data-kind')).toBe('retry')
    act(() => main.emit('autopilot.changed', { projectId: PROJECT }))
    await settle()
    expect(screen.getByTestId('continue-countdown').getAttribute('data-kind')).toBe('limits')
    act(() => main.emit('autoContinue.waitChanged', { projectId: PROJECT, wait: null }))
    await settle()
    expect(screen.queryByTestId('continue-countdown')).toBeNull()
    expect(asked('autoContinue.wait')).toHaveLength(4)
  })
})
