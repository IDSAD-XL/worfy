// When the main window is put on screen (src/main/window-show.ts): on 'ready-to-show', or, when
// that never comes, READY_TO_SHOW_FALLBACK_MS after did-finish-load; exactly once either way, never
// for a closed window, and the app's output names the path.
import { describe, expect, it } from 'vitest'
import { READY_TO_SHOW_FALLBACK_MS, windowShow, type WindowShowDeps } from '../../src/main/window-show'

/** A window show with a hand-driven timer: `fire()` runs the pending timer, as if its time had come. */
function harness(overrides: Partial<WindowShowDeps> = {}) {
  const calls = { shows: 0, lines: [] as string[], timers: [] as { callback: () => void; ms: number; cleared: boolean }[] }
  let destroyed = false
  const shower = windowShow({
    show: () => {
      calls.shows += 1
    },
    isDestroyed: () => destroyed,
    log: (line) => calls.lines.push(line),
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false }
      calls.timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      ;(timer as { cleared: boolean }).cleared = true
    },
    ...overrides,
  })
  const pending = () => calls.timers.filter((timer) => !timer.cleared)
  const fire = (): void => {
    const [timer] = pending()
    if (timer === undefined) throw new Error('no pending timer')
    timer.cleared = true
    timer.callback()
  }
  return { shower, calls, pending, fire, close: () => (destroyed = true) }
}

describe('windowShow', () => {
  it('shows the window on ready-to-show and says so', () => {
    const { shower, calls } = harness()
    shower.readyToShow()
    expect(calls.shows).toBe(1)
    expect(shower.shownBy()).toBe('ready-to-show')
    expect(calls.lines).toEqual(['[worfy] the window was shown on ready-to-show'])
  })

  it('waits READY_TO_SHOW_FALLBACK_MS (3 s) after did-finish-load, then shows the window without ready-to-show and says so', () => {
    const { shower, calls, pending, fire } = harness()
    shower.didFinishLoad()
    expect(calls.shows).toBe(0)
    expect(pending().map((timer) => timer.ms)).toEqual([READY_TO_SHOW_FALLBACK_MS])
    expect(READY_TO_SHOW_FALLBACK_MS).toBe(3_000)
    fire()
    expect(calls.shows).toBe(1)
    expect(shower.shownBy()).toBe('fallback')
    expect(calls.lines).toEqual(['[worfy] the window was shown by the fallback: no ready-to-show within 3000 ms of did-finish-load'])
  })

  it('takes another grace period when given one', () => {
    const { shower, pending } = harness({ fallbackMs: 50 })
    shower.didFinishLoad()
    expect(pending().map((timer) => timer.ms)).toEqual([50])
  })

  it('a ready-to-show inside the grace period clears the timer and shows once', () => {
    const { shower, calls, pending } = harness()
    shower.didFinishLoad()
    shower.readyToShow()
    expect(pending()).toEqual([])
    expect(calls.shows).toBe(1)
    expect(shower.shownBy()).toBe('ready-to-show')
  })

  it('a ready-to-show after the fallback has shown the window shows nothing more', () => {
    const { shower, calls, fire } = harness()
    shower.didFinishLoad()
    fire()
    shower.readyToShow()
    expect(calls.shows).toBe(1)
    expect(shower.shownBy()).toBe('fallback')
    expect(calls.lines).toHaveLength(1)
  })

  it('a did-finish-load after the window is shown starts no timer', () => {
    const { shower, calls } = harness()
    shower.readyToShow()
    shower.didFinishLoad()
    expect(calls.timers).toEqual([])
  })

  it('a second did-finish-load before the show keeps the first timer and does not start another', () => {
    const { shower, calls } = harness()
    shower.didFinishLoad()
    shower.didFinishLoad()
    expect(calls.timers).toHaveLength(1)
  })

  it('a closed window is not shown by the fallback, and closing clears the timer', () => {
    const { shower, calls, pending } = harness()
    shower.didFinishLoad()
    shower.dispose()
    expect(pending()).toEqual([])
    expect(calls.shows).toBe(0)
    expect(shower.shownBy()).toBeNull()
  })

  it('a window destroyed before the timer fires is not shown, and nothing is logged', () => {
    const { shower, calls, fire, close } = harness()
    shower.didFinishLoad()
    close()
    fire()
    expect(calls.shows).toBe(0)
    expect(calls.lines).toEqual([])
    expect(shower.shownBy()).toBeNull()
  })

  it('a window destroyed before ready-to-show is not shown', () => {
    const { shower, calls, close } = harness()
    close()
    shower.readyToShow()
    expect(calls.shows).toBe(0)
  })

  it('dispose without a timer clears nothing', () => {
    let clears = 0
    const { shower } = harness({ clearTimer: () => (clears += 1) })
    shower.dispose()
    shower.readyToShow()
    shower.dispose()
    expect(clears).toBe(0)
  })
})
