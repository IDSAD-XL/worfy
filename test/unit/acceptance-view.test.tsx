// The Acceptance view (worfy-acceptance ticket 05, src/renderer/acceptance/AcceptanceView.tsx) over a queue in the
// shape main sends it (`acceptance.get`, src/shared/ipc/acceptance.ts), main a fake preload bridge:
// - the groups that hold a row, in the spec's order, each with its count; In work and Older closed until opened;
// - the tab: the count of Ready to check, the tooltip, pressable without an open Project;
// - ↑ and ↓ move along the shown rows, a click selects one;
// - the item pane: the Stable copy line of each kind as the spec draws it (in; out with Update worfy, `main` waits for
//   a green CI, this copy does not check for updates, the update's commit not here; not checked; merged #N);
// - the decision: Fail without a comment is inactive with the reason; while Autopilot runs both are inactive with
//   main's reason; Pass sends `actions.ownerCheck` with the item's text as shown and selects the next row, and the
//   item reads "Sent" with both buttons inactive until main answers and after; a refusal of main shows under them;
// - "Sent · waits for the line" and "Not recorded yet" with Send again from main's mark;
// - Waits for you: the Blocked reason, Open Ticket and Open Orchestrator, no Pass and Fail.
// On a Linked machine (worfy-acceptance ticket 07): in a window on the PC the queue and the decision go to the PC; read
// only — Pass and Fail inactive with the read-only hint; the decision names the PC's platform and the commit of its
// build; in this Machine's window an item for Windows shows the PC's build, or "PC not connected"; a worfy on the PC
// without the view is told to be updated; the Stable copy line there offers no Update of this Machine.
// Every Project, Epic and text is invented.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptanceGroupName, AcceptanceItemRow, AcceptanceRow, AcceptanceStable, AcceptanceState } from '../../src/shared/ipc/acceptance'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { EvidenceItem } from '../../src/shared/workflow/types'
import { ms } from '../time-scale'
import { VIEW_BUTTON_IDS } from '../../src/shared/layout/view-buttons'
// The registry's six buttons all in the header (worfy-layout ticket 04 puts them in three zones; test/unit/view-zones.test.tsx).
const ALL_IN_HEADER = { header: [...VIEW_BUTTON_IDS], rail: [], footer: [] }

const DEMO = 'demo-0000000d'
const PROJECTS: ProjectsState = { projects: [{ id: DEMO, name: 'demo', path: '/projects/demo', branch: 'main' }], activeId: null, revision: 1 }

const evidenceItem = (index: number, text: string, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  index,
  text,
  checked: false,
  manual: true,
  needs: { platform: 'mac', copy: 'stable' },
  evidence: [],
  errors: [],
  line: 10 + index,
  state: 'not-verified',
  reason: 'no evidence',
  ...over,
})

const ticket = (num: number, over: Partial<AcceptanceItemRow['ticket']> = {}): AcceptanceItemRow['ticket'] => ({
  projectId: DEMO,
  projectName: 'demo',
  epic: 'shop',
  num,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  state: 'done',
  pr: null,
  blockedReason: null,
  ...over,
})

const item = (num: number, index: number, text: string, over: Partial<AcceptanceItemRow> = {}): AcceptanceItemRow => ({
  kind: 'item',
  ticket: ticket(num),
  item: evidenceItem(index, text),
  prepared: [],
  sent: null,
  stable: null,
  ...over,
})

const IN: AcceptanceStable = { state: 'in', text: 'In your Stable copy 0.4.2101 — the change is there since 0.4.2093', update: null }
const out = (update: AcceptanceStable['update']): AcceptanceStable => ({ state: 'out', text: 'Not in your Stable copy yet: it runs 0.4.2101, the change is in 0.4.2110', update })

