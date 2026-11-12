// The Start Autopilot window (src/renderer/autopilot/StartAutopilotModal.tsx, worfy-autopilot-queue ticket
// 09) over the real renderer IPC client and a fake preload. The Autopilot button of an Epic frame
// (canvas/actions/AutopilotAction.tsx) opens it instead of starting a run; the window shows the facts
// main answers to `autopilot.prepare`, the default Run mode of Settings marked and chosen, and starts
// with the chosen mode only on "Start Autopilot" or ⌘↩. Esc and Cancel start nothing; the focus is on
// Cancel when it opens and Tab does not leave it. With the Orchestrator busy it says so and its main
// button is "Start when free". What main answers is checked in test/contract/autopilot-prepare.test.ts.
//
// An agent's `autopilot_start` (worfy-autopilot-queue ticket 11): main's `autopilot.confirm.ask` opens the
// same window in its "Agent asks" view — the Session that asks and a countdown of main's 10 minutes, the
// last minute in the blocked colours, "time is up" at 0:00 or on main's `autopilot.confirm.close`. The
// choice goes back as `autopilot.confirm.answer`. The countdown runs on the test's clock (fake timers).
// What main does with the answer is checked in test/contract/autopilot-start-tool.test.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutopilotPrepareAnswer } from '../../src/shared/ipc/autopilot-prepare'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { AutopilotConfirmAsk } from '../../src/shared/ipc/autopilot-confirm'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { pressTab } from './tab-key'

const ROOT = '/work/demo'
const PROJECT = 'demo-0000000d'

const ticket = (num: number, state: Ticket['state'], blockedNums: number[] = []): Ticket => ({
  epic: 'demo',
  num,
  slug: `ticket-${num}`,
  title: `Ticket ${num}`,
  statusRaw: state,
  state,
  blockedRaw: blockedNums.length ? blockedNums.join(', ') : null,
  blockedNums,
  blockedParsed: true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})
const EPIC: Epic = { epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }
const TICKETS = [ticket(7, 'done'), ticket(8, 'open', [7]), ticket(9, 'open'), ticket(10, 'open', [9])]

const PREPARED: AutopilotPrepareAnswer = {
  project: { id: PROJECT, name: 'Demo shop' },
  epics: [{ epic: 'demo', tickets: [8, 9, 10], waves: 2, accepted: null }],
  orchestrator: { vendor: 'claude', session: 'a1b2c3d4-0000-4000-8000-000000000001' },
  forecast: {
    lines: [
      'Forecast: This Epic: 2 Waves, 3 Tickets left, usually 18–31% of the week. Used now: 38%, resets in 2 d 5 h.',
      'Budget-aware: Recommended: 1 Wave now, the other 1 after the reset.',
      'Fastest: Only 1 of 2 Waves fits before the reset: then the run waits for the Limits.',
      'Start window 23:00–07:00: a Wave usually takes up to 50 min.',
    ],
    waves: 2,
    range: { low: 0.18, high: 0.31 },
    duration: 100 * 60_000,
  },
  budget: { enabled: true, reserve: 0.15 },
  limits: { utilization: 0.38, text: 'Used now: 38%, resets in 2 d 5 h' },
  mode: 'budget-aware',
  window: { from: 23, to: 7 },
  busy: null,
}

interface Fake {
  calls: { channel: string; input: unknown }[]
  prepared: AutopilotPrepareAnswer | string
  /** What autopilot.start answers; undefined: the run's first state. */
  started: { ok: boolean; value?: unknown; error?: string } | undefined
  /** The subscriptions of the page, by id. */
  listeners: Map<number, { channel: string; handler: (payload: unknown) => void }>
}

let fake: Fake

const idle = (): AutopilotState => ({ projectId: PROJECT, epic: null, status: 'stopped', wave: 0, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [], stopping: false, ticketsInWork: 0, harnessBehind: null, revision: 1 })

