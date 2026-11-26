// The one scheduler of the Assistant's checks of sources (src/main/assistant/schedule/scheduler.ts,
// worfy-assistant ticket 04; seam A of the spec's test decisions). On the way in: a clock and the settings; on the
// way out: which check goes when. The clock is vitest's fake one; the Mac's sleep is suspend() and resume(),
// a restart is a second scheduler over the same marks. Moments are UTC with Kyiv's offset written out
// (UTC+2 in winter, UTC+3 in summer).
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKOFF_AFTER_FAILURES, BACKOFF_CEILING_MS, CHECK_RUN_TIMEOUT_MS, CheckScheduler, followPower, MAX_TIMER_MS, memoryCheckMarks, SCHEDULE_JITTER, type CheckMarksStore, type CheckRunContext } from '../../src/main/assistant/schedule/scheduler'
import type { AssistantScheduleChoice, AssistantScheduleSettings } from '../../src/shared/assistant/schedule/settings'
import type { WorkHours } from '../../src/shared/assistant/schedule/work-hours'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const KYIV = 'Europe/Kyiv'

const utc = (year: number, month: number, day: number, hour: number, minute = 0): number => Date.UTC(year, month - 1, day, hour, minute)

const OFFICE: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 9 * 60, to: 18 * 60 }], timeZone: KYIV }
const EVERY_DAY: WorkHours = { ...OFFICE, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }

/**
 * How long after the start of work hours a sleeping check of `minutes` goes with the draw of the middle
 * (0.5, the default here): half of the spread of SCHEDULE_JITTER of its interval.
 */
const startDelay = (minutes: number): number => (SCHEDULE_JITTER / 2) * minutes * MINUTE

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
  it('a check that is still running is not started a second time: not by its timer, a change of settings, a wake-up, another kind\'s timer or runNow', async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    choose({ checks: { slack: { enabled: true, intervalMinutes: 5, sleepOutsideWorkHours: false }, jira: { enabled: true, intervalMinutes: 5, sleepOutsideWorkHours: false } } })
    let finish: () => void = () => undefined
    let started = 0
    const checks = scheduler()
    checks.register('slack', () => {
      started += 1
      return new Promise<void>((resolve) => (finish = resolve))
    })
    const jira = recorder()
    checks.register('jira', jira.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(1)
    expect(checks.running('slack')).toBe(true)

    // Past Slack's due time, short of the run time limit, while its first run hangs: its own timer and
    // Jira's both fire, the settings change, the Mac sleeps and wakes.
    await vi.advanceTimersByTimeAsync(8 * MINUTE)
    expect(jira.runs).toHaveLength(2)
    checks.reschedule()
    checks.suspend()
    checks.resume()
    await vi.advanceTimersByTimeAsync(0)
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
    expect(checks.nextRun('slack')).toBe(utc(2026, 11, 30, 7, 0) + startDelay(10))

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

  it('a run that covered only part of its time (an answer at its cap) moves `since` only as far as it covered, never past its start', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, sleepOutsideWorkHours: false } } })
    const contexts: CheckRunContext[] = []
    const covered = [start - 30 * MINUTE, start + HOUR, undefined]
    const checks = scheduler()
    checks.register('slack', async (context) => {
      contexts.push(context)
      const until = covered[contexts.length - 1]
      return until === undefined ? undefined : { coveredUntil: until }
    })
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    // The first run covered up to half an hour before its start; the second claims past its start, which counts as its start.
    expect(contexts.map((context) => context.since)).toEqual([null, start - 30 * MINUTE, start + 10 * MINUTE])
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
    expect(checks.nextRun('slack')).toBe(utc(2026, 12, 4, 20, 0) + startDelay(30))
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
    expect(checks.nextRun('slack')).toBe(utc(2026, 3, 29, 6, 0) + startDelay(60)) // 09:00 EEST and the spread
    await vi.advanceTimersByTimeAsync(6 * HOUR)
    expect(slack.runs).toEqual([{ kind: 'slack', since: utc(2026, 3, 28, 15, 30), now: utc(2026, 3, 29, 6, 0) + startDelay(60) }])
  })

  it('the night the clocks go back: a sleeping check wakes at 09:00 winter time', async () => {
    vi.setSystemTime(utc(2026, 10, 24, 17, 0)) // Saturday 20:00 EEST
    choose({ workHours: EVERY_DAY, checks: { slack: { enabled: true, intervalMinutes: 60 } } })
    marks.write({ slack: { startedAt: utc(2026, 10, 24, 14, 30), succeededAt: utc(2026, 10, 24, 14, 30) } })
    const checks = scheduler()
    checks.register('slack', recorder().run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks.nextRun('slack')).toBe(utc(2026, 10, 25, 7, 0) + startDelay(60))
  })
})

