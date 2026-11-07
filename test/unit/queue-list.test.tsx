// The "Queue" view of the Start Autopilot window (worfy-autopilot-queue ticket 16; prototype Card
// card-918c77d9, view "Queue"), over the real renderer IPC client and a fake preload, as
// test/unit/start-autopilot-modal.test.tsx does for the one-Epic views.
//
// - "Run all accepted" of the Command palette opens the window with the Project's accepted Epics
//   (acceptedEpics: an acceptance date and a ready Ticket), oldest acceptance first; with none, a toast
//   says so and no window opens.
// - The list (src/renderer/autopilot/QueueList.tsx): a tick, the place among the ticked, the Epic, its
//   Waves and "accepted <date>". Unticking drops an Epic; a drag with the mouse and ⌥↑/⌥↓ on a row's
//   grip move it. The title counts the ticked Epics and their Waves, and the facts (the forecast) are
//   asked again of main for the ticked Epics in their order. Nothing ticked: the start is off.
// - The start goes with the ticked Epics in the order of the list.
// - An agent's ask with a list of Epics (ticket 15) shows the same list, ticks and grips under "Asked by …";
//   the answer to main carries the Run mode and the ticked Epics in their order (`epics`); an ask of one
//   Epic answers no list.
// What main answers to `autopilot.prepare` for several Epics is test/contract/autopilot-prepare.test.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutopilotConfirmAsk } from '../../src/shared/ipc/autopilot-confirm'
import type { AutopilotPrepareAnswer } from '../../src/shared/ipc/autopilot-prepare'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { duration } from '../../src/shared/autopilot/limits-estimate'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import type { CommandContext } from '../../src/renderer/palette/commands'

const PROJECT = 'demo-0000000d'

/** The Epics of the fixture: their Waves left and the day the owner accepted each. */
const EPICS: Record<string, { waves: number; accepted: string }> = {
  alpha: { waves: 2, accepted: '2026-11-04' },
  bravo: { waves: 1, accepted: '2026-11-05' },
  charlie: { waves: 3, accepted: '2026-11-06' },
}

const ticket = (epic: string, num: number, state: Ticket['state'] = 'open'): Ticket => ({
  epic,
  num,
  slug: `ticket-${num}`,
  title: `Ticket ${num}`,
  statusRaw: state,
  state,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [`src/${epic}-${num}.ts`],
  filesListed: true,
  fromBranch: null,
})

/** The model of the window: the accepted Epics out of acceptance order, one not accepted, one accepted but done. */
function model(epics: Epic[] = [
  { epic: 'charlie', hasSpec: true, hasMap: false, title: null, acceptedAt: EPICS['charlie']!.accepted },
  { epic: 'draft', hasSpec: true, hasMap: false, title: null, acceptedAt: null },
  { epic: 'alpha', hasSpec: true, hasMap: false, title: null, acceptedAt: EPICS['alpha']!.accepted },
  { epic: 'closed', hasSpec: true, hasMap: false, title: null, acceptedAt: '2026-11-01' },
  { epic: 'bravo', hasSpec: true, hasMap: false, title: null, acceptedAt: EPICS['bravo']!.accepted },
]): WorkflowModel {
  const tickets = [ticket('alpha', 1), ticket('bravo', 1), ticket('charlie', 1), ticket('draft', 1), ticket('closed', 1, 'done')]
  return { root: '/work/demo', epics, tickets, error: null, branchErrors: [] } as unknown as WorkflowModel
}

/** What main answers to `autopilot.prepare` for `epics`: each Epic's Waves and date, the forecast their sum at 50 min a Wave. */
function prepared(epics: readonly string[]): AutopilotPrepareAnswer {
  const waves = epics.reduce((sum, epic) => sum + (EPICS[epic]?.waves ?? 0), 0)
  return {
    project: { id: PROJECT, name: 'Demo shop' },
    epics: epics.map((epic) => ({ epic, tickets: [1], waves: EPICS[epic]?.waves ?? 0, accepted: EPICS[epic]?.accepted ?? null })),
    orchestrator: { vendor: 'claude', session: 'a1b2c3d4-0000-4000-8000-000000000001' },
    forecast: { lines: [], waves, range: null, duration: waves * 50 * 60_000 },
    budget: { enabled: false, reserve: 0.15 },
    limits: { utilization: 0.38, text: 'Used now: 38%, resets in 2 d 5 h' },
    mode: 'fastest',
    window: { from: 23, to: 7 },
    busy: null,
  }
}

