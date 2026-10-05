import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyLimits, type LimitsState } from '../../src/shared/agent/limits'
import { LimitsRailView } from '../../src/renderer/session/rail/LimitsRail'
import { railBlocks } from '../../src/renderer/session/rail/index'
import { LimitsMeterView } from '../../src/renderer/shell/toolbar/LimitsMeter'

// The toolbar's LimitsMeter and the rail's LimitsRail draw the same bars from one state:
// 1791184200 = Mon 2026-10-05 07:10 UTC, 1791795600 = Mon 2026-10-12 09:00 UTC.
const AT = Date.UTC(2026, 9, 5, 5, 0)
const TZ = 'UTC'

const state: LimitsState = {
  windows: {
    five_hour: { utilization: 0.62, resetsAt: 1791184200, status: 'allowed', receivedAt: AT, source: 'sdk' },
    seven_day: { utilization: null, resetsAt: null, status: 'rejected', receivedAt: AT - 2 * 60 * 60 * 1000, source: 'sdk' },
  },
}

describe('LimitsMeterView', () => {
  it('says there is no data yet when nothing is known', () => {
    render(<LimitsMeterView state={emptyLimits()} now={AT} timeZone={TZ} />)
    expect(screen.getByRole('group', { name: 'Limits' }).textContent).toBe('Limitsno data yet')
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('draws a meter with the share and reset time, and the status in words without a share', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(within(fiveHour).getByRole('meter', { name: '5-hour limit' }).getAttribute('aria-valuenow')).toBe('62')
    expect(fiveHour.textContent).toBe('5-hour62%resets 07:10')
    expect(fiveHour.dataset.level).toBe('working')

    const sevenDay = screen.getByTestId('limit-seven_day')
    expect(within(sevenDay).queryByRole('meter')).toBeNull()
    expect(sevenDay.textContent).toBe('7-daylimit reachedas of 03:00')
    expect(sevenDay.dataset.level).toBe('blocked')
  })
})

describe('LimitsRailView', () => {
  it('is a rail block of the Session view', () => {
    expect(railBlocks.map((block) => block.id)).toContain('LimitsRail')
  })

  it('draws the same bars under a Limits heading', () => {
    render(<LimitsRailView state={state} now={AT} timeZone={TZ} />)
    const rail = screen.getByTestId('limits-rail')
    expect(within(rail).getByRole('heading', { name: 'Limits' })).toBeTruthy()
    expect(within(rail).getByTestId('limit-five_hour').textContent).toBe('5-hour62%· resets 07:10')
    expect(within(rail).getByTestId('limit-seven_day').textContent).toBe('7-daylimit reached· as of 03:00')
  })

  it('says there is no data yet when nothing is known', () => {
    render(<LimitsRailView state={emptyLimits()} now={AT} timeZone={TZ} />)
    expect(screen.getByTestId('limits-rail').textContent).toBe('LimitsNo data yet')
  })
})
