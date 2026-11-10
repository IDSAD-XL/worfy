// Settings → General, "Fold Epics without work after" (worfy-polish ticket 98, src/renderer/settings/GeneralSection.tsx):
// when an Epic of the sidebar without work moves into «Older» — Never, 3, 7 or 30 days, 7 days while not chosen —
// over the real renderer IPC client and a fake preload of this Machine. How main keeps the choice is checked in
// test/contract/app-settings.test.ts.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings, EpicsOlderAfter } from '../../src/shared/settings/app-settings'

const settings = (revision: number, epicsOlderAfter?: EpicsOlderAfter): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(epicsOlderAfter === undefined ? {} : { epicsOlderAfter }),
  revision,
})

interface FakeMain {
  /** Every `appSettings.set`, oldest first, with the way to answer it. */
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
  // useAppSettings keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(state: AppSettings): Promise<FakeMain> {
  const main = preload(state)
  const section = await import('../../src/renderer/settings/GeneralSection')
  render(<section.default />)
  return main
}

const threshold = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: 'Fold Epics without work after' })

describe('Settings → General, the «Older» threshold of the sidebar Epics', () => {
  it('shows 7 days on a Machine that chose nothing', async () => {
    await mount(settings(1))
    await waitFor(() => expect(threshold().textContent).toContain('7 days'))
  })

  it('offers the four thresholds in order; a pick goes to main alone and shows once main answers', async () => {
    const main = await mount(settings(1, '3d'))
    await waitFor(() => expect(threshold().textContent).toContain('3 days'))
    fireEvent.click(threshold())
    const listbox = screen.getByRole('listbox', { name: 'Fold Epics without work after' })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Never', '3 days', '7 days', '30 days'])
    fireEvent.click(within(listbox).getByRole('option', { name: 'Never' }))
    expect(main.sets.map((each) => each.input)).toEqual([{ epicsOlderAfter: 'never' }])
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, 'never') }))
    expect(threshold().textContent).toContain('Never')
  })

  it('a choice main refuses is not shown as saved: the reason is', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(threshold().textContent).toContain('7 days'))
    fireEvent.click(threshold())
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Fold Epics without work after' })).getByRole('option', { name: '30 days' }))
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'app-settings.json is read-only' }))
    expect(screen.getByTestId('settings-epics-older-problem').textContent).toBe('Not saved: app-settings.json is read-only')
    expect(threshold().textContent).toContain('7 days')
  })
})