const ROWS = {
  cart: item(3, 2, '(manual) Add an item to the cart → the badge shows 1', {
    stable: IN,
    ticket: ticket(3, { pr: 40 }),
    prepared: [evidenceItem(1, 'Unit test of the cart', { manual: false, state: 'verified', reason: null }), evidenceItem(3, 'Write the result', { manual: false })],
  }),
  search: item(4, 1, 'Search finds a product by its code', { stable: { state: 'merged', text: 'merged #41', update: null } }),
  checkout: item(5, 1, 'Pay with a test card', { stable: out('available') }),
  colour: { kind: 'ticket', ticket: ticket(6, { state: 'blocked', blockedReason: 'Choose the colour of the button' }) } as AcceptanceRow,
  refund: item(7, 1, 'Refund the order', { item: evidenceItem(1, 'Refund the order', { state: 'failed', evidence: [{ kind: 'owner-check', verdict: 'fail', ref: '2026-11-20: the total stays', platform: 'mac', copy: 'stable', sha: 'abcdef1', scrub: null, line: 12 }] }) }),
  wishlist: item(8, 1, 'Save to the wishlist', { ticket: ticket(8, { state: 'work' }) }),
  login: item(1, 1, 'Sign in with a code', { ticket: ticket(1) }),
}

function queue(rows: Partial<Record<AcceptanceGroupName, AcceptanceRow[]>>): AcceptanceState {
  const order: AcceptanceGroupName[] = ['ready', 'update', 'waits', 'failed', 'work', 'older']
  return { groups: order.map((group) => ({ group, rows: rows[group] ?? [] })) }
}

/** The model's Ticket 03: three checkbox items, of which the cart is the second. */
const MODEL_TICKETS = [{ epic: 'shop', num: 3, slug: 'ticket-3', title: '03 — Ticket 3', evidence: [evidenceItem(1, 'a', { manual: false }), evidenceItem(2, 'b'), evidenceItem(3, 'c', { manual: false })] }]

const FULL = queue({ ready: [ROWS.cart, ROWS.search], update: [ROWS.checkout], waits: [ROWS.colour], failed: [ROWS.refund], work: [ROWS.wishlist], older: [ROWS.login] })

/** The link state as main sends it, with the Linked machines `linked` (only what the view reads matters here). */
function linkState(linked: { id: string; name: string }[]): unknown {
  return { revision: 1, machine: null, problem: null, listening: false, addresses: [], bonjour: false, linking: { open: false, code: null, expiresAt: null, linked: null, failure: null }, linked: linked.map((machine) => ({ ...machine, state: 'online', certificateChanged: false, access: 'off' })), discovered: [] }
}

