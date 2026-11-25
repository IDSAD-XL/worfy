// The one scheduler of the Assistant's checks of sources (src/main/assistant/schedule/scheduler.ts,
// worfy-assistant ticket 04; seam A of the spec's test decisions). On the way in: a clock and the settings; on the
// way out: which check goes when. The clock is vitest's fake one; the Mac's sleep is suspend() and resume(),
// a restart is a second scheduler over the same marks. Moments are UTC with Kyiv's offset written out
// (UTC+2 in winter, UTC+3 in summer).
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckScheduler, followPower, memoryCheckMarks, SCHEDULE_JITTER, type CheckMarksStore, type CheckRunContext } from '../../src/main/assistant/schedule/scheduler'
import type { AssistantScheduleChoice, AssistantScheduleSettings } from '../../src/shared/assistant/schedule/settings'
import type { WorkHours } from '../../src/shared/assistant/schedule/work-hours'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const KYIV = 'Europe/Kyiv'

const utc = (year: number, month: number, day: number, hour: number, minute = 0): number => Date.UTC(year, month - 1, day, hour, minute)

const OFFICE: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 9 * 60, to: 18 * 60 }], timeZone: KYIV }
const EVERY_DAY: WorkHours = { ...OFFICE, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }

/** A run that records its context and ends at once. */
function recorder(): { runs: CheckRunContext[]; run: (context: CheckRunContext) => Promise<void> } {
  const runs: CheckRunContext[] = []
  return { runs, run: async (context) => void runs.push(context) }
}

let settings: AssistantScheduleSettings
let marks: CheckMarksStore
const made: CheckScheduler[] = []

function scheduler(options: { random?: () => number; marks?: CheckMarksStore } = {}): CheckScheduler {
  const made1 = new CheckScheduler({ now: () => Date.now(), settings: () => settings, marks: options.marks ?? marks, random: options.random ?? (() => 0.5) })
  made.push(made1)
  return made1
}

function choose(choice: AssistantScheduleChoice): void {
  settings = { assistantSchedule: choice }
}

beforeEach(() => {
  vi.useFakeTimers()
  marks = memoryCheckMarks()
  settings = {}
})

afterEach(() => {
  for (const one of made.splice(0)) one.stop()
  vi.useRealTimers()
})

describe('the registry', () => {
  it('a check that is still running is not started a second time, by its timer or by runNow', async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    let finish: () => void = () => undefined
    let started = 0
    const checks = scheduler()
    checks.register('slack', () => {
      started += 1
      return new Promise<void>((resolve) => (finish = resolve))
    })
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(1)
    expect(checks.running('slack')).toBe(true)

    // Two and a half intervals go by while the first run hangs.
    await vi.advanceTimersByTimeAsync(25 * MINUTE)
    expect(started).toBe(1)
    expect(checks.runNow('slack')).toBe(false)
    expect(started).toBe(1)

    // It ends: the time for the next one has long come, so it goes at once — once.
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(2)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks.runNow('slack')).toBe(true)
    expect(started).toBe(3)
  })

  it('the interval spreads by ±10 %: the random draw decides where in the spread the next run lands', async () => {
    expect(SCHEDULE_JITTER).toBe(0.1)
    const start = utc(2026, 11, 25, 8, 0)
    choose({ checks: { jira: { enabled: true, sleepOutsideWorkHours: false } } })
    for (const [draw, minutes] of [
      [0, 54],
      [0.5, 60],
      [1, 66],
    ] as const) {
      vi.setSystemTime(start)
      const checks = scheduler({ random: () => draw, marks: memoryCheckMarks() })
      checks.register('jira', recorder().run)
      checks.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(checks.nextRun('jira'), String(draw)).toBe(start + minutes * MINUTE)
      checks.stop()
    }
  })

  it('a kind with no check registered, or turned off, has no next run; unregistering stops it', async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    choose({ checks: { slack: { enabled: true, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    const slack = recorder()
    const unregister = checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks.nextRun('jira')).toBeNull()
    expect(checks.nextRun('slack')).toBe(Date.now() + 10 * MINUTE)
    expect(() => checks.register('slack', slack.run)).toThrow('a check of kind slack is registered already')

    unregister()
    expect(checks.nextRun('slack')).toBeNull()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(slack.runs).toHaveLength(1)
  })
})

