// The action buttons on the Canvas (ticket 23): "Ship ticket" on a Ticket, "Run wave" on an Epic
// frame and "Open PR" on a Ticket with a PR (src/renderer/canvas/actions/*.tsx). Each one decides
// from the workflow model, the Project's action templates and the checks snapshot whether it is
// active, and says why not; a click goes to main (`actions.*`, `shell.openExternal`).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchedHint } from '../../src/shared/actions/render-template'
import type { LaunchesSnapshot } from '../../src/shared/ipc/actions'
import { autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ChecksSnapshot } from '../../src/shared/ipc/checks'
import { AUTOPILOT_TEMPLATE_HINT, DEFAULT_ACTION_TEMPLATES, LEGACY_RUN_WAVE_TEMPLATE, type ActionTemplates } from '../../src/shared/projects/action-templates'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/Users/test/projects/demo'
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
let tickets: Ticket[]
let templates: ActionTemplates
let snapshot: ChecksSnapshot
let calls: { channel: string; input: unknown }[]
let listeners: Map<string, (payload: unknown) => void>
let launches: LaunchesSnapshot
let shipAnswer: IpcResult<unknown>
let autopilot: AutopilotState
/** What autopilot.stop answers; null answers the stopping state at once. */
let stopAnswer: Promise<IpcResult<unknown>> | null
/** What autopilot.forceStop answers; null answers the stopped state at once. */
let forceStopAnswer: Promise<IpcResult<unknown>> | null
/** What autopilot.estimate answers; null answers the bridge's default, which is no estimate answer. */
let estimateAnswer: unknown