describe('the clock moves', () => {
  it('the system clock jumps forward while the timer waits: the check goes within MAX_TIMER_MS, not at the end of the old wait', async () => {
    expect(MAX_TIMER_MS).toBe(HOUR)
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { jira: { enabled: true, intervalMinutes: 180, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    const jira = recorder()
    checks.register('jira', jira.run)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(jira.runs).toHaveLength(1)
    // The wall clock jumps three hours ahead; the timers do not move.
    vi.setSystemTime(start + 3 * HOUR)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(jira.runs).toHaveLength(2)
  })

  it('a last start in the future — the clock was moved back — counts as now: the check waits one interval, not the gap', async () => {
    const now = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(now)
    marks.write({ slack: { startedAt: now + 5 * HOUR, succeededAt: now + 5 * HOUR } })
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    const slack = recorder()
    checks.register('slack', slack.run)
    checks.start()
    expect(checks.nextRun('slack')).toBe(now + 10 * MINUTE)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(slack.runs).toHaveLength(1)
  })

  it('sleeping checks do not all go at the first millisecond of work hours: each goes within the spread after their start, and never outside them', async () => {
    // Saturday noon; office hours start on Monday at 09:00 (07:00 UTC).
    const monday = utc(2026, 11, 30, 7, 0)
    for (const [draw, delay] of [
      [0, 0],
      [0.5, 3 * MINUTE],
      [1, 6 * MINUTE],
    ] as const) {
      vi.setSystemTime(utc(2026, 11, 28, 10, 0))
      choose({ workHours: OFFICE, checks: { jira: { enabled: true, intervalMinutes: 60 } } })
      const checks = scheduler({ random: () => draw, marks: memoryCheckMarks() })
      checks.register('jira', recorder().run)
      checks.start()
      expect(checks.nextRun('jira'), String(draw)).toBe(monday + delay)
      checks.stop()
    }

    // A window shorter than the spread: the check goes at its start rather than after its end.
    vi.setSystemTime(utc(2026, 11, 28, 10, 0))
    choose({ workHours: { ...OFFICE, windows: [{ from: 9 * 60, to: 9 * 60 + 5 }] }, checks: { jira: { enabled: true, intervalMinutes: 1440 } } })
    const short = scheduler({ random: () => 1, marks: memoryCheckMarks() })
    const jira = recorder()
    short.register('jira', jira.run)
    short.start()
    expect(short.nextRun('jira')).toBe(monday)
    // A plan made inside work hours before the check's moment (another kind's timer, a change of settings)
    // does not cut the spread short.
    vi.setSystemTime(monday - MINUTE)
    choose({ workHours: OFFICE, checks: { jira: { enabled: true, intervalMinutes: 60 } } })
    short.reschedule()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    short.reschedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(jira.runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(jira.runs.map((run) => run.now)).toEqual([monday + 6 * MINUTE])
  })
})

describe('a run that never ends', () => {
  it(`counts as failed after CHECK_RUN_TIMEOUT_MS: the kind goes again, \`since\` stays at the last success, and a late answer of the old run changes nothing`, async () => {
    expect(CHECK_RUN_TIMEOUT_MS).toBe(10 * MINUTE)
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 30, sleepOutsideWorkHours: false } } })
    const contexts: CheckRunContext[] = []
    const answers: (() => void)[] = []
    let hang = false
    const checks = scheduler()
    checks.register('slack', (context) => {
      contexts.push(context)
      return hang ? new Promise<void>((resolve) => answers.push(resolve)) : Promise.resolve()
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    hang = true
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(contexts).toHaveLength(2)
    expect(checks.running('slack')).toBe(true)

    await vi.advanceTimersByTimeAsync(CHECK_RUN_TIMEOUT_MS - 1)
    expect(checks.running('slack')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(checks.running('slack')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the slack check did not end in 10 minutes'))

    // The old run answers late: no success is written, nothing is planned twice.
    answers[0]?.()
    hang = false
    await vi.advanceTimersByTimeAsync(0)
    expect(contexts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(contexts.map((context) => context.since)).toEqual([null, start, start])
    warn.mockRestore()
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
    await vi.advanceTimersByTimeAsync(2 * HOUR + startDelay(30) - MINUTE)
    expect(slack.runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(slack.runs).toEqual([{ kind: 'slack', since: evening, now: utc(2026, 11, 26, 7, 0) + startDelay(30) }])
  })
})

describe('failures in a row (worfy-assistant ticket 22)', () => {
  /** A run that records its start and fails while `state.fail` is set. */
  function failing(state: { fail: boolean }): { starts: number[]; run: (context: CheckRunContext) => Promise<void> } {
    const starts: number[] = []
    return {
      starts,
      run: async (context) => {
        starts.push(context.now)
        if (state.fail) throw new Error('the connector did not answer')
      },
    }
  }

  /** Moves the clock to the next run of `kind` and lets it end. */
  async function toNextRun(checks: CheckScheduler, kind: 'slack' | 'jira' | 'main-ci'): Promise<void> {
    const next = checks.nextRun(kind)
    if (next === null) throw new Error(`${kind} has no next run`)
    await vi.advanceTimersByTimeAsync(next - Date.now())
  }

  const gapsOf = (starts: number[]): number[] => starts.slice(1).map((at, index) => (at - (starts[index] ?? at)) / MINUTE)

  it(`after ${BACKOFF_AFTER_FAILURES} failures in a row the interval doubles with each further one up to a day; the first success brings the usual interval back`, async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const state = { fail: true }
    const slack = failing(state)
    const checks = scheduler()
    checks.register('slack', slack.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let run = 2; run <= 11; run += 1) await toNextRun(checks, 'slack')
    expect(gapsOf(slack.starts)).toEqual([10, 10, 20, 40, 80, 160, 320, 640, 1280, 24 * 60])
    expect(BACKOFF_CEILING_MS).toBe(24 * HOUR)
    expect(marks.read().slack?.failures).toBe(11)

    state.fail = false
    await toNextRun(checks, 'slack')
    expect(gapsOf(slack.starts).at(-1)).toBe(24 * 60)
    expect(checks.nextRun('slack')).toBe(Date.now() + 10 * MINUTE)
    expect(marks.read().slack?.failures).toBeUndefined()
    await toNextRun(checks, 'slack')
    expect(gapsOf(slack.starts).at(-1)).toBe(10)

    // One line per failed run as before, one when the backoff began, one when the success lifted it.
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => /check failed:/u.test(line))).toHaveLength(11)
    expect(lines.filter((line) => !/check failed:/u.test(line))).toEqual([
      `[assistant] the slack check failed ${BACKOFF_AFTER_FAILURES} times in a row: it backs off, the next run at ${new Date((slack.starts[2] ?? 0) + 20 * MINUTE).toISOString()}`,
    ])
    expect(info.mock.calls.map((call) => String(call[0]))).toEqual(['[assistant] the slack check succeeded after 11 failures in a row: back to its usual interval'])
    warn.mockRestore()
    info.mockRestore()
  })

  it('the spread of ±10 % applies to the longer interval too', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { jira: { enabled: true, intervalMinutes: 60, sleepOutsideWorkHours: false } } })
    const jira = failing({ fail: true })
    const checks = scheduler({ random: () => 0 })
    checks.register('jira', jira.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let run = 2; run <= 4; run += 1) await toNextRun(checks, 'jira')
    expect(gapsOf(jira.starts)).toEqual([54, 54, 108])
    warn.mockRestore()
  })

  it('a backed-off check that falls due outside work hours still waits for their start', async () => {
    // Wednesday 16:00 Kyiv: the usual 60 minutes would land at 17:00, inside work hours; the third failure doubles them
    // to 18:00, past their end, so the next run is Thursday 09:00 and the spread.
    const start = utc(2026, 11, 25, 14, 0)
    marks.write({ jira: { startedAt: start - HOUR, succeededAt: start - 3 * HOUR, failures: 2 } })
    vi.setSystemTime(start)
    choose({ workHours: OFFICE, checks: { jira: { enabled: true, intervalMinutes: 60 } } })
    const jira = failing({ fail: true })
    const checks = scheduler()
    checks.register('jira', jira.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(jira.starts).toEqual([start])
    expect(checks.nextRun('jira')).toBe(utc(2026, 11, 26, 7, 0) + startDelay(60))
    warn.mockRestore()
  })

  it('a run that does not end in time counts as a failure in a row', async () => {
    vi.setSystemTime(utc(2026, 11, 25, 8, 0))
    choose({ checks: { slack: { enabled: true, intervalMinutes: 30, sleepOutsideWorkHours: false } } })
    const checks = scheduler()
    checks.register('slack', () => new Promise<void>(() => undefined))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(CHECK_RUN_TIMEOUT_MS)
    expect(marks.read().slack?.failures).toBe(1)
    warn.mockRestore()
  })

  it('the CI of the main branch keeps its interval however often it fails, and counts no failures', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { 'main-ci': { enabled: true, intervalMinutes: 10 } } })
    const ci = failing({ fail: true })
    const checks = scheduler()
    checks.register('main-ci', ci.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let run = 2; run <= 6; run += 1) await toNextRun(checks, 'main-ci')
    expect(gapsOf(ci.starts)).toEqual([10, 10, 10, 10, 10])
    expect(marks.read()['main-ci']?.failures).toBeUndefined()
    warn.mockRestore()
  })

  it('turning a backed-off check off and on, or changing its interval, clears the count: the next run is its plain interval', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const slack = failing({ fail: true })
    const checks = scheduler()
    checks.register('slack', slack.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    checks.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let run = 2; run <= 4; run += 1) await toNextRun(checks, 'slack')
    const last = slack.starts.at(-1) ?? 0
    expect(checks.nextRun('slack')).toBe(last + 40 * MINUTE)

    // Off, then on again: the person asks for the check, so it is no longer held back.
    choose({ checks: { slack: { enabled: false, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    checks.reschedule()
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    checks.reschedule()
    expect(marks.read().slack?.failures).toBeUndefined()
    expect(checks.nextRun('slack')).toBe(last + 10 * MINUTE)

    // Backed off again, then a new interval: the new one counts from the plain interval.
    for (let run = 1; run <= 3; run += 1) await toNextRun(checks, 'slack')
    const again = slack.starts.at(-1) ?? 0
    expect(checks.nextRun('slack')).toBe(again + 20 * MINUTE)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 15, sleepOutsideWorkHours: false } } })
    checks.reschedule()
    expect(checks.nextRun('slack')).toBe(again + 15 * MINUTE)

    // A change of another field (sleep outside work hours) or of another kind keeps the count.
    for (let run = 1; run <= 3; run += 1) await toNextRun(checks, 'slack')
    choose({ workHours: EVERY_DAY, checks: { slack: { enabled: true, intervalMinutes: 15, sleepOutsideWorkHours: false }, jira: { enabled: true } } })
    checks.reschedule()
    expect(marks.read().slack?.failures).toBe(3)
    warn.mockRestore()
    info.mockRestore()
  })

  it('the count outlives a restart: a new scheduler over the same marks keeps the longer interval; marks without the count read as no failures', async () => {
    const start = utc(2026, 11, 25, 8, 0)
    vi.setSystemTime(start)
    choose({ checks: { slack: { enabled: true, intervalMinutes: 10, sleepOutsideWorkHours: false } } })
    const first = scheduler()
    const before = failing({ fail: true })
    first.register('slack', before.run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    first.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let run = 2; run <= 3; run += 1) await toNextRun(first, 'slack')
    first.stop()
    const third = before.starts.at(-1) ?? 0

    const second = scheduler()
    second.register('slack', failing({ fail: true }).run)
    expect(second.nextRun('slack')).toBe(third + 20 * MINUTE)
    warn.mockRestore()

    const now = Date.now()
    const old = scheduler({ marks: memoryCheckMarks({ slack: { startedAt: now, succeededAt: now } }) })
    old.register('slack', failing({ fail: false }).run)
    expect(old.nextRun('slack')).toBe(now + 10 * MINUTE)
  })
})