interface Fake {
  calls: { channel: string; input: unknown }[]
  listeners: Map<number, { channel: string; handler: (payload: unknown) => void }>
}
let fake: Fake

beforeEach(() => {
  vi.resetModules()
  fake = { calls: [], listeners: new Map() }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      fake.calls.push({ channel, input })
      switch (channel) {
        case 'autopilot.prepare':
          return Promise.resolve({ ok: true, value: prepared((input as { epics: string[] }).epics) })
        case 'autopilot.start':
          return Promise.resolve({ ok: true, value: { projectId: PROJECT, epic: 'charlie', status: 'running', wave: 1, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [], stopping: false, ticketsInWork: 0, harnessBehind: null, revision: 2 } })
        case 'appSettings.get':
          return Promise.resolve({ ok: true, value: { ...defaultAppSettings(), revision: 1 } })
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
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })

const prepares = () => fake.calls.filter((call) => call.channel === 'autopilot.prepare').map((call) => (call.input as { epics: string[] }).epics)
const starts = () => fake.calls.filter((call) => call.channel === 'autopilot.start').map((call) => call.input)

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  project: { id: PROJECT, name: 'demo', path: '/work/demo', branch: 'main' },
  projects: [],
  view: 'canvas',
  model: model(),
  layoutNodes: [],
  history: [],
  adrs: [],
  tagFilter: null,
  createItems: [],
  ...over,
})

/** The palette's "Run all accepted" for `ctx`; undefined when the palette has no such command. */
async function runAllAccepted(ctx: CommandContext = context()) {
  const { buildCommands } = await import('../../src/renderer/palette/commands')
  return buildCommands(ctx).find((command) => command.id === 'run-all-accepted')
}

/** The shell's window, opened by "Run all accepted", with main's facts read. */
async function queueWindow(): Promise<HTMLElement> {
  const { StartAutopilotModal } = await import('../../src/renderer/autopilot/StartAutopilotModal')
  render(<StartAutopilotModal />)
  const command = await runAllAccepted()
  expect(command).toBeDefined()
  act(() => {
    expect(command!.run()).toBeUndefined()
  })
  const dialog = await screen.findByRole('dialog')
  await settle()
  expect(dialog.getAttribute('data-facts')).toBe('read')
  return dialog
}

const rows = (dialog: HTMLElement) => within(dialog).getAllByTestId('start-autopilot-queue-row')
const order = (dialog: HTMLElement) => rows(dialog).map((row) => row.getAttribute('data-epic'))
const row = (dialog: HTMLElement, epic: string) => rows(dialog).find((each) => each.getAttribute('data-epic') === epic)!
const title = (dialog: HTMLElement) => within(dialog).getByRole('heading', { level: 2 }).textContent
const forecast = (dialog: HTMLElement) => within(dialog).getByTestId('start-autopilot-forecast').textContent

describe('"Run all accepted" in the Command palette', () => {
  it('is a command of the palette while the Project\'s workflow is read; a read-only screen shows it inactive', async () => {
    const command = await runAllAccepted()
    expect(command).toMatchObject({ group: 'Action', title: 'Run all accepted' })
    expect(await runAllAccepted(context({ model: undefined }))).toBeUndefined()
    expect((await runAllAccepted(context({ readOnly: 'Read-only: view access' })))?.readOnly).toBe('Read-only: view access')
  })

  it('opens the window with the accepted Epics that have a ready Ticket, oldest acceptance first', async () => {
    const dialog = await queueWindow()
    expect(dialog.getAttribute('data-from')).toBe('accepted')
    expect(order(dialog)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(prepares()).toEqual([['alpha', 'bravo', 'charlie']])
    expect(title(dialog)).toBe('Start Autopilot · 3 Epics, 6 Waves')
    expect(within(dialog).getByTestId('start-autopilot-accepted').textContent).toBe('3 Epics are accepted and waiting. Autopilot runs them one after another.')
    expect(within(dialog).getByTestId('start-autopilot-queue-hint').textContent).toBe('Ordered by acceptance date · drag to reorder, untick to drop')
    expect(rows(dialog).map((each) => each.textContent)).toEqual(['⋮⋮1alpha2 Wavesaccepted Nov 4', '⋮⋮2bravo1 Waveaccepted Nov 5', '⋮⋮3charlie3 Wavesaccepted Nov 6'])
    // The queue view lists the Epics in the queue, not in the grid of facts.
    expect(within(dialog).queryByTestId('start-autopilot-epic')).toBeNull()
    expect(within(dialog).queryByTestId('start-autopilot-tickets')).toBeNull()
    expect(forecast(dialog)).toBe(`≈ ${duration(6 * 50 * 60_000)}`)
    expect(starts()).toEqual([])
  })

  it('with no accepted Epic that has a ready Ticket: a toast says so and no window opens', async () => {
    const { StartAutopilotModal } = await import('../../src/renderer/autopilot/StartAutopilotModal')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    render(<StartAutopilotModal />)
    const none = model([{ epic: 'draft', hasSpec: true, hasMap: false, title: null, acceptedAt: null }])
    const command = await runAllAccepted(context({ model: none }))
    act(() => {
      expect(command!.run()).toBeUndefined()
    })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toasts.getState().toasts.map((toast) => ({ kind: toast.kind, text: toast.text }))).toEqual([{ kind: 'info', text: 'No accepted Epic has a ready Ticket' }])
    expect(prepares()).toEqual([])
  })
})

