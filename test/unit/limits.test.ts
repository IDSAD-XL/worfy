// Limits from rate_limit_event messages and the status line bridge file:
// src/shared/agent/limits.ts merges them per window and turns the result into the two bars.
import { describe, expect, it } from 'vitest'
import { emptyLimits, limitBars, limitsStateSchema, limitUpdatesFromSdk, limitUpdatesFromStatusline, limitUpdatesFromUsage, mergeLimits } from '../../src/shared/agent/limits'

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

/**
 * A hand-made rate_limit_event in the shape recorded in test/fixtures/sdk-messages/init.jsonl
 * (Claude Code 2.1.289); its numbers are not the recorded ones, so the two windows differ clearly.
 */
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

  it('keeps the known reset time for an update without one while it is ahead, from either source, and drops it once passed', () => {
    const reset = 1791184200
    const known = mergeLimits(emptyLimits(), [{ window: 'seven_day', state: { utilization: 0.4, resetsAt: reset, status: 'allowed', receivedAt: AT, source: 'sdk' } }])
    const refusal = (receivedAt: number, source: 'sdk' | 'statusline' = 'sdk') => ({ window: 'seven_day', state: { utilization: null, resetsAt: null, status: 'rejected', receivedAt, source } })

    expect(mergeLimits(known, [refusal(reset * 1000 - 1)]).windows.seven_day).toEqual({ utilization: null, resetsAt: reset, status: 'rejected', receivedAt: reset * 1000 - 1, source: 'sdk' })
    expect(mergeLimits(known, [refusal(reset * 1000 - 1, 'statusline')]).windows.seven_day).toMatchObject({ resetsAt: reset, source: 'statusline' })
    // At the reset time or after it, the old time is no longer the window's.
    expect(mergeLimits(known, [refusal(reset * 1000)]).windows.seven_day).toMatchObject({ resetsAt: null, status: 'rejected' })
    // An update with its own reset time replaces the known one.
    const own = { ...refusal(AT + 1).state, resetsAt: reset + 60 }
    expect(mergeLimits(known, [{ window: 'seven_day', state: own }]).windows.seven_day).toEqual(own)
    // A window with nothing known keeps none.
    expect(mergeLimits(emptyLimits(), [refusal(AT)]).windows.seven_day).toMatchObject({ resetsAt: null })
  })

  describe('an update without a status (the status line bridge) after a status from the SDK', () => {
    // Both sources give the reset time in Unix seconds on the hour: 7-day 1791777600 in both
    // (recorded 2026-10-06). One window's reset time from the two may differ by up to an hour.
    const reset = 1791777600
    const warned = mergeLimits(emptyLimits(), [{ window: 'seven_day', state: { utilization: 0.45, resetsAt: reset, status: 'allowed_warning', receivedAt: AT, source: 'sdk' } }])
    const bridge = (resetsAt: number | null, receivedAt = AT + 1000) => limitUpdatesFromStatusline({ seven_day: { used_percentage: 33, resets_at: resetsAt } }, receivedAt)

    it('keeps the status while the window is the same: the same reset time, or one an hour apart at most', () => {
      expect(mergeLimits(warned, bridge(reset)).windows.seven_day).toEqual({ utilization: 0.33, resetsAt: reset, status: 'allowed_warning', receivedAt: AT + 1000, source: 'statusline' })
      expect(mergeLimits(warned, bridge(reset + 3600)).windows.seven_day).toMatchObject({ status: 'allowed_warning', resetsAt: reset + 3600 })
      expect(mergeLimits(warned, bridge(reset - 3600)).windows.seven_day).toMatchObject({ status: 'allowed_warning' })
      // Without a reset time of its own the update takes the known one, which is still ahead.
      expect(mergeLimits(warned, bridge(null)).windows.seven_day).toMatchObject({ status: 'allowed_warning', resetsAt: reset })
      // The bar keeps its warning colour.
      expect(limitBars(mergeLimits(warned, bridge(reset)), AT + 1000, { timeZone: TZ })?.[1]).toMatchObject({ value: '33%', level: 'working' })
    })

    it('drops the status in a new window: another reset time, or the known one passed', () => {
      expect(mergeLimits(warned, bridge(reset + 3601)).windows.seven_day).toMatchObject({ status: null, resetsAt: reset + 3601 })
      expect(mergeLimits(warned, bridge(reset + 7 * 24 * 3600)).windows.seven_day).toMatchObject({ status: null })
      expect(mergeLimits(warned, bridge(reset + 7 * 24 * 3600, reset * 1000)).windows.seven_day).toMatchObject({ status: null })
      expect(mergeLimits(warned, bridge(null, reset * 1000)).windows.seven_day).toMatchObject({ status: null, resetsAt: null })
      // A late file still naming the passed reset time does not bring the old window's status back.
      expect(mergeLimits(warned, bridge(reset, reset * 1000)).windows.seven_day).toMatchObject({ status: null, resetsAt: reset })
    })

    it('drops it when the window had no reset time to compare with', () => {
      const noReset = mergeLimits(emptyLimits(), [{ window: 'seven_day', state: { utilization: null, resetsAt: null, status: 'allowed_warning', receivedAt: AT, source: 'sdk' } }])
      expect(mergeLimits(noReset, bridge(reset)).windows.seven_day).toMatchObject({ status: null })
    })

    it('lets a newer status replace the known one in the same window', () => {
      const allowed = { utilization: 0.4, resetsAt: reset, status: 'allowed', receivedAt: AT + 1000, source: 'sdk' as const }
      expect(mergeLimits(warned, [{ window: 'seven_day', state: allowed }]).windows.seven_day).toEqual(allowed)
    })
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

describe('limitUpdatesFromUsage (the answer of the SDK usage request)', () => {
  it('reads the share 0..100 and the ISO reset time of both windows', () => {
    const value = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 10, resets_at: '2026-10-05T07:10:00.000Z' }, seven_day: { utilization: 8, resets_at: '2026-10-12T09:00:00Z' }, seven_day_opus: { utilization: 50, resets_at: null } } }
    expect(limitUpdatesFromUsage(value, AT)).toEqual([
      { window: 'five_hour', state: { utilization: 0.1, resetsAt: 1791184200, status: null, receivedAt: AT, source: 'usage' } },
      { window: 'seven_day', state: { utilization: 0.08, resetsAt: 1791795600, status: null, receivedAt: AT, source: 'usage' } },
    ])
  })

  it('a missing share or an unreadable time counts as missing; a window with neither is skipped', () => {
    const value = { rate_limits: { five_hour: { utilization: null, resets_at: 'not a time' }, seven_day: { utilization: 'x', resets_at: '2026-10-12T09:00:00Z' } } }
    expect(limitUpdatesFromUsage(value, AT)).toEqual([{ window: 'seven_day', state: { utilization: null, resetsAt: 1791795600, status: null, receivedAt: AT, source: 'usage' } }])
  })

  it('no rate limits (an API key, Bedrock, Vertex) and anything that is not an answer give nothing', () => {
    for (const value of [null, undefined, 'text', 42, {}, { rate_limits_available: false, rate_limits: null }, { rate_limits: 'x' }]) {
      expect(limitUpdatesFromUsage(value, AT)).toEqual([])
    }
  })

  it('keeps an SDK status of the same window, as the status line does', () => {
    const known = mergeLimits(emptyLimits(), [{ window: 'seven_day', state: { utilization: 0.8, resetsAt: 1791795600, status: 'allowed_warning', receivedAt: AT - 1000, source: 'sdk' } }])
    const next = mergeLimits(known, limitUpdatesFromUsage({ rate_limits: { seven_day: { utilization: 81, resets_at: '2026-10-12T09:00:00Z' } } }, AT))
    expect(next.windows.seven_day).toEqual({ utilization: 0.81, resetsAt: 1791795600, status: 'allowed_warning', receivedAt: AT, source: 'usage' })
  })
})

describe('limits.json with a source this build does not know', () => {
  it('is read, not set aside: the status and the reset times stay, the source reads as sdk', () => {
    const file = {
      windows: {
        seven_day: { utilization: null, resetsAt: 1791795600, status: 'rejected', receivedAt: AT, source: 'a-source-of-a-newer-build' },
        five_hour: { utilization: 0.4, resetsAt: 1791184200, status: null, receivedAt: AT, source: 'statusline' },
      },
    }
    const parsed = limitsStateSchema.safeParse(file)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.windows.seven_day).toEqual({ utilization: null, resetsAt: 1791795600, status: 'rejected', receivedAt: AT, source: 'sdk' })
    expect(parsed.data?.windows.five_hour?.source).toBe('statusline')
  })
})