type Answers = Record<string, (input: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>>

interface FakeMain {
  /** `machine`: the Linked machine a window on it called through `linked.invoke`. */
  calls: { channel: string; input: unknown; machine?: string }[]
  emit: (channel: string, payload: unknown) => void
}

let main: FakeMain

function preload(state: AcceptanceState, answers: Answers = {}): void {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 0
  const fake: FakeMain = {
    calls: [],
    emit: (channel, payload) => {
      for (const each of handlers.values()) if (each.channel === channel) each.handler(payload)
    },
  }
  const answer = (channel: string, input: unknown): IpcResult<unknown> | Promise<IpcResult<unknown>> => {
    const own = answers[channel]
    if (own !== undefined) return own(input)
    switch (channel) {
      case 'acceptance.get':
        return { ok: true, value: state }
      case 'projects.list':
        return { ok: true, value: PROJECTS }
      case 'autopilot.state':
        return { ok: true, value: { projectId: (input as { projectId: string }).projectId, revision: 1, status: 'stopped' } }
      case 'checks.repos':
        return { ok: true, value: { mode: 'full', repos: [] } }
      case 'workflow.open':
        return { ok: true, value: { root: (input as { root: string }).root, epics: [], tickets: MODEL_TICKETS, error: null, branchErrors: [], repoUrl: 'https://github.com/example/shop' } }
      case 'tickets.read':
        return { ok: true, value: { path: '/projects/demo/.scratch/shop/issues/03-ticket-3.md', relative: '.scratch/shop/issues/03-ticket-3.md', text: '' } }
      case 'update.state':
        return { ok: true, value: { enabled: false, checking: false, available: null, running: null, build: { phase: 'idle' } } }
      case 'actions.ownerCheck':
        return { ok: true, value: { sessionId: 's-1', text: '/worfy:owner-check', delivery: 'sent' } }
      // A window on a Linked machine: `linked.invoke` is answered by the bridge itself, with the Machine it calls.
      case 'linked.state':
        return { ok: true, value: { revision: 1, machines: [{ id: LINKED, online: true, sharing: 'yes', readOnly: false, epoch: 1 }] } }
      case 'link.state':
        return { ok: true, value: linkState([]) }
      default:
        return { ok: true, value: null }
    }
  }
  const bridge: WorfyBridge = {
    invoke: async (channel, input) => {
      // A window on a Linked machine calls its channels through this Machine's main (src/renderer/ipc.ts, machineBridge).
      if (channel === 'linked.invoke') {
        const call = input as { machine: string; channel: string; input: unknown }
        fake.calls.push({ channel: call.channel, input: call.input, machine: call.machine })
        return { ok: true, value: await answer(call.channel, call.input) }
      }
      fake.calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: (channel, handler) => {
      next += 1
      handlers.set(next, { channel, handler: handler as (payload: unknown) => void })
      return next
    },
    off: (id) => {
      handlers.delete(id)
    },
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

// The first import of the view and the toolbar transforms their whole module graph (about 5 s alone, past the 15 s
// test timeout when the whole suite runs at once): it is paid here, with its own timeout, not in the first test.
beforeAll(async () => {
  await import('../../src/renderer/acceptance/AcceptanceView')
  await import('../../src/renderer/shell/Toolbar')
}, ms(120_000))

beforeEach(() => {
  // The queue's store lives in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  window.history.replaceState(null, '', '/')
})

async function view(state: AcceptanceState, answers: Answers = {}, shown = true): Promise<void> {
  preload(state, answers)
  // The shell keeps every view mounted; the Acceptance view is the one on screen unless a test says otherwise.
  if (shown) (await import('../../src/renderer/session/navigation')).setView('acceptance')
  const { AcceptanceView } = await import('../../src/renderer/acceptance/AcceptanceView')
  render(<AcceptanceView />)
  await screen.findAllByTestId('acceptance-group')
}

/** The Linked machine a window of the review-round-2 test shows. */
const LINKED = 'machine-pc'

const textOf = (element: Element | null | undefined): string => element?.textContent ?? ''
const attrOf = (element: Element | null | undefined, name: string): string | null => element?.getAttribute(name) ?? null
const titles = (): string[] => screen.getAllByTestId('acceptance-group-title').map((each) => each.textContent ?? '')
const shown = (): string[] => screen.queryAllByTestId('acceptance-row').map((each) => each.dataset.key ?? '')
const key = (num: number, index?: number): string => `${DEMO}\nshop\n${num}${index === undefined ? '' : `\n${index}`}`
const pane = (): HTMLElement => screen.getByTestId('acceptance-pane')
const ownerChecks = () => main.calls.filter((call) => call.channel === 'actions.ownerCheck').map((call) => call.input)

describe('the groups of the queue', () => {
  it('shows the groups that hold a row in the spec order with their counts; In work and Older stay closed until opened', async () => {
    await view(FULL)
    expect(titles().map((text) => text.replace(/^[▸▾]\s*/, ''))).toEqual(['Ready to check · 2', 'Update first · 1', 'Waits for you · 1', 'Failed · 1', 'In work · 1', 'Older · 1'])
    expect(shown()).toEqual([key(3, 2), key(4, 1), key(5, 1), key(6), key(7, 1)])
    fireEvent.click(screen.getByRole('button', { name: /In work · 1/ }))
    expect(shown()).toContain(key(8, 1))
    expect(shown()).not.toContain(key(1, 1))
    // The Failed row says the words of its last fail line.
    expect(textOf(screen.getAllByTestId('acceptance-row')[4])).toContain('2026-11-20: the total stays')
  })

  it('selects the first row of Ready to check by itself; a click and ↑ ↓ move the selection and stop at the ends', async () => {
    await view(FULL)
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(4, 1)))
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    fireEvent.click(screen.getAllByTestId('acceptance-row')[2]!)
    await waitFor(() => expect(pane().dataset.key).toBe(key(5, 1)))
    // A key in the comment field is the field's.
    fireEvent.keyDown(screen.getByTestId('acceptance-words'), { key: 'ArrowDown' })
    expect(pane().dataset.key).toBe(key(5, 1))
  })

  it('the toolbar tab: Acceptance with the count of Ready to check and its tooltip, pressable without a Project', async () => {
    preload(FULL)
    const { ToolbarView } = await import('../../src/renderer/shell/Toolbar')
    const onViewChange = vi.fn()
    render(<ToolbarView items={[]} view="canvas" onViewChange={onViewChange} sidebarVisible onToggleSidebar={() => {}} layout={ALL_IN_HEADER} />)
    const tab = screen.getByTestId('acceptance-tab')
    await waitFor(() => expect(textOf(within(tab).getByTestId('acceptance-tab-count'))).toContain('2'))
    expect(attrOf(tab, 'title')).toBe('Checks that wait for you')
    expect((tab as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(tab)
    expect(onViewChange).toHaveBeenCalledWith('acceptance')
  })
})

describe('the pane of an item', () => {
  it('shows the Ticket, the item, where to check it, the Stable copy line, the Evidence, what was prepared and the links', async () => {
    await view(FULL)
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    expect(textOf(pane())).toContain('demo · shop 03 — Ticket 3')
    expect(textOf(pane())).toContain('Item 2 of 3 · manual · needs mac stable')
    expect(textOf(screen.getByTestId('acceptance-stable'))).toContain(IN.text)
    // The manual mark the item starts with is left out: the line above says "manual".
    expect(textOf(screen.getByTestId('acceptance-text'))).toBe('Add an item to the cart → the badge shows 1')
    expect(textOf(within(pane()).getByTestId('evidence-matrix'))).toContain('Evidence · 0 of 1 verified')
    expect(textOf(screen.getByTestId('acceptance-prepared'))).toContain('Prepared by the Orchestrator · 1 of 2 verified')
    expect(textOf(screen.getByTestId('acceptance-open-ticket'))).toContain('Open Ticket')
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-open-pr'))).toContain('Open PR #40'))
    // A Full mode Project: the comment field says where the words go.
    await waitFor(() => expect(textOf(pane())).toContain('Your words go into the repository with the owner-check line'))
  })

  it.each([
    ['in', IN, IN.text, null],
    ['out, an update has it', out('available'), 'the change is in 0.4.2110', 'Update worfy'],
    ['out, main waits for CI', out('waits-ci'), '`main` waits for a green CI', null],
    ['out, a dev copy', out('no-update-check'), 'This copy does not check for updates: update from your Stable copy', null],
    ['out, the update not in this checkout', out('update-not-here'), "The update's commit is not in this checkout: fetch to check", null],
    ['not checked', { state: 'not-checked', text: 'Stable copy not checked: the merge is not in this checkout', update: null } as AcceptanceStable, 'Stable copy not checked', null],
    ['merged', { state: 'merged', text: 'merged #41', update: null } as AcceptanceStable, 'merged #41', null],
  ] as const)('the Stable copy line: %s', async (_name, stable, text, button) => {
    await view(queue({ ready: [item(3, 2, 'Check it', { stable })] }))
    const line = await screen.findByTestId('acceptance-stable')
    expect(attrOf(line, 'data-state')).toBe(stable.state)
    expect(textOf(line)).toContain(text)
    if (button === null) expect(within(line).queryByRole('button')).toBeNull()
    else expect(within(line).getByRole('button', { name: button })).toBeTruthy()
  })
})

describe('the decision', () => {
  it('Fail is inactive without a comment, with the reason; Pass is not', async () => {
    await view(FULL)
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    const fail = screen.getByTestId('acceptance-fail')
    expect(attrOf(fail, 'aria-disabled')).toBe('true')
    expect(attrOf(fail, 'title')).toBe('Write what is wrong: Fail needs a comment')
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('false')
    fireEvent.click(fail)
    expect(ownerChecks()).toEqual([])
    fireEvent.change(screen.getByTestId('acceptance-words'), { target: { value: '   ' } })
    expect(attrOf(fail, 'aria-disabled')).toBe('true')
    fireEvent.change(screen.getByTestId('acceptance-words'), { target: { value: 'The badge stays at 0' } })
    expect(attrOf(fail, 'aria-disabled')).toBe('false')
  })

  it('while Autopilot runs in the Project, Pass and Fail are inactive and say why', async () => {
    await view(FULL, { 'autopilot.state': (input) => ({ ok: true, value: { projectId: (input as { projectId: string }).projectId, revision: 2, status: 'running' } }) })
    const { OWNER_CHECK_AUTOPILOT_HINT } = await import('../../src/shared/actions/render-template')
    await waitFor(() => expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('true'))
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'title')).toBe(OWNER_CHECK_AUTOPILOT_HINT)
    expect(attrOf(screen.getByTestId('acceptance-fail'), 'title')).toBe(OWNER_CHECK_AUTOPILOT_HINT)
    expect(textOf(screen.getByTestId('acceptance-status'))).toContain(OWNER_CHECK_AUTOPILOT_HINT)
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    expect(ownerChecks()).toEqual([])
  })

  it('Pass sends actions.ownerCheck with the item as shown, keeps both buttons inactive while main answers, then selects the next row and reads Sent', async () => {
    let answer!: (result: IpcResult<unknown>) => void
    await view(FULL, { 'actions.ownerCheck': () => new Promise((resolve) => (answer = resolve)) })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    fireEvent.change(screen.getByTestId('acceptance-words'), { target: { value: 'Works' } })
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    expect(ownerChecks()).toEqual([{ projectId: DEMO, epic: 'shop', num: 3, item: 2, itemText: '(manual) Add an item to the cart → the badge shows 1', verdict: 'pass', platform: 'mac', copy: 'stable', sha: '-', words: 'Works' }])
    // A decision under way: no second one on the same item.
    await waitFor(() => expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('true'))
    expect(attrOf(screen.getByTestId('acceptance-fail'), 'aria-disabled')).toBe('true')
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    expect(ownerChecks()).toHaveLength(1)
    await act(async () => answer({ ok: true, value: { sessionId: 's-1', text: 't', delivery: 'queued' } }))
    await waitFor(() => expect(pane().dataset.key).toBe(key(4, 1)))
    expect(textOf(screen.getAllByTestId('acceptance-row')[0])).toContain('Sent')
    // Back on the item: Sent, both inactive, until main's mark or the line comes.
    fireEvent.click(screen.getAllByTestId('acceptance-row')[0]!)
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-status'))).toContain('Sent · waits for the line'))
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('true')
    expect(attrOf(screen.getByTestId('acceptance-fail'), 'aria-disabled')).toBe('true')
    // The line came: main's queue has the item no more, and the selection stays where it is.
    act(() => main.emit('acceptance.changed', queue({ ready: [ROWS.search], update: [ROWS.checkout] })))
    await waitFor(() => expect(shown()).toEqual([key(4, 1), key(5, 1)]))
    expect(pane().dataset.key).toBe(key(4, 1))
  })

  it('a refusal of main stays under the buttons: an item changed since the owner saw it', async () => {
    const reason = 'Item 2 of shop 03 has changed since you looked at it: reload the Acceptance view'
    await view(FULL, { 'actions.ownerCheck': () => ({ ok: false, error: `actions.ownerCheck failed: ${reason}` }) })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-status'))).toContain(reason))
    expect(pane().dataset.key).toBe(key(3, 2))
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('false')
  })

  it('main\'s Sent mark: "Sent · waits for the line" with both inactive; after 24 hours "Not recorded yet" and Send again', async () => {
    const at = '2026-11-20T10:00:00.000Z'
    await view(queue({ ready: [item(3, 2, 'Check it', { sent: { verdict: 'fail', at, state: 'sent' } }), item(4, 1, 'Check that', { sent: { verdict: 'pass', at, state: 'not-recorded' } })] }))
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-status'))).toContain('Sent · waits for the line'))
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('true')
    expect(attrOf(screen.getByTestId('acceptance-fail'), 'aria-disabled')).toBe('true')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-status'))).toContain('Not recorded yet'))
    expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('false')
    fireEvent.click(screen.getByTestId('acceptance-send-again'))
    await waitFor(() => expect(ownerChecks()).toEqual([expect.objectContaining({ num: 4, item: 1, verdict: 'pass', itemText: 'Check that' })]))
  })
})

describe('Waits for you', () => {
  it('shows the Blocked reason with Open Ticket and Open Orchestrator, and no Pass or Fail', async () => {
    await view(FULL)
    fireEvent.click(screen.getAllByTestId('acceptance-row')[3]!)
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-reason'))).toContain('Blocked reason: Choose the colour of the button'))
    expect(screen.getByTestId('acceptance-open-ticket')).toBeTruthy()
    expect(screen.getByTestId('acceptance-open-orchestrator')).toBeTruthy()
    expect(screen.queryByTestId('acceptance-pass')).toBeNull()
    expect(screen.queryByTestId('acceptance-fail')).toBeNull()
    expect(screen.queryByTestId('acceptance-decision')).toBeNull()
  })
})

describe('review round 1', () => {
  const opens = () => main.calls.filter((call) => call.channel === 'workflow.open').length

  it('↑ ↓ between two items of one Project open its model once; a hidden view opens none', async () => {
    await view(queue({ ready: [ROWS.cart, ROWS.search] }), {}, false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(opens()).toBe(0)
    const { setView } = await import('../../src/renderer/session/navigation')
    act(() => setView('acceptance'))
    await waitFor(() => expect(opens()).toBe(1))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(4, 1)))
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    expect(opens()).toBe(1)
  })

  it('a decision in the Stable copy carries the commit main names for it, not the last update check\'s', async () => {
    const stableCommit = 'abcdef1234567'
    await view({ ...queue({ ready: [ROWS.cart] }), stableCommit }, { 'update.state': () => ({ ok: true, value: { enabled: true, checking: false, available: null, running: { commit: 'ffffffffffffffffffffffffffffffffffffffff', version: '0.4.1' }, build: { phase: 'idle' } } }) })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    await waitFor(() => expect(ownerChecks()).toEqual([expect.objectContaining({ copy: 'stable', sha: stableCommit })]))
  })

  it('the keyboard focus follows the selection along the list', async () => {
    await view(FULL)
    const first = screen.getAllByTestId('acceptance-row')[0]!
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(5, 1)))
    expect((document.activeElement as HTMLElement).dataset.key).toBe(key(5, 1))
  })

  it('sendDecision twice before a render sends one decision', async () => {
    await view(queue({ ready: [ROWS.cart] }))
    const { sendDecision } = await import('../../src/renderer/acceptance/useAcceptance')
    const where = { platform: 'mac', copy: 'stable', sha: '-' } as const
    await act(async () => {
      await Promise.all([sendDecision(ROWS.cart, 'pass', where, ''), sendDecision(ROWS.cart, 'pass', where, '')])
    })
    expect(ownerChecks()).toHaveLength(1)
  })

  it('the pane says "Item N of M", M the checkbox items of the Ticket', async () => {
    await view(FULL)
    await waitFor(() => expect(textOf(pane())).toContain('Item 2 of 3 · manual · needs mac stable'))
  })

  it('the tab counts the items of Ready to check that are not Sent', async () => {
    const sent = { ...ROWS.cart, sent: { verdict: 'pass' as const, at: '2026-11-20T10:00:00.000Z', state: 'sent' as const } }
    preload(queue({ ready: [sent, ROWS.search] }))
    const { ToolbarView } = await import('../../src/renderer/shell/Toolbar')
    render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} layout={ALL_IN_HEADER} />)
    await waitFor(() => expect(textOf(screen.queryByTestId('acceptance-tab-count'))).toBe('1'))
  })

  it('the list row and the Evidence matrix show the item as text: no markdown markers, no manual mark', async () => {
    const bold = item(3, 2, '(manual) The badge shows **1** in `Cart`', { stable: IN })
    await view(queue({ ready: [bold] }))
    expect(textOf(screen.getAllByTestId('acceptance-row')[0])).toContain('The badge shows 1 in Cart')
    expect(textOf(screen.getAllByTestId('acceptance-row')[0])).not.toMatch(/\*\*|`|\(manual\)/)
    const shown = within(pane()).getByTestId('evidence-item')
    expect(textOf(shown)).toContain('The badge shows 1 in Cart')
    expect(textOf(shown)).not.toMatch(/\*\*|`|\(manual\)/)
  })
})

