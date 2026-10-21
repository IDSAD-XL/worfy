// The pure parts of the diagnosis of an e2e start whose first window was not shown
// (test/e2e/start-diagnosis.ts, used by launchApp in test/e2e/helpers.ts): it runs only on a rare
// failure, so its time bounds, its budget, the output tail and the summary line are checked here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLEANUP_MARGIN_MS,
  DIAGNOSIS_MAX_MS,
  DIAGNOSTIC_SAVE_MS,
  DIAGNOSTIC_STEP_MS,
  NO_TIME_LEFT,
  OUTPUT_LIMIT,
  PARTIAL_LINE_LIMIT,
  appShowPathOf,
  appShowSummary,
  appShowWatcher,
  deadline,
  diagnosisBudget,
  diagnosisSummary,
  outputTail,
  shownLine,
  step,
  timeLeftOnClock,
} from '../e2e/start-diagnosis'

afterEach(() => {
  vi.useRealTimers()
})

describe('step', () => {
  it('gives the value of work that answers in time', async () => {
    expect(await step(() => Promise.resolve(42), 100)).toEqual({ value: 42 })
  })

  it('gives the first line of the error of work that fails', async () => {
    expect(await step(() => Promise.reject(new Error('evaluate failed\n  at somewhere')), 100)).toEqual({ problem: 'evaluate failed' })
    expect(await step(() => Promise.reject('plain'), 100)).toEqual({ problem: 'plain' })
  })

  it('catches work that throws before it returns a promise', async () => {
    expect(await step(() => {
      throw new Error('at once')
    }, 100)).toEqual({ problem: 'at once' })
  })

  it('gives up on work slower than its time and says after how long', async () => {
    vi.useFakeTimers()
    const result = step(() => new Promise<never>(() => undefined), 3_000)
    await vi.advanceTimersByTimeAsync(2_999)
    let settled = false
    void result.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual({ problem: 'no answer within 3000 ms' })
  })

  it('does not run work given no time', async () => {
    const work = vi.fn(() => Promise.resolve(1))
    expect(await step(work, 0)).toEqual({ problem: NO_TIME_LEFT })
    expect(await step(work, -5)).toEqual({ problem: NO_TIME_LEFT })
    expect(work).not.toHaveBeenCalled()
  })
})

describe('diagnosisBudget', () => {
  it('is the whole diagnosis, 3 steps of 3 s and 10 s of saving, when the test has time or no timeout', () => {
    expect(DIAGNOSIS_MAX_MS).toBe(3 * DIAGNOSTIC_STEP_MS + DIAGNOSTIC_SAVE_MS)
    expect(DIAGNOSIS_MAX_MS).toBe(19_000)
    expect(diagnosisBudget(undefined)).toBe(DIAGNOSIS_MAX_MS)
    expect(diagnosisBudget(60_000)).toBe(DIAGNOSIS_MAX_MS)
  })

  it('keeps CLEANUP_MARGIN_MS (15 s) of the time left for the kill and the cleanup', () => {
    expect(CLEANUP_MARGIN_MS).toBe(15_000)
    expect(diagnosisBudget(25_000)).toBe(10_000)
    expect(diagnosisBudget(15_001)).toBe(1)
  })

  it('is 0 when the test has no more than the margin left, or is already past its timeout', () => {
    expect(diagnosisBudget(15_000)).toBe(0)
    expect(diagnosisBudget(12_000)).toBe(0)
    expect(diagnosisBudget(4_000)).toBe(0)
    expect(diagnosisBudget(-2_000)).toBe(0)
  })
})

