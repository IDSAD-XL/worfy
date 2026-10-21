// The wait for the app's first window to be on screen (test/e2e/first-window-shown.ts, used by
// launchApp in test/e2e/helpers.ts), with fake windows and fake timers: it runs inside the app's
// main process in e2e, where a missed 'show' hung a gate full for 30 s.
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHOW_POLL_MS, waitForFirstWindowShown, type ShowWait, type WatchedWindow } from '../e2e/first-window-shown'

class FakeWindow extends EventEmitter implements WatchedWindow {
  visible = false
  destroyed = false
  isDestroyed(): boolean {
    return this.destroyed
  }
  isVisible(): boolean {
    return this.visible
  }
  showListeners(): number {
    return this.listenerCount('show')
  }
}

const TIMEOUT_MS = 30_000

/**
 * The function rebuilt from its source text, as app.evaluate sends it to main: a name from outside
 * its body, even in a rare branch, fails here with a ReferenceError instead of only in main.
 */
const fromSource = new Function(`return (${String(waitForFirstWindowShown)})`)() as typeof waitForFirstWindowShown

/** Starts the wait over `windows` (read again on every tick) and keeps what it resolved with. */
function startWait(windows: FakeWindow[]): { result: () => ShowWait | undefined } {
  let result: ShowWait | undefined
  void fromSource({ BrowserWindow: { getAllWindows: () => windows } }, { intervalMs: SHOW_POLL_MS, timeoutMs: TIMEOUT_MS }).then((value) => {
    result = value
  })
  return { result: () => result }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForFirstWindowShown', () => {
  it('resolves at once for a window already visible, with no timer and no listener left', async () => {
    const window = new FakeWindow()
    window.visible = true
    const wait = startWait([window])
    await vi.advanceTimersByTimeAsync(0)
    expect(wait.result()).toEqual({ how: 'visible', afterMs: 0 })
    expect(vi.getTimerCount()).toBe(0)
    expect(window.showListeners()).toBe(0)
  })

  it('resolves when isVisible() turns true later and no show event ever comes (macOS: show is occlusion-driven)', async () => {
    const window = new FakeWindow()
    const wait = startWait([window])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(wait.result()).toBeUndefined()
    window.visible = true
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(wait.result()).toEqual({ how: 'visible', afterMs: 2_000 + SHOW_POLL_MS })
    expect(vi.getTimerCount()).toBe(0)
    expect(window.showListeners()).toBe(0)
  })

  it('resolves on the show event without waiting for the next tick, while isVisible() is still false', async () => {
    const window = new FakeWindow()
    const wait = startWait([window])
    await vi.advanceTimersByTimeAsync(250)
    window.emit('show')
    await Promise.resolve()
    expect(wait.result()).toEqual({ how: 'show-event', afterMs: 250 })
    expect(vi.getTimerCount()).toBe(0)
    expect(window.showListeners()).toBe(0)
  })

  it('follows a first window that is destroyed and replaced: listens to the new one and resolves on it', async () => {
    const old = new FakeWindow()
    const windows = [old]
    const wait = startWait(windows)
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(old.showListeners()).toBe(1)
    old.destroyed = true
    const replacement = new FakeWindow()
    windows.push(replacement)
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(replacement.showListeners()).toBe(1)
    replacement.emit('show')
    await Promise.resolve()
    expect(wait.result()?.how).toBe('show-event')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('moves its listener off a window that is no longer the first live one', async () => {
    const first = new FakeWindow()
    const second = new FakeWindow()
    const windows = [first, second]
    const wait = startWait(windows)
    await vi.advanceTimersByTimeAsync(0)
    expect(first.showListeners()).toBe(1)
    windows.shift()
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(first.showListeners()).toBe(0)
    expect(second.showListeners()).toBe(1)
    second.visible = true
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(wait.result()?.how).toBe('visible')
    expect(second.showListeners()).toBe(0)
  })

  it('resolves with no-window when the app has no live window, as the wait for show did before', async () => {
    const windows = [new FakeWindow()]
    const wait = startWait(windows)
    await vi.advanceTimersByTimeAsync(0)
    windows[0]!.destroyed = true
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(wait.result()).toEqual({ how: 'no-window', afterMs: SHOW_POLL_MS })
    expect(vi.getTimerCount()).toBe(0)
    const none = startWait([])
    await vi.advanceTimersByTimeAsync(0)
    expect(none.result()).toEqual({ how: 'no-window', afterMs: 0 })
  })

  it('ends by itself after its timeout, with the interval and the listener removed', async () => {
    const window = new FakeWindow()
    const wait = startWait([window])
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - SHOW_POLL_MS)
    expect(wait.result()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SHOW_POLL_MS)
    expect(wait.result()).toEqual({ how: 'timeout', afterMs: TIMEOUT_MS })
    expect(vi.getTimerCount()).toBe(0)
    expect(window.showListeners()).toBe(0)
  })
})