describe('the queue of the window', () => {
  it('unticking an Epic drops it: its place, the title, and the facts asked again for the ticked Epics', async () => {
    const dialog = await queueWindow()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include bravo' }))
    await settle()
    expect(row(dialog, 'bravo').getAttribute('data-on')).toBe('false')
    expect(rows(dialog).map((each) => each.querySelector('.w-apstart__queue-n')?.textContent)).toEqual(['1', '–', '2'])
    expect(title(dialog)).toBe('Start Autopilot · 2 Epics, 5 Waves')
    expect(prepares().at(-1)).toEqual(['alpha', 'charlie'])
    expect(forecast(dialog)).toBe(`≈ ${duration(5 * 50 * 60_000)}`)
    // Ticked again: back in its place.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include bravo' }))
    await settle()
    expect(title(dialog)).toBe('Start Autopilot · 3 Epics, 6 Waves')
    expect(forecast(dialog)).toBe(`≈ ${duration(6 * 50 * 60_000)}`)
  })

  it('a drag with the mouse moves a row to where it is dropped', async () => {
    const dialog = await queueWindow()
    const transfer = { setData: () => undefined, effectAllowed: 'all', dropEffect: 'none' }
    fireEvent.dragStart(row(dialog, 'charlie'), { dataTransfer: transfer })
    fireEvent.dragOver(row(dialog, 'alpha'), { dataTransfer: transfer })
    fireEvent.drop(row(dialog, 'alpha'), { dataTransfer: transfer })
    fireEvent.dragEnd(row(dialog, 'charlie'), { dataTransfer: transfer })
    await settle()
    expect(order(dialog)).toEqual(['charlie', 'alpha', 'bravo'])
    expect(prepares().at(-1)).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('⌥↑ and ⌥↓ on a row\'s grip move it a place, the focus with it; at the ends nothing moves', async () => {
    const dialog = await queueWindow()
    const grip = within(dialog).getByRole('button', { name: 'Reorder alpha' })
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown', altKey: true })
    await settle()
    expect(order(dialog)).toEqual(['bravo', 'alpha', 'charlie'])
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Reorder alpha' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true })
    await settle()
    expect(order(dialog)).toEqual(['bravo', 'charlie', 'alpha'])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true })
    expect(order(dialog)).toEqual(['bravo', 'charlie', 'alpha'])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true })
    await settle()
    expect(order(dialog)).toEqual(['bravo', 'alpha', 'charlie'])
    // Without ⌥ an arrow moves nothing.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(order(dialog)).toEqual(['bravo', 'alpha', 'charlie'])
  })

  it('the start goes with the ticked Epics in the order of the list', async () => {
    const dialog = await queueWindow()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include bravo' }))
    const transfer = { setData: () => undefined, effectAllowed: 'all', dropEffect: 'none' }
    fireEvent.dragStart(row(dialog, 'charlie'), { dataTransfer: transfer })
    fireEvent.drop(row(dialog, 'alpha'), { dataTransfer: transfer })
    await settle()
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await settle()
    expect(starts()).toEqual([{ projectId: PROJECT, epic: 'charlie', epics: ['charlie', 'alpha'], mode: 'fastest' }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('nothing ticked: the start is off, and ⌘↩ starts nothing', async () => {
    const dialog = await queueWindow()
    for (const epic of ['alpha', 'bravo', 'charlie']) fireEvent.click(within(dialog).getByRole('checkbox', { name: `Include ${epic}` }))
    await settle()
    expect(title(dialog)).toBe('Start Autopilot · 0 Epics, 0 Waves')
    const start = within(dialog).getByTestId('start-autopilot-start') as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(forecast(dialog)).toBe('No Epic is ticked')
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, ctrlKey: true })
    await settle()
    expect(starts()).toEqual([])
    expect(screen.getByRole('dialog')).toBe(dialog)
  })
})

