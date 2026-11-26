// The one offer to turn the Assistant on in the window (worfy-assistant ticket 16; owner's decision 10; stories 29 and 30),
// over the real renderer IPC client, the real toast store and a fake preload:
// - a new user: on a first start First run goes from the welcome page to the offer ("Meet Assistant"), then to its
//   checks — «Turn on and meet» or «Not now» — and main hears the answer; without an offer it goes to the checks at once;
// - an updated (existing) user: one action toast with «Meet Assistant» and «Not now»; Not now refuses the offer, Meet
//   Assistant shows the section with the offer, and however the toast leaves main hears once that it was shown;
// - no toast for a new user, nor once the message was shown or the offer no longer stands.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfferView } from '../../src/shared/assistant/intro'
import type { AssistantView } from '../../src/shared/assistant/window'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Check, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { AppSettings } from '../../src/shared/settings/app-settings'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

const check = (id: Check['id'], title: string): Check => ({ id, group: 'Command-line tools', title, status: 'ok', severity: 'non-critical', detail: 'found', hint: '', command: null, actions: [] })
const REPORT: FirstRunReport = { checkedAt: '2026-11-26T00:00:00.000Z', checks: [check('git', 'git'), check('jq', 'jq')] }

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

const view = (offer: OfferView): AssistantView => ({
  on: false,
  projects: 1,
  items: [],
  snoozed: [],
  hidden: [],
  proposals: [],
  journal: [],
  conversation: [],
  summary: { id: 's', since: 0, came: 0, done: 0, stopped: 0, waiting: 0, projects: [], first: [], morning: null, rating: null },
  usage: { today: 0, week: 0, fiveHour: null, sevenDay: null, estimate: true },
  workHours: true,
  linked: [],
  offer,
})

let invoke: ReturnType<typeof vi.fn<(channel: string, input?: unknown) => Promise<Answer>>>
const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

