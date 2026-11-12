// The chip «MCP n/m» of the Session header and its popover (worfy-mcp-live ticket 04,
// src/renderer/session/McpChip.tsx): n is the servers that are connected, m every server of the Session
// but those not allowed in the Project; the chip warns while a server failed or needs auth, and is not
// drawn without data. The popover draws a row per server with a button for each action main put in the
// row and nothing else, the servers not allowed in a group of their own under the others, and a click
// sends the action to main (`agent.mcpAction`); the button waits while it runs, and a refusal is a toast.
// The store keeps the last `mcp` event of a Session apart from its transcript, asks main (`agent.mcp`) for
// the rows of a Session no event came for yet, and carries them to the Session's new id. The chip of the
// Session view starts afresh for another Session. Server names are made up.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
const main = vi.hoisted(() => ({
  calls: [] as { channel: string; input: unknown }[],
  answers: {} as Record<string, (input: unknown) => Answer | Promise<Answer>>,
  toasts: [] as { kind: string; text: string }[],
}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => {
    main.calls.push({ channel, input })
    const answer = main.answers[channel]
    return Promise.resolve(answer ? answer(input) : { ok: false, error: `no answer for ${channel}` })
  },
  subscribe: () => () => undefined,
  windowMachine: () => null,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({ useReadOnly: () => null }))
vi.mock('../../src/renderer/toast/toasts', () => ({
  showToast: (toast: { kind: string; text: string }) => {
    main.toasts.push(toast)
    return 'toast'
  },
}))

const { McpChip, SessionMcpChip } = await import('../../src/renderer/session/McpChip')
const { mcpCount } = await import('../../src/renderer/session/header-facts')
const { acceptAgentEvent, useSessionLogs } = await import('../../src/renderer/session/store')

const row = (name: string, overrides: Partial<McpServerRow> = {}): McpServerRow => ({
  name,
  status: 'connected',
  tools: 2,
  error: null,
  source: 'user',
  sourceWord: null,
  actions: [],
  ...overrides,
})

const ROWS: McpServerRow[] = [
  row('example-notes', { tools: 3 }),
  row('example-tracker', { status: 'failed', tools: null, error: 'connection refused by example-tracker', actions: ['reconnect'] }),
  row('example-calendar', { status: 'needs-auth', tools: null, source: 'claudeai', actions: ['sign-in'] }),
  row('worfy-canvas', { source: 'worfy', tools: 5, actions: ['turn-off'] }),
  row('example-wiki', { status: 'not-allowed', tools: null, source: 'project', actions: ['allow'] }),
  row('example-drive', { status: 'disabled', tools: null, source: 'user', sourceWord: 'managed', actions: ['turn-on', 'restart'] }),
]

beforeEach(() => {
  main.calls.length = 0
  main.toasts.length = 0
  main.answers = {}
})
afterEach(cleanup)

function open(): HTMLElement {
  fireEvent.click(screen.getByTestId('session-mcp'))
  return screen.getByRole('dialog', { name: 'MCP servers' })
}

const rowOf = (popover: HTMLElement, name: string): HTMLElement => {
  const found = popover.querySelector<HTMLElement>(`[data-testid="mcp-row"][data-name="${name}"]`)
  if (found === null) throw new Error(`no row of ${name}`)
  return found
}

const buttonsOf = (element: HTMLElement): string[] => within(element).queryAllByRole('button').map((button) => button.textContent ?? '')

describe('the count of the chip', () => {
  it('n is the connected servers, m every server but those not allowed; it warns on failed and needs-auth', () => {
    expect(mcpCount(ROWS)).toEqual({ connected: 2, total: 5, warn: true })
    expect(mcpCount([row('a'), row('b', { status: 'pending' }), row('c', { status: 'not-allowed' })])).toEqual({ connected: 1, total: 2, warn: false })
    expect(mcpCount([row('a', { status: 'needs-auth' })]).warn).toBe(true)
    expect(mcpCount([row('a', { status: 'disabled' })])).toEqual({ connected: 0, total: 1, warn: false })
  })
})

describe('the chip in the header', () => {
  it('says «MCP n/m» and warns while a server failed or needs auth', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const chip = screen.getByTestId('session-mcp')
    expect(chip.textContent).toBe('MCP2/5')
    expect(within(chip).getByTestId('session-mcp-count').textContent).toBe('2/5')
    expect(chip.dataset.warn).toBe('true')
    expect(chip.getAttribute('title')).toBe('2 of 5 MCP servers connected: 1 failed, 1 needs auth. 1 more not allowed in this Project')
  })

  it('is plain when every server is fine', () => {
    render(<McpChip sessionId="s" rows={[row('example-notes'), row('worfy-canvas', { source: 'worfy' })]} autopilot={false} />)
    const chip = screen.getByTestId('session-mcp')
    expect(within(chip).getByTestId('session-mcp-count').textContent).toBe('2/2')
    expect(chip.dataset.warn).toBeUndefined()
  })

  it('is not drawn without data, nor for a Session without servers', () => {
    const { rerender } = render(<McpChip sessionId="s" rows={null} autopilot={false} />)
    expect(screen.queryByTestId('session-mcp')).toBeNull()
    rerender(<McpChip sessionId="s" rows={[]} autopilot={false} />)
    expect(screen.queryByTestId('session-mcp')).toBeNull()
  })
})