describe('timeLeftOnClock', () => {
  it('starts the clock of a key at its first call, with the whole timeout left', () => {
    const starts = new Map<string, number>()
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 1_000)).toBe(60_000)
    expect(starts.get('test-a:0')).toBe(1_000)
  })

  it('keeps the first start on later calls for the same key', () => {
    const starts = new Map<string, number>()
    timeLeftOnClock(starts, 'test-a:0', 60_000, 1_000)
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 21_000)).toBe(40_000)
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 31_000)).toBe(30_000)
    expect(starts.get('test-a:0')).toBe(1_000)
  })

  it('starts fresh for another key: another test, or a retry of the same test', () => {
    const starts = new Map<string, number>()
    timeLeftOnClock(starts, 'test-a:0', 60_000, 1_000)
    expect(timeLeftOnClock(starts, 'test-b:0', 60_000, 50_000)).toBe(60_000)
    expect(timeLeftOnClock(starts, 'test-a:1', 60_000, 70_000)).toBe(60_000)
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 41_000)).toBe(20_000)
  })

  it('never gives less than 0 once the timeout has passed', () => {
    const starts = new Map<string, number>()
    timeLeftOnClock(starts, 'test-a:0', 60_000, 1_000)
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 61_000)).toBe(0)
    expect(timeLeftOnClock(starts, 'test-a:0', 60_000, 90_000)).toBe(0)
  })
})

describe('deadline', () => {
  it('gives each step what it asks while the budget lasts, then what is left, then nothing', () => {
    let now = 1_000
    const left = deadline(5_000, () => now)
    expect(left(DIAGNOSTIC_STEP_MS)).toBe(3_000)
    now += 3_000
    expect(left(DIAGNOSTIC_STEP_MS)).toBe(2_000)
    now += 2_000
    expect(left(DIAGNOSTIC_STEP_MS)).toBe(0)
    now += 1_000
    expect(left(DIAGNOSTIC_SAVE_MS)).toBe(0)
  })

  it('with a budget of 0 runs no step at all', async () => {
    const left = deadline(diagnosisBudget(3_000))
    const work = vi.fn(() => Promise.resolve('state'))
    for (const ms of [DIAGNOSTIC_STEP_MS, DIAGNOSTIC_STEP_MS, DIAGNOSTIC_STEP_MS, DIAGNOSTIC_SAVE_MS]) expect(await step(work, left(ms))).toEqual({ problem: NO_TIME_LEFT })
    expect(work).not.toHaveBeenCalled()
  })

  it('cuts a step slower than its share of the budget off at the end of the budget', async () => {
    vi.useFakeTimers()
    const left = deadline(1_500)
    const result = step(() => new Promise<never>(() => undefined), left(DIAGNOSTIC_STEP_MS))
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await result).toEqual({ problem: 'no answer within 1500 ms' })
    expect(left(DIAGNOSTIC_STEP_MS)).toBe(0)
  })
})

describe('outputTail', () => {
  it('keeps everything appended while it fits', () => {
    const tail = outputTail(10)
    tail.append('abc')
    tail.append(Buffer.from('def'))
    expect(tail.text()).toBe('abcdef')
  })

  it('keeps only the last `limit` characters, 256 KB by default', () => {
    const tail = outputTail(5)
    tail.append('0123456789')
    expect(tail.text()).toBe('56789')
    tail.append('ab')
    expect(tail.text()).toBe('789ab')
    expect(OUTPUT_LIMIT).toBe(256 * 1024)
    const big = outputTail()
    big.append('x'.repeat(OUTPUT_LIMIT + 10))
    big.append('end')
    expect(big.text()).toHaveLength(OUTPUT_LIMIT)
    expect(big.text().endsWith('end')).toBe(true)
  })
})

describe('shownLine', () => {
  it('is the last line of the app that says how the window was shown', () => {
    const output = 'boot\n[worfy] the window was shown on ready-to-show\nmore\n[worfy] the window was shown by the fallback: x\nlast\n'
    expect(shownLine(output)).toBe('[worfy] the window was shown by the fallback: x')
  })

  it('says so when no such line is there', () => {
    expect(shownLine('boot\n')).toBe('no line of the app says the window was shown')
  })
})