function preload(state: GettingStartedSnapshot, startup = { show: true, firstTime: true }): void {
  const answers: Record<string, (input: unknown) => Answer> = {
    'firstRun.startup': () => ({ ok: true, value: { ...startup, report: null } }),
    'firstRun.checks': () => ({ ok: true, value: REPORT }),
    'firstRun.close': () => ({ ok: true, value: undefined }),
    'gettingStarted.state': () => ({ ok: true, value: state }),
    'gettingStarted.setSection': (input) => ({ ok: true, value: { ...state, ...(input as object) } }),
    'assistant.offer': () => ({ ok: true, value: {} }),
    'appSettings.get': () => ({ ok: true, value: appSettings }),
    'appSettings.set': () => ({ ok: true, value: appSettings }),
  }
  invoke = vi.fn((channel: string, input?: unknown) => Promise.resolve(answers[channel]?.(input) ?? { ok: false, error: `${channel}: not in this test` }))
  ;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

describe('the offer on the welcome step of a new user', () => {
  async function welcomeWith(offer: OfferView) {
    preload(snapshot())
    const { useAssistant } = await import('../../src/renderer/assistant/useAssistant')
    useAssistant.setState({ view: view(offer) })
    const { FirstRun } = await import('../../src/renderer/shell/FirstRun')
    render(<FirstRun />)
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome to worfy' })).getByRole('button', { name: 'Next' }))
  }

  it('"Next" of the welcome page shows the offer once; "Not now" refuses it and goes on to the checks', async () => {
    await welcomeWith({ owed: true, notice: false })
    const offer = await screen.findByRole('dialog', { name: 'Meet Assistant' })
    expect(offer.textContent).toContain('It does')
    expect(offer.textContent).toContain('It never')
    expect(offer.textContent).toContain('worfy asks once')
    expect(offer.textContent).not.toMatch(/[$€]|USD|price/iu)
    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    const checks = await screen.findByRole('dialog', { name: 'First run' })
    await waitFor(() => expect(checks.querySelectorAll('[data-check]')).toHaveLength(2))
    expect(callsOf('assistant.offer')).toEqual([{ answer: 'declined' }])
  })

  it('"Turn on and meet" turns it on and goes on to the checks', async () => {
    await welcomeWith({ owed: true, notice: false })
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Meet Assistant' })).getByRole('button', { name: 'Turn on and meet' }))
    await screen.findByRole('dialog', { name: 'First run' })
    expect(callsOf('assistant.offer')).toEqual([{ answer: 'accepted' }])
  })

  it('without an offer standing, "Next" goes to the checks at once', async () => {
    await welcomeWith({ owed: false, notice: false })
    await screen.findByRole('dialog', { name: 'First run' })
    expect(screen.queryByRole('dialog', { name: 'Meet Assistant' })).toBeNull()
    expect(callsOf('assistant.offer')).toEqual([])
  })
})

describe('the one message after an update', () => {
  const KEY = 'assistant-offer-notice'

  async function windowWith(state: GettingStartedSnapshot, offer: OfferView) {
    preload(state)
    const toasts = await import('../../src/renderer/toast/toasts')
    const { ToastRegion } = await import('../../src/renderer/toast/ToastRegion')
    const { useAssistant } = await import('../../src/renderer/assistant/useAssistant')
    const notice = await import('../../src/renderer/assistant/offer-notice')
    const scope = await import('../../src/renderer/shell/sidebar-scope')
    render(<ToastRegion projectId={undefined} />)
    notice.installAssistantOffer()
    await waitFor(() => expect(callsOf('gettingStarted.state')).toHaveLength(1))
    await act(flush)
    // The view comes after the state: the message waits for it.
    act(() => useAssistant.setState({ view: view(offer) }))
    await act(flush)
    return { toasts, notice, scope }
  }

  const onScreen = () => screen.queryByTestId(KEY)

  it('an updated user gets one toast with «Meet Assistant» and «Not now»; «Not now» refuses the offer', async () => {
    const { toasts, notice } = await windowWith(snapshot({ user: 'existing', section: 'hidden' }), { owed: true, notice: true })
    expect(toasts.toasts.getState().toasts).toHaveLength(1)
    const element = onScreen()!
    expect(element.textContent).toMatch(/Assistant/u)
    expect(within(element).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Meet Assistant', 'Not now', 'Dismiss'])
    notice.installAssistantOffer()
    await act(flush)
    expect(toasts.toasts.getState().toasts).toHaveLength(1)
    fireEvent.click(within(element).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(onScreen()).toBeNull())
    await act(flush)
    expect(callsOf('assistant.offer')).toEqual([{ answer: 'declined' }])
  })

  it('«Meet Assistant» shows the section, where the offer stands; main hears the message was shown', async () => {
    const { scope } = await windowWith(snapshot({ user: 'existing', section: 'hidden' }), { owed: true, notice: true })
    fireEvent.click(within(onScreen()!).getByRole('button', { name: 'Meet Assistant' }))
    await waitFor(() => expect(onScreen()).toBeNull())
    await act(flush)
    expect(scope.useSidebarScope.getState().section).toBe('AssistantSection')
    expect(callsOf('assistant.offer')).toEqual([{ answer: 'seen' }])
  })

  it('closed with Escape: main hears once that it was shown, and the offer stays', async () => {
    await windowWith(snapshot({ user: 'existing', section: 'hidden' }), { owed: true, notice: true })
    fireEvent.keyDown(onScreen()!, { key: 'Escape' })
    await waitFor(() => expect(onScreen()).toBeNull())
    await act(flush)
    expect(callsOf('assistant.offer')).toEqual([{ answer: 'seen' }])
  })

  it('a new user gets no toast: the welcome step offers it', async () => {
    const { toasts } = await windowWith(snapshot(), { owed: true, notice: true })
    expect(toasts.toasts.getState().toasts).toEqual([])
  })

  it('once shown, or once the offer no longer stands: no toast', async () => {
    const shown = await windowWith(snapshot({ user: 'existing', section: 'hidden' }), { owed: true, notice: false })
    expect(shown.toasts.toasts.getState().toasts).toEqual([])
    vi.resetModules()
    const over = await windowWith(snapshot({ user: 'existing', section: 'hidden' }), { owed: false, notice: false })
    expect(over.toasts.toasts.getState().toasts).toEqual([])
    expect(callsOf('assistant.offer')).toEqual([])
  })
})