describe('each kind of check', () => {
  it('has its own switch, interval and sleep outside work hours', async () => {
    // Saturday 2026-11-28 12:00 in Kyiv: outside office hours.
    vi.setSystemTime(utc(2026, 11, 28, 10, 0))
    choose({ workHours: OFFICE, checks: { slack: { enabled: true, intervalMinutes: 10 }, jira: { enabled: true, intervalMinutes: 30, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    const slack = recorder()
    const jira = recorder()
    checks.register('slack', slack.run)
    checks.register('jira', jira.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    // Slack sleeps through the weekend; Jira, not marked to sleep, goes every 30 minutes.
    expect(slack.runs).toHaveLength(0)
    expect(jira.runs).toHaveLength(5)
    expect(checks.nextRun('slack')).toBe(utc(2026, 11, 30, 7, 0))

    // Jira turned off, Slack set not to sleep: from the next plan on.
    choose({ workHours: OFFICE, checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false }, jira: { enabled: false, intervalMinutes: 30, sleepOutsideWorkHours: false } } })
    checks.reschedule()
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(jira.runs).toHaveLength(5)
    expect(slack.runs).toHaveLength(4)
    expect(checks.nextRun('jira')).toBeNull()
  })

  it('a kind left off never runs', async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(slack.runs).toHaveLength(0)
    expect(checks.nextRun('slack')).toBeNull()
  })

  it('a check that fails is tried again after its interval, and the next one covers the time since the last success', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, sleepOutsideWorkHours: false } } })
    const contexts: CheckRunContext[] = []
    let fail = false
    const checks = scheduler()
    checks.register('slack', async (context) => {
      contexts.push(context)
      if (fail) throw new Error('the connector did not answer')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    fail = true
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(warn).toHaveBeenCalledOnce()
    expect(checks.nextRun('slack')).toBe(start + 20 * MINUTE)
    fail = false
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(contexts.map((context) => context.since)).toEqual([null, start, start])
    warn.mockRestore()
  })
})

describe('the clock', () => {
  it('across midnight: a window of Friday 22:00–01:00 runs into Saturday, then sleeps until the next Friday', async () => {
    vi.setSystemTime(utc(2026, 11, 27, 21, 10)) // Friday 23:10
    choose({ workHours: { days: ['fri'], windows: [{ from: 22 * 60, to: 60 }], timeZone: KYIV }, checks: { slack: { enabled: true, intervalMinutes: 30 } } })
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    // 23:10, 23:40, 00:10, 00:40; 01:10 is outside.
    expect(slack.runs.map((run) => run.now)).toEqual([utc(2026, 11, 27, 21, 10), utc(2026, 11, 27, 21, 40), utc(2026, 11, 27, 22, 10), utc(2026, 11, 27, 22, 40)])
    expect(checks.nextRun('slack')).toBe(utc(2026, 12, 4, 20, 0))
  })

  it('the night the clocks go forward: an hourly check waits one real hour, and a sleeping one wakes at 09:00 summer time', async () => {
    // Sunday 2026-03-29, 02:30 EET; at 03:00 the clocks jump to 04:00.
    vi.setSystemTime(utc(2026, 3, 29, 0, 30))
    choose({ workHours: EVERY_DAY, checks: { jira: { enabled: true, intervalMinutes: 60, sleepOutsideWorkHours: false }, slack: { enabled: true, intervalMinutes: 60 } } })
    marks.write({ slack: { startedAt: utc(2026, 3, 28, 15, 30), succeededAt: utc(2026, 3, 28, 15, 30) } }) // Saturday 17:30
    const checks = scheduler()
    const jira = recorder()
    const slack = recorder()
    checks.register('jira', jira.run)
    checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks.nextRun('jira')).toBe(utc(2026, 3, 29, 1, 30)) // 04:30 EEST
    expect(checks.nextRun('slack')).toBe(utc(2026, 3, 29, 6, 0)) // 09:00 EEST
    await vi.advanceTimersByTimeAsync(6 * HOUR)
    expect(slack.runs).toEqual([{ kind: 'slack', since: utc(2026, 3, 28, 15, 30), now: utc(2026, 3, 29, 6, 0) }])
  })

  it('the night the clocks go back: a sleeping check wakes at 09:00 winter time', async () => {
    vi.setSystemTime(utc(2026, 10, 24, 17, 0)) // Saturday 20:00 EEST
    choose({ workHours: EVERY_DAY, checks: { slack: { enabled: true, intervalMinutes: 60 } } })
    marks.write({ slack: { startedAt: utc(2026, 10, 24, 14, 30), succeededAt: utc(2026, 10, 24, 14, 30) } })
    const checks = scheduler()
    checks.register('slack', recorder().run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks.nextRun('slack')).toBe(utc(2026, 10, 25, 7, 0))
  })
})

