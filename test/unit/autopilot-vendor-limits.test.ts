// The budget, the Wave estimate and the Epic forecast of an Autopilot run by the Limits of its
// Vendor, and the Codex refusal that waits or stops (worfy-multi-vendor ticket 38, decision 09):
// - a run on Codex reads Codex's windows: the longest stands for the 7-day window, the others for
//   the 5-hour one; Pro has one weekly window, Plus a 5-hour and a weekly one (the snapshots of the
//   fake's scripts account-pro and limits-two-windows, as codexLimitWindows makes them);
// - the samples come from the Wave lines of runs on the same Vendor, never mixed with Claude's;
// - `limits` of a Wave's line has the shape of its Vendor, and both shapes read;
// - `usage-limit-window` (a window used up with its reset) waits until that reset, `usage-limit-quota`
//   (no window used up) stops the run with `vendor-quota` (the fake's scripts of the same names).
// Times of the budget are built in the Machine's local time, as the day of the budget is.
import { describe, expect, it } from 'vitest'
import { observeSessionLimits, type SessionLimitsStatus } from '../../src/main/agent/limits'
import type { EventSink } from '../../src/main/agent/session'
import { LimitsWait } from '../../src/main/autopilot/limits-wait'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitsState, LimitWindow } from '../../src/shared/agent/limits'
import { BUDGET_FRESH_MS, budgetDecision, weekReadings, type BudgetInput } from '../../src/shared/autopilot/budget'
import { budgetWindows, journalBudgetWindow, longestWindow, VENDOR_ESTIMATE_MIN_WAVES } from '../../src/shared/autopilot/budget-window'
import { epicForecast, FORECAST_MIN_SAMPLES, type EpicForecast } from '../../src/shared/autopilot/forecast'
import { fitBeforeReset, forecastLine, WIDE_RANGE_TEXT } from '../../src/shared/autopilot/forecast-lines'
import { formatJournalLine, journalLimits, journalVendorLimits, parseJournal, type JournalEvent, type JournalLimits, type VendorJournalLimits } from '../../src/shared/autopilot/journal'
import { ESTIMATE_MIN_WAVES, estimateMinWaves, waveEstimate, waveGrowth, waveSamples, type WaveLine } from '../../src/shared/autopilot/limits-estimate'
import { RESUME_MARGIN_MS, resumeAt, stillUsedUp } from '../../src/shared/autopilot/resume-at'

/** A local time in October 2026. */
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()
const S = (ms: number): number => ms / 1000

/** The weekly window resets on 31 October at 09:00, the 5-hour one at 13:00 of the day. */
const WEEK_RESET = at(31, 9)
const NOW = at(28, 10)
const FIVE_RESET = at(28, 13)
const RUN = '2026-10-28T01-00-00-000Z-a1b2c3'
const ON = { enabled: true, reserve: 0.15 }

/** A Codex window as codexLimitWindows makes it from a snapshot of account/rateLimits/read. */
function codex(id: 'primary' | 'secondary', usedPercent: number, minutes: number, resetsAt: number, extra: Partial<LimitWindow> = {}): LimitWindow {
  return { vendor: 'codex', id, label: minutes === 300 ? '5h' : 'weekly', usedPercent, windowMinutes: minutes, resetsAt: S(resetsAt), state: usedPercent >= 100 ? 'reached' : 'ok', receivedAt: NOW, source: 'read', ...extra }
}
/** Codex Pro (account-pro): one window, weekly, as `primary`. */
const pro = (used: number, extra: Partial<LimitWindow> = {}): LimitWindow[] => [codex('primary', used, 10080, WEEK_RESET, extra)]
/** Codex Plus (limits-two-windows): a 5-hour `primary` and a weekly `secondary`. */
const plus = (five: number, week: number, extra: Partial<LimitWindow> = {}): LimitWindow[] => [codex('primary', five, 300, FIVE_RESET, extra), codex('secondary', week, 10080, WEEK_RESET, extra)]
/** Plus with the weekly window at `week` percent and the 5-hour one at 10. */
const plusWeek = (week: number): LimitWindow[] => plus(10, week)

/** Claude's stored state with a 7-day share `week` (and a 5-hour one), all fresh at NOW. */
function claude(week: number, five?: number): LimitsState {
  const windows: LimitsState['windows'] = { seven_day: { utilization: week, resetsAt: S(WEEK_RESET), status: null, receivedAt: NOW, source: 'usage' } }
  if (five !== undefined) windows.five_hour = { utilization: five, resetsAt: S(FIVE_RESET), status: null, receivedAt: NOW, source: 'usage' }
  return { windows }
}

