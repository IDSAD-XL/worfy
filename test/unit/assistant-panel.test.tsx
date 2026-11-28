// The Assistant's section in the window (src/renderer/assistant/AssistantPanel.tsx, PrepareDialog.tsx; worfy-assistant
// ticket 14): an item with its reason, source and duty; like and dislike go to main as `assistant.rate`, and a dislike
// that wrote a rule leaves the card of the hidden item with that rule; Prepare shows the exact text and nothing starts
// until Start, which sends exactly the text shown; with the Assistant off the box to write is disabled; the Assistant's
// messages are Markdown with the Session view's renderer, raw HTML and quoted outside text inert (worfy-polish 162). IPC is
// replaced; the section's store and components are real. The built app is checked in test/e2e/assistant.spec.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  offer: { owed: false, notice: false },
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

  it('two rows of one label both show, with no duplicate React key', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const twice = { ...change(null), change: { rows: [{ label: 'Duty «Release day»', before: 'On', after: 'Off' }, { label: 'Duty «Release day»', before: 'Off', after: 'On' }], applied: null } }
    render(<AssistantPanel view={view({ items: [], proposals: [twice] })} />)
    expect(within(screen.getByTestId('assistant-change')).getAllByText('Duty «Release day»')).toHaveLength(2)
    expect(errors.mock.calls.filter((args) => String(args[0]).includes('same key'))).toEqual([])
    errors.mockRestore()
  })
})