describe('the Mac sleeps, worfy restarts', () => {
  it('no check goes while the Mac sleeps; on waking the missed check goes once and covers the whole sleep', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(slack.runs).toHaveLength(1)

    checks.suspend()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(slack.runs).toHaveLength(1)
    // Neither a change of the settings nor runNow starts a check while the Mac sleeps.
    checks.reschedule()
    expect(checks.runNow('slack')).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(slack.runs).toHaveLength(1)

    checks.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(slack.runs).toHaveLength(2)
    expect(slack.runs[1]).toEqual({ kind: 'slack', since: start, now: start + 3 * HOUR + 5 * MINUTE })
    await vi.advanceTimersByTimeAsync(9 * MINUTE)
    expect(slack.runs).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(slack.runs).toHaveLength(3)
  })

  it("followPower passes the system's suspend and resume to the scheduler, and its stop lets go of them", async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const power = new EventEmitter()
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    const stop = followPower(checks, power)
    await vi.advanceTimersByTimeAsync(0)
    power.emit('suspend')
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(slack.runs).toHaveLength(1)
    power.emit('resume')
    await vi.advanceTimersByTimeAsync(0)
    expect(slack.runs).toHaveLength(2)
    stop()
    expect(power.listenerCount('suspend') + power.listenerCount('resume')).toBe(0)
  })

  it('while worfy is closed nothing goes; after the restart the overdue check goes at once, once, from the last success', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const first = scheduler()
    const before = recorder()
    first.register('slack', before.run)
    first.start()
    await vi.advanceTimersByTimeAsync(MINUTE)
    first.stop()
    await vi.advanceTimersByTimeAsync(5 * HOUR)
    expect(before.runs).toHaveLength(1)

    const second = scheduler()
    const after = recorder()
    second.register('slack', after.run)
    second.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(after.runs).toEqual([{ kind: 'slack', since: start, now: start + 5 * HOUR + MINUTE }])
  })

  it('a restart before the check is due keeps its time: no extra run', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const first = scheduler()
    first.register('slack', recorder().run)
    first.start()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    first.stop()

    const second = scheduler()
    const after = recorder()
    second.register('slack', after.run)
    second.start()
    await vi.advanceTimersByTimeAsync(6 * MINUTE)
    expect(after.runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(after.runs).toEqual([{ kind: 'slack', since: start, now: start + 10 * MINUTE }])
  })

  it('a restart before work hours: a sleeping check catches up at their start, not at once', async () => {
    // Closed on Tuesday evening at 17:50 after a check, opened on Thursday at 07:00: the work hours of
    // Wednesday, missed while closed, do not make it go before Thursday's.
    const evening = utc(2026, 11, 24, 15, 50)
    marks.write({ slack: { startedAt: evening, succeededAt: evening } })
    vi.setSystemTime(utc(2026, 11, 26, 5, 0))
    choose({ workHours: OFFICE, checks: { slack: { enabled: true, intervalMinutes: 30 } } })
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(2 * HOUR - MINUTE)
    expect(slack.runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(slack.runs).toEqual([{ kind: 'slack', since: evening, now: utc(2026, 11, 26, 7, 0) }])
  })
})