const line = (kind: 'wave-started' | 'wave-finished', wave: number, when: number, limits: JournalLimits | undefined, tickets = ['01']): WaveLine =>
  ({ at: iso(when), run: RUN, project: 'demo-00000001', epic: 'demo', kind, wave, tickets, ...(limits === undefined ? {} : { limits }) }) as WaveLine

/** The {windows} limits of a Codex Wave line, the windows received at `when`. */
const codexLimits = (windows: readonly LimitWindow[], when: number): VendorJournalLimits => journalVendorLimits('codex', windows.map((window) => ({ ...window, receivedAt: when })))!
/** The {five_hour, seven_day} limits of a Claude Wave line. */
const claudeLimits = (week: number, when: number): JournalLimits => ({ five_hour: null, seven_day: { utilization: week, receivedAt: iso(when), resetsAt: iso(WEEK_RESET) } })

/** A Codex Wave from `start` to `end` (ms) whose longest window grew from `from` to `to` percent. */
function codexWave(num: number, start: number, end: number, from: number, to: number, plan: (used: number) => LimitWindow[] = pro, tickets = ['01']): JournalEvent[] {
  return [line('wave-started', num, start, codexLimits(plan(from), start), tickets), line('wave-finished', num, end, codexLimits(plan(to), end), tickets)]
}

function claudeWave(num: number, start: number, end: number, from: number, to: number): JournalEvent[] {
  return [line('wave-started', num, start, claudeLimits(from, start)), line('wave-finished', num, end, claudeLimits(to, end))]
}

const decide = (input: Partial<BudgetInput>): ReturnType<typeof budgetDecision> =>
  budgetDecision({ budget: ON, now: NOW, limits: { windows: {} }, runs: [], estimate: null, tickets: 1, ...input })

describe('the budget window of the run\'s Vendor (budget-window.ts)', () => {
  it('is the longest window: Plus the weekly `secondary`, Pro its one weekly `primary`; one of unknown length only when none has a length', () => {
    expect(longestWindow(plus(10, 40))?.id).toBe('secondary')
    expect(longestWindow(pro(40))?.id).toBe('primary')
    expect(longestWindow([codex('primary', 1, 300, FIVE_RESET), { ...codex('secondary', 2, 10080, WEEK_RESET), windowMinutes: null }])?.id).toBe('primary')
    expect(longestWindow([{ ...codex('primary', 1, 300, FIVE_RESET), windowMinutes: null }])?.id).toBe('primary')
    expect(longestWindow([])).toBeNull()
  })

  it("a Wave line's {windows} with another Vendor's window too: the run's Vendor's longest window, never the other's", () => {
    const limits = { windows: [...codexLimits(plus(10, 40), NOW).windows, { ...codexLimits(pro(90), NOW).windows[0]!, vendor: 'other', id: 'monthly', windowMinutes: 43_200 }] } as JournalLimits
    expect(journalBudgetWindow(limits, 'codex')).toEqual({ id: 'secondary', utilization: 0.4, receivedAt: iso(NOW), resetsAt: iso(WEEK_RESET) })
    expect(journalBudgetWindow(limits, 'other')).toMatchObject({ id: 'monthly', utilization: 0.9 })
    expect(journalBudgetWindow(limits, 'gemini')).toBeNull()
  })

  it('reads Claude\'s seven_day and five_hour from the stored state, and another Vendor\'s windows only from its own list', () => {
    expect(budgetWindows(claude(0.4, 0.2))).toMatchObject({ week: { id: 'seven_day', utilization: 0.4 }, short: [{ id: 'five_hour', utilization: 0.2 }] })
    const mixed = [...plus(30, 41), { ...codex('secondary', 99, 20160, WEEK_RESET), vendor: 'claude' }]
    const read = budgetWindows(claude(0.99, 1), { vendor: 'codex', windows: mixed })
    expect(read.week).toEqual({ id: 'secondary', utilization: 0.41, resetsAt: S(WEEK_RESET), receivedAt: NOW, reached: false })
    expect(read.short).toEqual([{ id: 'primary', utilization: 0.3, resetsAt: S(FIVE_RESET), receivedAt: NOW, reached: false }])
    expect(budgetWindows(claude(0.4), { vendor: 'codex', windows: pro(40) })).toMatchObject({ week: { id: 'primary', utilization: 0.4 }, short: [] })
  })
})

