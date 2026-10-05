// Limits from rate_limit_event messages and the status line bridge file:
// src/shared/agent/limits.ts merges them per window and turns the result into the two bars.
import { describe, expect, it } from 'vitest'
import { emptyLimits, limitBars, limitUpdatesFromSdk, limitUpdatesFromStatusline, mergeLimits } from '../../src/shared/agent/limits'

const AT = Date.UTC(2026, 9, 5, 5, 0) // Mon 2026-10-05 05:00 UTC
const TZ = 'UTC'

describe('a rate_limit_event without utilization and resetsAt', () => {
  const message = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour' } }

  it('becomes a window with its status and nothing else', () => {
    expect(limitUpdatesFromSdk(message, AT)).toEqual([
      { window: 'five_hour', state: { utilization: null, resetsAt: null, status: 'allowed_warning', receivedAt: AT, source: 'sdk' } },
    ])
  })

  it('shows the status in words, without a share or a reset time', () => {
    const state = mergeLimits(emptyLimits(), limitUpdatesFromSdk(message, AT))
    const [fiveHour, sevenDay] = limitBars(state, AT, { timeZone: TZ }) ?? []
    expect(fiveHour).toMatchObject({ window: 'five_hour', label: '5-hour', percent: null, value: 'near limit', resets: null, asOf: null, level: 'working' })
    expect(sevenDay).toMatchObject({ window: 'seven_day', label: '7-day', percent: null, value: 'no data', resets: null, level: 'normal' })
  })
})

/** The rate_limit_event of test/fixtures/sdk-messages/init.jsonl (Claude Code 2.1.289). */
const recorded = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1791184200,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: 0.62, resetsAt: 1791184200 }, seven_day: { utilization: 0.38, resetsAt: 1791795600 } },
  },
  uuid: '00000000-0000-4000-8000-000000000009',
  session_id: '00000000-0000-4000-8000-000000000003',
}

