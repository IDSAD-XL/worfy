// The Assistant's section in the window (src/renderer/assistant/AssistantPanel.tsx, PrepareDialog.tsx; worfy-assistant
// ticket 14): an item with its reason, source and duty; like and dislike go to main as `assistant.rate`, and a dislike
// that wrote a rule leaves the card of the hidden item with that rule; Prepare shows the exact text and nothing starts
// until Start, which sends exactly the text shown; with the Assistant off the box to write is disabled. IPC is
// replaced; the section's store and components are real. The built app is checked in test/e2e/assistant.spec.ts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantView, WindowItem } from '../../src/shared/assistant/window'

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: ipc.invoke,
  subscribe: () => () => undefined,
}))

const { AssistantPanel } = await import('../../src/renderer/assistant/AssistantPanel')
const { PrepareDialog } = await import('../../src/renderer/assistant/PrepareDialog')
const { useAssistant } = await import('../../src/renderer/assistant/useAssistant')

const NOW = Date.UTC(2026, 10, 25, 9, 0)

const item = (over: Partial<WindowItem> = {}): WindowItem => ({
  id: 'item-1',
  title: 'Teammate A asks you to look at the rate-limit change',
  why: null,
  source: 'slack',
  sourceLabel: 'Slack',
  subject: { kind: 'message', id: 'C1/1', label: '#shop-api' },
  kind: 'message',
  projectId: 'shop',
  projectName: 'shop-api',
  duty: { id: 'source:slack', title: 'Slack messages for you' },
  urgent: false,
  state: 'new',
  startedAt: NOW - 3_600_000,
  lastAt: NOW - 3_600_000,
  outside: null,
  proposalId: null,
  prepare: null,
  open: null,
  rating: null,
  ...over,
})

const RED = item({
  id: 'item-2',
  title: 'CI of main is red after PR #412',
  source: 'ci',
  sourceLabel: 'CI of the main branch',
  subject: { kind: 'pr', id: 'shop/412', label: 'PR #412' },
  kind: 'main-red',
  duty: { id: 'main-ci-red', title: 'Main CI red' },
  prepare: { projectId: 'shop', projectName: 'shop-api', text: 'The CI of main went red after PR #412.\nFind the cause and fix it.', by: 'worfy' },
})

const view = (over: Partial<AssistantView> = {}): AssistantView => ({
  on: true,
  projects: 1,
  items: [item(), RED],
  snoozed: [],
  hidden: [],
  proposals: [],
  journal: [],
  conversation: [],
  summary: { id: 'summary-1', since: NOW - 16 * 3_600_000, came: 2, done: 0, stopped: 0, waiting: 2, projects: [], first: [], morning: null, rating: null },
  usage: { today: 1200, week: 5400, fiveHour: 0.02, sevenDay: 0.01, estimate: true },
  workHours: true,
  linked: [],
  ...over,
})

const card = (id: string): HTMLElement => screen.getAllByTestId('assistant-item').find((each) => each.getAttribute('data-item-id') === id)!

