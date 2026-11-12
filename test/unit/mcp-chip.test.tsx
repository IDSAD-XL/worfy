// The chip «MCP n/m» of the Session header and its popover (worfy-mcp-live ticket 04,
// src/renderer/session/McpChip.tsx): n is the servers that are connected, m every server of the Session
// but those not allowed in the Project; the chip warns while a server failed or needs auth, and is not
// drawn without data. The popover draws a row per server with a button for each action main put in the
// row and nothing else, the servers not allowed in a group of their own under the others, and a click
// sends the action to main (`agent.mcpAction`); the button waits while it runs, and a refusal is a toast.
// The store keeps the last `mcp` event of a Session apart from its transcript, asks main (`agent.mcp`) for
// the rows of a Session no event came for yet, and carries them to the Session's new id. The chip of the
// Session view starts afresh for another Session. Ticket 10: the rows «not started» form a group with one Restart
// Session, names show whole (a claude.ai connector's without «claude.ai »), and «Allow all» is the one primary button.
// Server names are made up.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const { ALLOW_ALL_LABEL, CONNECTOR_HINT, McpChip, SessionMcpChip } = await import('../../src/renderer/session/McpChip')
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
  row('example-notes', { tools: 3, actions: ['turn-off'] }),
  row('example-tracker', { status: 'failed', tools: null, error: 'connection refused by example-tracker', actions: ['reconnect'] }),
  row('example-calendar', { status: 'needs-auth', tools: null, source: 'claudeai', actions: ['sign-in'] }),
  // worfy's own server: main gives its row no action (ticket 09).
  row('worfy-canvas', { source: 'worfy', tools: 5 }),
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
    // Under them, how to allow a claude.ai connector the inventory may not list (ticket 05).
    expect(within(group).getByTestId('mcp-connector-hint').textContent).toBe(CONNECTOR_HINT)

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

  it('has no group and no line about connectors while every server is allowed', () => {
    render(<McpChip sessionId="s" rows={[row('example-notes'), row('worfy-canvas', { source: 'worfy' })]} autopilot={false} />)
    const popover = open()
    expect(within(popover).queryByTestId('mcp-not-allowed')).toBeNull()
    expect(within(popover).queryByTestId('mcp-connector-hint')).toBeNull()
  })

  it('draws a button for each action of a row, and only those', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    expect(buttonsOf(rowOf(popover, 'example-notes'))).toEqual(['Turn off for this Session'])
    expect(buttonsOf(rowOf(popover, 'example-tracker'))).toEqual(['Reconnect'])
    expect(buttonsOf(rowOf(popover, 'example-calendar'))).toEqual(['Sign in'])
    expect(buttonsOf(rowOf(popover, 'worfy-canvas'))).toEqual([])
    expect(buttonsOf(rowOf(popover, 'example-wiki'))).toEqual(['Allow'])
    expect(buttonsOf(rowOf(popover, 'example-drive'))).toEqual(['Turn on', 'Restart Session'])
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
    const actions = () => main.calls.filter((call) => call.channel === 'agent.mcpAction')
    expect(actions()).toEqual([{ channel: 'agent.mcpAction', input: { sessionId: 's', name: 'example-tracker', action: 'reconnect' } }])
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // A second click while it runs sends nothing.
    fireEvent.click(button)
    expect(actions()).toHaveLength(1)
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

  it('a failed Allow stays written in its row, not only in a toast that goes away; the next try clears it', async () => {
    main.answers['agent.mcpAction'] = () => ({ ok: false, error: 'agent.mcpAction failed: The profile changed while Allow wrote it; nothing was written. Press Allow again.' })
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    const allow = () => within(rowOf(popover, 'example-wiki')).getByRole('button', { name: 'Allow' })
    await act(async () => fireEvent.click(allow()))
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-action-error').textContent).toBe('Allow failed: The profile changed while Allow wrote it; nothing was written. Press Allow again.')
    expect(main.toasts).toHaveLength(1)

    // Main wrote the list but the Session did not take the server: the answer's error stays in the row too.
    main.answers['agent.mcpAction'] = () => ({ ok: true, value: { servers: null, error: 'Claude Code did not start it' } })
    await act(async () => fireEvent.click(allow()))
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-action-error').textContent).toBe('Allow failed: Claude Code did not start it')

    // A call that never answered with a result (the bridge itself failed) is no silent click either.
    main.answers['agent.mcpAction'] = () => Promise.reject(new Error('the window lost main'))
    await act(async () => fireEvent.click(allow()))
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-action-error').textContent).toBe('Allow failed: the window lost main')
    expect(allow().getAttribute('aria-disabled')).toBeNull()

    // The reason stays through a new `mcp` event and while the next try runs, until that try answers.
    await act(async () => acceptAgentEvent({ sessionId: 's', event: { type: 'mcp', servers: ROWS } }))
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-action-error').textContent).toBe('Allow failed: the window lost main')
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAction'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    fireEvent.click(allow())
    expect(allow().getAttribute('aria-disabled')).toBe('true')
    expect(within(rowOf(popover, 'example-wiki')).getByTestId('mcp-row-action-error').textContent).toBe('Allow failed: the window lost main')
    await act(async () => settle({ ok: true, value: { servers: null, error: null } }))
    expect(within(rowOf(popover, 'example-wiki')).queryByTestId('mcp-row-action-error')).toBeNull()
  })

  it('a server on the list that Claude Code did not start shows as not started, counts against the chip and warns', () => {
    const rows = [row('example-notes'), row('example-docs', { status: 'not-started', tools: null, source: 'claudeai', error: 'not started here', actions: ['restart'] })]
    expect(mcpCount(rows)).toEqual({ connected: 1, total: 2, warn: true })
    render(<McpChip sessionId="s" rows={rows} autopilot={false} />)
    const popover = open()
    expect(within(rowOf(popover, 'example-docs')).getByTestId('mcp-row-status').textContent).toBe('not started')
    // The warning look of failed and needs auth, and the tooltip names why the chip warns.
    expect(within(rowOf(popover, 'example-docs')).getByTestId('mcp-row-status').querySelector('.w-chip--blocked')).not.toBeNull()
    expect(screen.getAllByTestId('session-mcp')[0]?.getAttribute('title')).toBe('1 of 2 MCP servers connected: 1 not started')
    expect(within(popover).queryByTestId('mcp-not-allowed')).toBeNull()
  })

  it('opens upward from the chip, in the bar under the input field, its height kept to the room above it', () => {
    render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const chip = screen.getByTestId('session-mcp')
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 600, bottom: 618, right: 100, width: 60, height: 18, x: 40, y: 600, toJSON: () => ({}) } as DOMRect)
    const popover = open()
    expect(popover.style.top).toBe('')
    expect(popover.style.bottom).toBe(`${window.innerHeight - 600 + 4}px`)
    expect(popover.style.maxHeight).toBe('480px')
    fireEvent.click(chip)
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 200, bottom: 218, right: 100, width: 60, height: 18, x: 40, y: 200, toJSON: () => ({}) } as DOMRect)
    expect(open().style.maxHeight).toBe(`${200 - 4 - 8}px`)
  })

  it('a failed action stays written in its row when new rows come (review of #1826)', async () => {
    main.answers['agent.mcpAction'] = () => ({ ok: true, value: { servers: null, error: 'connection refused again' } })
    acceptAgentEvent({ sessionId: 'kept-error', event: { type: 'mcp', servers: ROWS } })
    render(<SessionMcpChip sessionId="kept-error" projectId="alpha" orchestrator={false} />)
    const popover = open()
    await act(async () => fireEvent.click(within(rowOf(popover, 'example-tracker')).getByRole('button', { name: 'Reconnect' })))
    // Rows with one more server, and the failed one changed: the reason stays until the next action there.
    const more = [...ROWS.map((each) => (each.name === 'example-tracker' ? { ...each, error: 'still refused' } : each)), row('example-new', { tools: 1 })]
    await act(async () => acceptAgentEvent({ sessionId: 'kept-error', event: { type: 'mcp', servers: more } }))
    const shown = screen.getByRole('dialog', { name: 'MCP servers' })
    expect(rowOf(shown, 'example-new')).toBeTruthy()
    expect(within(rowOf(shown, 'example-tracker')).getByTestId('mcp-row-action-error').textContent).toBe('Reconnect failed: connection refused again')
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

// Ticket 09 (owner 2026-11-12, Q3): «Allow all» in the heading of the group «Not allowed in this Project».
describe('Allow all', () => {
  const OUTSIDE = [row('example-wiki', { status: 'not-allowed', tools: null, actions: ['allow'] }), row('example-docs', { status: 'not-allowed', tools: null, source: 'claudeai', actions: ['allow'] })]
  const TWO = [...ROWS.filter((each) => each.status !== 'not-allowed'), ...OUTSIDE]
  const allowAll = (popover: HTMLElement) => within(within(popover).getByTestId('mcp-not-allowed')).getByRole('button', { name: ALLOW_ALL_LABEL })
  const calls = () => main.calls.filter((call) => call.channel === 'agent.mcpAllowAll')

  it('is in the group\'s heading only while two rows or more offer Allow: one row has its own Allow', () => {
    const { rerender } = render(<McpChip sessionId="s" rows={ROWS} autopilot={false} />)
    const popover = open()
    expect(within(popover).queryByTestId('mcp-allow-all')).toBeNull()
    rerender(<McpChip sessionId="s" rows={TWO} autopilot={false} />)
    const button = allowAll(popover)
    // Ticket 10: «Allow all» is the one primary button of the popover; each row's Allow is secondary.
    expect(button.classList.contains('w-button--primary')).toBe(true)
    expect(popover.querySelectorAll('.w-button--primary, .w-action--primary')).toHaveLength(1)
    for (const name of ['example-wiki', 'example-docs']) {
      const allow = within(rowOf(popover, name)).getByRole('button', { name: 'Allow' })
      expect(allow.classList.contains('w-button--secondary'), name).toBe(true)
      expect(allow.dataset.action).toBe('allow')
    }
    expect(button.closest('.w-mcp__group-head')?.querySelector('h2')?.textContent).toBe('Not allowed in this Project')
    // A not-allowed row without Allow does not count.
    rerender(<McpChip sessionId="s" rows={[...TWO.slice(0, -1), { ...OUTSIDE[1]!, actions: [] }]} autopilot={false} />)
    expect(within(popover).queryByTestId('mcp-allow-all')).toBeNull()
  })

  it('sends every name in one call; the rows\' Allow and the button wait while it runs; the rows main answers are taken', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAllowAll'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    render(<McpChip sessionId="all" rows={TWO} autopilot={false} />)
    const popover = open()
    fireEvent.click(allowAll(popover))
    expect(calls()).toEqual([{ channel: 'agent.mcpAllowAll', input: { sessionId: 'all', names: ['example-wiki', 'example-docs'] } }])
    expect(allowAll(popover).getAttribute('aria-disabled')).toBe('true')
    expect(allowAll(popover).getAttribute('aria-busy')).toBe('true')
    for (const name of ['example-wiki', 'example-docs']) expect(within(rowOf(popover, name)).getByRole('button', { name: 'Allow' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(allowAll(popover))
    fireEvent.click(within(rowOf(popover, 'example-wiki')).getByRole('button', { name: 'Allow' }))
    expect(calls()).toHaveLength(1)
    expect(main.calls.filter((call) => call.channel === 'agent.mcpAction')).toEqual([])
    const after = TWO.map((each) => (each.status === 'not-allowed' ? { ...each, status: 'connected' as const, tools: 1, actions: [] } : each))
    await act(async () => settle({ ok: true, value: { servers: after, error: null } }))
    expect(useSessionLogs.getState().logs.all?.mcp?.servers).toEqual(after)
    expect(main.toasts).toEqual([])
  })

  it('waits while an action of a row runs', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAction'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    render(<McpChip sessionId="s" rows={TWO} autopilot={false} />)
    const popover = open()
    fireEvent.click(within(rowOf(popover, 'example-tracker')).getByRole('button', { name: 'Reconnect' }))
    expect(allowAll(popover).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(allowAll(popover))
    expect(calls()).toEqual([])
    await act(async () => settle({ ok: true, value: { servers: null, error: null } }))
    expect(allowAll(popover).getAttribute('aria-disabled')).toBeNull()
  })

  it('a refusal is a toast and stays written under the heading, through new rows, until the next Allow all answers', async () => {
    main.answers['agent.mcpAllowAll'] = () => ({ ok: false, error: 'agent.mcpAllowAll failed: The profile changed while Allow wrote it; nothing was written. Press Allow again.' })
    acceptAgentEvent({ sessionId: 'refused-all', event: { type: 'mcp', servers: TWO } })
    render(<SessionMcpChip sessionId="refused-all" projectId="alpha" orchestrator={false} />)
    const popover = open()
    await act(async () => fireEvent.click(allowAll(popover)))
    const error = () => within(within(screen.getByRole('dialog', { name: 'MCP servers' })).getByTestId('mcp-not-allowed')).queryByTestId('mcp-allow-all-error')
    expect(error()?.textContent).toBe('Allow all failed: The profile changed while Allow wrote it; nothing was written. Press Allow again.')
    expect(main.toasts).toEqual([expect.objectContaining({ kind: 'error', text: 'Allow all: The profile changed while Allow wrote it; nothing was written. Press Allow again.' })])
    // Main wrote the list, but a server did not join: its words stay too.
    main.answers['agent.mcpAllowAll'] = () => ({ ok: true, value: { servers: null, error: 'example-docs did not start' } })
    await act(async () => fireEvent.click(allowAll(popover)))
    expect(error()?.textContent).toBe('Allow all failed: example-docs did not start')
    await act(async () => acceptAgentEvent({ sessionId: 'refused-all', event: { type: 'mcp', servers: [...TWO, row('example-more', { status: 'not-allowed', tools: null, actions: ['allow'] })] } }))
    expect(error()?.textContent).toBe('Allow all failed: example-docs did not start')
    main.answers['agent.mcpAllowAll'] = () => ({ ok: true, value: { servers: null, error: null } })
    await act(async () => fireEvent.click(allowAll(popover)))
    expect(error()).toBeNull()
    expect(calls().at(-1)?.input).toEqual({ sessionId: 'refused-all', names: ['example-wiki', 'example-docs', 'example-more'] })
  })
})

// Ticket 10 (owner 2026-11-12, Q8–Q10): the rows «not started» stand in a group of their own, with the reason and one
// Restart Session in its heading; a claude.ai connector's name drops the «claude.ai » its source already says.
describe('the group «not started»', () => {
  const NOT_STARTED = 'Allowed in this Project, but Claude Code did not start them in this Session.'
  const unstarted = (name: string, overrides: Partial<McpServerRow> = {}): McpServerRow =>
    row(name, { status: 'not-started', tools: null, source: 'claudeai', error: 'Allowed in this Project, but Claude Code did not start it in this Session.', actions: ['restart'], ...overrides })
  const FOUR = ['claude.ai Example Notebook', 'claude.ai Example Planner', 'claude.ai Example Board', 'claude.ai Example Mailbox'].map((name) => unstarted(name))
  const rows = [row('example-notes', { actions: ['turn-off'] }), ...FOUR, row('example-wiki', { status: 'not-allowed', tools: null, actions: ['allow'] })]
  const groupOf = (popover: HTMLElement) => within(popover).getByTestId('mcp-not-started')
  const restarts = () => main.calls.filter((call) => call.channel === 'agent.mcpAction')

  it('has one heading with the reason and one Restart Session, whatever the number of rows; its rows have no button', () => {
    for (const count of [1, 4]) {
      const { unmount } = render(<McpChip sessionId="s" rows={[...rows.slice(0, 1), ...FOUR.slice(0, count), ...rows.slice(-1)]} autopilot={false} />)
      const popover = open()
      const group = groupOf(popover)
      expect(within(group).getAllByTestId('mcp-row')).toHaveLength(count)
      expect(within(group).getAllByRole('heading')).toHaveLength(1)
      expect(within(group).getByRole('heading').textContent).toBe(count === 1 ? NOT_STARTED.replace('them', 'it') : NOT_STARTED)
      expect(buttonsOf(group)).toEqual(['Restart Session'])
      expect(within(group).getByRole('button', { name: 'Restart Session' }).classList.contains('w-button--secondary')).toBe(true)
      for (const each of within(group).getAllByTestId('mcp-row')) {
        expect(buttonsOf(each), each.dataset.name).toEqual([])
        expect(within(each).getByTestId('mcp-row-status').textContent).toBe('not started')
        expect(within(each).getByTestId('mcp-row-source').textContent).toBe('claude.ai')
        // The reason is said once, in the heading, not under each row.
        expect(within(each).queryByTestId('mcp-row-error')).toBeNull()
      }
      // The group stands between the Session's servers and «Not allowed in this Project».
      const order = [...popover.querySelectorAll<HTMLElement>('[data-testid="mcp-row"]')].map((each) => each.dataset.name)
      expect(order).toEqual(['example-notes', ...FOUR.slice(0, count).map((each) => each.name), 'example-wiki'])
      unmount()
    }
  })

  it('Restart Session sends the same Restart as a row\'s did, once; it waits while it runs and says in its tooltip that the conversation stays', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAction'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    render(<McpChip sessionId="r" rows={rows} autopilot={false} />)
    const popover = open()
    const restart = () => within(groupOf(popover)).getByRole('button', { name: 'Restart Session' })
    expect(restart().getAttribute('aria-description')).toBe('Restarts the Session with the same conversation, so Claude Code starts again with the list')
    fireEvent.click(restart())
    expect(restarts()).toEqual([{ channel: 'agent.mcpAction', input: { sessionId: 'r', name: 'claude.ai Example Notebook', action: 'restart' } }])
    expect(restart().getAttribute('aria-disabled')).toBe('true')
    expect(restart().getAttribute('aria-busy')).toBe('true')
    fireEvent.click(restart())
    expect(restarts()).toHaveLength(1)
    await act(async () => settle({ ok: true, value: { servers: null, error: null } }))
    expect(restart().getAttribute('aria-disabled')).toBeNull()
    expect(main.toasts).toEqual([])
  })

  it('a refused Restart is a toast and stays written under the heading until the next Restart answers', async () => {
    main.answers['agent.mcpAction'] = () => ({ ok: false, error: 'agent.mcpAction failed: The Session\'s agent is not running' })
    render(<McpChip sessionId="r" rows={rows} autopilot={false} />)
    const popover = open()
    const restart = () => within(groupOf(popover)).getByRole('button', { name: 'Restart Session' })
    await act(async () => fireEvent.click(restart()))
    expect(within(groupOf(popover)).getByTestId('mcp-restart-error').textContent).toBe("Restart Session failed: The Session's agent is not running")
    expect(main.toasts).toEqual([expect.objectContaining({ kind: 'error', text: "Restart Session: The Session's agent is not running" })])
    // No row carries it: the Restart is the group's.
    for (const each of within(groupOf(popover)).getAllByTestId('mcp-row')) expect(within(each).queryByTestId('mcp-row-action-error')).toBeNull()
    main.answers['agent.mcpAction'] = () => ({ ok: true, value: { servers: null, error: null } })
    await act(async () => fireEvent.click(restart()))
    expect(within(groupOf(popover)).queryByTestId('mcp-restart-error')).toBeNull()
  })

  it('waits while another action of the popover runs; an unattended Session\'s group has the reason and no button', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcpAction'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    const { rerender } = render(<McpChip sessionId="s" rows={rows} autopilot={false} />)
    const popover = open()
    fireEvent.click(within(rowOf(popover, 'example-notes')).getByRole('button', { name: 'Turn off for this Session' }))
    const restart = within(groupOf(popover)).getByRole('button', { name: 'Restart Session' })
    expect(restart.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(restart)
    expect(restarts()).toHaveLength(1)
    await act(async () => settle({ ok: true, value: { servers: null, error: null } }))
    rerender(<McpChip sessionId="s" rows={rows.map((each) => (each.status === 'not-started' ? { ...each, actions: [] } : each))} autopilot={false} />)
    expect(within(groupOf(popover)).getByRole('heading').textContent).toBe(NOT_STARTED)
    expect(buttonsOf(groupOf(popover))).toEqual([])
  })
})

describe('the names of the servers', () => {
  const LONG = 'claude.ai Example Project Planning Board for the Whole Team'

  it('a claude.ai connector shows without «claude.ai »; the full name is its tooltip; a long name is not cut', () => {
    const rows = [
      row(LONG, { status: 'not-started', tools: null, source: 'claudeai', actions: ['restart'] }),
      row('claude.ai Example Notebook', { status: 'not-allowed', tools: null, source: 'claudeai', actions: ['allow'] }),
      // Only a claude.ai connector loses it: a server of the user named so keeps its name.
      row('claude.ai example-local', { source: 'user' }),
    ]
    render(<McpChip sessionId="s" rows={rows} autopilot={false} />)
    const popover = open()
    const name = (of: string) => within(rowOf(popover, of)).getByTestId('mcp-row-name')
    expect(name(LONG).textContent).toBe('Example Project Planning Board for the Whole Team')
    expect(name(LONG).getAttribute('aria-description')).toBe(LONG)
    expect(name('claude.ai Example Notebook').textContent).toBe('Example Notebook')
    expect(name('claude.ai Example Notebook').getAttribute('aria-description')).toBe('claude.ai Example Notebook')
    expect(name('claude.ai example-local').textContent).toBe('claude.ai example-local')
    // The tooltip is the kit's, not a native title over it.
    expect(name(LONG).getAttribute('title')).toBeNull()
    // The row's data keeps the full name: the actions go to main by it.
    expect(rowOf(popover, LONG).dataset.name).toBe(LONG)
  })

  it('a name that does not fit wraps to a second line, never cut with an ellipsis (mcp-chip.css)', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/session/mcp-chip.css'), 'utf8')
    const name = /\.w-mcp__name\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(name).not.toBe('')
    expect(name).not.toMatch(/text-overflow|max-width|white-space:\s*nowrap|overflow:\s*hidden/)
    expect(name).toMatch(/overflow-wrap:\s*anywhere/)
    // The buttons of a row go under the name rather than squeeze it.
    expect(/\.w-mcp__line\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/flex-wrap:\s*wrap/)
  })
})

// Ticket 03: the open popover is the moment main may take in a server allowed since the Session started.
// Whether it does — an attended Session, no turn running — main decides (test/contract/claude-mcp-pickup.test.ts).
describe('opening the popover', () => {
  const asks = () => main.calls.filter((call) => call.channel === 'agent.mcp')

  it('asks main once for the rows with pickUp, and draws the server main took in; closing asks nothing', async () => {
    const picked = [...ROWS, row('example-new', { tools: 1, actions: ['turn-off'] })]
    main.answers['agent.mcp'] = () => ({ ok: true, value: { servers: picked } })
    render(<McpChip sessionId="opened" rows={ROWS} autopilot={false} />)
    expect(asks()).toEqual([])
    open()
    await act(async () => {})
    expect(asks()).toEqual([{ channel: 'agent.mcp', input: { sessionId: 'opened', pickUp: true } }])
    expect(useSessionLogs.getState().logs.opened?.mcp?.servers).toEqual(picked)
    await act(async () => fireEvent.click(screen.getByTestId('session-mcp')))
    expect(screen.queryByRole('dialog', { name: 'MCP servers' })).toBeNull()
    expect(asks()).toHaveLength(1)
  })

  it('an `mcp` event that comes while main is asked wins over the answer', async () => {
    let settle: (answer: Answer) => void = () => undefined
    main.answers['agent.mcp'] = () => new Promise<Answer>((resolve) => (settle = resolve))
    render(<McpChip sessionId="overtaken" rows={ROWS} autopilot={false} />)
    open()
    await act(async () => acceptAgentEvent({ sessionId: 'overtaken', event: { type: 'mcp', servers: [row('example-notes')] } }))
    await act(async () => settle({ ok: true, value: { servers: ROWS } }))
    expect(useSessionLogs.getState().logs.overtaken?.mcp?.servers).toEqual([row('example-notes')])
  })

  it('a refused ask changes nothing and is no toast', async () => {
    main.answers['agent.mcp'] = () => ({ ok: false, error: 'the Session is gone' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<McpChip sessionId="gone" rows={ROWS} autopilot={false} />)
    open()
    await act(async () => {})
    expect(asks()).toHaveLength(1)
    expect(useSessionLogs.getState().logs.gone?.mcp).toBeUndefined()
    expect(main.toasts).toEqual([])
    warn.mockRestore()
  })

  it('an answer with no data keeps the rows the chip has', async () => {
    acceptAgentEvent({ sessionId: 'blank', event: { type: 'mcp', servers: ROWS } })
    main.answers['agent.mcp'] = () => ({ ok: true, value: { servers: null } })
    render(<McpChip sessionId="blank" rows={ROWS} autopilot={false} />)
    open()
    await act(async () => {})
    expect(asks()).toHaveLength(1)
    expect(useSessionLogs.getState().logs.blank?.mcp?.servers).toEqual(ROWS)
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
