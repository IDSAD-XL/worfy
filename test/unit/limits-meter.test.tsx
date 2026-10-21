import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyLimits, type LimitsState } from '../../src/shared/agent/limits'
import { LimitsMeterView } from '../../src/renderer/shell/toolbar/LimitsMeter'

// The toolbar's LimitsMeter, the only place the Limits are shown, drawn from one state:
// 1791184200 = Mon 2026-10-05 07:10 UTC, 1791795600 = Mon 2026-10-12 09:00 UTC.
const AT = Date.UTC(2026, 9, 5, 5, 0)
const TZ = 'UTC'

const state: LimitsState = {
  windows: {
    five_hour: { utilization: 0.62, resetsAt: 1791184200, status: 'allowed', receivedAt: AT, source: 'sdk' },
    seven_day: { utilization: null, resetsAt: null, status: 'rejected', receivedAt: AT - 2 * 60 * 60 * 1000, source: 'sdk' },
  },
}

afterEach(cleanup)

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
    expect(sevenDay.dataset.level).toBe('blocked')
  })

  it('a fresh bar is neither dimmed nor carries "as of"', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(fiveHour.dataset.stale).toBeUndefined()
    expect(fiveHour.getAttribute('title')).toBeNull()
    expect(fiveHour.style.opacity).toBe('')
  })

  it('data older than an hour adds no "as of" line: the bar is dimmed and "as of" is its tooltip', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    const sevenDay = screen.getByTestId('limit-seven_day')
    expect(sevenDay.textContent).toBe('7-daylimit reached')
    expect(sevenDay.dataset.stale).toBe('true')
    expect(sevenDay.getAttribute('title')).toBe('limit reached · as of 03:00')
    expect(Number(sevenDay.style.opacity)).toBeLessThan(1)
  })

  it('the value of an old bar has no tooltip of its own: the bar\'s tooltip carries it with "as of"', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    // A fresh bar's value keeps its tooltip, in case the value is cut.
    expect(screen.getByTestId('limit-five_hour-value').getAttribute('title')).toBe('62%')
    const sevenDay = screen.getByTestId('limit-seven_day')
    expect(sevenDay.dataset.stale).toBe('true')
    expect(within(sevenDay).getByTestId('limit-seven_day-value').getAttribute('title')).toBeNull()
  })

  it('an old bar with a reset time still has two lines of text at most: the label line and the reset line', () => {
    const old: LimitsState = { windows: { ...state.windows, five_hour: { ...state.windows.five_hour!, receivedAt: AT - 2 * 24 * 60 * 60 * 1000 } } }
    render(<LimitsMeterView state={old} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(fiveHour.textContent).toBe('5-hour62%resets 07:10')
    expect(fiveHour.getAttribute('title')).toBe('62% · as of Sat 05:00')
    // The children are the label line, the meter and the reset line; nothing else.
    expect(fiveHour.children).toHaveLength(3)
    expect(within(fiveHour).getByTestId('limit-five_hour-note').textContent).toBe('resets 07:10')
    // The reset line carries its full text as the tooltip, in case it is cut.
    expect(within(fiveHour).getByTestId('limit-five_hour-note').getAttribute('title')).toBe('resets 07:10')
    expect(within(fiveHour).queryByText(/as of/)).toBeNull()
  })
})
