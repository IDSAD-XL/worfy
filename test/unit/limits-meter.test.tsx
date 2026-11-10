import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyLimitsView, type LimitWindow, type LimitsState, type LimitsView } from '../../src/shared/agent/limits'
import { LimitsMeterView } from '../../src/renderer/shell/toolbar/LimitsMeter'
import { vendorIcon } from '../../src/shared/vendors/vendor'

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
    expect(fiveHour.textContent).toBe('5-hour62%07:10')
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

  // worfy-polish ticket 48: a narrow window shows the value alone (shell.css), so its tooltip names the
  // window, the value, the reset and the age of the data.
  it('the tooltip of a value names the whole bar: its window, value, reset line and, for old data, "as of"', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    expect(screen.getByTestId('limit-five_hour-value').getAttribute('title')).toBe('5-hour: 62% · resets 07:10')
    const sevenDay = screen.getByTestId('limit-seven_day')
    expect(sevenDay.dataset.stale).toBe('true')
    expect(within(sevenDay).getByTestId('limit-seven_day-value').getAttribute('title')).toBe('7-day: limit reached · as of 03:00')
  })

  it('the label, the reset line and the heading carry the classes the narrow-window rule of the toolbar hides', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(fiveHour.classList.contains('w-limit-bar')).toBe(true)
    expect(within(fiveHour).getByText('5-hour').classList.contains('w-limit-bar__label')).toBe(true)
    expect(within(fiveHour).getByTestId('limit-five_hour-note').classList.contains('w-limit-bar__resets')).toBe(true)
    expect(within(screen.getByTestId('limits-meter')).getByText('Limits').classList.contains('w-limits__heading')).toBe(true)
  })

  it('an old bar with a reset time is still one line of text and its bar: label, value, reset time', () => {
    const old: LimitsView = { claude: { windows: { ...claude.windows, five_hour: { ...claude.windows.five_hour!, receivedAt: AT - 2 * 24 * 60 * 60 * 1000 } } }, vendors: {} }
    render(<LimitsMeterView state={old} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(fiveHour.textContent).toBe('5-hour62%07:10')
    expect(fiveHour.getAttribute('title')).toBe('62% · as of Sat 05:00')
    // The children are the label, the value, the reset time and the meter; nothing else (worfy-polish ticket 93).
    expect([...fiveHour.children].map((child) => child.className)).toEqual(['w-limit-bar__label', 'w-limit-bar__value', 'w-limit-bar__resets', 'w-limit-bar__meter'])
    expect(within(fiveHour).getByTestId('limit-five_hour-note').textContent).toBe('07:10')
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
  /** The start of each Vendor's logo path (Simple Icons, src/shared/vendors/vendor.ts), written out so a swap fails. */
  const LOGO_START = { claude: 'm4.7144 15.9555', codex: 'M22.2819 9.8211' } as const
  /**
   * A section's first child is its Vendor's logo alone (owner, 2026-11-03): no visible name; the logo is
   * named and titled with the Vendor's whole name, and so is the section.
   */
  const expectLogoFirst = (vendor: 'claude' | 'codex', name: string): void => {
    const section = screen.getByRole('group', { name: `${name} limits` })
    expect(section.getAttribute('title')).toBe(name)
    const logo = section.firstElementChild as HTMLElement
    expect(logo.dataset.testid).toBe(`limits-${vendor}-logo`)
    expect(logo.dataset.vendor).toBe(vendor)
    expect(logo.textContent).toBe('')
    expect(logo.getAttribute('role')).toBe('img')
    expect(logo.getAttribute('aria-label')).toBe(name)
    expect(logo.getAttribute('title')).toBe(name)
    const svg = logo.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    const d = svg?.querySelector('path')?.getAttribute('d') ?? ''
    expect(d.startsWith(LOGO_START[vendor]), `the ${vendor} logo, got ${d.slice(0, 30)}…`).toBe(true)
    expect(d).toBe(vendorIcon(vendor))
  }

  it('two Vendors are two sections, each with its Vendor\'s logo and no visible name; Codex labels its bars with the window\'s label', () => {
    // The 7-day window comes first in the list: the bars go by the window's length, not the order read.
    const view: LimitsView = { claude, vendors: { codex: [codex('secondary', 'weekly', 40, 10080), codex('primary', '5h', 12, 300)] } }
    render(<LimitsMeterView state={view} now={AT} timeZone={TZ} />)
    expect(sectionNames()).toEqual(['Claude Code limits', 'Codex limits'])

    // Each section starts with its Vendor's logo, Claude's too, and no Vendor's name is visible text: the
    // logos say whose bars are whose, the names are the tooltips (owner, 2026-11-03). A thin line parts the sections.
    const meter = screen.getByRole('group', { name: 'Limits' })
    expect(meter.textContent).toBe('5-hour62%07:107-daylimit reached5h12%09:00weekly40%Mon 09:00')
    expect([...meter.children].map((child) => child.getAttribute('data-testid'))).toEqual(['limits-claude', 'limits-divider', 'limits-codex'])
    expect(screen.getByTestId('limits-divider').getAttribute('aria-hidden')).toBe('true')
    expectLogoFirst('claude', 'Claude Code')
    expectLogoFirst('codex', 'Codex')
    expect(screen.getByRole('img', { name: 'Codex' })).toBe(screen.getByTestId('limits-codex-logo'))

    const claudeSection = screen.getByRole('group', { name: 'Claude Code limits' })
    // Two sections make the panel compact: no "Limits" heading (the group keeps the name).
    expect(screen.getByRole('group', { name: 'Limits' }).dataset.compact).toBe('true')
    expect(screen.queryByText('Limits')).toBeNull()
    expect(within(claudeSection).getByTestId('limit-five_hour').textContent).toBe('5-hour62%07:10')
    expect(within(claudeSection).getByTestId('limit-five_hour-note').getAttribute('title')).toBe('resets 07:10')

    const codexSection = screen.getByRole('group', { name: 'Codex limits' })
    const bars = within(codexSection).getAllByRole('meter')
    expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow')])).toEqual([['5h limit', '12'], ['weekly limit', '40']])
    // A window longer than a day shows the weekday of its reset, as Claude's 7-day one.
    expect(within(codexSection).getByTestId('limit-codex-primary').textContent).toBe('5h12%09:00')
    expect(within(codexSection).getByTestId('limit-codex-secondary').textContent).toBe('weekly40%Mon 09:00')
    expect(within(codexSection).getByTestId('limit-codex-secondary-note').getAttribute('title')).toBe('resets Mon 09:00')
  })

  // worfy-polish ticket 93: a Vendor's windows one above the other, so a section is as wide as one line.
  it('each Vendor\'s windows stand one above the other in one stack; a Vendor with more than two gets a stack of two per column', () => {
    const two: LimitsView = { claude, vendors: { codex: [codex('primary', '5h', 12, 300), codex('secondary', 'weekly', 40, 10080)] } }
    render(<LimitsMeterView state={two} now={AT} timeZone={TZ} />)
    const ids = (stack: HTMLElement): (string | null)[] => [...stack.children].map((child) => child.getAttribute('data-testid'))
    expect(screen.getAllByTestId('limits-claude-stack').map(ids)).toEqual([['limit-five_hour', 'limit-seven_day']])
    expect(screen.getAllByTestId('limits-codex-stack').map(ids)).toEqual([['limit-codex-primary', 'limit-codex-secondary']])
    expect(screen.getByTestId('limits-codex-stack').classList.contains('w-limits-stack')).toBe(true)
    cleanup()
    const four: LimitsView = { claude, vendors: { codex: [codex('a', '5h', 1, 300), codex('b', 'weekly', 2, 10080), codex('c', 'monthly', 3, 43200), codex('d', 'annual', 4, 525600)] } }
    render(<LimitsMeterView state={four} now={AT} timeZone={TZ} />)
    expect(screen.getAllByTestId('limits-codex-stack').map(ids)).toEqual([
      ['limit-codex-a', 'limit-codex-b'],
      ['limit-codex-c', 'limit-codex-d'],
    ])
  })

  it('a share over 100% keeps the warning colour on its value, and the bar stays full', () => {
    const over: LimitsView = { claude: { windows: { five_hour: { ...claude.windows.five_hour!, utilization: 1.01 } } }, vendors: {} }
    render(<LimitsMeterView state={over} now={AT} timeZone={TZ} />)
    const fiveHour = screen.getByTestId('limit-five_hour')
    expect(fiveHour.dataset.level).toBe('blocked')
    expect(within(fiveHour).getByTestId('limit-five_hour-value').textContent).toBe('101%')
    expect(within(fiveHour).getByTestId('limit-five_hour-value').style.color).toBe('var(--blocked-text)')
    expect((within(fiveHour).getByRole('meter').firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('a status in words with no reset time takes the reset time\'s column too', () => {
    render(<LimitsMeterView state={state} now={AT} timeZone={TZ} />)
    expect(screen.getByTestId('limit-seven_day-value').classList.contains('w-limit-bar__value--wide')).toBe(true)
    expect(screen.getByTestId('limit-five_hour-value').classList.contains('w-limit-bar__value--wide')).toBe(false)
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
    // One section keeps the heading, with no Vendor name and no line; its windows stand one above the other too.
    expect(screen.getByRole('group', { name: 'Limits' }).dataset.compact).toBeUndefined()
    expect(screen.getByRole('group', { name: 'Limits' }).textContent).toMatch(/^Limits5-hour62%07:10/)
    expect(screen.getAllByTestId('limits-claude-stack')).toHaveLength(1)
    expectLogoFirst('claude', 'Claude Code')
    expect(screen.queryByTestId('limits-divider')).toBeNull()
  })

  it('signed in to Codex with no windows: "No limits reported", and Claude without data says so in its own section', () => {
    render(<LimitsMeterView state={{ claude: { windows: {} }, vendors: { codex: [] } }} now={AT} timeZone={TZ} />)
    expect(sectionNames()).toEqual(['Claude Code limits', 'Codex limits'])
    expect(screen.getByTestId('limits-codex-empty').textContent).toBe('No limits reported')
    expect(screen.getByTestId('limits-claude-empty').textContent).toBe('no data yet')
    // Without bars a section says whose it is by its logo, as one with bars does; its line is the only text.
    expect(screen.getByRole('group', { name: 'Limits' }).textContent).toBe('no data yetNo limits reported')
    expectLogoFirst('claude', 'Claude Code')
    expectLogoFirst('codex', 'Codex')
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
