// Settings → Autopilot (src/renderer/settings/AutopilotSection.tsx, worfy-throughput ticket 41 and
// worfy-resource-planner ticket 04): the default Run mode and the Start window, the daily budget of the
// Limits on or off, and the reserve of the week for work by hand, over the real
// renderer IPC client and a fake preload of this Machine. A choice goes to main as that field alone;
// main's answer is what the section shows. How main keeps the choice is checked in
// test/contract/app-settings.test.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, autopilotBudget?: AppSettings['autopilotBudget'], autopilotRun?: AppSettings['autopilotRun']): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(autopilotBudget === undefined ? {} : { autopilotBudget }),
  ...(autopilotRun === undefined ? {} : { autopilotRun }),
  revision,
})

interface FakeMain {
  sets: { input: unknown; answer: (result: IpcResult<unknown>) => void }[]
}

function preload(state: AppSettings): FakeMain {
  const main: FakeMain = { sets: [] }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: state } as never)
      if (channel === 'appSettings.set') return new Promise((resolve) => main.sets.push({ input, answer: resolve as (result: IpcResult<unknown>) => void }))
      return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(state: AppSettings) {
  const main = preload(state)
  const section = await import('../../src/renderer/settings/AutopilotSection')
  render(<section.default />)
  return main
}

const BUDGET = 'Daily budget of the Limits'
const RESERVE = 'Reserve for your own work'
const budgetSwitch = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('switch', { name: BUDGET })
const reserve = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: RESERVE })
const MODE = 'Default run mode'
const WINDOW_FROM = 'Start window from'
const WINDOW_TO = 'Start window to'
const mode = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: MODE })
const windowFrom = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: WINDOW_FROM })
const windowTo = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: WINDOW_TO })