describe('the budget on Codex (budget.ts)', () => {
  // The share of today: (1 − 0.15 − 0.30) / 4 days (28 to 31 October, the 31st up to 09:00) = 0.1375.
  const morning = at(28, 8)

  it('Pro, one weekly window: today counts from the first Codex number of today, and a Wave that does not fit waits for tomorrow', () => {
    const runs = [codexWave(1, morning, morning + 30 * 60_000, 30, 40)]
    const stop = decide({ limits: claude(0.99), vendor: { vendor: 'codex', windows: pro(40) }, runs, estimate: { perTicket: 0.05, waves: 5 } })
    expect(stop).toMatchObject({ kind: 'stop', cause: 'daily-share', need: 0.05 })
    if (stop.kind !== 'stop') throw new Error('no stop')
    expect(stop.share).toBeCloseTo((1 - 0.15 - 0.3) / 4, 10)
    expect(stop.used).toBeCloseTo(0.1, 10)
    expect(stop.until).toBe(at(29, 0))
  })

  it('Pro: the numbers of Claude runs do not count as today\'s start of a Codex run, nor Claude\'s 7-day share as its week', () => {
    const runs = [claudeWave(1, morning, morning + 30 * 60_000, 0.3, 0.4)]
    // No Codex number of today: the day starts now, from 40 %, so nothing of today is used.
    expect(decide({ limits: claude(0.99), vendor: { vendor: 'codex', windows: pro(40) }, runs, estimate: { perTicket: 0.05, waves: 5 } })).toEqual({ kind: 'go' })
    // The same journals on Claude: Claude's 99 % leaves nothing of today.
    expect(decide({ limits: claude(0.99), runs, estimate: { perTicket: 0.05, waves: 5 } })).toMatchObject({ kind: 'stop', cause: 'daily-share' })
    expect(weekReadings(runs, 'codex')).toEqual([])
    expect(weekReadings(runs)).toHaveLength(2)
    expect(weekReadings([codexWave(1, morning, morning + 60_000, 30, 31)], 'codex')).toEqual([
      { at: morning, utilization: 0.3, resetsAt: WEEK_RESET },
      { at: morning + 60_000, utilization: 0.31, resetsAt: WEEK_RESET },
    ])
  })

  it('Plus, two windows: the 5-hour window used up with today\'s share left holds the Wave until its reset, the weekly one decides the share', () => {
    const vendor = { vendor: 'codex', windows: plus(100, 40) }
    expect(decide({ limits: claude(0.1), vendor })).toEqual({ kind: 'stop', cause: 'five-hour', share: (1 - 0.15 - 0.4) / 4, used: 0, need: 0, until: FIVE_RESET + RESUME_MARGIN_MS })
    // `reached` without 100 % (Codex named the limit reached) holds it too; at 99 % and `ok` the Wave goes.
    expect(decide({ vendor: { vendor: 'codex', windows: [codex('primary', 80, 300, FIVE_RESET, { state: 'reached' }), codex('secondary', 40, 10080, WEEK_RESET)] } })).toMatchObject({ kind: 'stop', cause: 'five-hour' })
    expect(decide({ vendor: { vendor: 'codex', windows: plus(99, 40) } })).toEqual({ kind: 'go' })
    // Two time windows full with different resets: the Wave waits for the later one.
    const hourly = { ...codex('primary', 100, 60, FIVE_RESET + 3_600_000), id: 'hourly' }
    expect(decide({ vendor: { vendor: 'codex', windows: [hourly, ...plus(100, 40)] } })).toMatchObject({ kind: 'stop', cause: 'five-hour', until: FIVE_RESET + 3_600_000 + RESUME_MARGIN_MS })
    expect(decide({ vendor: { vendor: 'codex', windows: [...plus(100, 40), hourly] } })).toMatchObject({ kind: 'stop', cause: 'five-hour', until: FIVE_RESET + 3_600_000 + RESUME_MARGIN_MS })
    // The weekly window used up: no share of today at all.
    expect(decide({ vendor: { vendor: 'codex', windows: plus(10, 90) } })).toMatchObject({ kind: 'stop', cause: 'daily-share' })
  })

  it('Pro has no time window: a weekly window with share left lets the Wave go; a stale or unknown one decides nothing', () => {
    expect(decide({ vendor: { vendor: 'codex', windows: pro(40) } })).toEqual({ kind: 'go' })
    expect(decide({ vendor: { vendor: 'codex', windows: pro(90, { receivedAt: NOW - BUDGET_FRESH_MS - 1 }) } })).toEqual({ kind: 'go' })
    expect(decide({ vendor: { vendor: 'codex', windows: [] } })).toEqual({ kind: 'go' })
    expect(decide({ limits: claude(0.9), vendor: { vendor: 'codex', windows: [] } })).toEqual({ kind: 'go' })
  })
})