beforeEach(() => {
  ipc.invoke.mockReset()
  ipc.invoke.mockResolvedValue({ ok: true, value: {} })
  useAssistant.setState({ view: null, tab: 'waits', focus: null, closed: [], gone: [], prepare: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Assistant section', () => {
  it('shows each item with its reason, its source and its duty', () => {
    render(<AssistantPanel view={view()} />)
    const slack = card('item-1')
    expect(slack.textContent).toContain('Teammate A asks you to look at the rate-limit change')
    expect(slack.textContent).toContain('Slack')
    expect(slack.textContent).toContain('Slack messages for you')
    expect(card('item-2').textContent).toContain('Main CI red')
  })

  it('like sends the rating of the item to main', async () => {
    render(<AssistantPanel view={view()} />)
    fireEvent.click(within(card('item-1')).getByRole('button', { name: 'Like' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.rate', { target: { kind: 'item', id: 'item-1' }, rating: 'like' }))
  })

  it('a dislike that wrote a rule leaves the card of the hidden item, with the rule and Undo', async () => {
    const rule = { id: 'rule-1', text: 'Hide Slack messages of shop-api' }
    ipc.invoke.mockResolvedValue({ ok: true, value: { rule } })
    const { rerender } = render(<AssistantPanel view={view()} />)
    fireEvent.click(within(card('item-1')).getByRole('button', { name: 'Dislike' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.rate', { target: { kind: 'item', id: 'item-1' }, rating: 'dislike' }))
    // main answers with a view in which the item is hidden by the rule.
    await act(async () => rerender(<AssistantPanel view={view({ items: [RED], hidden: [{ item: item({ rating: 'dislike' }), rule }] })} />))
    const gone = screen.getByTestId('assistant-gone')
    expect(gone.textContent).toContain(rule.text)
    expect(within(gone).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getAllByTestId('assistant-item').map((each) => each.getAttribute('data-item-id'))).toEqual(['item-2'])
  })

  it('Prepare shows the exact text; nothing starts until Start, which sends exactly that text', async () => {
    ipc.invoke.mockResolvedValue({ ok: true, value: { projectId: 'shop', nodeId: 'n1', sessionId: 's1' } })
    render(
      <>
        <AssistantPanel view={view()} />
        <PrepareDialog />
      </>,
    )
    fireEvent.click(within(card('item-2')).getByRole('button', { name: /Prepare/ }))
    const dialog = await screen.findByTestId('assistant-prepare')
    expect(within(dialog).getByTestId('assistant-prepare-text').textContent).toBe(RED.prepare!.text)
    expect(ipc.invoke).not.toHaveBeenCalledWith('assistant.start', expect.anything())
    fireEvent.click(within(dialog).getByRole('button', { name: /Start Session/ }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.start', { projectId: 'shop', text: RED.prepare!.text, itemId: 'item-2', proposalId: null }))
    await waitFor(() => expect(screen.queryByTestId('assistant-prepare')).toBeNull())
  })

  it('Prepare names the Project the Session starts in, not the Project of the item (review round 1)', async () => {
    ipc.invoke.mockResolvedValue({ ok: true, value: { projectId: 'mobile', nodeId: 'n1', sessionId: 's1' } })
    const elsewhere = item({ id: 'item-3', prepare: { projectId: 'mobile', projectName: 'mobile-app', text: 'Pin the SDK.', by: 'assistant' } })
    render(
      <>
        <AssistantPanel view={view({ items: [elsewhere] })} />
        <PrepareDialog />
      </>,
    )
    fireEvent.click(within(card('item-3')).getByRole('button', { name: /Prepare/ }))
    const dialog = await screen.findByTestId('assistant-prepare')
    expect(dialog.textContent).toContain('mobile-app')
    expect(dialog.textContent).not.toContain('shop-api')
  })

  it('Prepare of a proposal of no item names its Project, not its id', async () => {
    const proposal = { id: 'proposal-1', title: 'Check PR #87', why: 'You asked.', prepare: { projectId: 'mobile-0001', projectName: 'mobile-app', text: 'Review #87.', by: 'assistant' as const }, change: null, createdAt: NOW, rating: null }
    render(
      <>
        <AssistantPanel view={view({ items: [], proposals: [proposal] })} />
        <PrepareDialog />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Prepare/ }))
    const dialog = await screen.findByTestId('assistant-prepare')
    expect(dialog.textContent).toContain('mobile-app')
    expect(dialog.textContent).not.toContain('mobile-0001')
  })

  it('an edit in Prepare is the text the Session starts with', async () => {
    ipc.invoke.mockResolvedValue({ ok: true, value: { projectId: 'shop', nodeId: 'n1', sessionId: 's1' } })
    render(
      <>
        <AssistantPanel view={view()} />
        <PrepareDialog />
      </>,
    )
    fireEvent.click(within(card('item-2')).getByRole('button', { name: /Prepare/ }))
    const dialog = await screen.findByTestId('assistant-prepare')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'The exact text of the Session' }), { target: { value: 'Fix only the failing test.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Start Session/ }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.start', expect.objectContaining({ text: 'Fix only the failing test.' })))
  })

  it('with the Assistant off the list shows and the box to write is disabled', () => {
    render(<AssistantPanel view={view({ on: false })} />)
    expect(screen.getAllByTestId('assistant-item')).toHaveLength(2)
    const box = screen.getByPlaceholderText('Assistant is off on this machine') as HTMLTextAreaElement
    expect(box.disabled).toBe(true)
  })

  it('the line of usage shows the tokens and marks the share of Limits as an estimate', () => {
    render(<AssistantPanel view={view()} />)
    const usage = screen.getByTestId('assistant-usage')
    expect(usage.textContent).toMatch(/1[.,]?2\s?k|1,?200/)
    expect(usage.textContent?.toLowerCase()).toContain('estimate')
  })
})

// worfy-assistant ticket 18 (spec, two machines; boundary 5): what waits on the Linked machine is in the list too, under
// its Machine's name, read-only: its own Assistant keeps it, so nothing here acts on it.
describe('the Linked machine in the section', () => {
  const PC_ITEM = {
    id: 'pc-1',
    title: 'Asks: Deploy the docs now?',
    source: 'session',
    sourceLabel: 'Session',
    subject: { kind: 'session', label: 'docs 02' },
    kind: 'question',
    projectId: 'docs-9',
    projectName: 'docs-site',
    duty: 'Waits for you',
    urgent: true,
    startedAt: NOW - 600_000,
    lastAt: NOW - 600_000,
    outside: null,
  }

  it('lists what waits on the Linked machine under its name, read-only, with no button that acts', () => {
    render(<AssistantPanel view={view({ linked: [{ id: 'pc', name: 'PC', online: true, projects: [{ id: 'docs-9', name: 'docs-site' }], items: [PC_ITEM], problem: null }] })} />)
    const group = screen.getByTestId('assistant-linked')
    expect(group.textContent).toContain('On PC')
    expect(group.textContent).toContain('read-only')
    const [linked] = within(group).getAllByTestId('assistant-linked-item')
    expect(linked!.textContent).toContain('Asks: Deploy the docs now?')
    expect(linked!.textContent).toContain('docs-site')
    expect(linked!.textContent).toContain('Waits for you')
    expect(within(linked!).queryAllByRole('button')).toEqual([])
    // This Machine's own items keep their buttons.
    expect(within(card('item-1')).getByRole('button', { name: 'Like' })).toBeTruthy()
  })

  it('says why a Linked machine shows nothing: offline, or access off', () => {
    render(<AssistantPanel view={view({ linked: [{ id: 'pc', name: 'PC', online: false, projects: [], items: [], problem: 'PC is offline' }] })} />)
    expect(screen.getByTestId('assistant-linked').textContent).toContain('PC is offline')
    expect(screen.queryAllByTestId('assistant-linked-item')).toEqual([])
  })

  it('shows no Linked machine part without one', () => {
    render(<AssistantPanel view={view()} />)
    expect(screen.queryByTestId('assistant-linked')).toBeNull()
  })
})

describe('a card «before → after» with Apply (worfy-assistant ticket 15)', () => {
  const change = (applied: number | null) => ({
    id: 'proposal-9',
    title: 'Check Slack less often',
    why: 'You asked for every 20 minutes.',
    prepare: null,
    change: { rows: [{ label: 'Slack interval', before: 'Every 10 min', after: 'Every 20 min' }], applied },
    createdAt: NOW,
    rating: null,
  })

  it('shows each setting before and after; Apply sends the proposal to main, Not now dismisses it', async () => {
    render(<AssistantPanel view={view({ items: [], proposals: [change(null)] })} />)
    const card1 = screen.getByTestId('assistant-change')
    expect(within(card1).getByText('Slack interval')).toBeTruthy()
    expect(within(card1).getByText('Every 10 min')).toBeTruthy()
    expect(within(card1).getByText('Every 20 min')).toBeTruthy()
    expect(card1.textContent).toContain('Nothing changes until you press Apply')
    fireEvent.click(within(card1).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.apply', { proposalId: 'proposal-9' }))
    fireEvent.click(within(card1).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.dismissProposal', { proposalId: 'proposal-9' }))
  })

  it('once applied: no Apply, the time it was applied, and Dismiss to clear the card', () => {
    render(<AssistantPanel view={view({ items: [], proposals: [change(Date.now())] })} />)
    const card1 = screen.getByTestId('assistant-change')
    expect(within(card1).queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(card1.textContent).toMatch(/Applied at \d\d:\d\d/)
    expect(within(card1).getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })
})