beforeEach(() => {
  vi.resetModules()
  calls = []
  autopilot = { projectId: PROJECT, epic: null, status: 'stopped', wave: 0, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [], stopping: false, ticketsInWork: 0, harnessBehind: null, revision: 1 }
  stopAnswer = null
  forceStopAnswer = null
  estimateAnswer = null
  listeners = new Map()
  // 07 done; 08 open, blocked by 07 (done) → ready; 09 open; 10 open, blocked by 09 (open); 11 claimed.
  tickets = [ticket(7, 'done'), ticket(8, 'open', [7]), ticket(9, 'open'), ticket(10, 'open', [9]), ticket(11, 'work')]
  templates = { ...DEFAULT_ACTION_TEMPLATES }
  snapshot = { root: ROOT, worktrees: [], pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } }
  launches = { projectId: PROJECT, revision: 0, tickets: [] }
  shipAnswer = { ok: true, value: { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket demo 08' } }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input })
      const model: WorkflowModel = { root: ROOT, epics: [EPIC], tickets, error: null, branchErrors: [] }
      switch (channel) {
        case 'workflow.open':
          return Promise.resolve({ ok: true, value: model })
        case 'projects.list':
          return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
        case 'projects.settings.get':
          return Promise.resolve({ ok: true, value: { actionTemplates: templates } })
        case 'checks.get':
          return Promise.resolve({ ok: true, value: snapshot })
        case 'actions.shipTicket':
          return Promise.resolve(shipAnswer)
        case 'actions.launches':
          return Promise.resolve({ ok: true, value: launches })
        case 'actions.runWave':
          return Promise.resolve({ ok: true, value: { sessionId: 'o1', text: '/epic-wave Ticket-ы 08, 09 эпика demo', delivery: 'sent' } })
        case 'autopilot.state':
          return Promise.resolve({ ok: true, value: autopilot })
        case 'autopilot.stop':
          return stopAnswer ?? Promise.resolve({ ok: true, value: { ...autopilot, stopping: true, revision: autopilot.revision + 1 } })
        case 'autopilot.forceStop':
          return forceStopAnswer ?? Promise.resolve({ ok: true, value: { ...autopilot, status: 'stopped', reason: 'user-force-stop', stopping: false, revision: autopilot.revision + 1 } })
        case 'autopilot.estimate':
          if (estimateAnswer !== null) return Promise.resolve({ ok: true, value: estimateAnswer })
          return Promise.resolve({ ok: true, value: { closed: true } })
        case 'shell.openExternal':
          return Promise.resolve({ ok: true, value: { url: (input as { url: string }).url } })
        default:
          return Promise.resolve({ ok: true, value: { closed: true } })
      }
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      listeners.set(channel, handler)
      return listeners.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const ticketSubject = (num: number) => ({ kind: 'ticket' as const, projectId: PROJECT, root: ROOT, ticket: tickets.find((each) => each.num === num)! })
const epicSubject = () => ({ kind: 'epic' as const, projectId: PROJECT, root: ROOT, epic: EPIC, tickets })

async function shipButton(num: number): Promise<HTMLElement> {
  const { default: TicketActions } = await import('../../src/renderer/canvas/actions/TicketActions')
  render(<TicketActions subject={ticketSubject(num)} />)
  return screen.findByRole('button', { name: 'Ship ticket' })
}

describe('Ship ticket', () => {
  it('is inactive on a Ticket with an open blocker, and names the blocker', async () => {
    const button = await shipButton(10)
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('blocked by 09'))
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(calls.some((call) => call.channel === 'actions.shipTicket')).toBe(false)
  })

  it('is active on an open Ticket whose blockers are done, and asks main to ship it', async () => {
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    expect(button.getAttribute('title')).toBe('/ship-ticket demo 08')
    fireEvent.click(button)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'actions.shipTicket')).toEqual([{ channel: 'actions.shipTicket', input: { projectId: PROJECT, epic: 'demo', num: 8 } }]))
  })

  it('asks for the Session right of the strip of Epic frames, at its Ticket’s height (worfy-canvas ticket 11)', async () => {
    // Imported after vi.resetModules(), like TicketActions, so both share one React Flow context.
    const { ReactFlowProvider } = await import('@xyflow/react')
    const { default: TicketActions } = await import('../../src/renderer/canvas/actions/TicketActions')
    const frame = (epic: string, x: number, y: number, width: number) => ({
      id: `epic:${epic}`,
      type: 'epic-frame',
      position: { x, y },
      width,
      height: 500,
      data: { node: { data: { epic: { epic }, auto: { x, y } } } },
    })
    const initialNodes = [
      frame('demo', 0, 0, 600),
      // A second column, narrower: the strip ends at its left edge plus the widest frame.
      frame('other', 648, 0, 300),
      { id: 'ticket:demo/8', type: 'ticket', position: { x: 40, y: 240.4 }, width: 220, height: 80, data: { node: { data: { ticket: { epic: 'demo', num: 8 } } } } },
    ]
    render(
      <ReactFlowProvider initialNodes={initialNodes}>
        <TicketActions subject={ticketSubject(8)} />
      </ReactFlowProvider>,
    )
    const button = await screen.findByRole('button', { name: 'Ship ticket' })
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(button)
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.channel === 'actions.shipTicket')).toEqual([
        { channel: 'actions.shipTicket', input: { projectId: PROJECT, epic: 'demo', num: 8, near: { x: 648 + 600 + 48, y: 240 } } },
      ]),
    )
  })

  it('with an empty template is inactive and points to Project settings; a template saved later applies at once', async () => {
    templates = { ...templates, shipTicket: '  ' }
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('Set the Ship ticket template in Project settings'))
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(calls.some((call) => call.channel === 'actions.shipTicket')).toBe(false)
    const changed = listeners.get('projects.settings.changed')
    expect(changed).toBeDefined()
    changed!({ id: PROJECT, settings: { actionTemplates: { ...DEFAULT_ACTION_TEMPLATES, shipTicket: 'ship {epic}/{NN} on {branch}' } } })
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('ship demo/08 on main'))
    expect(button.getAttribute('aria-disabled')).toBe('false')
  })

  it('shows main\'s refusal by its reason alone', async () => {
    shipAnswer = { ok: false, error: 'actions.shipTicket failed: blocked by 09' }
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(button)
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('blocked by 09'))
    expect(button.getAttribute('data-error')).toBe('blocked by 09')
  })

  it('is inactive while a Session it launched for the Ticket is live, and active again once main says it closed', async () => {
    launches = { projectId: PROJECT, revision: 4, tickets: [{ epic: 'demo', num: 8 }] }
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe(launchedHint(8)))
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(calls.some((call) => call.channel === 'actions.shipTicket')).toBe(false)
    const changed = listeners.get('actions.launches.changed')
    expect(changed).toBeDefined()
    // An older snapshot (one that crossed the answer) does not roll the list back.
    changed!({ projectId: PROJECT, revision: 3, tickets: [] })
    await new Promise((done) => setTimeout(done, 20))
    expect(button.getAttribute('title')).toBe(launchedHint(8))
    // Another Project's snapshot is not this one's.
    changed!({ projectId: 'other-1', revision: 9, tickets: [] })
    await new Promise((done) => setTimeout(done, 20))
    expect(button.getAttribute('aria-disabled')).toBe('true')
    changed!({ projectId: PROJECT, revision: 5, tickets: [] })
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    expect(button.getAttribute('title')).toBe('/ship-ticket demo 08')
  })

  it('turns inactive when main reports the Session it just launched', async () => {
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(button)
    listeners.get('actions.launches.changed')!({ projectId: PROJECT, revision: 1, tickets: [{ epic: 'demo', num: 8 }] })
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe(launchedHint(8)))
    expect(button.getAttribute('aria-disabled')).toBe('true')
  })

  it('is not shown on a claimed or a done Ticket', async () => {
    const { default: TicketActions } = await import('../../src/renderer/canvas/actions/TicketActions')
    const { container } = render(
      <>
        <TicketActions subject={ticketSubject(7)} />
        <TicketActions subject={ticketSubject(11)} />
      </>,
    )
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'projects.settings.get')).toBe(true))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('Run wave', () => {
  it('sends the rendered template when the ready Wave is not empty', async () => {
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    render(<EpicActions subject={epicSubject()} />)
    const button = await screen.findByRole('button', { name: 'Run wave' })
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(button)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'actions.runWave')).toEqual([{ channel: 'actions.runWave', input: { projectId: PROJECT, epic: 'demo' } }]))
  })

  it('with an empty template is inactive and points to Project settings', async () => {
    templates = { ...templates, runWave: '' }
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    render(<EpicActions subject={epicSubject()} />)
    const button = await screen.findByRole('button', { name: 'Run wave' })
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('Set the Run wave template in Project settings'))
    fireEvent.click(button)
    expect(calls.some((call) => call.channel === 'actions.runWave')).toBe(false)
  })

  it('is inactive when no Ticket is ready', async () => {
    tickets = [ticket(7, 'done'), ticket(8, 'open', [9]), ticket(9, 'work')]
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    render(<EpicActions subject={epicSubject()} />)
    const button = await screen.findByRole('button', { name: 'Run wave' })
    await vi.waitFor(() => expect(button.getAttribute('title')).toBe('No ready wave'))
    expect(button.getAttribute('aria-disabled')).toBe('true')
  })

  it('is not shown on an Epic whose Tickets are all done', async () => {
    tickets = [ticket(7, 'done'), ticket(8, 'done')]
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    const { container } = render(<EpicActions subject={epicSubject()} />)
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'projects.settings.get')).toBe(true))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('hasRunWave: false only when the Epic has Tickets and every one of its own is done', async () => {
    const { hasRunWave } = await import('../../src/renderer/canvas/actions/gates')
    expect(hasRunWave('demo', [{ epic: 'demo', state: 'done' }, { epic: 'other', state: 'open' }])).toBe(false)
    expect(hasRunWave('demo', [{ epic: 'demo', state: 'done' }, { epic: 'demo', state: 'work' }])).toBe(true)
    expect(hasRunWave('demo', [{ epic: 'other', state: 'done' }])).toBe(true)
    expect(hasRunWave('demo', [])).toBe(true)
  })
})

