// worfy's own memory in the renderer (worfy-ui ticket 20):
// - the figure (src/renderer/memory/AppMemory.tsx): number and unit, the breakdown as its tooltip;
// - its place: the last row of the version chip's popover in the footer (worfy-layout ticket 03,
//   src/renderer/shell/footer/VersionChip.tsx), while the setting is on;
// - the window opens the figure in main only while the `memoryIndicator` setting is on, and closes
//   it when the setting goes off (src/renderer/memory/useAppMemory.ts);
// - the switch of Settings → General writes the setting (src/renderer/settings/GeneralSection.tsx).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppMemoryView } from '../../src/renderer/memory/AppMemory'
import type { HarnessStatusState } from '../../src/renderer/harness/useHarnessStatus'
import { VersionChipView } from '../../src/renderer/shell/footer/VersionChip'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import { sumAppMetrics, type MemoryUsage } from '../../src/shared/memory'
import { defaultAppSettings, type AppSettings } from '../../src/shared/settings/app-settings'

const MB = 1024
const usage: MemoryUsage = sumAppMetrics(
  [
    { type: 'Browser', memory: { workingSetSize: 180 * MB } },
    { type: 'Tab', memory: { workingSetSize: 160 * MB } },
    { type: 'GPU', memory: { workingSetSize: 50 * MB } },
    { type: 'Utility', memory: { workingSetSize: 22 * MB } },
  ],
  0,
)

describe('the memory figure', () => {
  it('shows the total with its unit and the breakdown as the tooltip', () => {
    render(<AppMemoryView usage={usage} />)
    const figure = screen.getByTestId('app-memory')
    expect(figure.textContent).toBe('412 MB')
    expect(figure.getAttribute('title')).toBe("Memory used by worfy's own processes (not counting terminal sessions)\nMain 180 MB · Windows 160 MB · GPU 50 MB · Other 22 MB")
  })

  it('shows "…" with no tooltip until the first sample', () => {
    render(<AppMemoryView usage={null} />)
    const figure = screen.getByTestId('app-memory')
    expect(figure.textContent).toBe('…')
    expect(figure.hasAttribute('title')).toBe(false)
  })

  it('is no row of the version popover while the setting is off', () => {
    const harness: HarnessStatusState = { status: undefined, busy: false, busyText: 'Installing Harness…', failure: undefined, migration: false, onInstall: () => undefined, onEnable: () => undefined, enableFailure: undefined, onMigrate: undefined, onApproveHooks: () => undefined, harnessBehind: null, dialogs: null }
    render(<VersionChipView version={{ version: '0.3.0+abc' }} update={null} harness={harness} memoryShown={false} />)
    fireEvent.click(screen.getByTestId('app-version'))
    expect(screen.getByRole('dialog', { name: 'worfy version' })).toBeTruthy()
    expect(screen.queryByTestId('version-memory-line')).toBeNull()
  })
})