describe('the Wave estimate on Codex (limits-estimate.ts): samples by Wave', () => {
  const hour = (h: number): number => at(27, h)

  it('the growth of the longest window over a Wave per Ticket, from Codex lines only; Claude\'s lines give Claude\'s samples only', () => {
    const runs = [[...codexWave(1, hour(1), hour(1) + 600_000, 40, 44, plusWeek, ['01', '02']), ...claudeWave(2, hour(2), hour(2) + 600_000, 0.1, 0.13)]]
    expect(waveSamples(runs, 'codex')).toHaveLength(1)
    expect(waveSamples(runs, 'codex')[0]).toBeCloseTo(0.02, 10)
    expect(waveSamples(runs)[0]).toBeCloseTo(0.03, 10)
    expect(waveSamples(runs)).toHaveLength(1)
  })

  it('a Wave whose longest window changed between its ends (the plan changed), fell, or reset inside it gives no sample', () => {
    const [started] = codexWave(1, hour(1), hour(1) + 600_000, 40, 44, pro)
    const [, finished] = codexWave(1, hour(1), hour(1) + 600_000, 40, 44, plusWeek)
    expect(waveGrowth(started as WaveLine, finished as WaveLine, 'codex')).toBeNull()
    const [down, up] = codexWave(1, hour(1), hour(1) + 600_000, 44, 40)
    expect(waveGrowth(down as WaveLine, up as WaveLine, 'codex')).toBeNull()
    const [same, end] = codexWave(1, hour(1), hour(1) + 600_000, 40, 44)
    expect(waveGrowth(same as WaveLine, end as WaveLine, 'codex')).toBeCloseTo(0.04, 10)
    expect(waveGrowth(same as WaveLine, end as WaveLine)).toBeNull()
  })

  it('needs 5 Waves on Codex ("not enough data" under 5), 3 on Claude as before', () => {
    expect(estimateMinWaves('codex')).toBe(VENDOR_ESTIMATE_MIN_WAVES)
    expect(VENDOR_ESTIMATE_MIN_WAVES).toBe(5)
    expect(estimateMinWaves()).toBe(ESTIMATE_MIN_WAVES)
    const waves = (n: number): JournalEvent[][] => [Array.from({ length: n }, (_, i) => codexWave(i + 1, hour(i + 1), hour(i + 1) + 600_000, 10 + i * 5, 12 + i * 5)).flat()]
    expect(waveEstimate(waves(4), 'codex')).toBeNull()
    expect(waveEstimate(waves(5), 'codex')).toMatchObject({ waves: 5 })
    expect(waveEstimate(waves(5), 'codex')!.perTicket).toBeCloseTo(0.02, 10)
    expect(waveEstimate(waves(5))).toBeNull()
    const claudeRuns = [Array.from({ length: 3 }, (_, i) => claudeWave(i + 1, hour(i + 1), hour(i + 1) + 600_000, 0.1, 0.12)).flat()]
    expect(waveEstimate(claudeRuns)?.waves).toBe(3)
    expect(waveEstimate(claudeRuns, 'codex')).toBeNull()
  })
})