describe('Autopilot (ticket 30, ADR-0033)', () => {
  it("is inactive with a Run wave template that does not name the Wave's tickets and says why; Run wave stays active", async () => {
    templates = { ...templates, runWave: LEGACY_RUN_WAVE_TEMPLATE }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    render(
      <>
        <AutopilotAction subject={epicSubject()} />
        <EpicActions subject={epicSubject()} />
      </>,
    )
    const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('title')).toBe(AUTOPILOT_TEMPLATE_HINT))
    expect(autopilot.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(autopilot)
    expect(calls.some((call) => call.channel === 'autopilot.start')).toBe(false)
    const wave = await screen.findByRole('button', { name: 'Run wave' })
    await vi.waitFor(() => expect(wave.getAttribute('aria-disabled')).toBe('false'))
  })

  it('is active with the default template, and its hint says the display stays on (ticket 32, ADR-0034)', async () => {
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('aria-disabled')).toBe('false'))
    expect(autopilot.getAttribute('title')).toBe('Run the Waves of demo one after another, without a person. The display stays on until the run ends')
  })

  it('ends its hint with what a Wave like the ready one usually takes of the week, and the share used now (worfy-throughput ticket 40)', async () => {
    // The ready Wave is 08 and 09: two Tickets at 2 % each.
    estimateAnswer = { estimate: { perTicket: 0.02, waves: 5 }, sevenDay: { utilization: 0.41, resetsAt: Math.round(Date.now() / 1000) + 2 * 86_400 + 5 * 3600 + 1800 } }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() =>
      expect(autopilot.getAttribute('title')).toBe(
        'Run the Waves of demo one after another, without a person. The display stays on until the run ends. A Wave like this usually takes about 4% of the week. Used now: 41%, resets in 2 d 5 h',
      ),
    )
    expect(calls.filter((call) => call.channel === 'autopilot.estimate')).toEqual([{ channel: 'autopilot.estimate', input: { projectId: PROJECT } }])
  })

  it('says there is no estimate yet when main has none', async () => {
    estimateAnswer = { estimate: null, sevenDay: null }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('title')).toMatch(/until the run ends\. No estimate for a Wave yet: fewer than 3 past Waves with fresh Limits\. Used now: unknown$/))
  })
})

