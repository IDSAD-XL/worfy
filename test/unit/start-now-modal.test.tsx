// The Autopilot line of a run that waits for its Orchestrator (worfy-autopilot-queue ticket 10) and the
// "Start now?" window (src/renderer/autopilot/StartNowModal.tsx). The line of the Epic frame
// (canvas/actions/AutopilotAction.tsx) says "waiting for the Orchestrator · N min" with "Start now" and
// "Cancel" beside it. "Cancel" ends the wait at once (`autopilot.stop`: `start-cancelled`, the
// Orchestrator is not touched). "Start now" opens the window: what the start stops — the running turn,
// the background tasks by name — and what stays, the queued messages, read from the state's `busy` and
// kept current while it is open; Cancel (and Esc) leaves the run waiting, "Interrupt and start" sends
// `autopilot.startNow`. What main does with both is checked in test/contract/autopilot-wait.test.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutopilotState } from '../../src/shared/ipc/autopilot'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { pressTab } from './tab-key'

const ROOT = '/work/demo'
const PROJECT = 'demo-0000000e'

type Busy = NonNullable<AutopilotState['busy']>

const TASKS: Busy['tasks'] = [
  { id: 'task-1', type: 'local_agent', description: 'impl-04' },
  { id: 'task-2', type: 'local_agent', description: 'verify-06' },
  { id: 'task-3', type: 'local_bash', description: null },
]

