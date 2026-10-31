// The way into Getting started from First run (worfy-onboarding ticket 08), over the real renderer
// IPC client and a fake preload:
// - the page of the three concepts (decision 8): First run opened by itself on a first start
//   (`firstRun.startup` answers `firstTime: true`) shows "Welcome to worfy" first, its checks running
//   behind it; "Next" goes to the checks; Escape and "Close" close it there too, and main writes the
//   mark as from the checks. Opened by itself any other time, or from the Command palette, it shows
//   the checks at once;
// - "Start Getting started" next to "Close" of the checks (decision 9), for a new user while step 6
//   is not marked: it closes First run and shows the Getting started section.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { AppSettings } from '../../src/shared/settings/app-settings'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const check = (id: Check['id'], title: string): Check => ({ id, group: 'Command-line tools', title, status: 'ok', detail: 'found', hint: '', command: null, actions: [] })
const REPORT: FirstRunReport = { checkedAt: '2026-10-30T00:00:00.000Z', checks: [check('git', 'git'), check('jq', 'jq')] }

const snapshot = (change: Partial<GettingStartedSnapshot> = {}): GettingStartedSnapshot => ({
  user: 'new',
  section: 'shown',
  steps: {},
  reworkSeen: false,
  noticeShown: false,
  demo: null,
  ...change,
})

const appSettings: AppSettings = {
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
}

let invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<Answer>>>
const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

/** A preload whose `firstRun.startup` answers `startup` and `gettingStarted.state` answers `state`. */
function preload(startup: { show: boolean; firstTime: boolean }, state: GettingStartedSnapshot = snapshot()): void {
  const answers: Record<string, (input: unknown) => Answer> = {
    'firstRun.startup': () => ({ ok: true, value: { ...startup, report: null } }),
    'firstRun.checks': () => ({ ok: true, value: REPORT }),
    'firstRun.close': () => ({ ok: true, value: undefined }),
    'gettingStarted.state': () => ({ ok: true, value: state }),
    'gettingStarted.setSection': (input) => ({ ok: true, value: { ...state, ...(input as object) } }),
    'appSettings.get': () => ({ ok: true, value: appSettings }),
    'appSettings.set': () => ({ ok: true, value: appSettings }),
  }
  invoke = vi.fn((channel: string, input?: unknown) => Promise.resolve(answers[channel]?.(input) ?? { ok: false, error: `${channel}: not in this test` }))
  ;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge
}

async function renderFirstRun() {
  const { FirstRun } = await import('../../src/renderer/shell/FirstRun')
  const store = await import('../../src/renderer/shell/first-run-store')
  const gettingStarted = await import('../../src/renderer/getting-started/store')
  render(<FirstRun />)
  return { store, gettingStarted }
}

const welcome = () => screen.findByRole('dialog', { name: 'Welcome to worfy' })
const checks = () => screen.findByRole('dialog', { name: 'First run' })

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