describe('the Harness in main is newer than the Stable copy (worfy-harness ticket 21)', () => {
  const behind = { harness: '0.1.0+abcdef1', main: 'origin/main', commits: 3 }

  it.each<[string, Partial<AutopilotState>]>([
    ['before any run', {}],
    ['while the run goes on', { epic: 'demo', status: 'running', wave: 1 }],
    ['after the run stopped', { epic: 'demo', status: 'stopped', wave: 1, reason: 'no-ready-wave' }],
  ])('shows the chip %s, its title counting the commits and naming pnpm install:stable', async (_name, state) => {
    autopilot = { ...autopilot, ...state, harnessBehind: behind }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const chip = await screen.findByTestId('autopilot-harness-behind')
    expect(chip.textContent).toBe('Harness in main is newer than the Stable copy')
    expect(chip.className).toBe('w-chip w-chip--open')
    expect(chip.getAttribute('title')).toBe('origin/main has 3 commits in harness/ that this build (0.1.0+abcdef1) has not. Rebuild the Stable copy with pnpm install:stable between runs')
  })

  it('says "1 commit" for one', async () => {
    autopilot = { ...autopilot, harnessBehind: { ...behind, commits: 1, main: 'main' } }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    expect((await screen.findByTestId('autopilot-harness-behind')).getAttribute('title')).toMatch(/^main has 1 commit in harness\/ /)
  })

  it('has no chip with harnessBehind null, and drops it when a later state says null', async () => {
    autopilot = { ...autopilot, harnessBehind: null }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'autopilot.state')).toBe(true))
    expect(screen.queryByTestId('autopilot-harness-behind')).toBeNull()
    // The answer of git comes later, by autopilot.changed.
    act(() => listeners.get('autopilot.changed')?.({ ...autopilot, harnessBehind: behind, revision: 7 }))
    await screen.findByTestId('autopilot-harness-behind')
    act(() => listeners.get('autopilot.changed')?.({ ...autopilot, harnessBehind: null, revision: 8 }))
    await vi.waitFor(() => expect(screen.queryByTestId('autopilot-harness-behind')).toBeNull())
  })
})