describe('the Epic forecast on Codex (forecast.ts, forecast-lines.ts)', () => {
  const resets = S(WEEK_RESET)
  const FIVE: EpicForecast = { waves: 2, tickets: 3, uncounted: 0, samples: 5, range: { low: 0.04, high: 0.09 }, cumulativeHigh: [0, 0.03, 0.09] }

  it('draws from the Codex samples by Wave: under FORECAST_MIN_SAMPLES no range, then a range', () => {
    const samples = (n: number): number[] => waveSamples([Array.from({ length: n }, (_, i) => codexWave(i + 1, at(27, i + 1), at(27, i + 1) + 600_000, 10, 12 + i)).flat()], 'codex')
    expect(FORECAST_MIN_SAMPLES).toBe(5)
    expect(epicForecast({ samples: samples(4), waves: { waves: [2], uncounted: [] } }).range).toBeNull()
    const range = epicForecast({ samples: samples(5), waves: { waves: [2], uncounted: [] } }).range
    expect(range).not.toBeNull()
    expect(range!.low).toBeGreaterThanOrEqual(0.04)
    expect(range!.high).toBeLessThanOrEqual(0.12)
  })

  it('the forecast line says the range is wide and reads "Used now" of the longest window; Claude\'s line has no such mark', () => {
    const vendor = { vendor: 'codex', windows: plus(12, 41) }
    const line = forecastLine({ forecast: FIVE, limits: claude(0.7), now: NOW, vendor })
    expect(line).toContain(`usually 4–9% of the week. ${WIDE_RANGE_TEXT}. Used now: 41%, resets in`)
    expect(forecastLine({ forecast: FIVE, limits: claude(0.7), now: NOW })).not.toContain(WIDE_RANGE_TEXT)
    expect(forecastLine({ forecast: FIVE, limits: claude(0.7), now: NOW })).toContain('Used now: 70%')
    // Under 5 samples it says there is not enough data, as on Claude.
    expect(forecastLine({ forecast: { ...FIVE, samples: 4, range: null, cumulativeHigh: null }, limits: claude(0.7), now: NOW, vendor })).toContain('Not enough data for a forecast: fewer than 5 past Waves')
  })

  it('K before the reset reads the longest window of the run\'s Vendor', () => {
    // Free before the reset with the reserve: 1 − 0.15 − 0.80 = 0.05 on Codex, the first Wave (0.03) fits; on Claude's 10 % both do.
    const vendor = { vendor: 'codex', windows: [codex('secondary', 80, 10080, WEEK_RESET)] }
    expect(fitBeforeReset({ forecast: FIVE, limits: claude(0.1), now: NOW, reserve: 0.15, vendor })).toBe(1)
    expect(fitBeforeReset({ forecast: FIVE, limits: claude(0.1), now: NOW, reserve: 0.15 })).toBe(2)
    expect(fitBeforeReset({ forecast: FIVE, limits: claude(0.1), now: NOW, reserve: 0.15, vendor: { vendor: 'codex', windows: [] } })).toBeNull()
    expect(resets).toBe(S(WEEK_RESET))
  })
})

