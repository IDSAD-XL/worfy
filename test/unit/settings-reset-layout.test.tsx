// Settings → General, the row «View buttons» (worfy-layout ticket 05, src/renderer/settings/GeneralSection.tsx): its
// Reset layout is inactive while the layout is the default one, and sends `viewButtons: null` otherwise — over the real
// renderer IPC client and a fake preload of this Machine. How main takes the field away is checked in
// test/contract/app-settings.test.ts.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewButtons } from '../../src/shared/layout/view-buttons'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const MOVED: ViewButtons = { header: ['canvas', 'session', 'history'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline'] }

const settings = (revision: number, viewButtons?: ViewButtons): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(viewButtons === undefined ? {} : { viewButtons }),
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

const reset = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: 'Reset layout' })

describe('Settings → General, Reset layout of the View buttons', () => {
  it('is inactive while the layout is the default one', async () => {
    await mount(settings(1))
    expect(screen.getByTestId('settings-view-buttons-row').textContent).toContain('View buttons')
    await waitFor(() => expect(reset().disabled).toBe(true))
  })

  it('sends `viewButtons: null` for a layout the person made, and is inactive again once main answers', async () => {
    const main = await mount(settings(1, MOVED))
    await waitFor(() => expect(reset().disabled).toBe(false))
    fireEvent.click(reset())
    expect(main.sets.map((each) => each.input)).toEqual([{ viewButtons: null }])
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2) }))
    expect(reset().disabled).toBe(true)
  })

  it('a reset main refuses is not shown as done: the reason is', async () => {
    const main = await mount(settings(1, MOVED))
    await waitFor(() => expect(reset().disabled).toBe(false))
    fireEvent.click(reset())
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'app-settings.json is read-only' }))
    expect(screen.getByTestId('settings-view-buttons-problem').textContent).toBe('Not saved: app-settings.json is read-only')
    expect(reset().disabled).toBe(false)
  })
})
