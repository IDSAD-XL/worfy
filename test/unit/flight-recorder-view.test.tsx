// The Run history screen (src/renderer/flight-recorder/; worfy-flight-recorder ticket 18): the header of the
// night Run (Epic, duration, stop reason, the Tickets by outcome, retries, who started it), the three cards of
// the summary and the span a click selects, the `#N` of a retry on its bar and in its row, the block mark «!»
// with `Waits:`, a cut-off span, the label of a lost source, the thin bars of a collapsed row's children, the
// labels that cross no bar of their row, and the live timeline that follows `runs.changed`.
//
// The night Run is test/fixtures/flight-recorder/night-run-view.json: what the service answers for the
// night-Run fixture (test/contract/flight-recorder-night-view.test.ts keeps it so). The other Runs are built
// here from facts with the span model. Main is a fake bridge.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeline, type RunFacts } from '../../src/shared/flight-recorder/spans'
import { summarize, WITHOUT_WORK_NOTE } from '../../src/shared/flight-recorder/summary'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { runViewSchema, type RunListItem, type RunView } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { openRunHistory } from '../../src/renderer/flight-recorder/open'
import { RunHistoryView } from '../../src/renderer/flight-recorder/RunHistoryView'
import { formatDuration, holdsRun, resetRunHistory, setTimeWindow, useRunHistory } from '../../src/renderer/flight-recorder/store'
import { setView, useNavigation } from '../../src/renderer/session/navigation'

const NIGHT: RunView = runViewSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/flight-recorder/night-run-view.json'), 'utf8')))
const NIGHT_ITEM: RunListItem = { run: NIGHT.run, epic: 'worfy-pipeline', startedAt: '2026-10-17T22:29:32.707Z', stoppedAt: '2026-10-18T03:17:34.592Z', reason: 'blocked-tickets', live: false, tickets: [], by: 'button' }

const T = (hhmm: string): string => `2026-10-20T${hhmm}:00.000Z`
const SMALL_RUN = '2026-10-20T10-00-00-000Z-aaaaaa'