describe('`limits` of a Wave line in the Journal: both shapes (journal.ts)', () => {
  const wave = (limits: unknown): string =>
    JSON.stringify({ at: iso(NOW), run: RUN, project: 'demo-00000001', epic: 'demo', kind: 'wave-started', wave: 1, tickets: ['01'], limits })

  it('reads the line of a Claude run {five_hour, seven_day} as before, and a Codex run\'s {windows}', () => {
    const old = claudeLimits(0.4, NOW)
    const fresh = codexLimits(plus(12, 41), NOW)
    const { events, skipped } = parseJournal([wave(old), wave(fresh)].join('\n'))
    expect(skipped).toBe(0)
    expect(events.map((event) => (event.kind === 'wave-started' ? event.limits : null))).toEqual([old, fresh])
    expect(fresh).toEqual({
      windows: [
        { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 12, windowMinutes: 300, resetsAt: iso(FIVE_RESET), receivedAt: iso(NOW), state: 'ok', source: 'read' },
        { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 41, windowMinutes: 10080, resetsAt: iso(WEEK_RESET), receivedAt: iso(NOW), state: 'ok', source: 'read' },
      ],
    })
    expect(journalBudgetWindow(events[0]!.kind === 'wave-started' ? events[0].limits : undefined)).toEqual({ id: 'seven_day', utilization: 0.4, receivedAt: iso(NOW), resetsAt: iso(WEEK_RESET) })
    expect(journalBudgetWindow(fresh, 'codex')).toEqual({ id: 'secondary', utilization: 0.41, receivedAt: iso(NOW), resetsAt: iso(WEEK_RESET) })
    // The other shape gives the other Vendor nothing.
    expect(journalBudgetWindow(fresh)).toBeNull()
    expect(journalBudgetWindow(old, 'codex')).toBeNull()
  })

  it('a limits value outside both shapes is dropped and the line read without it', () => {
    const { events, skipped } = parseJournal([wave({ windows: [] }), wave({ windows: [{ id: 'primary' }] }), wave({ seven_day: 5 })].join('\n'))
    expect(skipped).toBe(0)
    expect(events.map((event) => (event.kind === 'wave-started' ? event.limits : 'other'))).toEqual([undefined, undefined, undefined])
  })

  it('journalVendorLimits keeps only the Vendor\'s windows, writes an out-of-range number as unknown, and gives none for no window', () => {
    const odd = [codex('primary', -1, 0, FIVE_RESET), { ...codex('secondary', 41, 10080, WEEK_RESET), vendor: 'other' }, { ...codex('secondary', 5, 10080, WEEK_RESET), id: '' }]
    const written = journalVendorLimits('codex', odd)
    expect(written).toEqual({ windows: [{ vendor: 'codex', id: 'primary', label: 'weekly', usedPercent: null, windowMinutes: null, resetsAt: iso(FIVE_RESET), receivedAt: iso(NOW), state: 'ok', source: 'read' }] })
    expect(() => formatJournalLine({ ...line('wave-started', 1, NOW, written) })).not.toThrow()
    // A time out of the range of dates (finite, but past year 9999) does not throw: an unknown reset, and
    // a window received at no writable time is left out.
    const far = journalVendorLimits('codex', [{ ...codex('primary', 10, 300, FIVE_RESET), resetsAt: 1e13 }, { ...codex('secondary', 40, 10080, WEEK_RESET), receivedAt: 1e17 }])
    expect(far).toEqual({ windows: [expect.objectContaining({ id: 'primary', resetsAt: null, receivedAt: iso(NOW) })] })
    expect(() => formatJournalLine({ ...line('wave-started', 1, NOW, far) })).not.toThrow()
    expect(journalVendorLimits('codex', [{ ...codex('primary', 10, 300, FIVE_RESET), receivedAt: 1e13 * 1000 }])).toBeUndefined()
    expect(journalVendorLimits('codex', [{ ...codex('primary', 10, 300, FIVE_RESET), resetsAt: 300_000_000_000 }])?.windows[0]?.resetsAt).toBeNull()
    expect(journalVendorLimits('codex', [])).toBeUndefined()
    expect(journalVendorLimits('codex', [{ ...codex('primary', 1, 300, FIVE_RESET), vendor: 'claude' }])).toBeUndefined()
    // Claude's lines are written as before.
    expect(journalLimits(claude(0.4))).toEqual({ five_hour: null, seven_day: { utilization: 0.4, receivedAt: iso(NOW), resetsAt: iso(WEEK_RESET) } })
  })

  it('reads limits-hit with `reason: quota` and its message; an unknown reason reads as none, and a line before ticket 38 as before', () => {
    const hit = (fields: Record<string, unknown>): string => JSON.stringify({ at: iso(NOW), run: RUN, project: 'demo-00000001', epic: 'demo', kind: 'limits-hit', window: null, resetsAt: null, ...fields })
    const { events, skipped } = parseJournal([hit({ reason: 'quota', message: "You've hit your usage limit." }), hit({ reason: 'later' }), hit({})].join('\n'))
    expect(skipped).toBe(0)
    expect(events.map((event) => (event.kind === 'limits-hit' ? [event.reason, event.message] : null))).toEqual([['quota', "You've hit your usage limit."], [undefined, undefined], [undefined, undefined]])
  })
})

