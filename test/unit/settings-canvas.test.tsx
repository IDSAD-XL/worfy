// Settings → Canvas (src/renderer/settings/CanvasSection.tsx, worfy-canvas ticket 08, ADR-0076,
// point 7): the threshold of the automatic archive — Never, 6 h, 24 h, 3 days, 7 days — and the
// switch "…and when their Ticket is done", over the real renderer IPC client and a fake preload of
// this Machine. A choice goes to main as that field alone; main's answer is what the section shows.
// How main keeps the choice is checked in test/contract/app-settings.test.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, sessionArchive?: AppSettings['sessionArchive']): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  ...(sessionArchive === undefined ? {} : { sessionArchive }),
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
  const section = await import('../../src/renderer/settings/CanvasSection')
  render(<section.default />)
  return main
}

const threshold = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('combobox', { name: 'Archive finished sessions after' })
const ticketDone = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('switch', { name: '…and when their Ticket is done' })

describe('Settings → Canvas', () => {
  it('is a section of its own, titled Canvas, after Sessions and before Pipeline', async () => {
    const canvas = await import('../../src/renderer/settings/CanvasSection')
    const sessions = await import('../../src/renderer/settings/SessionsSection')
    const pipeline = await import('../../src/renderer/settings/PipelineSection')
    expect(canvas.title).toBe('Canvas')
    expect(canvas.order).toBeGreaterThan(sessions.order)
    expect(canvas.order).toBeLessThan(pipeline.order)
  })

  it('a Machine that chose nothing shows the defaults: Never, and the switch on', async () => {
    await mount(settings(1))
    await waitFor(() => expect(threshold().textContent).toContain('Never'))
    expect(ticketDone().getAttribute('aria-checked')).toBe('true')
  })

  it('offers the five thresholds in order; a pick goes to main as the threshold alone and shows once main answers', async () => {
    const main = await mount(settings(1, { after: '24h' }))
    await waitFor(() => expect(threshold().textContent).toContain('24 h'))
    fireEvent.click(threshold())
    const listbox = screen.getByRole('listbox', { name: 'Archive finished sessions after' })
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Never', '6 h', '24 h', '3 days', '7 days'])
    fireEvent.click(within(listbox).getByRole('option', { name: '3 days' }))
    expect(main.sets.map((each) => each.input)).toEqual([{ sessionArchive: { after: '3d' } }])
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { after: '3d' }) }))
    expect(threshold().textContent).toContain('3 days')
  })

  it('the switch asks for the other value alone and keeps the threshold; main\'s answer moves it', async () => {
    const main = await mount(settings(1, { after: '6h', ticketDone: true }))
    await waitFor(() => expect(threshold().textContent).toContain('6 h'))
    fireEvent.click(ticketDone())
    expect(main.sets.map((each) => each.input)).toEqual([{ sessionArchive: { ticketDone: false } }])
    await act(async () => main.sets[0]!.answer({ ok: true, value: settings(2, { after: '6h', ticketDone: false }) }))
    expect(ticketDone().getAttribute('aria-checked')).toBe('false')
    expect(threshold().textContent).toContain('6 h')
  })

  it('a choice main refuses is not shown as saved: the reason is', async () => {
    const main = await mount(settings(1))
    await waitFor(() => expect(threshold().textContent).toContain('Never'))
    fireEvent.click(threshold())
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Archive finished sessions after' })).getByRole('option', { name: '7 days' }))
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'disk full' }))
    expect(screen.getByTestId('settings-archive-problem').textContent).toBe('Not saved: disk full')
    expect(threshold().textContent).toContain('Never')
  })
})