describe('the memory figure and the setting', () => {
  interface Fake {
    calls: string[]
    sets: unknown[]
    changed: (channel: string, payload: unknown) => void
    settings: AppSettings
    /** The answer to `memory.open`; the sample `usage` at once by default. */
    openReply: () => Promise<IpcResult<unknown>>
    /** The answer to `appSettings.set`; the patched settings by default. */
    setReply: ((input: unknown) => Promise<IpcResult<unknown>>) | undefined
  }
  let fake: Fake

  beforeEach(() => {
    // A fresh useAppSettings: it subscribes to the bridge once per module.
    vi.resetModules()
    const handlers = new Map<string, (payload: unknown) => void>()
    const current: Fake = {
      calls: [],
      sets: [],
      changed: (channel, payload) => handlers.get(channel)?.(payload),
      settings: { ...defaultAppSettings(), revision: 1 },
      openReply: () => Promise.resolve({ ok: true, value: usage }),
      setReply: undefined,
    }
    const bridge: WorfyBridge = {
      invoke: (channel, input): Promise<IpcResult<unknown>> => {
        current.calls.push(channel)
        if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: current.settings })
        if (channel === 'appSettings.set') {
          current.sets.push(input)
          if (current.setReply !== undefined) return current.setReply(input)
          current.settings = { ...current.settings, ...(input as Partial<AppSettings>), revision: current.settings.revision + 1 }
          return Promise.resolve({ ok: true, value: current.settings })
        }
        if (channel === 'memory.open') return current.openReply()
        if (channel === 'harness.state') return Promise.resolve({ ok: false, error: 'no Harness here' })
        if (channel === 'harnessMigration.offer') return Promise.resolve({ ok: true, value: { offered: false } })
        if (channel === 'memory.close') return Promise.resolve({ ok: true, value: undefined })
        return Promise.resolve({ ok: true, value: { version: '9.9.9' } })
      },
      on: (channel, handler) => {
        handlers.set(channel, handler)
        return handlers.size
      },
      off: () => undefined,
    }
    fake = current
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  })

  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  const memoryCalls = () => fake.calls.filter((channel) => channel.startsWith('memory.'))

  it('opens the figure while the setting is on, and closes it when the setting goes off, in this window', async () => {
    const { default: AppMemory } = await import('../../src/renderer/memory/AppMemory')
    render(<AppMemory />)
    expect(await screen.findByText('412 MB')).toBeTruthy()
    expect(memoryCalls()).toEqual(['memory.open'])

    // A newer sample from main replaces the figure.
    act(() => fake.changed('memory.changed', { ...usage, totalKb: 1.3 * 1024 * MB }))
    expect(screen.getByTestId('app-memory').textContent).toBe('1.3 GB')

    // Another window turned the setting off: this one hides the figure and stops the samples.
    act(() => fake.changed('appSettings.changed', { ...fake.settings, memoryIndicator: false, revision: 2 }))
    expect(screen.queryByTestId('app-memory')).toBeNull()
    expect(memoryCalls()).toEqual(['memory.open', 'memory.close'])

    act(() => fake.changed('appSettings.changed', { ...fake.settings, memoryIndicator: true, revision: 3 }))
    expect(await screen.findByText('412 MB')).toBeTruthy()
    expect(memoryCalls()).toEqual(['memory.open', 'memory.close', 'memory.open'])
  })

  it('with the setting off, the figure is hidden once the settings arrive, and the window leaves it closed', async () => {
    fake.settings = { ...fake.settings, memoryIndicator: false }
    const { default: AppMemory } = await import('../../src/renderer/memory/AppMemory')
    render(<AppMemory />)
    await vi.waitFor(() => expect(fake.calls).toContain('appSettings.get'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('app-memory')).toBeNull()
    // Before main's settings arrive the window holds the defaults (on), so it may open the figure
    // for that moment; main samples nothing for it while the setting is off (test/contract/memory.test.ts).
    const calls = memoryCalls()
    expect(calls.filter((channel) => channel === 'memory.open').length).toBe(calls.filter((channel) => channel === 'memory.close').length)
  })

  it('the version chip of the footer carries the figure as the last row of its popover, and samples only while it is open', async () => {
    const { VersionChip } = await import('../../src/renderer/shell/footer/VersionChip')
    render(<VersionChip />)
    fireEvent.click(await screen.findByTestId('app-version'))
    expect(await screen.findByText('412 MB')).toBeTruthy()
    const popover = screen.getByRole('dialog', { name: 'worfy version' })
    expect(popover.lastElementChild).toBe(screen.getByTestId('version-memory-line'))
    expect(screen.getByTestId('version-memory-line').textContent).toBe('Memory412 MB')
    fireEvent.keyDown(screen.getByTestId('app-memory'), { key: 'Escape' })
    await vi.waitFor(() => expect(memoryCalls()).toEqual(['memory.open', 'memory.close']))
  })

  it('a sample that arrives before the answer to memory.open is kept: the older answer does not replace it', async () => {
    let answer: (result: IpcResult<unknown>) => void = () => undefined
    fake.openReply = () => new Promise((resolve) => (answer = resolve))
    const { default: AppMemory } = await import('../../src/renderer/memory/AppMemory')
    render(<AppMemory />)
    await vi.waitFor(() => expect(memoryCalls()).toEqual(['memory.open']))
    act(() => fake.changed('memory.changed', { ...usage, totalKb: 2 * 1024 * MB }))
    expect(screen.getByTestId('app-memory').textContent).toBe('2.0 GB')
    await act(async () => answer({ ok: true, value: usage }))
    expect(screen.getByTestId('app-memory').textContent).toBe('2.0 GB')
  })

  it('a change main refused says why under the switch, and the switch keeps the setting in force', async () => {
    fake.setReply = () => Promise.resolve({ ok: false, error: 'disk full' })
    const { default: GeneralSection } = await import('../../src/renderer/settings/GeneralSection')
    render(<GeneralSection />)
    const toggle = await screen.findByRole('switch', { name: "Show worfy's memory in the version popover" })
    fireEvent.click(toggle)
    expect((await screen.findByTestId('settings-memory-indicator-problem')).textContent).toBe('Not saved: disk full')
    expect(screen.getByTestId('settings-memory-indicator-row').textContent).not.toContain('Terminal sessions are not counted.')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(fake.sets).toEqual([{ memoryIndicator: false }])
  })

  it('the switch of Settings → General writes memoryIndicator, on by default', async () => {
    const { default: GeneralSection } = await import('../../src/renderer/settings/GeneralSection')
    render(<GeneralSection />)
    const toggle = await screen.findByRole('switch', { name: "Show worfy's memory in the version popover" })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(fake.sets).toEqual([{ memoryIndicator: false }])
    fireEvent.click(toggle)
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(fake.sets).toEqual([{ memoryIndicator: false }, { memoryIndicator: true }])
  })
})
