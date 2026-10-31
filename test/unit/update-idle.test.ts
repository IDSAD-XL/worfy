// "Nothing works" (worfy-update ticket 04, spec R6) over a fake Session registry and a fake
// Autopilot, and "Restart when idle" over them: the restart itself is a stand-in that only counts.
// No process is started, no app quits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SessionState } from '../../src/shared/agent/events'
import { idle, IdleWatch, IDLE_POLL_MS, type IdleSession } from '../../src/main/update/idle'
import { RestartIntent } from '../../src/main/update/restart'

/** A registry of Sessions the test sets, and the observers it tells of each event. */
function fakeWorld() {
  const sessions = new Map<string, IdleSession>()
  const observers = new Set<(sessionId: string, event: AgentEvent) => void>()
  let autopilot = false
  return {
    sources: {
      sessions: () => [...sessions.values()],
      autopilotRunning: () => autopilot,
    },
    observe: (listener: (sessionId: string, event: AgentEvent) => void) => {
      observers.add(listener)
      return () => observers.delete(listener)
    },
    observers,
    /** Sets a Session's state and tells the observers, as a Session does. */
    state(id: string, state: SessionState): void {
      const session = sessions.get(id) ?? { state, backgroundTasks: 0 }
      sessions.set(id, { ...session, state })
      for (const observer of observers) observer(id, { type: 'state', state, error: null })
    },
    tasks(id: string, count: number): void {
      const session = sessions.get(id) ?? { state: 'idle' as SessionState, backgroundTasks: 0 }
      sessions.set(id, { ...session, backgroundTasks: count })
      for (const observer of observers) observer(id, { type: 'background_tasks', tasks: [] })
    },
    autopilot(running: boolean): void {
      autopilot = running
    },
  }
}

describe('idle (spec R6)', () => {
  const quiet = { sessions: () => [], autopilotRunning: () => false }

  it('is false while a Session is busy or asks for a permission', () => {
    expect(idle({ ...quiet, sessions: () => [{ state: 'busy', backgroundTasks: 0 }] })).toBe(false)
    expect(idle({ ...quiet, sessions: () => [{ state: 'needs_permission', backgroundTasks: 0 }] })).toBe(false)
  })

  it('is false while an idle Session has a background task', () => {
    expect(idle({ ...quiet, sessions: () => [{ state: 'idle', backgroundTasks: 1 }] })).toBe(false)
  })

  it('is false while Autopilot runs', () => {
    expect(idle({ ...quiet, autopilotRunning: () => true })).toBe(false)
  })

  it('is true when all is quiet: idle, starting, closed and errored Sessions do not count', () => {
    const states: SessionState[] = ['idle', 'starting', 'closed', 'error']
    expect(idle({ ...quiet, sessions: () => states.map((state) => ({ state, backgroundTasks: 0 })) })).toBe(true)
    expect(idle(quiet)).toBe(true)
  })
})

describe('IdleWatch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tells its listener once per change, from the Sessions events', () => {
    const world = fakeWorld()
    const changes: boolean[] = []
    const watch = new IdleWatch({ sources: world.sources, observe: world.observe })
    const stop = watch.start()
    watch.subscribe((now) => changes.push(now))
    expect(watch.idle).toBe(true)

    world.state('s1', 'busy')
    world.state('s1', 'needs_permission')
    world.state('s1', 'busy')
    expect(changes).toEqual([false])
    world.state('s1', 'idle')
    expect(changes).toEqual([false, true])
    world.tasks('s1', 1)
    world.tasks('s1', 0)
    expect(changes).toEqual([false, true, false, true])
    // Events that change nothing tell nothing.
    world.state('s2', 'idle')
    expect(changes).toEqual([false, true, false, true])
    stop()
    expect(world.observers.size).toBe(0)
  })

  it('sees Autopilot at the next look, every 2 s, and not more often', () => {
    const world = fakeWorld()
    const looks = vi.fn(world.sources.autopilotRunning)
    const changes: boolean[] = []
    const watch = new IdleWatch({ sources: { ...world.sources, autopilotRunning: looks }, observe: world.observe })
    const stop = watch.start()
    watch.subscribe((now) => changes.push(now))
    expect(IDLE_POLL_MS).toBe(2000)
    const first = looks.mock.calls.length

    world.autopilot(true)
    vi.advanceTimersByTime(IDLE_POLL_MS - 1)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([false])
    vi.advanceTimersByTime(10 * IDLE_POLL_MS)
    // At most one look per 2 s by the timer.
    expect(looks.mock.calls.length - first).toBeLessThanOrEqual(11)
    world.autopilot(false)
    vi.advanceTimersByTime(IDLE_POLL_MS)
    expect(changes).toEqual([false, true])

    stop()
    const stopped = looks.mock.calls.length
    vi.advanceTimersByTime(10 * IDLE_POLL_MS)
    expect(looks.mock.calls.length).toBe(stopped)
  })

  it('keeps telling the others when one listener throws', () => {
    const world = fakeWorld()
    const watch = new IdleWatch({ sources: world.sources, observe: world.observe })
    const stop = watch.start()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const heard: boolean[] = []
    watch.subscribe(() => {
      throw new Error('a listener that fails')
    })
    watch.subscribe((now) => heard.push(now))
    world.state('s1', 'busy')
    expect(heard).toEqual([false])
    warn.mockRestore()
    stop()
  })
})