describe('appShowPathOf', () => {
  it('reads the path from the two lines of src/main/window-show.ts and nothing from other lines', () => {
    expect(appShowPathOf('[worfy] the window was shown on ready-to-show')).toBe('ready-to-show')
    expect(appShowPathOf('[worfy] the window was shown by the fallback: no ready-to-show within 3000 ms of did-finish-load\r')).toBe('fallback')
    expect(appShowPathOf('[worfy] the window could not load its page (loadURL)')).toBeNull()
  })
})

describe('appShowWatcher', () => {
  it('records the first shown line and the time it was read', () => {
    let clock = 1_000
    const watcher = appShowWatcher(() => clock)
    watcher.append('boot\n')
    expect(watcher.shown()).toBeNull()
    clock = 1_600
    watcher.append(Buffer.from('[worfy] the window was shown on ready-to-show\nmore\n'))
    clock = 9_000
    watcher.append('[worfy] the window was shown by the fallback: x\n')
    expect(watcher.shown()).toEqual({ path: 'ready-to-show', atMs: 1_600 })
  })

  it('joins a line split across chunks and reads the clock when the line is complete', () => {
    let clock = 0
    const watcher = appShowWatcher(() => clock)
    watcher.append('log\n[worfy] the window was sh')
    clock = 5
    watcher.append('own by the fallback: no ready-to-show')
    expect(watcher.shown()).toBeNull()
    clock = 7
    watcher.append(' within 3000 ms of did-finish-load\n')
    expect(watcher.shown()).toEqual({ path: 'fallback', atMs: 7 })
  })

  it('keeps at most PARTIAL_LINE_LIMIT characters of a line without its newline yet', () => {
    const watcher = appShowWatcher(() => 3)
    watcher.append('x'.repeat(PARTIAL_LINE_LIMIT * 4))
    watcher.append('[worfy] the window was shown on ready-to-show\n')
    expect(watcher.shown()).toEqual({ path: 'ready-to-show', atMs: 3 })
  })
})

describe('appShowSummary', () => {
  it('says how and how long after the launch the app showed the window', () => {
    expect(appShowSummary({ path: 'ready-to-show', atMs: 10_620 }, 10_000)).toBe('the app showed the window on ready-to-show 0.62 s after launch')
    expect(appShowSummary({ path: 'fallback', atMs: 14_000 }, 10_000)).toBe('the app showed the window by the fallback 4.00 s after launch')
  })

  it('says so when the app never said it showed the window', () => {
    expect(appShowSummary(null, 10_000)).toBe('the app did not say it showed the window')
  })
})

describe('diagnosisSummary', () => {
  const shown = 'the app showed the window on ready-to-show 0.62 s after launch'

  it('names the window state, the readyState, the shown line and where the files are', () => {
    const state = {
      value: { windows: 1, isVisible: false, isFocused: false, appHidden: false, idleState: 'locked', isLoading: false, isCrashed: false, url: 'file:///out/renderer/index.html' },
    }
    expect(diagnosisSummary(state, { value: 'complete' }, shown, '; diagnostics in /tmp/d')).toBe(
      'window: visible false, focused false, app hidden false, system locked, loading false, crashed false, url file:///out/renderer/index.html, document.readyState complete; the app showed the window on ready-to-show 0.62 s after launch; diagnostics in /tmp/d',
    )
  })

  it('says when there is no window', () => {
    expect(diagnosisSummary({ value: { windows: 0 } }, { value: 'no window' }, shown, '')).toBe(`window: none, document.readyState no window; ${shown}`)
  })

  it('puts the problem of a step that failed or did not run in brackets', () => {
    expect(diagnosisSummary({ problem: 'no answer within 3000 ms' }, { problem: NO_TIME_LEFT }, shown, '')).toBe(
      `window: (no answer within 3000 ms), document.readyState (${NO_TIME_LEFT}); ${shown}`,
    )
  })
})