describe("an agent's ask with a list of Epics (ticket 15)", () => {
  const ASK: AutopilotConfirmAsk = { id: 'ask-1', projectId: PROJECT, project: 'Demo shop', epic: 'bravo', epics: ['bravo', 'alpha', 'charlie'], session: 'c0ffee12-3456-4789-8abc-def012345678', mode: 'fastest', forecast: [], waitMs: 10 * 60_000 }
  const answers = () => fake.calls.filter((call) => call.channel === 'autopilot.confirm.answer').map((call) => call.input)

  /** The shell's window with the agent's ask received and its facts read. */
  async function agentWindow(ask: AutopilotConfirmAsk = ASK): Promise<HTMLElement> {
    const { StartAutopilotModal } = await import('../../src/renderer/autopilot/StartAutopilotModal')
    render(<StartAutopilotModal />)
    await settle()
    act(() => {
      for (const listener of [...fake.listeners.values()]) if (listener.channel === 'autopilot.confirm.ask') listener.handler(ask)
    })
    const dialog = await screen.findByRole('dialog')
    await settle()
    return dialog
  }

  it('shows the queue under "Asked by …" with ticks and grips, in the order the Session asked', async () => {
    const dialog = await agentWindow()
    expect(within(dialog).getByTestId('start-autopilot-asked').textContent).toContain('Asked by Session "c0ffee12" in a chat')
    expect(within(dialog).getByTestId('start-autopilot-countdown').textContent).toMatch(/^(10:00|9:[0-5]\d)$/u)
    expect(order(dialog)).toEqual(['bravo', 'alpha', 'charlie'])
    expect(title(dialog)).toBe('Start Autopilot · 3 Epics, 6 Waves')
    expect(within(dialog).getByTestId('start-autopilot-queue-hint').textContent).toBe('In the order the Session asked · drag to reorder, untick to drop')
    expect(within(dialog).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['Include bravo', 'Include alpha', 'Include charlie'])
    expect(within(dialog).getAllByRole('button', { name: /^Reorder / }).map((grip) => grip.getAttribute('aria-label'))).toEqual(['Reorder bravo', 'Reorder alpha', 'Reorder charlie'])
    expect(rows(dialog).map((each) => each.getAttribute('draggable'))).toEqual(['true', 'true', 'true'])
  })

  it('the answer carries the Run mode and the ticked Epics in their new order; the window starts nothing itself', async () => {
    const dialog = await agentWindow()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include alpha' }))
    const grip = within(dialog).getByRole('button', { name: 'Reorder charlie' })
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true })
    await settle()
    expect(order(dialog)).toEqual(['charlie', 'bravo', 'alpha'])
    expect(title(dialog)).toBe('Start Autopilot · 2 Epics, 4 Waves')
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await settle()
    expect(answers()).toEqual([{ id: 'ask-1', answer: 'fastest', epics: ['charlie', 'bravo'] }])
    expect(starts()).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('nothing ticked: the start is off and nothing is answered; Cancel still answers cancel', async () => {
    const dialog = await agentWindow()
    for (const epic of ['bravo', 'alpha', 'charlie']) fireEvent.click(within(dialog).getByRole('checkbox', { name: `Include ${epic}` }))
    await settle()
    expect((within(dialog).getByTestId('start-autopilot-start') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, ctrlKey: true })
    await settle()
    expect(answers()).toEqual([])
    fireEvent.click(within(dialog).getByTestId('start-autopilot-cancel'))
    await settle()
    expect(answers()).toEqual([{ id: 'ask-1', answer: 'cancel' }])
  })

  it('an ask of one Epic shows no queue and answers no list', async () => {
    const one: AutopilotConfirmAsk = { id: 'ask-1', projectId: PROJECT, project: 'Demo shop', epic: 'alpha', session: ASK.session, mode: 'fastest', forecast: [], waitMs: 10 * 60_000 }
    const dialog = await agentWindow(one)
    expect(within(dialog).queryByTestId('start-autopilot-queue')).toBeNull()
    fireEvent.click(within(dialog).getByTestId('start-autopilot-start'))
    await settle()
    expect(answers()).toEqual([{ id: 'ask-1', answer: 'fastest' }])
  })
})
