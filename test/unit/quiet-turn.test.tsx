// The hint line item of a quiet turn (src/renderer/session/composer/QuietTurn.tsx, worfy-stuck-agents ticket
// 06), over the real renderer IPC client, the renderer's event store and a fake preload. Once main reports
// the running turn quiet (the `quiet` event, worfy-stuck-agents ticket 03) the line says for how long, in
// whole minutes, with Interrupt and Restart; with no quiet turn, and while the turn waits for a permission
// answer, there is no line. Interrupt asks `agent.interrupt`, as the Session's own button; Restart asks
// `agent.restart`, and the line shows the reason main gives when it restarted nothing. On a read-only screen
// the buttons ask nothing. What main does on `agent.restart` is checked in test/contract/agent-session.test.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))
vi.mock('../../src/renderer/projects/read-only-now', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/read-only-now')>()),
  readOnlyNow: () => readOnly.hint,
}))

const SESSION = 'quiet-session'
const MIN = 60_000
/** 2026-11-17 12:00:00 local time: the clock of every test. */
const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime()
const REASON = '1 background task of this Session is still running, and a Restart would end it. Try again once it finishes.'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  answers: Record<string, () => Answer>
}

let main: FakeMain

function preload(): FakeMain {
  const fake: FakeMain = {
    calls: [],
    answers: {
      'agent.interrupt': () => ({ ok: true, value: { interrupted: true } }),
      'agent.restart': () => ({ ok: true, value: { restarted: true, reason: null } }),
    },
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      const answer = fake.answers[channel]
      return Promise.resolve((answer === undefined ? { ok: false, error: `no ${channel} here` } : answer()) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return fake
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  readOnly.hint = null
  main = preload()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetModules()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

async function accept(...events: AgentEvent[]) {
  const { acceptAgentEvent } = await import('../../src/renderer/session/store')
  act(() => {
    for (const event of events) acceptAgentEvent({ sessionId: SESSION, event })
  })
}

/** The item of the chat of SESSION, after `events` of it. */
async function mount(...events: AgentEvent[]) {
  const { default: QuietTurn } = await import('../../src/renderer/session/composer/QuietTurn')
  await accept(...events)
  render(<QuietTurn sessionId={SESSION} busy text="" setText={() => undefined} />)
  await settle()
}

const busy: AgentEvent = { type: 'state', state: 'busy', error: null }
const quiet = (minutes: number): AgentEvent => ({ type: 'quiet', quietSince: NOW - minutes * MIN })
const asked = (channel: string) => main.calls.filter((call) => call.channel === channel)

describe('the hint line of a quiet turn (worfy-stuck-agents ticket 06)', () => {
  it('a turn quiet past the mark: the line with its minutes, Interrupt and Restart; the minutes go on', async () => {
    await mount(busy, quiet(14))
    const line = screen.getByTestId('quiet-turn')
    expect(screen.getByTestId('quiet-turn-text').textContent).toBe('No sign of life for 14 min: no events, no hook, no output.')
    expect(line.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(MIN)
    })
    expect(screen.getByTestId('quiet-turn-text').textContent).toBe('No sign of life for 15 min: no events, no hook, no output.')
  })

  it('no line without a quiet turn, and none once the turn shows a sign of life', async () => {
    await mount(busy)
    expect(screen.queryByTestId('quiet-turn')).toBeNull()
    await accept(quiet(11))
    expect(screen.getByTestId('quiet-turn')).toBeTruthy()
    await accept({ type: 'quiet', quietSince: null })
    expect(screen.queryByTestId('quiet-turn')).toBeNull()
  })

  it('no line while the turn waits for a permission answer, nor once the turn ended', async () => {
    await mount(busy, quiet(14))
    await accept({ type: 'state', state: 'needs_permission', error: null })
    expect(screen.queryByTestId('quiet-turn')).toBeNull()
    await accept(busy, quiet(20))
    expect(screen.getByTestId('quiet-turn')).toBeTruthy()
    await accept({ type: 'state', state: 'idle', error: null })
    expect(screen.queryByTestId('quiet-turn')).toBeNull()
  })

  it('Interrupt asks agent.interrupt of the Session, as its own button does', async () => {
    await mount(busy, quiet(14))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await settle()
    expect(asked('agent.interrupt')).toEqual([{ channel: 'agent.interrupt', input: { sessionId: SESSION } }])
    expect(asked('agent.restart')).toEqual([])
  })

  it('Restart asks agent.restart of the Session; nothing more is shown when it restarted', async () => {
    await mount(busy, quiet(14))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await settle()
    expect(asked('agent.restart')).toEqual([{ channel: 'agent.restart', input: { sessionId: SESSION } }])
    expect(asked('agent.interrupt')).toEqual([])
    expect(screen.queryByTestId('quiet-turn-reason')).toBeNull()
  })

  it('a Restart that live background tasks keep from happening: the line shows the reason main gives', async () => {
    main.answers['agent.restart'] = () => ({ ok: true, value: { restarted: false, reason: REASON } })
    await mount(busy, quiet(14))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await settle()
    expect(screen.getByTestId('quiet-turn-reason').textContent).toBe(REASON)
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeTruthy()
  })

  it('a Restart main refuses: the line shows why', async () => {
    main.answers['agent.restart'] = () => ({ ok: false, error: 'agent.restart failed: An unattended Session is not restarted from here' })
    await mount(busy, quiet(14))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await settle()
    expect(screen.getByTestId('quiet-turn-reason').textContent).toContain('An unattended Session is not restarted from here')
  })

  it('on a read-only screen the buttons show and ask nothing', async () => {
    readOnly.hint = 'Read-only: this Machine only watches the Project'
    await mount(busy, quiet(14))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await settle()
    expect(main.calls).toEqual([])
  })

  it('stands on the hint line', async () => {
    const item = await import('../../src/renderer/session/composer/QuietTurn')
    expect(item.line).toBe('hint')
  })
})
