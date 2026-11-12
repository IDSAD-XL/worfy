// The First run window (src/renderer/shell/FirstRun.tsx) on the kit's Dialog (worfy-ui-kit ticket 06,
// ADR-0106), from the outside: Tab does not leave it, the focus goes back to what opened it, a click
// outside does nothing, and Settings opened over it (⌘, of the app menu) takes the keyboard while it
// is open and gives it back to First run when it closes. That Esc leaves First run open while the
// move form of the old Harness is over it is checked in test/unit/settings-health.test.tsx.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import { pressTab } from './tab-key'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const check = (id: Check['id'], title: string): Check => ({ id, group: 'Command-line tools', title, status: 'ok', detail: 'found', hint: '', command: null, actions: [] })
const REPORT: FirstRunReport = { checkedAt: '2026-11-12T00:00:00.000Z', checks: [check('git', 'git'), check('jq', 'jq')] }
const SNAPSHOT: GettingStartedSnapshot = { user: 'existing', section: 'hidden', steps: {}, reworkSeen: false, noticeShown: false, demo: null }
const APP_SETTINGS: AppSettings = {
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
}

let invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<Answer>>>
const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

beforeEach(() => {
  vi.resetModules()
  const answers: Record<string, () => Answer> = {
    'firstRun.startup': () => ({ ok: true, value: { show: false, firstTime: false, report: null } }),
    'firstRun.checks': () => ({ ok: true, value: REPORT }),
    'firstRun.close': () => ({ ok: true, value: undefined }),
    'gettingStarted.state': () => ({ ok: true, value: SNAPSHOT }),
    'appSettings.get': () => ({ ok: true, value: APP_SETTINGS }),
  }
  invoke = vi.fn((channel: string) => Promise.resolve(answers[channel]?.() ?? { ok: false, error: `${channel}: not in this test` }))
  ;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Lets Base UI's effects and frames run. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

/** The page: an opener, First run and the Settings window (one stub section), as the shell mounts them. */
async function renderPage() {
  const { FirstRun } = await import('../../src/renderer/shell/FirstRun')
  const store = await import('../../src/renderer/shell/first-run-store')
  const { SettingsDialogView } = await import('../../src/renderer/settings/SettingsDialog')
  const { collectSections } = await import('../../src/renderer/settings/sections')
  const settings = await import('../../src/renderer/settings/settings-window')
  const sections = collectSections({ './StubSection.tsx': { default: () => <button type="button">Stub control</button>, order: 10, title: 'Stub' } })
  render(
    <>
      <button type="button">opener</button>
      <FirstRun />
      <SettingsDialogView sections={sections} />
    </>,
  )
  await waitFor(() => expect(callsOf('firstRun.startup')).toHaveLength(1))
  const opener = screen.getByRole('button', { name: 'opener' })
  opener.focus()
  act(() => store.openFirstRun())
  const dialog = await screen.findByRole('dialog', { name: 'First run' })
  await waitFor(() => expect(dialog.querySelectorAll('[data-check]')).toHaveLength(REPORT.checks.length))
  await flush()
  return { opener, dialog, settings }
}

describe('First run on the kit\'s Dialog', () => {
  it('is a modal dialog named by its title that takes the focus; Tab and Shift+Tab do not leave it', async () => {
    const { dialog } = await renderPage()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    const close = within(dialog).getByRole('button', { name: 'Close' })
    act(() => close.focus())
    for (let step = 0; step < 6; step += 1) {
      await pressTab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    act(() => close.focus())
    await pressTab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await pressTab(true)
    expect(document.activeElement).toBe(close)
  })

  it('Esc closes it, main writes the mark, and the focus goes back to what opened it', async () => {
    const { opener, dialog } = await renderPage()
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog', { name: 'First run' })).toBeNull()
    expect(callsOf('firstRun.close')).toHaveLength(1)
    expect(document.activeElement).toBe(opener)
  })

  it('"Next" on the concepts page takes away the button that had the focus: the focus goes to the window, not to the page', async () => {
    const answers = invoke.getMockImplementation()!
    invoke.mockImplementation((channel: string, input?: unknown) =>
      channel === 'firstRun.startup' ? Promise.resolve({ ok: true, value: { show: true, firstTime: true, report: null } }) : answers(channel, input),
    )
    const { FirstRun } = await import('../../src/renderer/shell/FirstRun')
    render(<FirstRun />)
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to worfy' })
    await flush()
    const next = within(dialog).getByRole('button', { name: 'Next' })
    act(() => next.focus())
    fireEvent.click(next)
    await flush()
    expect(dialog.getAttribute('data-page')).toBe('checks')
    expect(next.isConnected).toBe(false)
    expect(document.activeElement).toBe(dialog)
  })

  it('a click outside leaves it open', async () => {
    const { dialog } = await renderPage()
    const backdrop = dialog.parentElement!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    await flush()
    expect(screen.getByRole('dialog', { name: 'First run' })).toBe(dialog)
    expect(callsOf('firstRun.close')).toHaveLength(0)
  })

  it('Settings opened over it takes the keyboard; closed, it gives the focus back to First run, which keeps Tab and Esc', async () => {
    const { dialog, settings } = await renderPage()
    const close = within(dialog).getByRole('button', { name: 'Close' })
    act(() => close.focus())
    act(() => settings.openSettings())
    await flush()
    const window = screen.getByRole('dialog', { name: 'Settings' })
    expect(window.contains(document.activeElement)).toBe(true)
    for (let step = 0; step < 4; step += 1) {
      await pressTab()
      expect(window.contains(document.activeElement)).toBe(true)
    }
    // Esc closes Settings only.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'First run' })).toBe(dialog)
    expect(callsOf('firstRun.close')).toHaveLength(0)
    // The focus is where it was in First run, and First run has the keyboard again.
    expect(document.activeElement).toBe(close)
    await pressTab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog', { name: 'First run' })).toBeNull()
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })
})
