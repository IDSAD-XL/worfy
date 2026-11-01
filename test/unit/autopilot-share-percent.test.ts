// A share of the week in whole percents (src/shared/autopilot/share-percent.ts; worfy-resource-planner
// ticket 11, round 1): half up from whole millionths, the one rule of the forecast lines and of Run history.
import { describe, expect, it } from 'vitest'
import { sharePercent, shareRangeText, shareText, shareUnits } from '../../src/shared/autopilot/share-percent'

describe('a share of the week in whole percents', () => {
  it('rounds half up from whole millionths, where × 100 in floating point falls under the half', () => {
    // 0.145 × 100 = 14.499999999999998 and 0.285 × 100 = 28.499999999999996 in floating point.
    expect(sharePercent(0.145)).toBe(15)
    expect(sharePercent(0.285)).toBe(29)
    expect(sharePercent(0.005)).toBe(1)
    expect(sharePercent(0.995)).toBe(100)
  })

  it('rounds down under the half, and keeps the ends', () => {
    expect(sharePercent(0.0049)).toBe(0)
    expect(sharePercent(0.144999)).toBe(14)
    expect(sharePercent(0)).toBe(0)
    expect(sharePercent(1)).toBe(100)
  })

  it('counts millionths whole: the binary error of a sum is not a millionth', () => {
    expect(shareUnits(1 - 0.15 - 0.45)).toBe(400_000)
    expect(shareUnits(0.285)).toBe(285_000)
  })

  it('words a range as the forecast line does', () => {
    expect(shareRangeText({ low: 0.145, high: 0.285 })).toBe('15–29%')
    expect(shareRangeText({ low: 0.181, high: 0.184 })).toBe('about 18%')
    expect(shareRangeText({ low: 0.001, high: 0.004 })).toBe('less than 1%')
    // 0.995 is 100 %, not «less than 1%»: only the high edge under one percent says that.
    expect(shareRangeText({ low: 0.005, high: 0.995 })).toBe('1–100%')
  })

  it('words one share: «less than 1%» above nothing and under one percent, «0%» for nothing', () => {
    expect(shareText(0.24)).toBe('24%')
    expect(shareText(0.285)).toBe('29%')
    expect(shareText(0.004)).toBe('less than 1%')
    expect(shareText(0)).toBe('0%')
  })
})