describe('the "Start now?" window', () => {
  afterEach(() => cleanup())

  async function open(busy: Busy) {
    const { StartNowModal } = await import('../../src/renderer/autopilot/StartNowModal')
    const onCancel = vi.fn()
    const onStart = vi.fn()
    const view = render(<StartNowModal epic="worfy-faults" busy={busy} starting={false} onCancel={onCancel} onStart={onStart} />)
    const dialog = screen.getByRole('dialog', { name: 'Start now?' })
    const rows = () => within(dialog).getAllByRole('listitem').map((row) => row.textContent)
    const rerender = (next: Busy) => view.rerender(<StartNowModal epic="worfy-faults" busy={next} starting={false} onCancel={onCancel} onStart={onStart} />)
    return { dialog, rows, onCancel, onStart, rerender }
  }

  it('a turn, 3 background tasks by name and 2 queued messages: the turn and the tasks stop, the messages stay', async () => {
    const { dialog, rows } = await open({ turn: true, queued: 2, tasks: TASKS })
    expect(within(dialog).getByText('Autopilot worfy-faults starts right away. This stops:')).toBeTruthy()
    expect(rows()).toEqual(['✕the running turn', '✕3 background tasks: impl-04, verify-06, task-3', '✓2 queued messages stay in the queue'])
    expect(within(dialog).getByRole('button', { name: 'Interrupt and start' }).className).toContain('w-apstart__button--danger')
  })

  it('no turn, one task, no messages: only the task stops', async () => {
    const { rows } = await open({ turn: false, queued: 0, tasks: [TASKS[0]!] })
    expect(rows()).toEqual(['✕1 background task: impl-04'])
  })

  it('a turn, 0 tasks, one message', async () => {
    const { rows } = await open({ turn: true, queued: 1, tasks: [] })
    expect(rows()).toEqual(['✕the running turn', '✓1 queued message stays in the queue'])
  })

  it('nothing keeps the Orchestrator busy any more: nothing stops', async () => {
    const { rows } = await open({ turn: false, queued: 0, tasks: [] })
    expect(rows()).toEqual(['✕nothing: the Orchestrator is free'])
  })

  it('the list follows `busy` while the window is open', async () => {
    const { rows, rerender } = await open({ turn: true, queued: 0, tasks: [] })
    rerender({ turn: false, queued: 0, tasks: TASKS.slice(0, 2) })
    expect(rows()).toEqual(['✕2 background tasks: impl-04, verify-06'])
  })

  it('the focus is on Cancel; Esc is Cancel and interrupts nothing', async () => {
    const { dialog, onCancel, onStart } = await open({ turn: true, queued: 0, tasks: TASKS })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('"Interrupt and start" starts', async () => {
    const { dialog, onCancel, onStart } = await open({ turn: true, queued: 0, tasks: [] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Interrupt and start' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('on the kit\'s Dialog: Tab and Shift+Tab go round its two buttons, a click outside and Esc while starting do nothing, and closed it gives the focus back to its opener (worfy-ui-kit ticket 06)', async () => {
    const { StartNowModal } = await import('../../src/renderer/autopilot/StartNowModal')
    const onCancel = vi.fn()
    const busy: Busy = { turn: true, queued: 0, tasks: [] }
    const page = (open: boolean, starting = false) => (
      <>
        <button type="button">Start now</button>
        {open ? <StartNowModal epic="worfy-faults" busy={busy} starting={starting} onCancel={onCancel} onStart={() => undefined} /> : null}
      </>
    )
    const view = render(page(false))
    const opener = screen.getByRole('button', { name: 'Start now' })
    opener.focus()
    view.rerender(page(true))
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    const dialog = screen.getByRole('dialog', { name: 'Start now?' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const start = within(dialog).getByRole('button', { name: 'Interrupt and start' })
    expect(document.activeElement).toBe(cancel)
    await pressTab()
    expect(document.activeElement).toBe(start)
    await pressTab()
    expect(document.activeElement).toBe(cancel)
    await pressTab(true)
    expect(document.activeElement).toBe(start)
    fireEvent.mouseDown(dialog.parentElement!)
    expect(onCancel).not.toHaveBeenCalled()
    view.rerender(page(true, true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    view.rerender(page(true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    view.rerender(page(false))
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    expect(document.activeElement).toBe(opener)
  })
})

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
const TICKETS = [ticket(1, 'open'), ticket(2, 'open'), ticket(3, 'open', [1, 2])]

const base = (): AutopilotState => ({ projectId: PROJECT, epic: 'demo', status: 'stopped', wave: 0, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [], stopping: false, ticketsInWork: 0, harnessBehind: null, revision: 1 })

/** When the run began to wait: four and a half minutes before the test file loads. Main keeps it for the whole wait. */
const SINCE = Date.now() - 270_000

/** A run that waits for its Orchestrator since SINCE. */
const waiting = (busy: Busy, revision = 2): AutopilotState => ({ ...base(), status: 'waiting', waitingFor: 'orchestrator', busy, waitingSince: SINCE, revision })

describe('the Autopilot line of a run that waits for its Orchestrator', () => {
  let calls: { channel: string; input: unknown }[]
  let listeners: Map<number, { channel: string; handler: (payload: unknown) => void }>
  let answers: Record<string, { ok: boolean; value?: unknown; error?: string }>

  beforeEach(() => {
    vi.resetModules()
    calls = []
    listeners = new Map()
    answers = {}
    const model = { root: ROOT, epics: [EPIC], tickets: TICKETS, error: null, branchErrors: [] } as unknown as WorkflowModel
    const bridge = {
      invoke: (channel: string, input: unknown) => {
        calls.push({ channel, input })
        const answer = answers[channel]
        if (answer !== undefined) return Promise.resolve(answer)
        switch (channel) {
          case 'autopilot.state':
            return Promise.resolve({ ok: true, value: waiting({ turn: true, queued: 2, tasks: TASKS }) })
          case 'workflow.open':
            return Promise.resolve({ ok: true, value: model })
          case 'projects.list':
            return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
          case 'projects.settings.get':
            return Promise.resolve({ ok: true, value: { actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } } })
          case 'appSettings.get':
            return Promise.resolve({ ok: true, value: { ...defaultAppSettings(), revision: 1 } })
          default:
            return Promise.resolve({ ok: false, error: `no ${channel} here` })
        }
      },
      on: (channel: string, handler: (payload: unknown) => void) => {
        const id = listeners.size + 1
        listeners.set(id, { channel, handler })
        return id
      },
      off: (id: number) => listeners.delete(id),
    } as unknown as WorfyBridge
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  })

  afterEach(() => {
    cleanup()
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  const sent = (channel: string) => calls.filter((call) => call.channel === channel).map((call) => call.input)

  /** main sends a new state of the run, as `autopilot.changed` does. */
  const publish = (state: AutopilotState) =>
    act(() => {
      for (const { channel, handler } of listeners.values()) if (channel === 'autopilot.changed') handler(state)
    })

  async function line() {
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    render(<AutopilotAction subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: EPIC, tickets: TICKETS }} />)
    const status = await screen.findByTestId('autopilot-status')
    await vi.waitFor(() => expect(status.textContent).toBe('waiting for the Orchestrator · 4 min'))
    const shown = () => toasts.getState().toasts.map((toast) => ({ kind: toast.kind, text: toast.text }))
    return { status, shown }
  }

  it('says how long it waits, with "Start now" and "Cancel" beside it', async () => {
    await line()
    expect(screen.getByTestId('autopilot-start-now').textContent).toBe('Start now')
    expect(screen.getByTestId('autopilot-cancel-wait').textContent).toBe('Cancel')
  })

  it('"Cancel" ends the wait at once, without a window: the Orchestrator is not touched', async () => {
    const { shown } = await line()
    answers['autopilot.stop'] = { ok: true, value: { ...base(), reason: 'start-cancelled', revision: 3 } }
    fireEvent.click(screen.getByTestId('autopilot-cancel-wait'))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent('autopilot.stop')).toEqual([{ projectId: PROJECT }])
    expect(sent('autopilot.startNow')).toEqual([])
    expect(shown()).toEqual([{ kind: 'info', text: 'Autopilot cancelled; the Orchestrator was not touched' }])
    expect(screen.getByTestId('autopilot-status').textContent).toBe('stopped: start cancelled')
  })

  it('"Start now" opens the window over the live `busy`; Cancel there leaves the run waiting', async () => {
    await line()
    fireEvent.click(screen.getByTestId('autopilot-start-now'))
    const dialog = screen.getByRole('dialog', { name: 'Start now?' })
    expect(within(dialog).getByText('Autopilot demo starts right away. This stops:')).toBeTruthy()
    // A task ends while the window is open: the list follows.
    await publish(waiting({ turn: true, queued: 2, tasks: TASKS.slice(0, 1) }, 5))
    expect(within(dialog).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['✕the running turn', '✕1 background task: impl-04', '✓2 queued messages stay in the queue'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent('autopilot.startNow')).toEqual([])
    expect(sent('autopilot.stop')).toEqual([])
  })

  it('"Interrupt and start" takes the Orchestrator at once and says what it stopped', async () => {
    const { shown } = await line()
    fireEvent.click(screen.getByTestId('autopilot-start-now'))
    answers['autopilot.startNow'] = { ok: true, value: { ...base(), status: 'running', wave: 1, revision: 6 } }
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Interrupt and start' }))
    await settle()
    expect(sent('autopilot.startNow')).toEqual([{ projectId: PROJECT }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(shown()).toEqual([{ kind: 'success', text: 'Turn interrupted, 3 background tasks stopped · Autopilot started' }])
    expect(screen.getByTestId('autopilot-status').textContent).toBe('Wave 1 · running')
  })

  it('the Orchestrator free before the click: the window closes by itself', async () => {
    await line()
    fireEvent.click(screen.getByTestId('autopilot-start-now'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await publish({ ...base(), status: 'running', wave: 1, revision: 7 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a start refused when the run takes the Orchestrator is an error toast with main\'s words', async () => {
    const { shown } = await line()
    fireEvent.click(screen.getByTestId('autopilot-start-now'))
    answers['autopilot.startNow'] = { ok: true, value: { ...base(), reason: 'start-refused', message: 'The Epic has no ready wave', revision: 6 } }
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Interrupt and start' }))
    await settle()
    expect(shown()).toEqual([{ kind: 'error', text: 'Autopilot did not start: The Epic has no ready wave' }])
  })
})
