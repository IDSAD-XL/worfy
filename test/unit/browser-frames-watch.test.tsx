// The watch of a Browser's frames from a window (src/renderer/browser/frames.ts, worfy-browser
// ticket 07): it is told again every BROWSER_SCREEN_RENEW_MS, and it ends on `pagehide` — a reload or
// a closed window runs no cleanup of React — as it does when the frame goes.
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserFrames } from '../../src/renderer/browser/frames'
import { BROWSER_SCREEN_RENEW_MS } from '../../src/shared/ipc/browser'

const calls = vi.hoisted(() => [] as { channel: string; input: { watch?: boolean } }[])

vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { watch?: boolean }) => {
    calls.push({ channel, input })
    return Promise.resolve({ ok: true, value: {} })
  },
  subscribe: () => () => undefined,
}))

const watches = () => calls.filter((call) => call.channel === 'browser.frames.watch').map((call) => call.input.watch)

beforeEach(() => {
  calls.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBrowserFrames', () => {
  it('watches, tells the watch again every BROWSER_SCREEN_RENEW_MS, and ends it when the frame goes', () => {
    const { unmount } = renderHook(() => useBrowserFrames('demo', 'b1', true))
    expect(watches()).toEqual([true])
    vi.advanceTimersByTime(BROWSER_SCREEN_RENEW_MS * 2)
    expect(watches()).toEqual([true, true, true])
    unmount()
    expect(watches()).toEqual([true, true, true, false])
    // No renewal after the end.
    vi.advanceTimersByTime(BROWSER_SCREEN_RENEW_MS * 2)
    expect(watches()).toEqual([true, true, true, false])
  })

  it('ends the watch on pagehide, which a reload or a closed window sends without a cleanup', () => {
    renderHook(() => useBrowserFrames('demo', 'b1', true))
    window.dispatchEvent(new Event('pagehide'))
    expect(watches()).toEqual([true, false])
  })

  it('never watches while off', () => {
    renderHook(() => useBrowserFrames('demo', 'b1', false))
    vi.advanceTimersByTime(BROWSER_SCREEN_RENEW_MS * 2)
    expect(watches()).toEqual([])
  })
})