describe('the page of the three concepts', () => {
  it('a first start: "Welcome to worfy" with the three concepts, the checks running behind it; "Next" goes to the checks', async () => {
    preload({ show: true, firstTime: true })
    await renderFirstRun()
    const dialog = await welcome()
    expect(within(dialog).getByText('worfy runs Claude Code agents on your projects and shows their work. Three things to know:')).toBeTruthy()
    const concepts = within(within(dialog).getByRole('list', { name: 'Three things to know' })).getAllByRole('listitem')
    expect(concepts.map((item) => within(item).getByRole('heading').textContent)).toEqual(['Project + Harness', 'Orchestrator', 'Canvas'])
    expect(concepts[0]?.textContent).toContain(
      'A Project is a repository you work on. The Harness is the set of rules the agents follow in this Project: how to check a change, how to review it, when to merge.',
    )
    expect(concepts[1]?.textContent).toContain('The Orchestrator is the main Claude Code Session of a Project. It hands tickets to agents, collects their reviews and merges the work.')
    expect(concepts[2]?.textContent).toContain('The Canvas is where it all shows: epics, tickets, Sessions and their progress, side by side.')
    expect(within(dialog).getByText('Everything else is explained when you meet it.')).toBeTruthy()
    // No checks on this page, but they run already.
    expect(dialog.querySelectorAll('[data-check]')).toHaveLength(0)
    await waitFor(() => expect(callsOf('firstRun.checks')).toHaveLength(1))

    // As a person does it: the focus on "Next", which leaves the screen with the page.
    const nextButton = within(dialog).getByRole('button', { name: 'Next' })
    nextButton.focus()
    fireEvent.click(nextButton)
    const next = await checks()
    await waitFor(() => expect(next.querySelectorAll('[data-check]')).toHaveLength(2))
    expect(screen.queryByRole('dialog', { name: 'Welcome to worfy' })).toBeNull()
    // The checks were not asked again.
    expect(callsOf('firstRun.checks')).toHaveLength(1)
    // The dialog keeps the keyboard: Escape on the checks page still closes it.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })

  it('"worfy Guide" under the concepts opens the Guide over First run, which stays open on its page (worfy-guide 09)', async () => {
    preload({ show: true, firstTime: true })
    await renderFirstRun()
    const { useGuide } = await import('../../src/renderer/guide/store')
    const dialog = await welcome()
    expect(useGuide.getState().open).toBe(false)
    const line = within(dialog).getByTestId('first-run-guide')
    expect(line.textContent).toBe('Short visual help: worfy Guide. It is in the Help menu too.')
    fireEvent.click(within(line).getByRole('button', { name: 'worfy Guide' }))
    expect(useGuide.getState().open).toBe(true)
    await act(async () => undefined)
    expect(screen.getByRole('dialog', { name: 'Welcome to worfy' })).toBe(dialog)
    expect(callsOf('firstRun.close')).toHaveLength(0)
  })

  it('Escape on the concepts page closes First run, and main is told to write the mark', async () => {
    preload({ show: true, firstTime: true })
    await renderFirstRun()
    const dialog = await welcome()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })

  it('"Close" on the concepts page closes First run too', async () => {
    preload({ show: true, firstTime: true })
    await renderFirstRun()
    fireEvent.click(within(await welcome()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsOf('firstRun.close')).toHaveLength(1)
  })
})

describe('askAtStartup and openFirstRun: which page opens', () => {
  it('firstTime true — concepts', async () => {
    preload({ show: true, firstTime: true })
    const { store } = await renderFirstRun()
    await welcome()
    expect(store.useFirstRun.getState().page).toBe('concepts')
  })

  it('show true, firstTime false — the checks at once', async () => {
    preload({ show: true, firstTime: false })
    const { store } = await renderFirstRun()
    await checks()
    expect(store.useFirstRun.getState().page).toBe('checks')
    expect(screen.queryByRole('dialog', { name: 'Welcome to worfy' })).toBeNull()
  })

  it('openFirstRun() — the checks, even after a first start that showed the concepts', async () => {
    preload({ show: false, firstTime: true })
    const { store } = await renderFirstRun()
    await waitFor(() => expect(callsOf('firstRun.startup')).toHaveLength(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => store.openFirstRun())
    await checks()
    expect(store.useFirstRun.getState().page).toBe('checks')
  })

  it('the palette opens the checks while the concepts page is open: the checks', async () => {
    preload({ show: true, firstTime: true })
    const { store } = await renderFirstRun()
    await welcome()
    act(() => store.openFirstRun())
    await checks()
  })
})

describe('"Start Getting started" in the checks (decision 9)', () => {
  it('a new user without step 6: next to "Close"; it closes First run and shows the section, focused', async () => {
    preload({ show: true, firstTime: false }, snapshot({ section: 'hidden', steps: { '1': '2026-10-30T09:00:00.000Z' } }))
    const { gettingStarted } = await renderFirstRun()
    const dialog = await checks()
    const start = await within(dialog).findByRole('button', { name: 'Start Getting started' })
    // In the footer, right before "Close".
    expect(start.nextElementSibling?.textContent).toBe('Close')
    fireEvent.click(start)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsOf('firstRun.close')).toHaveLength(1)
    await waitFor(() => expect(callsOf('gettingStarted.setSection')).toEqual([{ section: 'shown' }]))
    await waitFor(() => expect(gettingStarted.useGettingStartedStore.getState().focusAsked).toBe(1))
  })

  it('an existing user: no button', async () => {
    preload({ show: true, firstTime: false }, snapshot({ user: 'existing', section: 'hidden' }))
    await renderFirstRun()
    const dialog = await checks()
    await waitFor(() => expect(callsOf('gettingStarted.state')).toHaveLength(1))
    await act(async () => undefined)
    expect(within(dialog).queryByRole('button', { name: 'Start Getting started' })).toBeNull()
  })

  it('a new user with step 6 marked: no button', async () => {
    const steps = Object.fromEntries(['1', '2', '3', '4', '5', '6'].map((step) => [step, '2026-10-30T09:00:00.000Z']))
    preload({ show: true, firstTime: false }, snapshot({ steps }))
    await renderFirstRun()
    const dialog = await checks()
    await waitFor(() => expect(callsOf('gettingStarted.state')).toHaveLength(1))
    await act(async () => undefined)
    expect(within(dialog).queryByRole('button', { name: 'Start Getting started' })).toBeNull()
  })

  it('not on the concepts page', async () => {
    preload({ show: true, firstTime: true })
    await renderFirstRun()
    const dialog = await welcome()
    await act(async () => undefined)
    expect(within(dialog).queryByRole('button', { name: 'Start Getting started' })).toBeNull()
  })
})