describe('limitUpdatesFromSdk', () => {
  it('reads both windows; the status belongs to the rateLimitType window only', () => {
    expect(limitUpdatesFromSdk(recorded, AT)).toEqual([
      { window: 'seven_day', state: { utilization: 0.38, resetsAt: 1791795600, status: null, receivedAt: AT, source: 'sdk' } },
      { window: 'five_hour', state: { utilization: 0.62, resetsAt: 1791184200, status: 'allowed', receivedAt: AT, source: 'sdk' } },
    ])
  })

  it('falls back to the top-level utilization and resetsAt without unifiedWindows', () => {
    const message = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', utilization: 0.97, resetsAt: 1791795600 } }
    expect(limitUpdatesFromSdk(message, AT)).toEqual([
      { window: 'seven_day', state: { utilization: 0.97, resetsAt: 1791795600, status: 'rejected', receivedAt: AT, source: 'sdk' } },
    ])
  })

  it('keeps other limit types under their own name', () => {
    const message = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day_opus', utilization: 0.7 } }
    expect(limitUpdatesFromSdk(message, AT).map((update) => update.window)).toEqual(['seven_day_opus'])
  })

  it('treats fields of the wrong type, negative and non-finite numbers as missing', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: '62%', resetsAt: -1, unifiedWindows: { five_hour: 'x', seven_day: { utilization: Infinity, resetsAt: 'Thu' } } },
    }
    expect(limitUpdatesFromSdk(message, AT)).toEqual([
      { window: 'seven_day', state: { utilization: null, resetsAt: null, status: null, receivedAt: AT, source: 'sdk' } },
      { window: 'five_hour', state: { utilization: null, resetsAt: null, status: 'allowed', receivedAt: AT, source: 'sdk' } },
    ])
  })

  it('ignores other messages and a rate_limit_event without a status', () => {
    expect(limitUpdatesFromSdk({ type: 'result', subtype: 'success' }, AT)).toEqual([])
    expect(limitUpdatesFromSdk({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour' } }, AT)).toEqual([])
    expect(limitUpdatesFromSdk(null, AT)).toEqual([])
    expect(limitUpdatesFromSdk('rate_limit_event', AT)).toEqual([])
  })
})

describe('limitUpdatesFromStatusline', () => {
  it('turns used_percentage into a share and drops keys it does not know', () => {
    const value = { five_hour: { used_percentage: 29, resets_at: 1791202800, extra: 1 }, seven_day: { used_percentage: 9, resets_at: 1791777600 }, other: {} }
    expect(limitUpdatesFromStatusline(value, AT)).toEqual([
      { window: 'five_hour', state: { utilization: 0.29, resetsAt: 1791202800, status: null, receivedAt: AT, source: 'statusline' } },
      { window: 'seven_day', state: { utilization: 0.09, resetsAt: 1791777600, status: null, receivedAt: AT, source: 'statusline' } },
    ])
  })

  it('skips a window that is missing or carries nothing usable', () => {
    expect(limitUpdatesFromStatusline({ five_hour: { used_percentage: 'a lot' } }, AT)).toEqual([])
    expect(limitUpdatesFromStatusline({ seven_day: { resets_at: 1791777600 } }, AT)).toEqual([
      { window: 'seven_day', state: { utilization: null, resetsAt: 1791777600, status: null, receivedAt: AT, source: 'statusline' } },
    ])
    expect(limitUpdatesFromStatusline(null, AT)).toEqual([])
    expect(limitUpdatesFromStatusline([1, 2], AT)).toEqual([])
  })
})

describe('mergeLimits', () => {
  const window = (utilization: number, receivedAt: number, source: 'sdk' | 'statusline' = 'sdk') => ({ utilization, resetsAt: 1791184200, status: null, receivedAt, source })

  it('lets a newer update replace the older one of the same window and keeps the others', () => {
    const first = mergeLimits(emptyLimits(), [
      { window: 'five_hour', state: window(0.1, AT) },
      { window: 'seven_day', state: window(0.3, AT) },
    ])
    const second = mergeLimits(first, [{ window: 'five_hour', state: window(0.2, AT + 1000, 'statusline') }])
    expect(second.windows.five_hour).toEqual(window(0.2, AT + 1000, 'statusline'))
    expect(second.windows.seven_day).toEqual(window(0.3, AT))
  })

  it('does not let an older update undo a newer one', () => {
    const state = mergeLimits(emptyLimits(), [{ window: 'five_hour', state: window(0.5, AT) }])
    expect(mergeLimits(state, [{ window: 'five_hour', state: window(0.1, AT - 1) }])).toBe(state)
  })

  it('replaces the whole window: a newer event without a share drops the old share', () => {
    const state = mergeLimits(emptyLimits(), [{ window: 'five_hour', state: window(0.5, AT) }])
    const next = mergeLimits(state, [{ window: 'five_hour', state: { utilization: null, resetsAt: null, status: 'rejected', receivedAt: AT + 1, source: 'sdk' } }])
    expect(next.windows.five_hour).toMatchObject({ utilization: null, status: 'rejected' })
  })

  it('returns the same state when nothing changed', () => {
    const state = mergeLimits(emptyLimits(), [{ window: 'five_hour', state: window(0.5, AT) }])
    expect(mergeLimits(state, [{ window: 'five_hour', state: window(0.5, AT) }])).toBe(state)
    expect(mergeLimits(state, [])).toBe(state)
  })
})

describe('limitBars', () => {
  const state = mergeLimits(emptyLimits(), limitUpdatesFromSdk(recorded, AT))

  it('is null when nothing is known about either window', () => {
    expect(limitBars(emptyLimits(), AT, { timeZone: TZ })).toBeNull()
    const onlyOpus = mergeLimits(emptyLimits(), [{ window: 'seven_day_opus', state: { utilization: 0.1, resetsAt: null, status: null, receivedAt: AT, source: 'sdk' } }])
    expect(limitBars(onlyOpus, AT, { timeZone: TZ })).toBeNull()
  })

  it('shows the share and the reset time: a clock for 5-hour, a weekday and a clock for 7-day', () => {
    // 1791184200 = Mon 2026-10-05 07:10 UTC, 1791795600 = Mon 2026-10-12 09:00 UTC.
    expect(limitBars(state, AT, { timeZone: TZ })).toEqual([
      { window: 'five_hour', label: '5-hour', percent: 62, value: '62%', resets: 'resets 07:10', asOf: null, level: 'working' },
      { window: 'seven_day', label: '7-day', percent: 38, value: '38%', resets: 'resets Mon 09:00', asOf: null, level: 'normal' },
    ])
  })

  it('shows times in the given time zone', () => {
    expect(limitBars(state, AT, { timeZone: 'Europe/Moscow' })?.[0]?.resets).toBe('resets 10:10')
  })

  it('marks data older than an hour with the time it arrived', () => {
    expect(limitBars(state, AT + 60 * 60 * 1000, { timeZone: TZ })?.[0]?.asOf).toBeNull()
    expect(limitBars(state, AT + 60 * 60 * 1000 + 1, { timeZone: TZ })?.[0]?.asOf).toBe('as of 05:00')
    expect(limitBars(state, AT + 24 * 60 * 60 * 1000, { timeZone: TZ })?.[0]?.asOf).toBe('as of Mon 05:00')
  })

  it('colours a bar working from 60% and blocked from 85%, or by status', () => {
    const at = (utilization: number | null, status: string | null = null) =>
      limitBars(mergeLimits(emptyLimits(), [{ window: 'five_hour', state: { utilization, resetsAt: null, status, receivedAt: AT, source: 'sdk' } }]), AT, { timeZone: TZ })?.[0]
    expect(at(0.59)?.level).toBe('normal')
    expect(at(0.6)?.level).toBe('working')
    expect(at(0.849)?.level).toBe('working')
    expect(at(0.85)?.level).toBe('blocked')
    expect(at(0.1, 'rejected')).toMatchObject({ level: 'blocked', value: '10%' })
    expect(at(null, 'rejected')).toMatchObject({ level: 'blocked', value: 'limit reached', percent: null })
    expect(at(null, 'allowed')).toMatchObject({ level: 'normal', value: 'allowed' })
    expect(at(null, 'paused')).toMatchObject({ value: 'paused' })
    expect(at(null)).toMatchObject({ value: 'unknown' })
  })
})