describe('review round 2', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('a window on a Linked machine sends sha "-": the Stable copy commit of its queue is that Machine\'s, not this computer\'s', async () => {
    window.history.replaceState(null, '', `/?machine=${LINKED}`)
    await view({ ...queue({ ready: [ROWS.cart] }), stableCommit: 'abcdef1234567' })
    await waitFor(() => expect(pane().dataset.key).toBe(key(3, 2)))
    await waitFor(() => expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('false'))
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    await waitFor(() => expect(ownerChecks()).toEqual([expect.objectContaining({ copy: 'stable', sha: '-' })]))
  })

  it('the tab counts an item in "Not recorded yet": the owner has to send it again', async () => {
    const at = '2026-11-20T10:00:00.000Z'
    const lost = { ...ROWS.cart, sent: { verdict: 'pass' as const, at, state: 'not-recorded' as const } }
    const sent = { ...ROWS.search, sent: { verdict: 'pass' as const, at, state: 'sent' as const } }
    preload(queue({ ready: [lost, sent] }))
    const { ToolbarView } = await import('../../src/renderer/shell/Toolbar')
    render(<ToolbarView items={[]} view="canvas" onViewChange={() => {}} sidebarVisible onToggleSidebar={() => {}} layout={ALL_IN_HEADER} />)
    await waitFor(() => expect(textOf(screen.queryByTestId('acceptance-tab-count'))).toBe('1'))
  })
})