beforeEach(() => {
  vi.resetModules()
  fake = { calls: [], prepared: PREPARED, started: undefined, listeners: new Map() }
  const model: WorkflowModel = { root: ROOT, epics: [EPIC], tickets: TICKETS, error: null, branchErrors: [] } as unknown as WorkflowModel
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      fake.calls.push({ channel, input })
      switch (channel) {
        case 'autopilot.prepare':
          return Promise.resolve(typeof fake.prepared === 'string' ? { ok: false, error: `autopilot.prepare failed: ${fake.prepared}` } : { ok: true, value: fake.prepared })
        case 'autopilot.start':
          return Promise.resolve(fake.started ?? { ok: true, value: { ...idle(), epic: 'demo', status: 'running', wave: 1, revision: 2 } })
        case 'autopilot.state':
          return Promise.resolve({ ok: true, value: idle() })
        case 'workflow.open':
          return Promise.resolve({ ok: true, value: model })
        case 'projects.list':
          return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
        case 'projects.settings.get':
          return Promise.resolve({ ok: true, value: { actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } } })
        case 'appSettings.get':
          return Promise.resolve({ ok: true, value: { ...defaultAppSettings(), autopilotRun: { mode: 'budget-aware' }, revision: 1 } })
        case 'ecoMode.read':
          return Promise.resolve({ ok: true, value: { available: true, on: false, fingerprint: `sha256:${'1'.repeat(64)}` } })
        case 'autoApproval.read':
          return Promise.resolve({ ok: true, value: { mode: 'on', saved: 'on', blocked: null } })
        case 'autoApproval.blockedHere':
          return Promise.resolve({ ok: true, value: { blocked: null } })
        case 'autoContinue.read':
          return Promise.resolve({ ok: true, value: { on: true } })
        case 'autopilot.confirm.answer':
          return Promise.resolve({ ok: true, value: undefined })
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` })
      }
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      const id = fake.listeners.size + 1
      fake.listeners.set(id, { channel, handler })
      return id
    },
    off: (id: number) => fake.listeners.delete(id),
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const starts = () => fake.calls.filter((call) => call.channel === 'autopilot.start').map((call) => call.input)

/** The Autopilot button of the Epic frame with the shell's window, ready to be clicked. */
async function button(): Promise<HTMLElement> {
  const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
  const { StartAutopilotModal } = await import('../../src/renderer/autopilot/StartAutopilotModal')
  render(
    <>
      <AutopilotAction subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: EPIC, tickets: TICKETS }} />
      <StartAutopilotModal />
    </>,
  )
  const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
  await vi.waitFor(() => expect(autopilot.getAttribute('aria-disabled')).toBe('false'))
  return autopilot
}

/** Clicks the button and waits for the window with main's facts. */
async function openWindow(): Promise<HTMLElement> {
  fireEvent.click(await button())
  const dialog = await screen.findByRole('dialog', { name: 'Start Autopilot' })
  await vi.waitFor(() => expect(dialog.getAttribute('data-facts')).not.toBe('reading'))
  await settle()
  return dialog
}

describe('the Autopilot button opens the Start Autopilot window', () => {
  it('a click opens the window and starts nothing', async () => {
    fireEvent.click(await button())
    expect(await screen.findByRole('dialog', { name: 'Start Autopilot' })).toBeTruthy()
    await settle()
    expect(starts()).toEqual([])
    expect(fake.calls.filter((call) => call.channel === 'autopilot.prepare').map((call) => call.input)).toEqual([{ projectId: PROJECT, epics: ['demo'] }])
  })

  it("shows the facts of main's answer: Project, Epic, Tickets and Waves left, Orchestrator, forecast, Limits, Modes", async () => {
    const dialog = await openWindow()
    const fact = (id: string) => within(dialog).getByTestId(`start-autopilot-${id}`).textContent
    expect(within(dialog).getByText('From the Autopilot button on the Canvas')).toBeTruthy()
    expect(fact('project')).toBe('Demo shop')
    expect(fact('epic')).toBe('demo')
    expect(fact('tickets')).toBe('08, 09, 10· 2 Waves left')
    expect(fact('orchestrator')).toBe('Claude Codevendor · Session a1b2c3d4')
    expect(fact('forecast')).toBe('≈ 1 h 40 min·usually 18–31% of the week· reserve 15%')
    expect(within(dialog).getByTestId('start-autopilot-forecast').firstElementChild?.getAttribute('title')).toBe(PREPARED.forecast.lines.join('\n'))
    expect(fact('limits')).toBe('Used now: 38%, resets in 2 d 5 h')
    expect(within(dialog).getByRole('img', { name: '38% of the week used' })).toBeTruthy()
    await vi.waitFor(() => expect(fact('modes')).toBe('Eco offAuto-approval OnAuto-continue onchange in Modes'))
    expect(within(dialog).queryByTestId('start-autopilot-busy')).toBeNull()
    expect(within(dialog).getByTestId('start-autopilot-start').textContent).toBe('Start Autopilot')
  })

  it('the default Run mode of Settings is marked "(default)" and chosen; the line under the modes is its forecast line', async () => {
    const dialog = await openWindow()
    const radios = within(dialog).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['Fastest', 'Budget-aware (default)', 'Start window (23:00–07:00)'])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    const hint = within(dialog).getByTestId('start-autopilot-mode-hint')
    expect(hint.textContent).toBe('The daily budget of the Limits, with the reserve. Recommended: 1 Wave now, the other 1 after the reset')
    fireEvent.click(radios[0]!)
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true')
    expect(hint.textContent).toBe('Waves go one after another: no budget, no window. Only 1 of 2 Waves fits before the reset: then the run waits for the Limits')
    fireEvent.click(radios[2]!)
    expect(hint.textContent).toBe('New Waves start only inside the window; the daily budget too, when it is on. Start window 23:00–07:00: a Wave usually takes up to 50 min')
  })

  it('the modes are one Tab stop, on the chosen one; the arrows move the choice (worfy-ui-kit ticket 14)', async () => {
    const dialog = await openWindow()
    const radios = within(dialog).getAllByRole('radio')
    const chosen = radios[1]!
    // Tab from the control before the modes lands on the chosen mode, the next Tab leaves the group.
    const stops = [...dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((each) => each.tabIndex >= 0 && !(each as HTMLButtonElement).disabled)
    const before = stops[stops.indexOf(chosen) - 1]!
    act(() => before.focus())
    await pressTab()
    expect(document.activeElement).toBe(chosen)
    await pressTab()
    expect(radios).not.toContain(document.activeElement)
    expect(document.activeElement?.tagName).toBe('BUTTON')
    act(() => chosen.focus())
    await act(async () => {
      fireEvent.keyDown(chosen, { key: 'ArrowRight' })
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(radios[2])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    expect(within(dialog).getByTestId('start-autopilot-mode-hint').textContent).toMatch(/^New Waves start only inside the window/)
  })

  it('the focus is on Cancel when it opens, and Tab and Shift+Tab go round the window only', async () => {
    const dialog = await openWindow()
    const cancel = within(dialog).getByTestId('start-autopilot-cancel')
    expect(document.activeElement).toBe(cancel)
    // Forward from the last control (Start) comes back to the first; back from the first goes to the last.
    const start = within(dialog).getByTestId('start-autopilot-start')
    await pressTab()
    expect(document.activeElement).toBe(start)
    await pressTab()
    const first = within(dialog).getByTestId('start-autopilot-change-modes')
    expect(document.activeElement).toBe(first)
    await pressTab(true)
    expect(document.activeElement).toBe(start)
    // Every step of a full round stays inside the window.
    const controls = dialog.querySelectorAll('button')
    for (let step = 0; step < controls.length + 2; step += 1) {
      await pressTab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    expect(starts()).toEqual([])
  })

  it('Esc and Cancel close the window and start nothing; the button is active again', async () => {
    const dialog = await openWindow()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const autopilot = screen.getByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(autopilot)
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('start-autopilot-cancel'))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(starts()).toEqual([])
    // Nothing was refused either: the button shows no reason.
    expect(autopilot.getAttribute('data-error')).toBeNull()
  })

  it('⌘↩ starts with the chosen mode and closes the window', async () => {
    const dialog = await openWindow()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Fastest' }))
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(starts()).toEqual([{ projectId: PROJECT, epic: 'demo', mode: 'fastest' }])
    await screen.findByRole('button', { name: 'Stop autopilot' })
  })

  it('⌘↩ is the window\'s own shortcut on the kit\'s Dialog: it starts, marked handled, and no listener of the app behind hears it; ⌘K does not open the Command palette (worfy-ui-kit ticket 06)', async () => {
    const { CommandPalette } = await import('../../src/renderer/palette/CommandPalette')
    render(<CommandPalette />)
    const dialog = await openWindow()
    // As focus mode's ⌘↩ and the Canvas's keys listen: on window, in both phases.
    const behind = { capture: vi.fn(), bubble: vi.fn() }
    globalThis.addEventListener('keydown', behind.capture, true)
    globalThis.addEventListener('keydown', behind.bubble)
    try {
      const cancel = within(dialog).getByTestId('start-autopilot-cancel')
      fireEvent.keyDown(cancel, { key: 'k', metaKey: true })
      await settle()
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
      expect(starts()).toEqual([])
      const key = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
      act(() => {
        cancel.dispatchEvent(key)
      })
      expect(key.defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start Autopilot' })).toBeNull())
      expect(starts()).toEqual([{ projectId: PROJECT, epic: 'demo', mode: 'budget-aware' }])
      expect(behind.capture).not.toHaveBeenCalled()
      expect(behind.bubble).not.toHaveBeenCalled()
    } finally {
      globalThis.removeEventListener('keydown', behind.capture, true)
      globalThis.removeEventListener('keydown', behind.bubble)
    }
  })

  it('Ctrl+Enter on macOS is not the start: the window stays and starts nothing (worfy-ui-kit ticket 06)', async () => {
    expect(document.documentElement.dataset.platform).toBe('mac')
    const dialog = await openWindow()
    const key = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      within(dialog).getByTestId('start-autopilot-cancel').dispatchEvent(key)
    })
    expect(key.defaultPrevented).toBe(false)
    await settle()
    expect(screen.getByRole('dialog', { name: 'Start Autopilot' })).toBe(dialog)
    expect(starts()).toEqual([])
  })

  it('a click on the backdrop does nothing: the window stays, nothing starts and nothing is cancelled (worfy-ui-kit ticket 06)', async () => {
    const dialog = await openWindow()
    const backdrop = dialog.parentElement!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    await settle()
    expect(screen.getByRole('dialog', { name: 'Start Autopilot' })).toBe(dialog)
    expect(starts()).toEqual([])
  })

  it('the window is drawn on the layer of the toasts (z 120), above the kit\'s dialog layer of Settings (worfy-ui-kit ticket 06)', async () => {
    const { LAYERS } = await import('../../src/renderer/theme/layers')
    const dialog = await openWindow()
    let layer: HTMLElement = dialog
    while (layer.parentElement !== null && layer.parentElement !== document.body) layer = layer.parentElement
    expect(layer.parentElement).toBe(document.body)
    expect(getComputedStyle(layer).zIndex).toBe('120')
    expect(Number(getComputedStyle(layer).zIndex)).toBe(LAYERS.toast)
    expect(Number(getComputedStyle(layer).zIndex)).toBeGreaterThan(LAYERS.dialog)
  })

  it('a ⌘ key that is not the window\'s own is not taken: ⌘A keeps its default (worfy-ui-kit ticket 06)', async () => {
    const dialog = await openWindow()
    const key = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })
    act(() => {
      within(dialog).getByTestId('start-autopilot-cancel').dispatchEvent(key)
    })
    expect(key.defaultPrevented).toBe(false)
    await settle()
    expect(screen.getByRole('dialog', { name: 'Start Autopilot' })).toBe(dialog)
    expect(starts()).toEqual([])
  })

  it('closed by Esc, the window gives the focus back to the Autopilot button that opened it (worfy-ui-kit ticket 06)', async () => {
    const autopilot = await button()
    autopilot.focus()
    fireEvent.click(autopilot)
    const dialog = await screen.findByRole('dialog', { name: 'Start Autopilot' })
    await settle()
    expect(document.activeElement).toBe(within(dialog).getByTestId('start-autopilot-cancel'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(autopilot)
  })

  it('"Start Autopilot" starts with the default mode', async () => {
    const dialog = await openWindow()
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(starts()).toEqual([{ projectId: PROJECT, epic: 'demo', mode: 'budget-aware' }])
  })

  it('the Orchestrator busy: the notice names its turn, queue and tasks, and the main button is "Start when free"', async () => {
    fake.prepared = { ...PREPARED, busy: { turn: true, queued: 2, tasks: [{ id: 't1', type: 'local_agent', description: 'impl-04' }, { id: 't2', type: null, description: null }] } }
    const dialog = await openWindow()
    expect(within(dialog).getByTestId('start-autopilot-busy').textContent).toBe(
      'The Orchestrator is busy: a turn is running · 2 queued messages · 2 background tasks. Autopilot will wait and start when it is free.Background tasks: impl-04, t2',
    )
    const start = within(dialog).getByTestId('start-autopilot-start')
    expect(start.textContent).toBe('Start when free')
    fireEvent.click(start)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(starts()).toEqual([{ projectId: PROJECT, epic: 'demo', mode: 'budget-aware' }])
  })

  it("a refused start closes the window; main's reason is the toast and the button's tooltip", async () => {
    const reason = 'Set the Run wave template in Project settings'
    fake.started = { ok: false, error: `autopilot.start failed: ${reason}` }
    const { toasts } = await import('../../src/renderer/toast/toasts')
    const dialog = await openWindow()
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const autopilot = screen.getByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('data-error')).toBe(reason))
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'error', text: reason, testId: 'autopilot-start-refused' }])
  })

  it('a Mode chip is the ready Chip while the Mode is on and the neutral one while it is off, each with its dot (worfy-ui-kit ticket 16)', async () => {
    const dialog = await openWindow()
    const modes = within(dialog).getByTestId('start-autopilot-modes')
    await vi.waitFor(() => expect(modes.querySelectorAll('.w-chip[data-on]')).toHaveLength(3))
    const chip = (word: string) => [...modes.querySelectorAll<HTMLElement>('.w-chip')].find((each) => each.textContent?.startsWith(word))!
    expect([chip('Eco'), chip('Auto-approval'), chip('Auto-continue')].map((each) => [each.dataset.on, each.classList.contains('w-chip--ready'), each.classList.contains('w-chip--open')])).toEqual([
      ['false', false, true],
      ['true', true, false],
      ['true', true, false],
    ])
    for (const each of [chip('Eco'), chip('Auto-approval')]) expect(each.firstElementChild?.classList.contains('w-chip__dot')).toBe(true)
  })

  it('facts that cannot be read say so; the start still goes', async () => {
    fake.prepared = 'The Project has no Epic demo'
    const dialog = await openWindow()
    expect(within(dialog).getByRole('alert').textContent).toBe('Could not read the facts of this start: The Project has no Epic demo')
    expect(within(dialog).getByTestId('start-autopilot-project').textContent).toBe('—')
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await vi.waitFor(() => expect(starts()).toEqual([{ projectId: PROJECT, epic: 'demo', mode: 'budget-aware' }]))
  })
})

describe('an agent\'s autopilot_start opens the window in its "Agent asks" view (worfy-autopilot-queue ticket 11)', () => {
  const SESSION = 'c0ffee12-3456-4789-8abc-def012345678'
  const ASK: AutopilotConfirmAsk = { id: 'ask-1', projectId: PROJECT, project: 'Demo shop', epic: 'demo', tickets: [8, 9], session: SESSION, mode: 'budget-aware', forecast: [], waitMs: 10 * 60_000 }

  /** Lets the window take main's answers: the fake bridge answers at once, in microtasks. */
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve()
    })

  /** Sends the page the event `channel` of main. */
  const emit = (channel: string, payload: unknown) =>
    act(() => {
      for (const listener of [...fake.listeners.values()]) if (listener.channel === channel) listener.handler(payload)
    })

  /** Moves the test's clock by `ms`. */
  const pass = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  const answers = () => fake.calls.filter((call) => call.channel === 'autopilot.confirm.answer').map((call) => call.input)

  /** The shell's window with main's ask received, its facts read; the test's clock from here on. */
  async function agentWindow(ask: AutopilotConfirmAsk = ASK): Promise<HTMLElement> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.parse('2026-11-06T12:00:00.000Z'))
    const { StartAutopilotModal } = await import('../../src/renderer/autopilot/StartAutopilotModal')
    render(<StartAutopilotModal />)
    await flush()
    emit('autopilot.confirm.ask', ask)
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Start Autopilot' })
    expect(dialog.getAttribute('data-facts')).toBe('read')
    return dialog
  }

  const asked = (dialog: HTMLElement) => within(dialog).getByTestId('start-autopilot-asked')
  const countdown = (dialog: HTMLElement) => within(dialog).getByTestId('start-autopilot-countdown')

  it('names the Session that asks and counts down main\'s 10 minutes; the facts are those of the asked start', async () => {
    const dialog = await agentWindow()
    expect(dialog.getAttribute('data-from')).toBe('agent')
    expect(asked(dialog).textContent).toBe('Asked by Session "c0ffee12" in a chat · answer within 10:00')
    expect(within(dialog).queryByText('From the Autopilot button on the Canvas')).toBeNull()
    await pass(1000)
    expect(countdown(dialog).textContent).toBe('9:59')
    expect(countdown(dialog).className).toBe('w-apstart__count')
    expect(fake.calls.filter((call) => call.channel === 'autopilot.prepare').map((call) => call.input)).toEqual([{ projectId: PROJECT, epics: ['demo'], tickets: [8, 9] }])
    expect(within(dialog).getByTestId('start-autopilot-project').textContent).toBe('Demo shop')
    // The focus is on Cancel, as for the Canvas button.
    expect(document.activeElement).toBe(within(dialog).getByTestId('start-autopilot-cancel'))
    expect(answers()).toEqual([])
  })

  it('the last minute is in the blocked colours', async () => {
    const dialog = await agentWindow()
    await pass(9 * 60_000 - 1000)
    expect(countdown(dialog).textContent).toBe('1:01')
    expect(countdown(dialog).hasAttribute('data-late')).toBe(false)
    await pass(1000)
    expect(countdown(dialog).textContent).toBe('1:00')
    expect(countdown(dialog).hasAttribute('data-late')).toBe(true)
    expect(countdown(dialog).className).toBe('w-apstart__count w-apstart__count--late')
    await pass(59_000)
    expect(countdown(dialog).textContent).toBe('0:01')
  })

  it('at 0:00 the time is up: "the Session got declined", every control off, no answer, and the window closes', async () => {
    const { TIME_UP_CLOSE_MS } = await import('../../src/renderer/autopilot/StartAutopilotModal')
    const dialog = await agentWindow()
    await pass(10 * 60_000)
    expect(asked(dialog).textContent).toBe('Asked by Session "c0ffee12" · time is up — the Session got "declined"')
    expect(dialog.hasAttribute('data-time-up')).toBe(true)
    const controls = [...dialog.querySelectorAll('button')]
    expect(controls.length).toBeGreaterThan(3)
    for (const control of controls) expect((control as HTMLButtonElement).disabled, control.textContent ?? '').toBe(true)
    // Neither Esc nor ⌘↩ answers any more.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    await pass(TIME_UP_CLOSE_MS - 1)
    expect(screen.queryByRole('dialog')).not.toBeNull()
    await pass(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Main has answered the Session itself.
    expect(answers()).toEqual([])
  })

  it("main's close says the time is up at once, whatever the window counted", async () => {
    const dialog = await agentWindow()
    await pass(5000)
    emit('autopilot.confirm.close', { id: 'another-ask' })
    expect(dialog.hasAttribute('data-time-up')).toBe(false)
    emit('autopilot.confirm.close', { id: ASK.id })
    expect(asked(dialog).textContent).toBe('Asked by Session "c0ffee12" · time is up — the Session got "declined"')
    expect((within(dialog).getByTestId('start-autopilot-start') as HTMLButtonElement).disabled).toBe(true)
  })

  it('"Start Autopilot" answers the chosen mode and closes the window; the window starts nothing itself', async () => {
    const dialog = await agentWindow()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Fastest' }))
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answers()).toEqual([{ id: ASK.id, answer: 'fastest' }])
    expect(starts()).toEqual([])
  })

  it('Esc answers cancel and closes the window', async () => {
    const dialog = await agentWindow()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answers()).toEqual([{ id: ASK.id, answer: 'cancel' }])
  })

  it('a second ask while the window is open is answered "occupied"; the open one stays', async () => {
    const dialog = await agentWindow()
    emit('autopilot.confirm.ask', { ...ASK, id: 'ask-2', session: 'feedface-0000-4000-8000-000000000000' })
    await flush()
    expect(answers()).toEqual([{ id: 'ask-2', answer: 'occupied' }])
    expect(screen.getAllByRole('dialog')).toEqual([dialog])
    expect(asked(dialog).textContent).toContain('"c0ffee12"')
  })
})
