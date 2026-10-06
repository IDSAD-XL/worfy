// The action buttons on the Canvas (ticket 23): "Ship ticket" on a Ticket, "Run wave" on an Epic
// frame and "Open PR" on a Ticket with a PR (src/renderer/canvas/actions/*.tsx). Each one decides
// from the workflow model, the Project's action templates and the checks snapshot whether it is
// active, and says why not; a click goes to main (`actions.*`, `shell.openExternal`).
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchedHint } from '../../src/shared/actions/render-template'
import type { LaunchesSnapshot } from '../../src/shared/ipc/actions'
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

beforeEach(() => {
  vi.resetModules()
  calls = []
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
          return Promise.resolve({ ok: true, value: { projectId: PROJECT, epic: null, status: 'stopped', wave: 0, backgroundTasks: 0, resumesAt: null, reason: null, message: null, revision: 1 } })
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

  it('is active with the default template', async () => {
    const { default: AutopilotAction } = await import('../../src/renderer/canvas/actions/AutopilotAction')
    render(<AutopilotAction subject={epicSubject()} />)
    const autopilot = await screen.findByRole('button', { name: 'Autopilot' })
    await vi.waitFor(() => expect(autopilot.getAttribute('aria-disabled')).toBe('false'))
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