describe('the popover', () => {
  it('draws a row per server: name, status, tools, error and source, the not-allowed ones in a group under the others', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    const names = [...popover.querySelectorAll<HTMLElement>('[data-testid="mcp-row"]')].map((each) => each.dataset.name)
    expect(names).toEqual(['example-notes', 'example-tracker', 'example-calendar', 'worfy-canvas', 'example-drive', 'example-wiki'])
    const group = within(popover).getByTestId('mcp-not-allowed')
    expect(within(group).getByText('Not allowed in this Project')).toBeTruthy()
    expect(within(group).getAllByTestId('mcp-row').map((each) => each.dataset.name)).toEqual(['example-wiki'])

    const tracker = rowOf(popover, 'example-tracker')
    expect(tracker.dataset.status).toBe('failed')
    expect(within(tracker).getByTestId('mcp-row-status').textContent).toBe('failed')
    expect(within(tracker).getByTestId('mcp-row-error').textContent).toBe('connection refused by example-tracker')
    expect(within(tracker).queryByTestId('mcp-row-tools')).toBeNull()
    expect(within(tracker).getByTestId('mcp-row-source').textContent).toBe('user config')

    const notes = rowOf(popover, 'example-notes')
    expect(within(notes).getByTestId('mcp-row-tools').textContent).toBe('3 tools')
    expect(within(notes).queryByTestId('mcp-row-error')).toBeNull()
    expect(within(rowOf(popover, 'example-calendar')).getByTestId('mcp-row-source').textContent).toBe('claude.ai')
    expect(within(rowOf(popover, 'example-calendar')).getByTestId('mcp-row-status').textContent).toBe('needs auth')
    expect(within(rowOf(popover, 'worfy-canvas')).getByTestId('mcp-row-source').textContent).toBe('worfy')
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-source').textContent).toBe('Project')
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-status').textContent).toBe('not allowed')
    // A source worfy shows as user config keeps the Vendor's own word in the tooltip.
    const drive = within(rowOf(popover, 'example-drive')).getByTestId('mcp-row-source')
    expect(drive.textContent).toBe('user config')
    expect(drive.getAttribute('title')).toBe('user config (managed)')
  })

  it('draws a button for each action of a row, and only those', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    expect(buttonsOf(rowOf(popover, 'example-notes'))).toEqual([])
    expect(buttonsOf(rowOf(popover, 'example-tracker'))).toEqual(['Reconnect'])
    expect(buttonsOf(rowOf(popover, 'example-calendar'))).toEqual(['Sign in'])
    expect(buttonsOf(rowOf(popover, 'worfy-canvas'))).toEqual(['Turn off for this Session'])
    expect(buttonsOf(rowOf(popover, 'example-wiki'))).toEqual(['Allow'])
    expect(buttonsOf(rowOf(popover, 'example-drive'))).toEqual(['Turn on', 'Restart Session with the same conversation'])
    expect(within(popover).queryByText(/next Wave/)).toBeNull()
  })

  it('in an Autopilot Session, Allow says it takes effect from the next Wave', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot />)
    const popover = open()
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-note').textContent).toBe('Allow takes effect from the next Wave')
    expect(within(rowOf(popover, 'example-tracker')).queryByTestId('mcp-row-note')).toBeNull()
  })

  it('a click sends the action to main; the button waits while it runs, and the rows main answers are taken', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAction'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    const button = within(rowOf(popover, 'example-tracker')).getByRole('button', { name: 'Reconnect' })
    fireEvent.click(button)
    expect(main.calls).toEqual([{ channel: 'agent.mcpAction', input: { sessionId: 's', name: 'example-tracker', action: 'reconnect' } }])
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // A second click while it runs sends nothing.
    fireEvent.click(button)
    expect(main.calls).toHaveLength(1)
    const after = ROWS.map((each) => (each.name === 'example-tracker' ? { ...each, status: 'connected' as const, tools: 1, error: null, actions: [] } : each))
    await act(async () => settle({ ok: true, value: { servers: after, error: null } }))
    expect(button.getAttribute('aria-disabled')).toBeNull()
    expect(useSessionLogs.getState().logs.s?.mcp?.servers).toEqual(after)
    expect(main.toasts).toEqual([])
  })

  it('a refused action is a toast with the reason', async () => {
    main.answers['agent.mcpAction'] = () => ({ ok: true, value: { servers: null, error: 'Server not found: example-tracker' } })
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    await act(async () => fireEvent.click(within(rowOf(popover, 'example-tracker')).getByRole('button', { name: 'Reconnect' })))
    expect(main.toasts).toEqual([expect.objectContaining({ kind: 'error', text: 'Reconnect example-tracker: Server not found: example-tracker' })])

    main.answers['agent.mcpAction'] = () => ({ ok: false, error: 'the Session is gone' })
    await act(async () => fireEvent.click(within(rowOf(popover, 'example-tracker')).getByRole('button', { name: 'Reconnect' })))
    expect(main.toasts[1]).toEqual(expect.objectContaining({ kind: 'error', text: expect.stringContaining('Reconnect example-tracker: ') }))
  })

  it('Escape closes the popover and gives the focus back to the chip, and the press goes no further', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    const free = fireEvent.keyDown(popover, { key: 'Escape' })
    expect(free).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'MCP servers' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('session-mcp'))
  })
})

