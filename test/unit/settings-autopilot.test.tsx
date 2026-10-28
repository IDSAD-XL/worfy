// Settings → Autopilot (src/renderer/settings/AutopilotSection.tsx, worfy-throughput ticket 41): the
// daily budget of the Limits on or off, and the reserve of the week for work by hand, over the real
// renderer IPC client and a fake preload of this Machine. A choice goes to main as that field alone;
// main's answer is what the section shows. How main keeps the choice is checked in
// test/contract/app-settings.test.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, autopilotBudget?: AppSettings['autopilotBudget']): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(autopilotBudget === undefined ? {} : { autopilotBudget }),
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

describe('Settings → Autopilot', () => {
  it('is a section of its own, titled Autopilot, after Browser and before Pipeline', async () => {
    const autopilot = await import('../../src/renderer/settings/AutopilotSection')
    const browser = await import('../../src/renderer/settings/BrowserSection')
    const pipeline = await import('../../src/renderer/settings/PipelineSection')
    expect(autopilot.title).toBe('Autopilot')
    expect(autopilot.order).toBeGreaterThan(browser.order)
    expect(autopilot.order).toBeLessThan(pipeline.order)
  })

  it('a Machine that chose nothing shows the defaults: the budget on, 15 % kept; no price anywhere', async () => {
    await mount(settings(1))
    await waitFor(() => expect(reserve().textContent).toContain('15 % of the week'))
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('true')
    expect(document.body.textContent).not.toMatch(/\$|USD|€|price|cost/i)
  })

  it('turns the budget off: the switch goes to main alone, and the reserve is disabled once main answers', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(budgetSwitch().getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(budgetSwitch())
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { enabled: false }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotBudget: { enabled: false } }])
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('false')
    expect(reserve().disabled).toBe(true)
  })

  it('changes the reserve: the pick goes to main as the reserve alone and shows once main answers', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(reserve().textContent).toContain('15 %'))
    fireEvent.click(reserve())
    const listbox = screen.getByRole('listbox', { name: RESERVE })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['0 % of the week', '5 % of the week', '10 % of the week', '15 % of the week', '20 % of the week', '25 % of the week', '30 % of the week', '40 % of the week', '50 % of the week'])
    fireEvent.click(within(listbox).getByRole('option', { name: '25 % of the week' }))
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { reservePercent: 25 }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ autopilotBudget: { reservePercent: 25 } }])
    expect(reserve().textContent).toContain('25 %')
  })

  it('a reserve set by hand outside the offered ones is shown as it is; a choice main refuses shows the reason', async () => {
    const main = await mount(settings(1, { reservePercent: 12 }))
    await waitFor(() => expect(reserve().textContent).toContain('12 % of the week'))
    fireEvent.click(budgetSwitch())
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'disk full' }))
    expect(screen.getByTestId('settings-autopilot-problem').textContent).toBe('Not saved: disk full')
    expect(budgetSwitch().getAttribute('aria-checked')).toBe('true')
  })
})