/** A small Run of Epic `e`: Ticket 01 blocked at 10:30 waiting for the owner, Ticket 02 with an implementer sent back once. */
function smallFacts(over: Partial<RunFacts> = {}): RunFacts {
  return {
    run: { id: SMALL_RUN, startedAt: T('10:00'), stoppedAt: T('12:00'), live: false, outcome: 'blocked', reason: 'blocked-tickets' },
    now: T('12:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('12:00'), tickets: ['e/01', 'e/02'] }],
    ticketEvents: [
      { ticket: 'e/01', at: T('10:01'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/01', at: T('10:30'), source: 'journal', event: 'status', state: 'blocked', reason: 'Needs the owner', waits: 'an answer on the API key' },
      { ticket: 'e/02', at: T('10:01'), source: 'journal', event: 'status', state: 'claimed' },
    ],
    work: [
      { id: 'a-1', kind: 'agent', ticket: 'e/02', name: 'impl-02', agentType: 'worfy:implementer', start: T('10:02'), end: T('10:40'), startSource: 'transcript' },
      { id: 'a-2', kind: 'agent', ticket: 'e/02', name: 'impl-02', agentType: 'worfy:implementer', start: T('10:50'), end: T('11:40'), retryOf: { kind: 'agent', id: 'a-1' }, startSource: 'transcript' },
    ],
    retryCauses: [],
    waits: [{ id: 'w-1', cause: 'background-tasks', start: T('10:40'), end: T('10:50'), startSource: 'journal' }],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

function viewOf(facts: RunFacts, run = SMALL_RUN): RunView {
  const timeline = buildTimeline(facts)
  return { projectId: 'p-1', run, epic: 'e', timeline, summary: summarize(timeline), github: { state: 'unused', reason: 'test' }, profileReason: null, skippedLines: 0, error: null }
}

const smallItem = (over: Partial<RunListItem> = {}): RunListItem => ({ run: SMALL_RUN, epic: 'e', startedAt: T('10:00'), stoppedAt: T('12:00'), reason: 'blocked-tickets', live: false, tickets: ['e/01', 'e/02'], by: null, ...over })

/** Main as a fake bridge: answers runs.list and runs.open from `views`, keeps the calls, and sends events. */
function fakeMain(projectId: string, items: RunListItem[], views: Record<string, RunView>) {
  const calls: string[] = []
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const ids = new Map<number, () => void>()
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      const { run } = (input ?? {}) as { run?: string }
      calls.push(`${channel}${run === undefined ? '' : ` ${run}`}`)
      if (channel === 'runs.list') return Promise.resolve({ ok: true, value: { runs: items } })
      if (channel === 'runs.open') return Promise.resolve(run !== undefined && views[run] !== undefined ? { ok: true, value: views[run] } : { ok: false, error: `no Run ${run}` })
      if (channel === 'runs.close') return Promise.resolve({ ok: true, value: { closed: true } })
      return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
    },
    on: (channel, handler) => {
      const set = handlers.get(channel) ?? new Set()
      handlers.set(channel, set)
      set.add(handler)
      const id = ids.size + 1
      ids.set(id, () => set.delete(handler))
      return id
    },
    off: (id) => ids.get(id)?.(),
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return {
    calls,
    projectId,
    send: (channel: string, payload: unknown) => {
      for (const handler of handlers.get(channel) ?? []) handler(payload)
    },
  }
}

async function show(projectId: string, items: RunListItem[], views: Record<string, RunView>, run?: string) {
  const main = fakeMain(projectId, items, views)
  render(<RunHistoryView />)
  await act(() => openRunHistory(projectId, run))
  return main
}

const rowOf = (id: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
  if (row === null) throw new Error(`no row ${id}`)
  return row
}
const px = (value: string): number => Number.parseFloat(value)

/** Every label drawn crosses no bar of its row but its own, and no other label. */
function expectLabelsClear(): void {
  for (const row of document.querySelectorAll<HTMLElement>('[data-testid="run-history-row"]')) {
    const bars = [...row.querySelectorAll<HTMLElement>('[data-testid="run-history-bar"]')].filter((bar) => !bar.className.includes('w-fr-bar--thin'))
    const labels = [...row.querySelectorAll<HTMLElement>('[data-testid="run-history-label"]')]
    for (const label of labels) {
      const [l0, l1] = [px(label.style.left), px(label.style.left) + px(label.style.width)]
      const over = (label.dataset.over ?? '').split(' ')
      for (const bar of bars) {
        if (bar.dataset.barKey === label.dataset.labelFor || over.includes(bar.dataset.barKey ?? '')) continue
        const [b0, b1] = [px(bar.style.left), px(bar.style.left) + px(bar.style.width)]
        expect(l0 < b1 && l1 > b0, `${row.dataset.rowId}: the label of ${label.dataset.labelFor} crosses ${bar.dataset.barKey}`).toBe(false)
      }
    }
  }
}

beforeEach(() => {
  resetRunHistory()
  setView('canvas')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the Run history screen over the night Run', () => {
  it('opens in the view `history` and asks main for the list and the newest Run', async () => {
    const main = await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    expect(useNavigation.getState().view).toBe('history')
    expect(main.calls).toEqual(['runs.list', `runs.open ${NIGHT.run}`])
    expect(holdsRun()).toBe(true)
  })

  it('heads the screen with the Epic, the duration, the stop reason, the Tickets by outcome, the retries and who started it', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    const header = screen.getByTestId('run-history-header')
    expect(within(header).getByTestId('run-history-epic').textContent).toBe('worfy-pipeline')
    expect(within(header).getByTestId('run-history-duration').textContent).toBe('4h 48m')
    expect(within(header).getByTestId('run-history-reason').textContent).toBe('stopped: blocked-tickets')
    // The night's Journal predates ticket-status: its Tickets end stopped with the Run, none done or blocked.
    expect(within(header).getByTestId('run-history-tickets').textContent).toBe('Tickets 0 done · 0 blocked · 0 cut-off · 4 stopped')
    // impl-04, impl-05 and impl-07 were each sent back once.
    expect(within(header).getByTestId('run-history-retries').textContent).toBe('Retries 3')
    expect(within(header).getByTestId('run-history-by').textContent).toBe('Started by the Autopilot button')
    expect((screen.getByTestId('run-history-choose') as HTMLSelectElement).value).toBe(NIGHT.run)
  })

  it('hides «Started by» for a Journal written before run-started.by', async () => {
    await show(NIGHT.projectId, [{ ...NIGHT_ITEM, by: null }], { [NIGHT.run]: NIGHT })
    expect(screen.queryByTestId('run-history-by')).toBeNull()
  })

  it('shows the three longest Stages by self time as cards; a click selects the Stage and opens the rows above it', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    const cards = screen.getAllByTestId('run-history-stage-card')
    expect(cards.map((card) => card.dataset.spanId)).toEqual(NIGHT.summary.topStages.map((stage) => stage.spanId))
    expect(cards[0]?.textContent).toContain(formatDuration(NIGHT.summary.topStages[0]!.selfTime))
    expect(cards[0]?.textContent).toContain('Closing · Ticket 03')
    fireEvent.click(cards[1]!)
    const id = NIGHT.summary.topStages[1]!.spanId
    expect(useRunHistory.getState().selected).toBe(id)
    expect(rowOf(id).className).toContain('is-selected')
    // The Waits by cause: background tasks count only their time with no work, and say so.
    const waits = screen.getByTestId('run-history-waits')
    expect(within(waits).getByText(/background tasks/).textContent).toContain(WITHOUT_WORK_NOTE)
    expect(screen.getByTestId('run-history-work').textContent).toContain('Work inside Stages (summed; parallel)')
  })

  it('marks a retry with #N in its row and on its bar', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    const retry = NIGHT.timeline.spans.find((span) => span.kind === 'agent' && span.attempt === 2 && span.name === 'impl-07')!
    expect(within(rowOf(retry.id)).getByTestId('run-history-retry').textContent).toBe('#2')
    // Zoomed onto it, the bar has room for its label, which starts with the attempt.
    act(() => setTimeWindow({ from: retry.start - 60_000, to: retry.until + 60_000 }))
    const label = rowOf(retry.id).querySelector<HTMLElement>(`[data-label-for="${CSS.escape(`${retry.id}@0`)}"]`)
    expect(label?.dataset.placement).toBe('inside')
    expect(label?.textContent).toMatch(/^#2 impl-07 · /)
    expectLabelsClear()
  })

  it('draws a cut-off span with its zigzag end, and a span whose source is gone hatched with the label of the source', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    // The Orchestrator lane is collapsed: its turns are bars of its row, the cut-off one among them.
    const cut = NIGHT.timeline.spans.find((span) => span.outcome === 'cut-off')!
    expect(rowOf('lane:orchestrator').querySelector(`[data-span-id="${CSS.escape(cut.id)}"]`)?.className).toContain('is-cut-off')
    fireEvent.click(within(rowOf('lane:orchestrator')).getByRole('button', { name: 'Expand Orchestrator' }))
    expect(rowOf(cut.id).textContent).toContain('CUT-OFF')

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    const lost = NIGHT.timeline.spans.find((span) => span.lost === 'gate-logs-deleted')!
    expect(rowOf(lost.id).querySelector('[data-testid="run-history-bar"]')?.className).toContain('w-fr-bar--lost')
    expect(rowOf(lost.id).textContent).toContain('gate logs deleted (10 runs or 8 days)')
    expectLabelsClear()
  })

  it('a collapsed row shows its children as thin bars inside its own row; «Collapse» closes the Tickets', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    const ticket = 'ticket:worfy-pipeline/03'
    // A Ticket is open at first: its Stages have rows of their own, no thin bars.
    expect(rowOf(ticket).dataset.open).toBe('true')
    expect(rowOf(ticket).querySelectorAll('.w-fr-bar--thin')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    const stages = NIGHT.timeline.spans.filter((span) => span.parent === ticket)
    expect(rowOf(ticket).dataset.open).toBe('false')
    expect([...rowOf(ticket).querySelectorAll<HTMLElement>('.w-fr-bar--thin')].map((bar) => bar.dataset.spanId).sort()).toEqual(stages.map((span) => span.id).sort())
    expect(document.querySelector(`[data-row-id="${CSS.escape(stages[0]!.id)}"]`)).toBeNull()
    expectLabelsClear()
  })

  it('leaving the view lets the Run go', async () => {
    const main = await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    act(() => setView('canvas'))
    expect(main.calls.at(-1)).toBe(`runs.close ${NIGHT.run}`)
    expect(holdsRun()).toBe(false)
  })

  it('Esc goes back to the Canvas', async () => {
    await show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('canvas')
  })
})

describe('a block, another Run and a live timeline', () => {
  it('marks a block with «!», its reason and Waits:, and hatches the row after it', async () => {
    const view = viewOf(smallFacts())
    await show('p-1', [smallItem()], { [SMALL_RUN]: view })
    const row = rowOf('ticket:e/01')
    expect(within(row).getByTestId('run-history-block').textContent).toBe('!')
    expect(within(row).getByTestId('run-history-block').title).toBe('Needs the owner · Waits: an answer on the API key')
    expect(row.querySelector('.w-fr-hatch')).not.toBeNull()
    expect(row.textContent).toContain('BLOCKED')
    const label = row.querySelector<HTMLElement>('[data-label-for="block-0"]')
    expect(label?.textContent).toBe('Needs the owner · Waits: an answer on the API key')
    expectLabelsClear()
  })

  it('chooses another Run of the list: the first is let go, the second opened', async () => {
    const other = '2026-10-21T10-00-00-000Z-bbbbbb'
    const main = await show('p-1', [smallItem({ run: other, startedAt: '2026-10-21T10:00:00.000Z' }), smallItem()], { [SMALL_RUN]: viewOf(smallFacts()), [other]: viewOf(smallFacts({ run: { ...smallFacts().run, id: other } }), other) })
    expect(main.calls).toEqual(['runs.list', `runs.open ${other}`])
    await act(async () => {
      fireEvent.change(screen.getByTestId('run-history-choose'), { target: { value: SMALL_RUN } })
    })
    expect(main.calls.slice(2)).toEqual([`runs.close ${other}`, `runs.open ${SMALL_RUN}`])
    expect(useRunHistory.getState().view?.run).toBe(SMALL_RUN)
  })

  it('a live Run follows runs.changed: the open span grows to the new now, and the now line moves', async () => {
    const live = (now: string) => viewOf(smallFacts({ run: { id: SMALL_RUN, startedAt: T('10:00'), stoppedAt: null, live: true }, now: T(now) }))
    const main = await show('p-1', [smallItem({ live: true, stoppedAt: null, reason: null })], { [SMALL_RUN]: live('11:00') })
    expect(screen.getByTestId('run-history-reason').textContent).toBe('running')
    const before = Number(screen.getByTestId('run-history-now').dataset.at)
    expect(before).toBe(Date.parse(T('11:00')))
    expect(rowOf('ticket:e/02').textContent).toContain('RUNNING')
    act(() => main.send('runs.changed', live('11:30')))
    expect(Number(screen.getByTestId('run-history-now').dataset.at)).toBe(Date.parse(T('11:30')))
    expect(screen.getByTestId('run-history-duration').textContent).toBe('1h 30m')
    // A timeline of another Run is not this screen's.
    act(() => main.send('runs.changed', { ...live('11:45'), run: '2026-10-22T10-00-00-000Z-cccccc' }))
    expect(Number(screen.getByTestId('run-history-now').dataset.at)).toBe(Date.parse(T('11:30')))
  })
})