describe('the store', () => {
  it('keeps the last `mcp` event of a Session apart from its transcript', () => {
    acceptAgentEvent({ sessionId: 'kept', event: { type: 'mcp', servers: ROWS } })
    acceptAgentEvent({ sessionId: 'kept', event: { type: 'mcp', servers: ROWS.slice(0, 2) } })
    const log = useSessionLogs.getState().logs.kept
    expect(log?.events).toEqual([])
    expect(log?.mcp?.servers).toEqual(ROWS.slice(0, 2))
    // «No data» from main replaces the rows: the chip goes rather than show a stale count.
    acceptAgentEvent({ sessionId: 'kept', event: { type: 'mcp', servers: null } })
    expect(useSessionLogs.getState().logs.kept?.mcp?.servers).toBeNull()
  })
})

describe('the rows of a Session view', () => {
  /** An answer the test settles when it chooses. */
  function later(): { answer: () => Promise<Answer>; settle: (answer: Answer) => void } {
    let settle: (answer: Answer) => void = () => undefined
    const promise = new Promise<Answer>((resolve) => (settle = resolve))
    return { answer: () => promise, settle: (answer) => settle(answer) }
  }

  it('a Session no `mcp` event came for asks main once, and the chip draws the answer', async () => {
    main.answers['agent.mcp'] = () => ({ ok: true, value: { servers: ROWS.slice(0, 2) } })
    const { rerender } = render(<SessionMcpChip sessionId="asked" projectId="p" orchestrator={false} />)
    await act(async () => {})
    expect(within(screen.getByTestId('session-mcp')).getByTestId('session-mcp-count').textContent).toBe('1/2')
    rerender(<SessionMcpChip sessionId="asked" projectId="p" orchestrator={false} />)
    await act(async () => {})
    expect(main.calls.filter((call) => call.channel === 'agent.mcp')).toEqual([{ channel: 'agent.mcp', input: { sessionId: 'asked' } }])
  })

  it('an `mcp` event that comes while main is asked wins over the answer, which is older', async () => {
    const answer = later()
    main.answers['agent.mcp'] = answer.answer
    render(<SessionMcpChip sessionId="raced" projectId="p" orchestrator={false} />)
    await act(async () => acceptAgentEvent({ sessionId: 'raced', event: { type: 'mcp', servers: [row('example-notes')] } }))
    await act(async () => answer.settle({ ok: true, value: { servers: ROWS } }))
    expect(useSessionLogs.getState().logs.raced?.mcp?.servers).toEqual([row('example-notes')])
    expect(within(screen.getByTestId('session-mcp')).getByTestId('session-mcp-count').textContent).toBe('1/1')
  })

  it('the rows go with the Session to its new id', () => {
    acceptAgentEvent({ sessionId: 'pending-9', event: { type: 'mcp', servers: ROWS } })
    acceptAgentEvent({ sessionId: 'real-9', event: { type: 'renamed', from: 'pending-9' } })
    expect(useSessionLogs.getState().logs['real-9']?.mcp?.servers).toEqual(ROWS)
    expect(useSessionLogs.getState().logs['pending-9']).toBeUndefined()
  })

  it('another Session in the same view starts afresh: an action running on a server of the one before holds no button here', async () => {
    const failed = [row('example-tracker', { status: 'failed', tools: null, actions: ['reconnect'] })]
    acceptAgentEvent({ sessionId: 's-a', event: { type: 'mcp', servers: failed } })
    acceptAgentEvent({ sessionId: 's-b', event: { type: 'mcp', servers: failed } })
    const action = later()
    main.answers['agent.mcpAction'] = action.answer
    const { rerender } = render(<SessionMcpChip sessionId="s-a" projectId="p" orchestrator={false} />)
    const before = open()
    const reconnect = within(rowOf(before, 'example-tracker')).getByRole('button', { name: 'Reconnect' })
    fireEvent.click(reconnect)
    expect(reconnect.getAttribute('aria-disabled')).toBe('true')

    rerender(<SessionMcpChip sessionId="s-b" projectId="p" orchestrator={false} />)
    expect(screen.queryByRole('dialog', { name: 'MCP servers' })).toBeNull()
    const after = open()
    expect(within(rowOf(after, 'example-tracker')).getByRole('button', { name: 'Reconnect' }).getAttribute('aria-disabled')).toBeNull()
    // The answer of the first Session's action goes to that Session.
    await act(async () => action.settle({ ok: true, value: { servers: [row('example-tracker')], error: null } }))
    expect(useSessionLogs.getState().logs['s-a']?.mcp?.servers).toEqual([row('example-tracker')])
    expect(useSessionLogs.getState().logs['s-b']?.mcp?.servers).toEqual(failed)
  })
})