describe('Force stop interrupts the Orchestrator (worfy-week tickets 17, 18)', () => {
  it('is available again with the Tickets a Force stop interrupted, still in work, though nothing else is ready', async () => {
    // 08 and 09 were the interrupted Wave and stay claimed; 10 waits for 09: nothing is ready on its own.
    tickets = [ticket(7, 'done'), ticket(8, 'work', [7]), ticket(9, 'work'), ticket(10, 'open', [9])]
    autopilot = { ...autopilot, epic: 'demo', status: 'stopped', wave: 1, reason: 'user-force-stop', resumable: [8, 9] }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    // The button is drawn again under the status line once the run's state comes: look it up each time.
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Autopilot' }).getAttribute('aria-disabled')).toBe('false'))
    expect(screen.getByTestId('autopilot-status').textContent).toBe('stopped: user force stop')
  })

  it('without that list, the same Tickets in work leave no ready Wave', async () => {
    tickets = [ticket(7, 'done'), ticket(8, 'work', [7]), ticket(9, 'work'), ticket(10, 'open', [9])]
    autopilot = { ...autopilot, epic: 'demo', status: 'stopped', wave: 1, reason: 'no-progress', resumable: [] }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    // The button is drawn again under the status line once the run's state comes: look it up each time.
    const button = () => screen.getByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(button().getAttribute('title')).toBe('No ready wave'))
    expect(button().getAttribute('aria-disabled')).toBe('true')
  })

  it('Force stop under "⋯": says what it does, and Stop stays "Stopping…", the item inactive, until autopilot.forceStop answers', async () => {
    autopilot = { ...autopilot, epic: 'demo', status: 'running', wave: 1 }
    let answer: (result: IpcResult<unknown>) => void = () => undefined
    forceStopAnswer = new Promise((done) => (answer = done))
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More Autopilot actions for demo' }))
    const force = screen.getByRole('menuitem', { name: 'Force stop' })
    expect(force.getAttribute('title')).toBe(
      'Stop Autopilot over demo now: interrupts the Orchestrator and its background tasks; worktrees stay. The next Autopilot takes the interrupted Tickets first',
    )
    fireEvent.click(force)
    // Choosing the item closes the menu and asks main once.
    expect(screen.queryByRole('menu')).toBeNull()
    const stopping = await screen.findByRole('button', { name: 'Stopping…' })
    expect(stopping.getAttribute('aria-disabled')).toBe('true')
    expect(stopping.getAttribute('title')).toBe("Stopping Autopilot: the Orchestrator's turn is being interrupted")
    // While it is on its way, the item is inactive and a click on it or on "Stopping…" asks main nothing more.
    fireEvent.click(screen.getByRole('button', { name: 'More Autopilot actions for demo' }))
    expect(screen.getByRole('menuitem', { name: 'Force stop' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Force stop' }))
    fireEvent.click(stopping)
    expect(calls.filter((call) => call.channel === 'autopilot.forceStop')).toEqual([{ channel: 'autopilot.forceStop', input: { projectId: PROJECT } }])
    expect(calls.filter((call) => call.channel === 'autopilot.stop')).toEqual([])
    // The run's stopped state may come by autopilot.changed first: the button still waits for the answer.
    act(() => listeners.get('autopilot.changed')?.({ ...autopilot, status: 'stopped', reason: 'user-force-stop', revision: 5 }))
    expect(screen.getByRole('button', { name: 'Stopping…' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      answer({ ok: true, value: { ...autopilot, status: 'stopped', reason: 'user-force-stop', revision: 6 } })
      await Promise.resolve()
    })
    await screen.findByRole('button', { name: 'Autopilot' })
    expect(screen.getByTestId('autopilot-status').textContent).toBe('stopped: user force stop')
    // A stopped run has no "⋯": there is nothing to force.
    expect(screen.queryByTestId('action-autopilot-more')).toBeNull()
  })

  it('main\'s refusal of Force stop is the title of "⋯", with the error mark', async () => {
    autopilot = { ...autopilot, epic: 'demo', status: 'running', wave: 1 }
    forceStopAnswer = Promise.resolve({ ok: false, error: 'autopilot.forceStop failed: no run' })
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const more = await screen.findByRole('button', { name: 'More Autopilot actions for demo' })
    expect(more.getAttribute('title')).toBe('More Autopilot actions')
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Force stop' }))
    await vi.waitFor(() => expect(more.getAttribute('data-error')).not.toBeNull())
    expect(more.getAttribute('title')).toBe(more.getAttribute('data-error'))
    expect(more.getAttribute('title')).toContain('no run')
  })
})

describe('the graceful Stop and the "⋯" menu (worfy-week ticket 18)', () => {
  async function running(state: Partial<AutopilotState> = {}) {
    autopilot = { ...autopilot, epic: 'demo', status: 'running', wave: 1, ...state }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    return render(<AutopilotAction subject={epicSubject()} />)
  }

  it('Stop says it takes no new Tickets; a click asks main once, and the stopping run shows "Stopping…" and the Tickets in work', async () => {
    await running()
    const stop = await screen.findByRole('button', { name: 'Stop autopilot' })
    expect(stop.getAttribute('title')).toBe('Stop Autopilot over demo: takes no new Tickets; the Tickets in work finish (merge or blocked)')
    fireEvent.click(stop)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'autopilot.stop')).toEqual([{ channel: 'autopilot.stop', input: { projectId: PROJECT } }]))
    act(() => listeners.get('autopilot.changed')?.({ ...autopilot, stopping: true, ticketsInWork: 2, revision: 9 }))
    const stopping = await screen.findByRole('button', { name: 'Stopping…' })
    expect(stopping.getAttribute('aria-disabled')).toBe('true')
    expect(stopping.getAttribute('title')).toBe('Autopilot over demo is stopping: no new Tickets; it waits for the Tickets in work. Force stop is under ⋯')
    expect(screen.getByTestId('autopilot-status').textContent).toBe('stopping · 2 tickets in work')
    fireEvent.click(stopping)
    expect(calls.filter((call) => call.channel === 'autopilot.stop')).toHaveLength(1)
    // Force stop is still there while it stops.
    expect(screen.getByTestId('action-autopilot-more')).toBeTruthy()
  })

  it.each<[string, Partial<AutopilotState>]>([
    ['running', { status: 'running' }],
    ['waiting', { status: 'waiting', resumesAt: Date.UTC(2026, 9, 8, 14, 20) }],
    ['stopping', { status: 'running', stopping: true, ticketsInWork: 1 }],
  ])('"⋯" is there while %s, with its name, popup and title', async (_name, state) => {
    await running(state)
    const more = await screen.findByTestId('action-autopilot-more')
    expect(more.getAttribute('aria-label')).toBe('More Autopilot actions for demo')
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('title')).toBe('More Autopilot actions')
    expect(more.textContent).toBe('⋯')
  })

  it('"⋯" is not there once the run has stopped', async () => {
    await running({ status: 'stopped', reason: 'user-stop' })
    await screen.findByTestId('autopilot-status')
    expect(screen.queryByTestId('action-autopilot-more')).toBeNull()
  })

  it('opens the menu with the focus on Force stop; Esc closes it with preventDefault and gives the focus back to "⋯"', async () => {
    await running()
    const more = await screen.findByTestId('action-autopilot-more')
    more.focus()
    fireEvent.click(more)
    const menu = screen.getByRole('menu', { name: 'Autopilot over demo' })
    // Drawn into document.body, out of the Node, where the Canvas's zoom does not reach it.
    expect(menu.parentElement).toBe(document.body)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const item = screen.getByRole('menuitem', { name: 'Force stop' })
    expect(item.getAttribute('data-testid')).toBe('action-force-stop-autopilot')
    expect(document.activeElement).toBe(item)
    // The arrows stay on the one item.
    fireEvent.keyDown(item, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item)
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void item.dispatchEvent(esc))
    expect(esc.defaultPrevented).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('a click outside, the wheel outside and the window losing focus close the menu', async () => {
    await running()
    const more = await screen.findByTestId('action-autopilot-more')
    fireEvent.click(more)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(more)
    fireEvent.wheel(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(more)
    // The wheel over the menu itself keeps it.
    fireEvent.wheel(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeTruthy()
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Force stop while stopping asks main to force, and focus goes back to "⋯"', async () => {
    await running({ stopping: true, ticketsInWork: 1 })
    const more = await screen.findByTestId('action-autopilot-more')
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Force stop' }))
    expect(document.activeElement).toBe(more)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'autopilot.forceStop')).toHaveLength(1))
    await screen.findByRole('button', { name: 'Autopilot' })
    expect(screen.getByTestId('autopilot-status').textContent).toBe('stopped: user force stop')
  })

  it('on another Epic\'s frame, Autopilot is inactive and says the run is stopping', async () => {
    autopilot = { ...autopilot, epic: 'other', status: 'running', wave: 1, stopping: true, ticketsInWork: 1 }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const button = () => screen.getByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(button().getAttribute('title')).toBe('Autopilot is stopping Epic other'))
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByTestId('action-autopilot-more')).toBeNull()
  })

  it('autopilotStatusLine says stopping, with the Tickets in work, and the Force stop reason', () => {
    expect(autopilotStatusLine({ status: 'running', wave: 1, reason: null, stopping: true, ticketsInWork: 2 })).toBe('stopping · 2 tickets in work')
    expect(autopilotStatusLine({ status: 'running', wave: 1, reason: null, stopping: true, ticketsInWork: 1 })).toBe('stopping · 1 ticket in work')
    expect(autopilotStatusLine({ status: 'running', wave: 1, reason: null, stopping: true, ticketsInWork: 0 })).toBe('stopping')
    expect(autopilotStatusLine({ status: 'stopped', wave: 1, reason: 'user-force-stop' })).toBe('stopped: user force stop')
    // While waiting for the Limits the line keeps saying so.
    expect(autopilotStatusLine({ status: 'waiting', wave: 1, reason: null, resumesAt: null, stopping: true, ticketsInWork: 1 })).toBe('waiting for limits')
  })

  it('autopilotStatusLine says what a wait is for: the Limits, today\'s share of the budget, or a full 5-hour window (worfy-throughput ticket 41)', () => {
    const at = Date.UTC(2026, 9, 29, 0, 0)
    const utc = { timeZone: 'UTC' }
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: at, waitingFor: 'limits' }, utc)).toBe('waiting for limits · resumes 00:00')
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: at, waitingFor: 'daily-share' }, utc)).toBe("today's share used · resumes 00:00")
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: at + 2 * 3_600_000 + 12 * 60_000, waitingFor: 'five-hour' }, utc)).toBe('5-hour limits full · resumes 02:12')
    // A state of an older build, without the field, is a wait for the Limits.
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: at }, utc)).toBe('waiting for limits · resumes 00:00')
  })

  it('autopilotStatusLine says why the Start window holds the next Wave back: outside it, or the Wave too long for it (worfy-resource-planner ticket 05)', () => {
    const at = Date.UTC(2026, 10, 1, 23, 0)
    const utc = { timeZone: 'UTC' }
    expect(autopilotStatusLine({ status: 'waiting', wave: 0, reason: null, resumesAt: at, waitingFor: 'start-window', windowReason: 'outside' }, utc)).toBe('outside start window · resumes 23:00')
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: at, waitingFor: 'start-window', windowReason: 'wave-too-long' }, utc)).toBe('wave too long for window · resumes 23:00')
    expect(autopilotStatusLine({ status: 'waiting', wave: 2, reason: null, resumesAt: null, waitingFor: 'start-window', windowReason: 'outside' }, utc)).toBe('outside start window')
    // A Wave that went without the check of its duration reads as any running Wave; its tooltip says the rest.
    expect(autopilotStatusLine({ status: 'running', wave: 2, reason: null }, utc)).toBe('Wave 2 · running')
  })
})

