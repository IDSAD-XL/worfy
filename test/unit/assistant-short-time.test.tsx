// The time a row of the Assistant's section shows (src/renderer/assistant/format.ts): today its hours and minutes, the
// days of the last week their weekday, and an older one its date (worfy-polish 172) — so the age of what stays in Waits
// is plain.
import { describe, expect, it } from 'vitest'
import { shortTime } from '../../src/renderer/assistant/format'

const DAY = 24 * 60 * 60_000
const NOW = new Date(2026, 10, 28, 15, 0).getTime()

describe('shortTime', () => {
  it('today: hours and minutes', () => {
    expect(shortTime(new Date(2026, 10, 28, 9, 5).getTime(), NOW)).toBe(new Date(2026, 10, 28, 9, 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  })

  it('up to 6 days back: the weekday', () => {
    for (const days of [1, 3, 6]) {
      const at = NOW - days * DAY
      expect(shortTime(at, NOW)).toBe(new Date(at).toLocaleDateString([], { weekday: 'short' }))
    }
  })

  it('older than 6 days: the date, as Nov 20', () => {
    const at = new Date(2026, 10, 20, 10, 0).getTime()
    expect(shortTime(at, NOW)).toBe(new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' }))
    expect(shortTime(at, NOW)).not.toBe(new Date(at).toLocaleDateString([], { weekday: 'short' }))
    expect(shortTime(NOW - 30 * DAY, NOW)).toBe(new Date(NOW - 30 * DAY).toLocaleDateString([], { month: 'short', day: 'numeric' }))
  })
})