describe('Settings → Autopilot', () => {
  it('is a section of its own, titled Autopilot, after Browser and before Pipeline', async () => {
    const autopilot = await import('../../src/renderer/settings/AutopilotSection')
    const browser = await import('../../src/renderer/settings/BrowserSection')
    const pipeline = await import('../../src/renderer/settings/PipelineSection')
    expect(autopilot.title).toBe('Autopilot')
    expect(autopilot.order).toBeGreaterThan(browser.order)
    expect(autopilot.order).toBeLessThan(pipeline.order)
  })

  it('a Machine that chose nothing shows the defaults: the budget off, 15 % to keep, the reserve disabled; no price anywhere', async () => {
    await mount(settings(1))
    await waitFor(() => expect(reserve().textContent).toContain('15 % of the week'))
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('false')
    expect(reserve().disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/\$|USD|€|price|cost/i)
  })

  it('turns the budget on and off: the switch goes to main alone, and the reserve follows once main answers', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(budgetSwitch().getAttribute('aria-checked')).toBe('false'))
    fireEvent.click(budgetSwitch())
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { enabled: true }) }))
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('true')
    expect(reserve().disabled).toBe(false)
    fireEvent.click(budgetSwitch())
    await act(async () => main.sets[1]!.answer({ ok: true, value: settings(3, { enabled: false }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotBudget: { enabled: true } }, { autopilotBudget: { enabled: false } }])
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('false')
    expect(reserve().disabled).toBe(true)
  })

  it('changes the reserve: the pick goes to main as the reserve alone and shows once main answers', async () => {
    const main = await mount(settings(1, { enabled: true }))
    await waitFor(() => expect(reserve().textContent).toContain('15 %'))
    fireEvent.click(reserve())
    const listbox = screen.getByRole('listbox', { name: RESERVE })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['0 % of the week', '5 % of the week', '10 % of the week', '15 % of the week', '20 % of the week', '25 % of the week', '30 % of the week', '40 % of the week', '50 % of the week'])
    fireEvent.click(within(listbox).getByRole('option', { name: '25 % of the week' }))
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { enabled: true, reservePercent: 25 }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotBudget: { reservePercent: 25 } }])
    expect(reserve().textContent).toContain('25 %')
  })

  it('the default Run mode and the Start window (worfy-resource-planner ticket 04): three rows; with nothing chosen and the budget off — Fastest, 23:00–07:00, the window disabled', async () => {
    await mount(settings(1))
    await waitFor(() => expect(mode().textContent).toContain('Fastest'))
    for (const row of ['settings-autopilot-mode-row', 'settings-autopilot-window-from-row', 'settings-autopilot-window-to-row']) expect(screen.getByTestId(row)).toBeTruthy()
    expect(screen.getByTestId('settings-autopilot-mode-row').textContent).toContain('Waves go one after another: no budget, no window.')
    expect(windowFrom().textContent).toContain('23:00')
    expect(windowTo().textContent).toContain('07:00')
    expect(windowFrom().disabled).toBe(true)
    expect(windowTo().disabled).toBe(true)
    expect(screen.getByTestId('settings-autopilot-window-from-row').hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(mode())
    const listbox = screen.getByRole('listbox', { name: MODE })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Fastest', 'Budget-aware', 'Start window'])
  })

  it('with the budget on and no mode chosen the default is Budget-aware; the window stays disabled', async () => {
    await mount(settings(1, { enabled: true }))
    await waitFor(() => expect(mode().textContent).toContain('Budget-aware'))
    expect(screen.getByTestId('settings-autopilot-mode-row').textContent).toContain('The daily budget of the Limits, with the reserve.')
    expect(windowFrom().disabled).toBe(true)
  })

  it('Budget-aware chosen with the switch off: the reserve is enabled, Budget-aware applies the budget whatever the switch says', async () => {
    await mount(settings(1, { enabled: false }, { mode: 'budget-aware' }))
    await waitFor(() => expect(mode().textContent).toContain('Budget-aware'))
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('false')
    expect(reserve().disabled).toBe(false)
    expect(windowTo().disabled).toBe(true)
  })

  it('picks Start window: the mode goes to main alone; then the window is enabled and an edge goes to main alone', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(mode().textContent).toContain('Fastest'))
    fireEvent.click(mode())
    fireEvent.click(within(screen.getByRole('listbox', { name: MODE })).getByRole('option', { name: 'Start window' }))
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, undefined, { mode: 'start-window' }) }))
    expect(mode().textContent).toContain('Start window')
    expect(screen.getByTestId('settings-autopilot-mode-row').textContent).toContain('New Waves start only between the times below; the daily budget too, when it is on.')
    expect(windowFrom().disabled).toBe(false)
    expect(windowTo().disabled).toBe(false)
    expect(reserve().disabled).toBe(true)

    fireEvent.click(windowFrom())
    const hours = screen.getByRole('listbox', { name: WINDOW_FROM })
    const labels = within(hours).getAllByRole('option').map((option) => option.textContent)
    expect(labels).toHaveLength(24)
    expect([labels[0], labels[9], labels[23]]).toEqual(['00:00', '09:00', '23:00'])
    fireEvent.click(within(hours).getByRole('option', { name: '22:00' }))
    await act(async () => main.sets[1]!.answer({ ok: true, value: settings(3, undefined, { mode: 'start-window', windowFrom: 22 }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotRun: { mode: 'start-window' } }, { autopilotRun: { windowFrom: 22 } }])
    expect(windowFrom().textContent).toContain('22:00')
  })

  it('an edge picked at the hour of the other one is not sent, and the line says why', async () => {
    const main = await mount(settings(1, undefined, { mode: 'start-window' }))
    await waitFor(() => expect(windowFrom().disabled).toBe(false))
    fireEvent.click(windowFrom())
    fireEvent.click(within(screen.getByRole('listbox', { name: WINDOW_FROM })).getByRole('option', { name: '07:00' }))
    expect(main.sets).toHaveLength(0)
    expect(screen.getByTestId('settings-autopilot-problem').textContent).toBe('Not saved: the Start window cannot start and end at the same hour')
    expect(windowFrom().textContent).toContain('23:00')
    fireEvent.click(windowTo())
    fireEvent.click(within(screen.getByRole('listbox', { name: WINDOW_TO })).getByRole('option', { name: '06:00' }))
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, undefined, { mode: 'start-window', windowTo: 6 }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotRun: { windowTo: 6 } }])
    expect(screen.queryByTestId('settings-autopilot-problem')).toBeNull()
  })

  it('a reserve set by hand outside the offered ones is shown as it is; a choice main refuses shows the reason', async () => {
    const main = await mount(settings(1, { reservePercent: 12 }))
    await waitFor(() => expect(reserve().textContent).toContain('12 % of the week'))
    fireEvent.click(budgetSwitch())
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'disk full' }))
    expect(screen.getByTestId('settings-autopilot-problem').textContent).toBe('Not saved: disk full')
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('false')
  })
})