describe('Autopilot status line hint (ticket 32, ADR-0034)', () => {
  const DISPLAY = 'The display stays on until the run ends'

  async function statusLine(state: Partial<AutopilotState>): Promise<HTMLElement> {
    autopilot = { ...autopilot, epic: 'demo', ...state }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    return screen.findByTestId('autopilot-status')
  }

  it.each<[string, Partial<AutopilotState>, string]>([
    ['running', { status: 'running', wave: 3 }, 'Wave 3 · running'],
    ['running with background tasks', { status: 'running', wave: 1, backgroundTasks: 2 }, 'Wave 1 · 2 background tasks'],
    ['waiting with no reset time', { status: 'waiting', wave: 2 }, 'waiting for limits'],
  ])('%s: the line is unchanged, its hint adds that the display stays on', async (_name, state, text) => {
    const status = await statusLine(state)
    expect(status.textContent).toBe(text)
    expect(status.getAttribute('title')).toBe(`${text}. ${DISPLAY}`)
  })

  it('waiting for a reset time: the line is the shared status line, its hint adds the display', async () => {
    const state = { status: 'waiting' as const, wave: 2, reason: null, resumesAt: Date.UTC(2026, 9, 7, 14, 20) }
    const status = await statusLine(state)
    const text = autopilotStatusLine(state)
    expect(text).toMatch(/^waiting for limits · resumes \d\d:\d\d$/)
    expect(status.textContent).toBe(text)
    expect(status.getAttribute('title')).toBe(`${text}. ${DISPLAY}`)
  })

  it("a run's message stays its hint, as before", async () => {
    const status = await statusLine({ status: 'waiting', wave: 2, message: 'The Limits did not say when they reset' })
    expect(status.textContent).toBe('waiting for limits')
    expect(status.getAttribute('title')).toBe('The Limits did not say when they reset')
  })

  it('a stopped run does not claim the display stays on', async () => {
    const status = await statusLine({ status: 'stopped', reason: 'no-ready-wave' })
    expect(status.textContent).toBe('stopped: no ready wave')
    expect(status.getAttribute('title')).toBe('stopped: no ready wave')
  })
})