describe('the introduction in the section (worfy-assistant ticket 16)', () => {
  const setup = {
    id: 'proposal-setup',
    title: 'Set up Assistant',
    why: 'The first setup: your work hours and the checks of the sources connected in claude.ai.',
    prepare: null,
    change: { rows: [{ label: 'Work hours', before: 'Mon–Fri, 09:00–18:00', after: 'Mon–Fri, 09:00–18:00, Europe/Berlin' }], applied: null },
    createdAt: NOW,
    rating: null,
  }
  const said = (id: string, text: string, proposalId?: string) => ({ id, at: NOW, who: 'assistant' as const, text, state: 'done' as const, reason: 'intro' as const, rating: null, ...(proposalId === undefined ? {} : { proposalId }) })

  it('while the offer stands, the section offers the Assistant once: what it does, what it never does, what it uses; the list still shows', async () => {
    render(<AssistantPanel view={view({ on: false, offer: { owed: true, notice: false } })} />)
    const offer = screen.getByRole('region', { name: 'Meet Assistant' })
    expect(offer.textContent).toContain('It does')
    expect(offer.textContent).toContain('It never')
    expect(offer.textContent).toMatch(/uses your Claude Limits/u)
    expect(offer.textContent).not.toMatch(/[$€]|USD|price/iu)
    expect(offer.textContent).toContain('worfy asks once')
    expect(screen.getAllByTestId('assistant-item')).toHaveLength(2)
    fireEvent.click(within(offer).getByRole('button', { name: 'Turn on and meet' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.offer', { answer: 'accepted' }))
    await waitFor(() => expect(useAssistant.getState().tab).toBe('chat'))
  })

  it('Not now refuses the offer', async () => {
    render(<AssistantPanel view={view({ on: false, offer: { owed: true, notice: false } })} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Meet Assistant' })).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.offer', { answer: 'declined' }))
  })

  it('no offer once it no longer stands', () => {
    render(<AssistantPanel view={view({ on: false })} />)
    expect(screen.queryByRole('region', { name: 'Meet Assistant' })).toBeNull()
  })

  it('in the conversation, the card of the first setup follows the message that hands it over, with Apply', async () => {
    useAssistant.setState({ tab: 'chat' })
    const conversation = [said('m1', 'Hi, I’m Assistant.'), said('m2', 'A setup to start with:', setup.id), said('m3', 'Later words.')]
    render(<AssistantPanel view={view({ conversation, proposals: [setup] })} />)
    const chat = screen.getByTestId('assistant-chat')
    const card1 = within(chat).getByTestId('assistant-change')
    const messages = within(chat).getAllByTestId('assistant-message')
    expect(messages[1]?.compareDocumentPosition(card1) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(card1.compareDocumentPosition(messages[2]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.click(within(card1).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('assistant.apply', { proposalId: setup.id }))
  })

  it('a card dismissed since leaves the conversation; the message stays', () => {
    useAssistant.setState({ tab: 'chat' })
    render(<AssistantPanel view={view({ conversation: [said('m2', 'A setup to start with:', setup.id)], proposals: [] })} />)
    expect(screen.queryByTestId('assistant-change')).toBeNull()
    expect(screen.getByTestId('assistant-message').textContent).toContain('A setup to start with:')
  })
})

describe('the Assistant’s messages as Markdown (worfy-polish ticket 162)', () => {
  const message = (id: string, text: string, who: 'you' | 'assistant' = 'assistant', reason: 'morning' | 'user' = 'morning') => ({ id, at: NOW, who, text, state: 'done' as const, reason, rating: null })
  const chat = (...conversation: ReturnType<typeof message>[]) => {
    useAssistant.setState({ tab: 'chat' })
    render(<AssistantPanel view={view({ conversation })} />)
    return screen.getByTestId('assistant-chat')
  }

  afterEach(() => {
    delete (globalThis as { pwned?: unknown }).pwned
  })

  it('renders bold, inline code, a list and a link of a message with the Session view’s renderer', async () => {
    const text = ['**Main thing:** two Runs wait.', '', '- run `open` on SHOP-12', '- read the `loop-log`', '', 'See [the page](https://example.com/page).'].join('\n')
    const said = within(chat(message('m1', text))).getByTestId('assistant-message')
    expect(said.querySelector('.w-md')).not.toBeNull()
    expect(said.querySelector('strong')?.textContent).toBe('Main thing:')
    expect([...said.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['open', 'loop-log'])
    expect(said.querySelectorAll('ul > li')).toHaveLength(2)
    expect(said.textContent).not.toContain('**')
    const link = within(said).getByRole('link', { name: 'the page' })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    // The window never navigates: the link leaves through main, to the browser.
    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('shell.openExternal', { url: 'https://example.com/page' }))
  })

  it('renders a code block, a heading and a table of a message', () => {
    const text = ['## Today', '', '```', 'pnpm test --run a-very-long-line-of-code-that-is-wider-than-the-panel', '```', '', '| Project | Waits |', '| --- | --- |', '| shop-api | 2 |'].join('\n')
    const said = within(chat(message('m1', text))).getByTestId('assistant-message')
    expect(said.querySelector('h2')?.textContent).toBe('Today')
    expect(said.querySelector('pre > code')?.textContent).toContain('a-very-long-line-of-code')
    expect(said.querySelector('table td')?.textContent).toBe('shop-api')
  })

  it('keeps raw <img onerror> and <script> of a message inert: shown as text, never run', () => {
    const text = ['Before <img src="x" onerror="globalThis.pwned = 1"> after.', '', '<script>globalThis.pwned = 2</script>'].join('\n')
    const said = within(chat(message('m1', text))).getByTestId('assistant-message')
    expect(said.querySelector('img')).toBeNull()
    expect(said.querySelector('script')).toBeNull()
    expect(said.querySelector('[onerror]')).toBeNull()
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined()
    expect(said.textContent).toContain('<img src="x" onerror="globalThis.pwned = 1">')
  })

  it('keeps outside text the Assistant quotes from a source from acting on its own: raw markup is text, no image is fetched, javascript: and file: links do nothing', () => {
    // What a Slack message may carry into the Assistant's answer when it quotes it (outside-text JSON, worfy-assistant 09).
    const quoted = [
      'Teammate A wrote in #shop-api:',
      '',
      '> <a href="https://evil.example/steal">Approve</a> <img src=x onerror="globalThis.pwned = 3">',
      '> ![tracker](https://tracker.example/pixel.png) [Open settings](javascript:globalThis.pwned=4) [file](file:///etc/passwd)',
    ].join('\n')
    const said = within(chat(message('m1', quoted))).getByTestId('assistant-message')
    expect(said.querySelector('blockquote')).not.toBeNull()
    expect(said.querySelector('img')).toBeNull()
    expect(said.querySelector('[onerror]')).toBeNull()
    expect(said.querySelector('a[href^="https://evil"]')).toBeNull()
    expect(said.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(said.querySelector('a[href^="file:"]')).toBeNull()
    expect(within(said).queryByRole('link')).toBeNull()
    // The raw tag reads as text; the tracking image is its alt text, never loaded.
    expect(said.textContent).toContain('<a href="https://evil.example/steal">')
    expect(said.textContent).toContain('tracker')
    fireEvent.click(within(said).getByText('Open settings'))
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined()
    expect(ipc.invoke).not.toHaveBeenCalledWith('shell.openExternal', expect.anything())
  })

  it('shows the real host next to a quoted link whose text names another address (review round 1)', async () => {
    const quoted = ['> Please look: [https://jira.example/SHOP-12](https://evil.example/steal)', '>', '> or [Approve][2]', '', '[2]: https://evil.example/ref'].join('\n')
    const said = within(chat(message('m1', quoted))).getByTestId('assistant-message')
    const disguised = within(said).getByRole('link', { name: 'https://jira.example/SHOP-12' })
    expect(disguised.nextElementSibling?.className).toBe('w-md__link-host')
    expect(disguised.nextElementSibling?.textContent).toBe('(evil.example)')
    const approve = within(said).getByRole('link', { name: 'Approve' })
    expect(approve.nextElementSibling?.textContent).toBe('(evil.example)')
    // An http(s) link of a quote still opens, in the browser: the host beside it says where.
    fireEvent.click(approve)
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('shell.openExternal', { url: 'https://evil.example/ref' }))
  })

  it('shows no extra host for a link whose text is its own address', () => {
    const text = ['[https://example.com/page](https://example.com/page) and https://example.com/bare and [example.com/x](https://example.com/x)'].join('\n')
    const said = within(chat(message('m1', text))).getByTestId('assistant-message')
    expect(within(said).getAllByRole('link')).toHaveLength(3)
    expect(said.querySelector('.w-md__link-host')).toBeNull()
  })

  it('shows a file link of a message, which names no Project, as inert text, not a link', () => {
    const said = within(chat(message('m1', 'Read [rel](foo.md), [disk](/etc/passwd) and [win](C:\\work\\f.md).'))).getByTestId('assistant-message')
    expect(within(said).queryByRole('link')).toBeNull()
    expect([...said.querySelectorAll('.w-md__inert-link')].map((each) => each.textContent)).toEqual(['rel', 'disk', 'win'])
    fireEvent.click(within(said).getByText('rel'))
    expect(ipc.invoke).not.toHaveBeenCalledWith('shell.openInEditor', expect.anything())
  })

  it('keeps the user’s own message plain text, as the Session view does', () => {
    const mine = within(chat(message('m1', '**not bold** and `not code`', 'you', 'user'))).getByText('**not bold** and `not code`')
    expect(mine.querySelector('strong')).toBeNull()
    expect(mine.querySelector('code')).toBeNull()
  })

  it('renders the morning summary of the Summary tab with the same renderer', () => {
    useAssistant.setState({ tab: 'summary' })
    const summary = { ...view().summary, morning: { at: NOW, text: '**Main thing:** run `open`.\n\n- one\n- two' } }
    render(<AssistantPanel view={view({ summary })} />)
    const tab = screen.getByTestId('assistant-summary')
    expect(tab.querySelector('.w-md strong')?.textContent).toBe('Main thing:')
    expect(tab.querySelector('.w-md code')?.textContent).toBe('open')
    expect(tab.querySelectorAll('.w-md li')).toHaveLength(2)
  })

  it('styles the message text for the narrow panel: no pre-wrap gaps, code and tables scroll inside the bubble', () => {
    const sheet = readFileSync(join(import.meta.dirname, '../../src/renderer/assistant/assistant.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const rules = (selector: string): string => {
      const bodies = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/gu)].filter((match) => match[1]!.split(',').some((each) => each.trim() === selector)).map((match) => match[2]!)
      expect(bodies.length, selector).toBeGreaterThan(0)
      return bodies.join(';')
    }
    expect(rules('.w-asst-md')).toMatch(/white-space\s*:\s*normal/u)
    expect(rules('.w-asst-md .w-md pre')).toMatch(/overflow-x\s*:\s*auto/u)
    expect(rules('.w-asst-md .w-md pre')).toMatch(/max-width\s*:\s*100%/u)
    expect(rules('.w-asst-md .w-md table')).toMatch(/overflow-x\s*:\s*auto/u)
    expect(rules('.w-asst-md .w-md table')).toMatch(/display\s*:\s*block/u)
    expect(rules('.w-asst-bubble')).toMatch(/min-width\s*:\s*0/u)
    // In the column of the bubble and its time (worfy-polish 171), 100% without border-box adds the padding and border on
    // top, and a wide code block pushes the bubble past the panel. jsdom lays nothing out, so the rule itself is pinned.
    expect(rules('.w-asst-bubble')).toMatch(/box-sizing\s*:\s*border-box/u)
    expect(rules('.w-asst-said')).toMatch(/min-width\s*:\s*0/u)
  })
})

describe('the Chat tab with a scroll that returns a value (worfy-polish ticket 165)', () => {
  const message = (id: string) => ({ id, at: NOW, who: 'assistant' as const, text: `Message ${id}`, state: 'done' as const, reason: 'user' as const, rating: null })

  it('a new message and a switch to another tab leave Chat without an error, when scrollIntoView returns a Promise', async () => {
    // Chromium of Electron 44 may answer scrollIntoView with a Promise; jsdom has no scrollIntoView at all. React 19
    // keeps whatever an effect returns and calls it on unmount: a returned Promise threw «destroy_ is not a function».
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: () => Promise.resolve() })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      useAssistant.setState({ tab: 'chat' })
      const { rerender } = render(<AssistantPanel view={view({ conversation: [message('m1')] })} />)
      await act(async () => rerender(<AssistantPanel view={view({ conversation: [message('m1'), message('m2')] })} />))
      // The new message re-runs the scroll: React first calls what the last run returned.
      expect(screen.queryByText(/failed to render/u)).toBeNull()
      expect(screen.getByTestId('assistant-chat')).toBeTruthy()
      fireEvent.click(screen.getByRole('tab', { name: 'Journal' }))
      await act(async () => undefined)
      expect(screen.queryByText(/failed to render/u)).toBeNull()
      expect(screen.queryByTestId('assistant-chat')).toBeNull()
      expect(screen.getByRole('tab', { name: 'Journal' }).getAttribute('aria-selected')).toBe('true')
      expect(errors.mock.calls.flat().map(String).join('\n')).not.toMatch(/is not a function/u)
    } finally {
      if (original === undefined) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      else Object.defineProperty(Element.prototype, 'scrollIntoView', original)
    }
  })
})

describe('the time of each message in Chat (worfy-polish ticket 171)', () => {
  // Local times, so the expected clock does not depend on the time zone the tests run in.
  const TODAY = new Date(2026, 10, 25, 18, 0).getTime()
  const ASKED = new Date(2026, 10, 25, 16, 7, 9).getTime()
  const ANSWERED = new Date(2026, 10, 25, 16, 9, 41).getTime()
  const message = (id: string, at: number, who: 'you' | 'assistant', state: 'done' | 'pending' | 'failed' = 'done') => ({ id, at, who, text: `Message ${id}`, state, reason: 'user' as const, rating: null })
  const chat = (...conversation: ReturnType<typeof message>[]) => {
    useAssistant.setState({ tab: 'chat' })
    render(<AssistantPanel view={view({ conversation })} />)
  }
  const yours = (): HTMLElement => screen.getByTestId('assistant-your-message')
  const answer = (): HTMLElement => screen.getByTestId('assistant-message')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the time of the user’s message and of the answer in 24 h, with no date for today', () => {
    chat(message('m1', ASKED, 'you'), message('m2', ANSWERED, 'assistant'))
    expect(within(yours()).getByTestId('transcript-clock').textContent).toBe('16:07')
    expect(within(answer()).getByTestId('transcript-clock').textContent).toBe('16:09')
    expect(within(yours()).queryByTestId('transcript-date')).toBeNull()
    expect(within(answer()).queryByTestId('transcript-date')).toBeNull()
  })

  it('gives the full time with seconds in the tooltip', () => {
    chat(message('m1', ASKED, 'you'), message('m2', ANSWERED, 'assistant'))
    expect(within(yours()).getByTestId('transcript-time').getAttribute('title')).toBe('2026-11-25 16:07:09')
    expect(within(answer()).getByTestId('transcript-time').getAttribute('title')).toBe('2026-11-25 16:09:41')
  })

  it('puts the date before the time of a message of another day', () => {
    chat(message('m1', new Date(2026, 10, 23, 8, 5).getTime(), 'you'), message('m2', new Date(2025, 11, 31, 23, 5).getTime(), 'assistant'))
    expect(within(yours()).getByTestId('transcript-date').textContent).toBe('Nov 23')
    expect(within(yours()).getByTestId('transcript-clock').textContent).toBe('08:05')
    expect(within(answer()).getByTestId('transcript-date').textContent).toBe("Dec 31 '25")
    expect(within(answer()).getByTestId('transcript-clock').textContent).toBe('23:05')
  })

  it('shows no time while the answer is being written, and the time of an answer that failed', () => {
    chat(message('m1', ASKED, 'assistant', 'pending'))
    expect(within(answer()).queryByTestId('transcript-time')).toBeNull()
    cleanup()
    chat(message('m1', ANSWERED, 'assistant', 'failed'))
    expect(within(answer()).getByTestId('transcript-clock').textContent).toBe('16:09')
  })
})
