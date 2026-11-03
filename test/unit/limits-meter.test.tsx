import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyLimitsView, type LimitWindow, type LimitsState, type LimitsView } from '../../src/shared/agent/limits'
import { LimitsMeterView } from '../../src/renderer/shell/toolbar/LimitsMeter'

// The toolbar's LimitsMeter, the only place the Limits are shown, drawn from one state:
// 1791184200 = Mon 2026-10-05 07:10 UTC, 1791795600 = Mon 2026-10-12 09:00 UTC.
const AT = Date.UTC(2026, 9, 5, 5, 0)
const TZ = 'UTC'

const claude: LimitsState = {
  windows: {
    five_hour: { utilization: 0.62, resetsAt: 1791184200, status: 'allowed', receivedAt: AT, source: 'sdk' },
    seven_day: { utilization: null, resetsAt: null, status: 'rejected', receivedAt: AT - 2 * 60 * 60 * 1000, source: 'sdk' },
  },
}
const state: LimitsView = { claude, vendors: {} }

afterEach(cleanup)

describe('LimitsMeterView', () => {
  it('says there is no data yet when nothing is known', () => {
    render(<LimitsMeterView state={emptyLimitsView()} now={AT} timeZone={TZ} />)
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
    const old: LimitsView = { claude: { windows: { ...claude.windows, five_hour: { ...claude.windows.five_hour!, receivedAt: AT - 2 * 24 * 60 * 60 * 1000 } } }, vendors: {} }
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

// The sections by Vendor (worfy-multi-vendor ticket 26): Claude's, then one per other Vendor signed in to.
describe('LimitsMeterView: a section per Vendor', () => {
  /** A Codex window as the driver reads it (src/main/vendors/codex/limits.ts). */
  const codex = (id: string, label: string, usedPercent: number | null, windowMinutes: number | null, extra: Partial<LimitWindow> = {}): LimitWindow => ({
    vendor: 'codex', id, label, usedPercent, windowMinutes, resetsAt: 1791795600, state: 'ok', receivedAt: AT, source: 'read', ...extra,
  })
  const sectionNames = (): string[] => screen.getAllByRole('group', { name: / limits$/ }).map((group) => group.getAttribute('aria-label')!)

  it('two Vendors are two sections, each with its name and bars; Codex labels its bars with the window\'s label', () => {
    // The 7-day window comes first in the list: the bars go by the window's length, not the order read.
    const view: LimitsView = { claude, vendors: { codex: [codex('secondary', 'weekly', 40, 10080), codex('primary', '5h', 12, 300)] } }
    render(<LimitsMeterView state={view} now={AT} timeZone={TZ} />)
    expect(sectionNames()).toEqual(['Claude Code limits', 'Codex limits'])

    const claudeSection = screen.getByRole('group', { name: 'Claude Code limits' })
    expect(within(claudeSection).getByTestId('limits-claude-name').textContent).toBe('Claude Code')
    // Two sections make the panel compact: no "Limits" heading (the group keeps the name), the reset line is the time alone.
    expect(screen.getByRole('group', { name: 'Limits' }).dataset.compact).toBe('true')
    expect(screen.queryByText('Limits')).toBeNull()
    expect(within(claudeSection).getByTestId('limit-five_hour').textContent).toBe('5-hour62%07:10')
    expect(within(claudeSection).getByTestId('limit-five_hour-note').getAttribute('title')).toBe('resets 07:10')

    const codexSection = screen.getByRole('group', { name: 'Codex limits' })
    expect(within(codexSection).getByTestId('limits-codex-name').textContent).toBe('Codex')
    const bars = within(codexSection).getAllByRole('meter')
    expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow')])).toEqual([['5h limit', '12'], ['weekly limit', '40']])
    // A window longer than a day shows the weekday of its reset, as Claude's 7-day one.
    expect(within(codexSection).getByTestId('limit-codex-primary').textContent).toBe('5h12%09:00')
    expect(within(codexSection).getByTestId('limit-codex-secondary').textContent).toBe('weekly40%Mon 09:00')
    expect(within(codexSection).getByTestId('limit-codex-secondary-note').getAttribute('title')).toBe('resets Mon 09:00')
  })

  it('Codex Pro: one section with the one weekly window', () => {
    const view: LimitsView = { claude, vendors: { codex: [codex('primary', 'weekly', 5, 10080)] } }
    render(<LimitsMeterView state={view} now={AT} timeZone={TZ} />)
    const codexSection = screen.getByRole('group', { name: 'Codex limits' })
    expect(within(codexSection).getAllByRole('meter').map((bar) => bar.getAttribute('aria-label'))).toEqual(['weekly limit'])
    expect(within(codexSection).getByTestId('limit-codex-primary-value').textContent).toBe('5%')
  })

  it('not signed in to Codex: only Claude\'s section', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    expect(sectionNames()).toEqual(['Claude Code limits'])
    expect(screen.queryByTestId('limits-codex')).toBeNull()
    // One section is drawn as before: the heading and the whole reset line.
    expect(screen.getByRole('group', { name: 'Limits' }).dataset.compact).toBeUndefined()
    expect(screen.getByRole('group', { name: 'Limits' }).textContent).toMatch(/^LimitsClaude Code5-hour62%resets 07:10/)
  })

  it('signed in to Codex with no windows: "No limits reported", and Claude without data says so in its own section', () => {
    render(<LimitsMeterView state={{ claude: { windows: {} }, vendors: { codex: [] } }} now={AT} timeZone={TZ} />)
    expect(sectionNames()).toEqual(['Claude Code limits', 'Codex limits'])
    expect(screen.getByTestId('limits-codex-empty').textContent).toBe('No limits reported')
    expect(screen.getByTestId('limits-claude-empty').textContent).toBe('no data yet')
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.queryByTestId('limits-empty')).toBeNull()
  })

  it('the colour thresholds are Claude\'s, and a window Codex says is reached is blocked whatever its share', () => {
    const view: LimitsView = {
      claude,
      vendors: {
        codex: [
          codex('primary', '5h', 59, 300),
          codex('secondary', 'weekly', 60, 10080),
          codex('third', 'monthly', 85, 43200),
          codex('reached', 'annual', 30, 525600, { state: 'reached' }),
        ],
      },
    }
    render(<LimitsMeterView state={view} now={AT} timeZone={TZ} />)
    const level = (id: string): string | undefined => screen.getByTestId(`limit-codex-${id}`).dataset.level
    expect([level('primary'), level('secondary'), level('third'), level('reached')]).toEqual(['normal', 'working', 'blocked', 'blocked'])
  })

  it('a window without a share shows its state in words; one of unknown length goes last', () => {
    const view: LimitsView = { claude, vendors: { codex: [codex('primary', 'usage', null, null, { state: 'reached' }), codex('secondary', '5h', 20, 300)] } }
    render(<LimitsMeterView state={view} now={AT} timeZone={TZ} />)
    const codexSection = screen.getByRole('group', { name: 'Codex limits' })
    expect(within(codexSection).getAllByTestId(/^limit-codex-[a-z]+$/).map((bar) => bar.dataset.testid)).toEqual(['limit-codex-secondary', 'limit-codex-primary'])
    expect(screen.getByTestId('limit-codex-primary-value').textContent).toBe('limit reached')
  })
})