describe('Open PR', () => {
  it('opens the PR of the Ticket on GitHub in the browser', async () => {
    snapshot = { ...snapshot, pulls: [{ number: 31, url: 'https://github.com/o/r/pull/31', state: 'OPEN', branch: 'demo/08', ci: null, verdict: null }] }
    const { default: OpenPr } = await import('../../src/renderer/canvas/actions/OpenPr')
    render(<OpenPr subject={ticketSubject(8)} />)
    const button = await screen.findByRole('button', { name: 'Open PR' })
    fireEvent.click(button)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'shell.openExternal')).toEqual([{ channel: 'shell.openExternal', input: { url: 'https://github.com/o/r/pull/31' } }]))
  })

  it.each([
    'https://evil.example/o/r/pull/31',
    'http://github.com/o/r/pull/31',
    'https://github.com:8443/o/r/pull/31',
    'https://u@github.com/o/r/pull/31',
    'https://u:p@github.com/o/r/pull/31',
    'https://github.com.evil.example/o/r/pull/31',
    'not a url',
  ])('refuses an address that is not https://github.com/: %s', async (url) => {
    snapshot = { ...snapshot, pulls: [{ number: 31, url, state: 'OPEN', branch: 'demo/08', ci: null, verdict: null }] }
    const { default: OpenPr } = await import('../../src/renderer/canvas/actions/OpenPr')
    render(<OpenPr subject={ticketSubject(8)} />)
    const button = await screen.findByRole('button', { name: 'Open PR' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe(`Not a GitHub address: ${url}`)
    fireEvent.click(button)
    expect(calls.some((call) => call.channel === 'shell.openExternal')).toBe(false)
  })

  it('is not shown on a Ticket without a PR', async () => {
    const { default: OpenPr } = await import('../../src/renderer/canvas/actions/OpenPr')
    const { container } = render(<OpenPr subject={ticketSubject(9)} />)
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'checks.get')).toBe(true))
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('on the screen of a Linked machine that shares its Projects read-only (worfy-link ticket 25)', () => {
  const MINI = '22222222-2222-4222-8222-222222222222'
  const HINT = 'Mini gives this Machine read-only access'
  let readOnly: boolean

  // The window shows Mini: its `project` channels go through this Machine's main as `linked.invoke`
  // (src/renderer/ipc.ts) and answer as above; main says Mini's level in `linked.state`.
  beforeEach(() => {
    readOnly = true
    window.history.replaceState(null, '', `/?machine=${MINI}`)
    const inner = (globalThis as unknown as { worfy: WorfyBridge }).worfy
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      ...inner,
      invoke: (channel, input) => {
        if (channel === 'linked.invoke') {
          const call = input as { channel: string; input: unknown }
          return inner.invoke(call.channel, call.input).then((value) => ({ ok: true, value }))
        }
        if (channel === 'linked.state') return Promise.resolve({ ok: true, value: { revision: 1, machines: [{ id: MINI, online: true, sharing: 'yes', readOnly, epoch: 1 }] } })
        if (channel === 'link.state') return Promise.resolve({ ok: true, value: { revision: 1, machine: null, linked: [{ id: MINI, name: 'Mini', state: 'online', certificateChanged: false, access: 'all' }] } })
        return inner.invoke(channel, input)
      },
    }
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('Ship ticket, Run wave and Autopilot are inactive and say why; a click sends nothing', async () => {
    const { default: TicketActions } = await import('../../src/renderer/canvas/actions/TicketActions')
    const { default: EpicActions } = await import('../../src/renderer/canvas/actions/EpicActions')
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(
      <>
        <TicketActions subject={ticketSubject(8)} />
        <EpicActions subject={epicSubject()} />
        <AutopilotAction subject={epicSubject()} />
      </>,
    )
    for (const name of ['Ship ticket', 'Run wave', 'Autopilot']) {
      const button = await screen.findByRole('button', { name })
      await vi.waitFor(() => expect(button.getAttribute('title')).toBe(HINT))
      expect(button.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(button)
    }
    expect(calls.filter((call) => ['actions.shipTicket', 'actions.runWave', 'autopilot.start'].includes(call.channel))).toEqual([])
  })

  it('a running Autopilot shows, and Stop and Force stop are inactive', async () => {
    autopilot = { ...autopilot, epic: 'demo', status: 'running', wave: 1 }
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const stop = await screen.findByRole('button', { name: 'Stop autopilot' })
    await vi.waitFor(() => expect(stop.getAttribute('title')).toBe(HINT))
    expect(stop.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(stop)
    fireEvent.click(screen.getByTestId('action-autopilot-more'))
    const force = await screen.findByRole('menuitem', { name: 'Force stop' })
    expect(force.getAttribute('aria-disabled')).toBe('true')
    expect(force.getAttribute('title')).toBe(HINT)
    fireEvent.click(force)
    expect(calls.filter((call) => call.channel === 'autopilot.stop' || call.channel === 'autopilot.forceStop')).toEqual([])
  })

  it('with Full access the same buttons are active and Ship ticket goes to the Machine', async () => {
    readOnly = false
    const button = await shipButton(8)
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))
    expect(button.getAttribute('title')).toBe('/ship-ticket demo 08')
    fireEvent.click(button)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'actions.shipTicket')).toHaveLength(1))
  })
})
