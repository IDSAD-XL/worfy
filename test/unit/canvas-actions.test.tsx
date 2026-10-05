// The action buttons on the Canvas (ticket 23): "Ship ticket" on a Ticket, "Run wave" on an Epic
// frame and "Open PR" on a Ticket with a PR (src/renderer/canvas/actions/*.tsx). Each one decides
// from the workflow model, the Project's action templates and the checks snapshot whether it is
// active, and says why not; a click goes to main (`actions.*`, `shell.openExternal`).
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ChecksSnapshot } from '../../src/shared/ipc/checks'
import { DEFAULT_ACTION_TEMPLATES, type ActionTemplates } from '../../src/shared/projects/action-templates'
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

beforeEach(() => {
  vi.resetModules()
  calls = []
  listeners = new Map()
  // 07 done; 08 open, blocked by 07 (done) → ready; 09 open; 10 open, blocked by 09 (open); 11 claimed.
  tickets = [ticket(7, 'done'), ticket(8, 'open', [7]), ticket(9, 'open'), ticket(10, 'open', [9]), ticket(11, 'work')]
  templates = { ...DEFAULT_ACTION_TEMPLATES }
  snapshot = { root: ROOT, worktrees: [], pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } }
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
          return Promise.resolve({ ok: true, value: { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket demo 08' } })
        case 'actions.runWave':
          return Promise.resolve({ ok: true, value: { sessionId: 'o1', text: '/epic-wave волна 1 эпика demo', delivery: 'sent' } })
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

describe('Open PR', () => {
  it('opens the PR of the Ticket on GitHub in the browser', async () => {
    snapshot = { ...snapshot, pulls: [{ number: 31, url: 'https://github.com/o/r/pull/31', state: 'OPEN', branch: 'demo/08', ci: null, verdict: null }] }
    const { default: OpenPr } = await import('../../src/renderer/canvas/actions/OpenPr')
    render(<OpenPr subject={ticketSubject(8)} />)
    const button = await screen.findByRole('button', { name: 'Open PR' })
    fireEvent.click(button)
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'shell.openExternal')).toEqual([{ channel: 'shell.openExternal', input: { url: 'https://github.com/o/r/pull/31' } }]))
  })

  it('refuses an address that is not https://github.com/', async () => {
    snapshot = { ...snapshot, pulls: [{ number: 31, url: 'https://evil.example/o/r/pull/31', state: 'OPEN', branch: 'demo/08', ci: null, verdict: null }] }
    const { default: OpenPr } = await import('../../src/renderer/canvas/actions/OpenPr')
    render(<OpenPr subject={ticketSubject(8)} />)
    const button = await screen.findByRole('button', { name: 'Open PR' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe('Not a GitHub address: https://evil.example/o/r/pull/31')
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