describe('on a Linked machine (worfy-acceptance ticket 07)', () => {
  const PC = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'
  const BUILD = '0.4.2101+3f2a1b9c'
  const WINDOWS_ITEM = item(9, 1, '(manual) Open the Acceptance tab on the PC → the queue shows', { item: evidenceItem(1, '(manual) Open the Acceptance tab on the PC → the queue shows', { needs: { platform: 'windows', copy: 'stable' } }), ticket: ticket(9) })
  /** What main knows of the PC: online or not, read-only or not, the build and platform of its `hello`. */
  const pc = (over: Record<string, unknown> = {}) => ({ id: PC, online: true, sharing: 'yes', readOnly: false, epoch: 1, build: BUILD, platform: 'windows', ...over })
  const onPc = (over: Record<string, unknown> = {}): Answers => ({
    'linked.state': () => ({ ok: true, value: { revision: 2, machines: [pc(over)] } }),
    'link.state': () => ({ ok: true, value: linkState([{ id: PC, name: 'Studio PC' }]) }),
  })
  const windowOnPc = (): void => window.history.replaceState(null, '', `/?machine=${PC}`)

  it("a window on the PC with read-only access: the PC's queue, and Pass and Fail inactive with the read-only hint", async () => {
    windowOnPc()
    await view(queue({ ready: [WINDOWS_ITEM] }), onPc({ readOnly: true }))
    expect(main.calls.find((call) => call.channel === 'acceptance.get')?.machine).toBe(PC)
    await waitFor(() => expect(attrOf(screen.getByTestId('acceptance-pass'), 'title')).toBe('Studio PC gives this Machine read-only access'))
    for (const verdict of ['pass', 'fail']) expect(attrOf(screen.getByTestId(`acceptance-${verdict}`), 'aria-disabled')).toBe('true')
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    expect(ownerChecks()).toEqual([])
  })

  it("a window on the PC with full access: the decision goes to the PC with its platform and the commit of its build, not this Machine's Stable copy", async () => {
    windowOnPc()
    await view({ ...queue({ ready: [WINDOWS_ITEM] }), stableCommit: 'abcdef1234567' }, onPc())
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-platform'))).toContain('windows'))
    expect(textOf(screen.getByTestId('acceptance-decision'))).toContain(BUILD)
    // The item names the PC's build too: it is checked on the window's Machine.
    expect(textOf(screen.getByTestId('acceptance-linked-build'))).toBe(`PC build: ${BUILD} (Studio PC)`)
    await waitFor(() => expect(attrOf(screen.getByTestId('acceptance-pass'), 'aria-disabled')).toBe('false'))
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'actions.ownerCheck')).toHaveLength(1))
    const sent = main.calls.find((call) => call.channel === 'actions.ownerCheck')!
    expect(sent.machine).toBe(PC)
    expect(sent.input).toMatchObject({ projectId: DEMO, epic: 'shop', num: 9, item: 1, verdict: 'pass', platform: 'windows', copy: 'stable', sha: '3f2a1b9c' })
  })

  it("a window on the PC, the platform set to this computer's: the snapshot's Stable copy commit is the PC's, so `-`", async () => {
    windowOnPc()
    await view({ ...queue({ ready: [WINDOWS_ITEM] }), stableCommit: 'abcdef1234567' }, onPc())
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-platform'))).toContain('windows'))
    const { currentPlatform } = await import('../../src/renderer/platform')
    fireEvent.click(screen.getByTestId('acceptance-platform'))
    fireEvent.click(await screen.findByRole('option', { name: currentPlatform() }))
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-platform'))).toContain(currentPlatform()))
    fireEvent.click(screen.getByTestId('acceptance-pass'))
    await waitFor(() => expect(ownerChecks()).toEqual([expect.objectContaining({ platform: currentPlatform(), copy: 'stable', sha: '-' })]))
  })

  it("this Machine's window: an item for Windows shows the PC's build while it is online, else \"PC not connected\"", async () => {
    await view(queue({ ready: [WINDOWS_ITEM] }), onPc())
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-linked-build'))).toBe(`PC build: ${BUILD} (Studio PC)`))
    expect(attrOf(screen.getByTestId('acceptance-linked-build'), 'data-state')).toBe('online')
    act(() => main.emit('linked.changed', { revision: 3, machines: [pc({ online: false, build: undefined, platform: undefined })] }))
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-linked-build'))).toBe('PC not connected'))
    // The queue itself is this Machine's.
    expect(main.calls.find((call) => call.channel === 'acceptance.get')?.machine).toBeUndefined()
  })

  it('a worfy on the PC without the Acceptance view: the view says to update worfy there', async () => {
    windowOnPc()
    preload(queue({}), { ...onPc(), 'acceptance.get': () => ({ ok: false, error: 'acceptance.get: not open to Linked machines' }) })
    const { AcceptanceView } = await import('../../src/renderer/acceptance/AcceptanceView')
    render(<AcceptanceView />)
    expect(await screen.findByText('Update worfy on Studio PC: its worfy has no Acceptance view yet')).toBeTruthy()
  })

  it("the Stable copy line in a window on the PC offers no Update of this Machine: it says to update worfy there", async () => {
    windowOnPc()
    await view(queue({ update: [{ ...WINDOWS_ITEM, stable: out('available') }] }), onPc())
    await waitFor(() => expect(textOf(screen.getByTestId('acceptance-stable'))).toContain('Update worfy on Studio PC'))
    expect(screen.queryByTestId('acceptance-update')).toBeNull()
  })
})
