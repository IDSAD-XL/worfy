// Settings → Browser (src/renderer/settings/BrowserSection.tsx, worfy-browser ticket 05, ADR-0078
// items 6 and 7): how many Browsers are Live at once, and the three thresholds of sleep — off
// screen, unused, and the readable zoom — over the real renderer IPC client and a fake preload of
// this Machine. A choice goes to main as that field alone; main's answer is what the section shows.
// How main keeps the choice is checked in test/contract/app-settings.test.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, browserSleep?: AppSettings['browserSleep']): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(browserSleep === undefined ? {} : { browserSleep }),
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
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(state: AppSettings) {
  const main = preload(state)
  const section = await import('../../src/renderer/settings/BrowserSection')
  render(<section.default />)
  return main
}

const select = (name: string): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name })
const LIVE = 'Live browsers at once'
const OFFSCREEN = 'Sleep when off screen after'
const IDLE = 'Sleep when unused after'
const ZOOM = 'Readable from zoom'

/** Picks `option` in the list of `name` and answers main's `appSettings.set` with `after`. */
async function pick(main: FakeMain, name: string, option: string, after: AppSettings) {
  fireEvent.click(select(name))
  fireEvent.click(within(screen.getByRole('listbox', { name })).getByRole('option', { name: option }))
  await act(async () => main.sets.at(-1)!.answer({ ok: true, value: after }))
}

describe('Settings → Browser', () => {
  it('is a section of its own, titled Browser, after Canvas and before Pipeline', async () => {
    const browser = await import('../../src/renderer/settings/BrowserSection')
    const canvas = await import('../../src/renderer/settings/CanvasSection')
    const pipeline = await import('../../src/renderer/settings/PipelineSection')
    expect(browser.title).toBe('Browser')
    expect(browser.order).toBeGreaterThan(canvas.order)
    expect(browser.order).toBeLessThan(pipeline.order)
  })

  it('a Machine that chose nothing shows the defaults: 3 Live, 30 s off screen, 5 min unused, readable from 40 %', async () => {
    await mount(settings(1))
    await waitFor(() => expect(select(LIVE).textContent).toContain('3'))
    expect(select(OFFSCREEN).textContent).toContain('30 s')
    expect(select(IDLE).textContent).toContain('5 min')
    expect(select(ZOOM).textContent).toContain('40 %')
  })

  it('changes N: the pick goes to main as N alone and shows once main answers', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(select(LIVE).textContent).toContain('3'))
    fireEvent.click(select(LIVE))
    const listbox = screen.getByRole('listbox', { name: LIVE })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '8', '10'])
    fireEvent.click(within(listbox).getByRole('option', { name: '5' }))
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { maxLive: 5 }) }))
    expect(main.sets.map((each) => each.input)).toEqual([{ browserSleep: { maxLive: 5 } }])
    expect(select(LIVE).textContent).toContain('5')
  })

  it('changes the threshold off screen, the one unused and the readable zoom, each alone', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(select(OFFSCREEN).textContent).toContain('30 s'))
    await pick(main, OFFSCREEN, '2 min', settings(2, { offscreenSeconds: 120 }))
    expect(select(OFFSCREEN).textContent).toContain('2 min')
    await pick(main, IDLE, '15 min', settings(3, { offscreenSeconds: 120, idleMinutes: 15 }))
    expect(select(IDLE).textContent).toContain('15 min')
    await pick(main, ZOOM, '25 %', settings(4, { offscreenSeconds: 120, idleMinutes: 15, zoom: 0.25 }))
    expect(select(ZOOM).textContent).toContain('25 %')
    expect(main.sets.map((each) => each.input)).toEqual([{ browserSleep: { offscreenSeconds: 120 } }, { browserSleep: { idleMinutes: 15 } }, { browserSleep: { zoom: 0.25 } }])
    // The other settings stay as main answered them.
    expect(select(LIVE).textContent).toContain('3')
  })

  it('a value set by hand outside the offered ones is shown as it is', async () => {
    await mount(settings(1, { offscreenSeconds: 2, idleMinutes: 90 }))
    await waitFor(() => expect(select(OFFSCREEN).textContent).toContain('2 s'))
    expect(select(IDLE).textContent).toContain('1 h 30 min')
  })

  it('a choice main refuses is not shown as saved: the reason is', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(select(LIVE).textContent).toContain('3'))
    fireEvent.click(select(LIVE))
    fireEvent.click(within(screen.getByRole('listbox', { name: LIVE })).getByRole('option', { name: '8' }))
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'disk full' }))
    expect(screen.getByTestId('settings-browser-problem').textContent).toBe('Not saved: disk full')
    expect(select(LIVE).textContent).toContain('3')
  })
})