describe('Restart when idle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** The watch over a fake world and an intent whose restart only counts its calls. */
  function setUp() {
    const world = fakeWorld()
    const watch = new IdleWatch({ sources: world.sources, observe: world.observe })
    const stop = watch.start()
    const restartNow = vi.fn(() => Promise.resolve({ outcome: 'quitting' as const }))
    const intent = new RestartIntent({ idle: watch, restartNow })
    return { world, watch, stop, restartNow, intent }
  }

  it('does nothing while a Session is busy, then restarts once the turn ends, exactly once', async () => {
    const { world, intent, restartNow, stop } = setUp()
    world.state('s1', 'busy')
    vi.advanceTimersByTime(IDLE_POLL_MS)

    expect(await intent.arm()).toEqual({ outcome: 'waiting' })
    expect(intent.pending).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * IDLE_POLL_MS)
    expect(restartNow).not.toHaveBeenCalled()

    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    expect(intent.pending).toBe(false)

    // Busy and quiet again: the intent was used.
    world.state('s1', 'busy')
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(5 * IDLE_POLL_MS)
    expect(restartNow).toHaveBeenCalledTimes(1)
    stop()
  })

  it('restarts nothing after a cancel', async () => {
    const { world, intent, restartNow, stop } = setUp()
    world.state('s1', 'busy')
    await intent.arm()
    intent.cancel()
    expect(intent.pending).toBe(false)
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(5 * IDLE_POLL_MS)
    expect(restartNow).not.toHaveBeenCalled()
    stop()
  })

  it('arms once for two clicks: one restart', async () => {
    const { world, intent, restartNow, stop } = setUp()
    world.state('s1', 'busy')
    await intent.arm()
    await intent.arm()
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stays armed when the restart is refused because the Sessions worked again, and goes on the next quiet', async () => {
    const { world, intent, restartNow, stop } = setUp()
    // The Session begins a turn while the restart is asked for, which then refuses.
    restartNow.mockImplementationOnce(() => {
      world.state('s1', 'busy')
      return Promise.resolve({ outcome: 'refused', reason: 'a Session works', busy: true } as never)
    })
    world.state('s1', 'busy')
    await intent.arm()
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    expect(intent.pending).toBe(true)
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(2)
    expect(intent.pending).toBe(false)
    stop()
  })

  it('a quiet that came back while a refused restart was asked for restarts without a new change', async () => {
    const { world, intent, restartNow, stop } = setUp()
    restartNow.mockImplementationOnce(() => {
      world.state('s1', 'busy')
      world.state('s1', 'idle')
      return Promise.resolve({ outcome: 'refused', reason: 'a Session works', busy: true } as never)
    })
    world.state('s1', 'busy')
    await intent.arm()
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(2)
    expect(intent.pending).toBe(false)
    stop()
  })

  it('drops the intent when the restart is refused for another reason', async () => {
    const { world, intent, restartNow, stop } = setUp()
    restartNow.mockResolvedValueOnce({ outcome: 'refused', reason: 'no build is ready' } as never)
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    world.state('s1', 'busy')
    await intent.arm()
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(intent.pending).toBe(false)
    world.state('s1', 'busy')
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    error.mockRestore()
    stop()
  })

  it('a quiet that comes and goes while the restart is asked for starts no second one', async () => {
    const { world, intent, restartNow, stop } = setUp()
    let finish: (value: { outcome: 'quitting' }) => void = () => undefined
    restartNow.mockImplementationOnce(() => new Promise((done) => (finish = done)))
    world.state('s1', 'busy')
    await intent.arm()
    world.state('s1', 'idle')
    world.state('s1', 'busy')
    world.state('s1', 'idle')
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    finish({ outcome: 'quitting' })
    await vi.advanceTimersByTimeAsync(0)
    expect(restartNow).toHaveBeenCalledTimes(1)
    stop()
  })

  it('restarts nothing once worfy quits with the intent pending', async () => {
    const { world, intent, restartNow, stop } = setUp()
    world.state('s1', 'busy')
    await intent.arm()
    intent.quitting()
    expect(intent.pending).toBe(false)
    expect(await intent.arm()).toEqual({ outcome: 'refused', reason: 'worfy is quitting' })
    // The Sessions close as worfy quits: all is quiet, and still nothing restarts.
    world.state('s1', 'closed')
    await vi.advanceTimersByTimeAsync(5 * IDLE_POLL_MS)
    expect(restartNow).not.toHaveBeenCalled()
    stop()
  })
})