describe('a Codex refusal: usage-limit-window waits until resetsAt, usage-limit-quota stops with vendor-quota', () => {
  /** The fake's clock: its scripts' turns run at 1793000000. */
  const CLOCK = 1_793_000_000_000
  /** `limit_reached` as the Codex driver makes it of each script (codexLimitReached over its windows). */
  const WINDOW: AgentEvent = { type: 'limit_reached', vendor: 'codex', windowId: 'primary', resetsAt: 1_793_003_600, reason: 'window' } as AgentEvent
  const QUOTA: AgentEvent = { type: 'limit_reached', vendor: 'codex', windowId: null, resetsAt: null, reason: 'quota' } as AgentEvent

  /** A LimitsWait over one Session that is sent `event` during a turn ending with the script's error. */
  function refused(event: AgentEvent): { wait: LimitsWait; statuses: SessionLimitsStatus[] } {
    let sink: EventSink | null = null
    const statuses: SessionLimitsStatus[] = []
    const wait = new LimitsWait({
      state: () => ({ windows: {} }),
      observeSession: (isSession, listener) => observeSessionLimits((each) => ((sink = each), () => (sink = null)), isSession, (status) => (statuses.push(status), listener(status))),
      send: () => undefined,
      now: () => CLOCK,
      schedule: () => () => undefined,
    })
    wait.watch((id) => id === 's')
    wait.turnStarted()
    ;(sink as EventSink | null)?.('s', event)
    return { wait, statuses }
  }
  const end = { isError: true, interrupted: false, message: "You've hit your usage limit. Try again later." }

  it('usage-limit-window: the hit names the used-up window, and the run waits until its resetsAt plus the margin', () => {
    const { wait, statuses } = refused(WINDOW)
    expect(statuses).toEqual([{ status: 'rejected', window: 'primary', resetsAt: 1_793_003_600 }])
    const hit = wait.hitOf(end)
    expect(hit).toEqual({ window: 'primary', resetsAt: 1_793_003_600 })
    expect(wait.plan(hit!)).toEqual({ kind: 'at', at: 1_793_003_600_000 + RESUME_MARGIN_MS, resetsAt: 1_793_003_600_000 })
  })

  it('a quota after a refusal with the same window and reset (both unknown) is a new status, not a repeat', () => {
    let sink: EventSink | null = null
    const statuses: SessionLimitsStatus[] = []
    observeSessionLimits((each) => ((sink = each), () => (sink = null)), () => true, (status) => statuses.push(status))
    const unknown = { type: 'limit_reached', vendor: 'codex', windowId: null, resetsAt: null, reason: 'window' } as AgentEvent
    ;(sink as EventSink | null)?.('s', unknown)
    ;(sink as EventSink | null)?.('s', QUOTA)
    ;(sink as EventSink | null)?.('s', QUOTA)
    expect(statuses).toEqual([
      { status: 'rejected', window: null, resetsAt: null },
      { status: 'rejected', window: null, resetsAt: null, quota: true },
    ])
  })

  it('usage-limit-quota: the hit is a quota, and the plan is to stop (vendor-quota), not to wait', () => {
    const { wait, statuses } = refused(QUOTA)
    expect(statuses).toEqual([{ status: 'rejected', window: null, resetsAt: null, quota: true }])
    const hit = wait.hitOf(end)
    expect(hit).toEqual({ window: null, resetsAt: null, quota: true })
    expect(wait.plan(hit!)).toEqual({ kind: 'quota' })
    // Without the quota the same refusal would wait and try again: what the quota changes.
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: { windows: {} }, now: CLOCK, since: CLOCK }).kind).toBe('recheck')
  })

  it('after the wait, a window of the fresh read still used up with its reset ahead is waited for once more; none, and the run goes on', () => {
    const later = CLOCK + 3_600_000
    const reads = (five: number, resetsAt: number): LimitWindow[] => [{ ...codex('primary', five, 300, resetsAt), receivedAt: later }]
    expect(stillUsedUp(reads(100, later + 600_000), later)).toEqual({ window: 'primary', resetsAt: S(later + 600_000) })
    expect(stillUsedUp([{ ...reads(40, later + 600_000)[0]!, state: 'reached' }], later)).toEqual({ window: 'primary', resetsAt: S(later + 600_000) })
    expect(stillUsedUp(reads(99, later + 600_000), later)).toBeNull()
    expect(stillUsedUp(reads(100, later - 1000), later)).toBeNull()
    // A reset at `now` or before is over: that window is skipped, also when it is the later one of two.
    expect(stillUsedUp(reads(100, later), later)).toBeNull()
    expect(stillUsedUp([...reads(100, later), { ...codex('secondary', 40, 10080, later + 7_200_000), receivedAt: later }], later)).toBeNull()
    expect(stillUsedUp([{ ...reads(100, later - 1000)[0]!, id: 'past' }, ...reads(100, later + 600_000)], later)).toEqual({ window: 'primary', resetsAt: S(later + 600_000) })
    expect(stillUsedUp([...reads(100, later + 600_000), { ...codex('secondary', 100, 10080, later + 7_200_000), receivedAt: later }], later)).toEqual({ window: 'secondary', resetsAt: S(later + 7_200_000) })
  })
})
