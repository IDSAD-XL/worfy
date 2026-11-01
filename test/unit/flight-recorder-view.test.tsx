// The Run history screen (src/renderer/flight-recorder/; worfy-flight-recorder ticket 18): the header of the
// night Run (Epic, duration, stop reason, the Tickets by outcome, retries, who started it), the three cards of
// the summary and the span a click selects, the `#N` of a retry on its bar and in its row, the block mark «!»
// with `Waits:`, a cut-off span, the label of a lost source, the thin bars of a collapsed row's children, the
// labels that cross no bar of their row, and the live timeline that follows `runs.changed`.
//
// The night Run is test/fixtures/flight-recorder/night-run-view.json: what the service answers for the
// night-Run fixture (test/contract/flight-recorder-night-view.test.ts keeps it so). The other Runs are built
// here from facts with the span model. Main is a fake bridge.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeline, type RunFacts } from '../../src/shared/flight-recorder/spans'
import { summarize, WITHOUT_WORK_NOTE } from '../../src/shared/flight-recorder/summary'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { runViewSchema, type RunListItem, type RunView } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { LABEL_GAP } from '../../src/renderer/flight-recorder/label-layout'
import { openRunHistory } from '../../src/renderer/flight-recorder/open'
import { RunHistoryView } from '../../src/renderer/flight-recorder/RunHistoryView'
import { chooseRun, formatDuration, formatLocal, holdsRun, resetRunHistory, setTimeWindow, useRunHistory } from '../../src/renderer/flight-recorder/store'
import { setView, useNavigation } from '../../src/renderer/session/navigation'

const NIGHT: RunView = runViewSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/flight-recorder/night-run-view.json'), 'utf8')))
const NIGHT_ITEM: RunListItem = { run: NIGHT.run, epic: 'worfy-pipeline', startedAt: '2026-10-17T22:29:32.707Z', stoppedAt: '2026-10-18T03:17:34.592Z', reason: 'blocked-tickets', live: false, tickets: [], by: 'button', mode: null, forecast: null, actual: null }

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
  return { projectId: 'p-1', run, epic: 'e', timeline, summary: summarize(timeline), github: { state: 'unused', reason: 'test' }, repoUrl: null, profileReason: null, skippedLines: 0, error: null }
}

const smallItem = (over: Partial<RunListItem> = {}): RunListItem => ({ run: SMALL_RUN, epic: 'e', startedAt: T('10:00'), stoppedAt: T('12:00'), reason: 'blocked-tickets', live: false, tickets: ['e/01', 'e/02'], by: null, mode: null, forecast: null, actual: null, ...over })

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

  // worfy-resource-planner ticket 08: the wait for the Start window has its own words, on the
  // Wait lane and in «Waits by cause».
  it('names a Start window Wait «Start window» on its bar and in the Waits by cause', async () => {
    const waits = [{ id: 'start-window:1', cause: 'start-window' as const, start: T('10:40'), end: T('10:50'), detail: `outside, until ${T('10:50')}`, tickets: ['e/02'], startSource: 'journal' as const, endSource: 'journal' as const }]
    await show('p-1', [smallItem()], { [SMALL_RUN]: viewOf(smallFacts({ waits })) })
    const bar = document.querySelector<HTMLElement>('[data-span-id="wait:start-window:1"]')
    expect(bar?.title.split('\n')[0]).toBe('Start window')
    const row = screen.getByTestId('run-history-waits').querySelector<HTMLElement>('[data-cause="start-window"]')
    expect(row?.querySelector('.w-fr-total__name')?.textContent).toBe('Start window')
    // worfy-resource-planner ticket 11, round 1: its until in local time, as Start and End are, on the bar and in the panel.
    const local = `Reason: start-window: outside, until ${formatLocal(Date.parse(T('10:50')))}`
    expect(bar?.title.split('\n')).toContain(local)
    expect(bar?.title).not.toContain(T('10:50'))
    act(() => fireEvent.click(bar!))
    expect(screen.getByTestId('run-history-detail-reason').querySelector('td')?.textContent).toBe(local.slice('Reason: '.length))
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

// ── worfy-resource-planner ticket 11: the Run mode, the Epic forecast and the actual share in the header ──

describe('the Run mode, the Epic forecast and the actual share in the header', () => {
  const FORECAST = { low: 0.18, high: 0.31 }
  // One screen at a time: a test that looks at several headers renders each afresh.
  const header = async (over: Partial<RunListItem>) => {
    cleanup()
    resetRunHistory()
    await show('p-1', [smallItem(over)], { [SMALL_RUN]: viewOf(smallFacts()) })
    return screen.getByTestId('run-history-header')
  }
  const forecastOf = (header: HTMLElement) => within(header).queryByTestId('run-history-forecast')

  it('shows the mode and «Forecast 18–31% · actual 24%» next to it', async () => {
    const shown = await header({ mode: 'budget-aware', forecast: FORECAST, actual: { share: 0.24, waves: 4, counted: 4 } })
    expect(within(shown).getByTestId('run-history-mode').textContent).toBe('Mode Budget-aware')
    expect(forecastOf(shown)?.textContent).toBe('Forecast 18–31% · actual 24%')
    // Every Wave counted: no tooltip to explain the actual.
    expect(forecastOf(shown)?.title).toBe('')
  })

  it('names each Run mode as Settings does', async () => {
    expect(within(await header({ mode: 'fastest' })).getByTestId('run-history-mode').textContent).toBe('Mode Fastest')
    expect(within(await header({ mode: 'start-window' })).getByTestId('run-history-mode').textContent).toBe('Mode Start window')
  })

  it('a Run from before the Epic forecast (no forecast line, no mode) shows neither the forecast nor the actual', async () => {
    const shown = await header({ actual: { share: 0.24, waves: 4, counted: 4 } })
    expect(forecastOf(shown)).toBeNull()
    expect(within(shown).queryByTestId('run-history-mode')).toBeNull()
  })

  it('shows the mode whenever run-started names it, also for a Run whose journal has no forecast line', async () => {
    const shown = await header({ mode: 'fastest', actual: { share: 0.24, waves: 4, counted: 4 } })
    expect(within(shown).getByTestId('run-history-mode').textContent).toBe('Mode Fastest')
    expect(forecastOf(shown)).toBeNull()
  })

  it('a forecast without a range says «not enough data»; one edge without the other is no range either', async () => {
    const actual = { share: 0.24, waves: 4, counted: 4 }
    expect(forecastOf(await header({ forecast: { low: null, high: null }, actual }))?.textContent).toBe('Forecast: not enough data · actual 24%')
    expect(forecastOf(await header({ forecast: { low: 0.18, high: null }, actual }))?.textContent).toBe('Forecast: not enough data · actual 24%')
    expect(forecastOf(await header({ forecast: { low: null, high: 0.31 }, actual }))?.textContent).toBe('Forecast: not enough data · actual 24%')
  })

  it('«actual: unknown» without run-stopped.actual, and when no Wave gave a sample (counted = 0)', async () => {
    expect(forecastOf(await header({ forecast: FORECAST, actual: null }))?.textContent).toBe('Forecast 18–31% · actual: unknown')
    const none = forecastOf(await header({ forecast: FORECAST, actual: { share: 0, waves: 2, counted: 0 } }))
    expect(none?.textContent).toBe('Forecast 18–31% · actual: unknown')
    expect(none?.title).toBe('Actual counts 0 of 2 Waves: a Wave counts only with fresh Limits at both ends and no week reset inside it')
  })

  it('a tooltip says how many Waves the actual counts when it is fewer than the Run finished', async () => {
    const shown = forecastOf(await header({ forecast: FORECAST, actual: { share: 0.24, waves: 4, counted: 3 } }))
    expect(shown?.textContent).toBe('Forecast 18–31% · actual 24%')
    expect(shown?.title).toBe('Actual counts 3 of 4 Waves: a Wave counts only with fresh Limits at both ends and no week reset inside it')
  })

  it('rounds the shares from whole millionths, as the forecast lines do', async () => {
    // 0.285 × 100 is 28.499999999999996 in floating point; in millionths it is 285 000, which rounds to 29.
    expect(forecastOf(await header({ forecast: { low: 0.145, high: 0.285 }, actual: { share: 0.285, waves: 1, counted: 1 } }))?.textContent).toBe('Forecast 15–29% · actual 29%')
    // Both edges on one whole percent, and a range under 1 %: the words of the forecast line.
    expect(forecastOf(await header({ forecast: { low: 0.181, high: 0.184 }, actual: { share: 0.004, waves: 1, counted: 1 } }))?.textContent).toBe('Forecast about 18% · actual less than 1%')
    expect(forecastOf(await header({ forecast: { low: 0.001, high: 0.004 }, actual: { share: 0, waves: 1, counted: 1 } }))?.textContent).toBe('Forecast less than 1% · actual 0%')
  })

  it('a Run started by the autopilot_start tool says a Session started it: any Session with the Canvas tools may call it', async () => {
    expect(within(await header({ by: 'tool' })).getByTestId('run-history-by').textContent).toBe('Started by a Session (autopilot_start)')
  })
})

// ── the rework of round 1: races with main, Esc, a Run that stops, another Project, the focus ─────────

const RUN_X = SMALL_RUN
const RUN_Y = '2026-10-21T10-00-00-000Z-bbbbbb'
const RUN_Z = '2026-10-22T10-00-00-000Z-cccccc'
const threeRuns = () => {
  const ids = [RUN_Z, RUN_Y, RUN_X]
  const items = ids.map((run, index) => smallItem({ run, startedAt: `2026-10-2${2 - index}T10:00:00.000Z` }))
  const views = Object.fromEntries(ids.map((run) => [run, viewOf(smallFacts({ run: { ...smallFacts().run, id: run } }), run)]))
  return { items, views }
}

/**
 * Main whose answers to runs.list and runs.open wait until the test lets them go. It holds a Run for this
 * window from the open sent to the close sent, one subscription per Run, as the service does: an open
 * registers before the timeline is computed, and the calls of one window come in the order they were sent.
 */
function slowMain(items: RunListItem[] | (() => RunListItem[]), views: Record<string, RunView>) {
  const held = new Set<string>()
  const calls: string[] = []
  const waiting: (() => void)[] = []
  const handlers = new Set<(payload: unknown) => void>()
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      const { run } = (input ?? {}) as { run?: string }
      calls.push(`${channel}${run === undefined ? '' : ` ${run}`}`)
      if (channel === 'runs.close') {
        held.delete(run ?? '')
        return Promise.resolve({ ok: true, value: { closed: true } })
      }
      if (channel === 'runs.open') held.add(run ?? '')
      const answer = channel === 'runs.list' ? { ok: true, value: { runs: typeof items === 'function' ? items() : items } } : { ok: true, value: views[run ?? ''] }
      return new Promise((resolve) => waiting.push(() => resolve(answer as never)))
    },
    on: (_channel, handler) => {
      handlers.add(handler)
      return handlers.size
    },
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  /**
   * Lets every waiting answer go, the latest first when `reverse`, until no call waits any more; with
   * `once`, only the calls waiting now.
   */
  const answer = async (reverse = false, once = false) => {
    while (waiting.length > 0) {
      const now = waiting.splice(0)
      if (reverse) now.reverse()
      await act(async () => {
        for (const go of now) go()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      if (once) return
    }
  }
  const send = (payload: unknown) => {
    for (const handler of handlers) handler(payload)
  }
  return { held, calls, answer, send }
}

describe('the screen and main hold the same Run, whatever order main answers in', () => {
  it('X, then Y, then X again before the first open is answered: main still holds X, and the screen shows it', async () => {
    const { items, views } = threeRuns()
    const main = slowMain(items, views)
    render(<RunHistoryView />)
    act(() => void openRunHistory('p-1', RUN_X))
    expect(main.calls).toEqual(['runs.list'])
    // The list comes; the open of X waits.
    await main.answer(false, true)
    expect(main.calls).toEqual(['runs.list', `runs.open ${RUN_X}`])
    act(() => {
      void chooseRun(RUN_Y)
      void chooseRun(RUN_X)
    })
    await main.answer(true)
    expect([...main.held]).toEqual([RUN_X])
    expect(holdsRun()).toBe(true)
    expect(useRunHistory.getState().view?.run).toBe(RUN_X)
    // No close went after the opens were answered: the late answer of the first X closes nothing.
    expect(main.calls.at(-1)).toBe(`runs.open ${RUN_X}`)
  })

  it('20 quick choices over three Runs, every open answered in reverse: main holds only the Run on screen', async () => {
    const { items, views } = threeRuns()
    const main = slowMain(items, views)
    render(<RunHistoryView />)
    act(() => void openRunHistory('p-1', RUN_Z))
    await main.answer(false, true)
    const order = [RUN_Y, RUN_X, RUN_Y, RUN_Z]
    act(() => {
      for (let index = 0; index < 20; index += 1) void chooseRun(order[index % order.length]!)
    })
    await main.answer(true)
    const last = order[19 % order.length]!
    expect(useRunHistory.getState().run).toBe(last)
    expect(useRunHistory.getState().view?.run).toBe(last)
    expect([...main.held]).toEqual([last])
  })

  it('leaving the view while main reads the list opens no Run when the list comes', async () => {
    const { items, views } = threeRuns()
    const main = slowMain(items, views)
    render(<RunHistoryView />)
    act(() => void openRunHistory('p-1'))
    act(() => setView('canvas'))
    await main.answer()
    expect(main.calls).toEqual(['runs.list'])
    expect([...main.held]).toEqual([])
    expect(holdsRun()).toBe(false)
  })

  it('leaving the view while main computes the Run: the close goes once, and the late timeline is not taken', async () => {
    const { items, views } = threeRuns()
    const main = slowMain(items, views)
    render(<RunHistoryView />)
    act(() => void openRunHistory('p-1', RUN_X))
    await main.answer(false, true)
    act(() => setView('canvas'))
    await main.answer()
    expect(main.calls).toEqual(['runs.list', `runs.open ${RUN_X}`, `runs.close ${RUN_X}`])
    expect([...main.held]).toEqual([])
    expect(useRunHistory.getState().view).toBeUndefined()
  })
})

describe('Esc on the screen', () => {
  const open = () => show(NIGHT.projectId, [NIGHT_ITEM], { [NIGHT.run]: NIGHT })
  const menu = (removeOnEscape: boolean) => {
    const element = document.createElement('div')
    element.setAttribute('role', 'menu')
    const item = document.createElement('button')
    item.setAttribute('role', 'menuitem')
    element.append(item)
    document.body.append(element)
    // A menu that closes on Esc, as the sidebar's does (ProjectsSection.tsx): gone before the press reaches the window.
    if (removeOnEscape) element.addEventListener('keydown', () => element.remove())
    item.focus()
    return { element, item }
  }
  afterEach(() => {
    for (const element of document.querySelectorAll('[role="menu"], [role="dialog"]')) element.remove()
  })

  it('that closes a menu leaves the screen open: the menu took it', async () => {
    await open()
    const { item } = menu(true)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('history')
  })

  it('with a menu open elsewhere, or a dialog, leaves the screen open', async () => {
    await open()
    menu(false)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('history')
    for (const element of document.querySelectorAll('[role="menu"]')) element.remove()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('history')
    dialog.remove()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('a dialog left open in a hidden view does not hold it: Esc goes back to the Canvas', async () => {
    await open()
    // The Canvas stays mounted while hidden (AppShell): a panel of one of its Nodes may still be open there.
    const hiddenView = document.createElement('div')
    hiddenView.hidden = true
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    hiddenView.append(dialog)
    document.body.append(hiddenView)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(useNavigation.getState().view).toBe('canvas')
    } finally {
      hiddenView.remove()
    }
  })

  it('in a text field stays there; on the Run picker it goes back to the Canvas', async () => {
    await open()
    const field = document.createElement('input')
    screen.getByTestId('run-history').append(field)
    field.focus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('history')
    const picker = screen.getByTestId('run-history-choose')
    picker.focus()
    fireEvent.keyDown(picker, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('canvas')
  })
})

describe('a Run that stops on screen, another Project, the focus', () => {
  const live = (now: string) => viewOf(smallFacts({ run: { id: SMALL_RUN, startedAt: T('10:00'), stoppedAt: null, live: true }, now: T(now) }))

  it('a live Run that stops while on screen shows its stop reason, loses the now line and «live» in the picker', async () => {
    const items = [smallItem({ live: true, stoppedAt: null, reason: null })]
    const main = await show('p-1', items, { [SMALL_RUN]: live('11:00') })
    expect(screen.getByTestId('run-history-reason').textContent).toBe('running')
    expect(screen.getByTestId('run-history-now')).not.toBeNull()
    expect(screen.getByRole('option').textContent).toContain('· live')
    // Main has the run-stopped line: the list says so too from now on.
    items[0] = smallItem()
    await act(async () => {
      main.send('runs.changed', viewOf(smallFacts()))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('run-history-reason').textContent).toBe('stopped: blocked-tickets')
    expect(screen.queryByTestId('run-history-now')).toBeNull()
    expect(main.calls.filter((call) => call === 'runs.list')).toHaveLength(2)
    expect(screen.getByRole('option').textContent).not.toContain('live')
  })

  it('a Run whose Journal just ends (cut off) says so when it stops on screen, and more stopped timelines read no more lists', async () => {
    const main = await show('p-1', [smallItem({ live: true, stoppedAt: null, reason: null })], { [SMALL_RUN]: live('11:00') })
    const cut = viewOf(smallFacts({ run: { id: SMALL_RUN, startedAt: T('10:00'), stoppedAt: null, live: false } }))
    expect(cut.timeline.spans.find((span) => span.kind === 'run')?.outcome).toBe('cut-off')
    await act(async () => {
      main.send('runs.changed', cut)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('run-history-reason').textContent).toBe('no stop in the Journal')
    // Main sends the stopped Run again (another source changed): the list was read once, on the stop.
    await act(async () => {
      main.send('runs.changed', cut)
      main.send('runs.changed', cut)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(main.calls.filter((call) => call === 'runs.list')).toHaveLength(2)
  })

  it('the list read again on the stop, answered after the screen was opened anew, does not replace the new list', async () => {
    const stopped = smallItem()
    const lists = [[smallItem({ live: true, stoppedAt: null, reason: null })], [stopped], [stopped, smallItem({ run: RUN_Y, startedAt: '2026-10-19T10:00:00.000Z' })]]
    const main = slowMain(() => lists.shift() ?? [], { [SMALL_RUN]: live('11:00'), [RUN_Y]: viewOf(smallFacts({ run: { ...smallFacts().run, id: RUN_Y } }), RUN_Y) })
    render(<RunHistoryView />)
    act(() => void openRunHistory('p-1'))
    await main.answer()
    // The Run stops: the list is read again; before main answers, the screen is opened anew.
    act(() => main.send(viewOf(smallFacts())))
    act(() => void openRunHistory('p-1'))
    expect(main.calls.filter((call) => call === 'runs.list')).toHaveLength(3)
    // The new screen's list comes first, the old one's after it.
    await main.answer(true)
    expect(useRunHistory.getState().runs?.map((item) => item.run)).toEqual([SMALL_RUN, RUN_Y])
  })

  it('another Project picked in the sidebar: the screen gives way to the Canvas and lets the Run go', async () => {
    const main = fakeMain('p-1', [smallItem()], { [SMALL_RUN]: viewOf(smallFacts()) })
    const { rerender } = render(<RunHistoryView activeProjectId="p-1" />)
    await act(() => openRunHistory('p-1'))
    rerender(<RunHistoryView activeProjectId="p-1" />)
    expect(useNavigation.getState().view).toBe('history')
    rerender(<RunHistoryView activeProjectId="p-2" />)
    expect(useNavigation.getState().view).toBe('canvas')
    expect(main.calls.at(-1)).toBe(`runs.close ${SMALL_RUN}`)
    // On the Canvas, a Project change is nothing to the screen.
    rerender(<RunHistoryView activeProjectId="p-1" />)
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('openRunHistory puts the focus on the Run picker, which keeps it while another Run is computed', async () => {
    const { items, views } = threeRuns()
    await show('p-1', items, views)
    const picker = screen.getByTestId('run-history-choose')
    expect(document.activeElement).toBe(picker)
    await act(async () => {
      fireEvent.change(picker, { target: { value: RUN_X } })
    })
    expect(useRunHistory.getState().view?.run).toBe(RUN_X)
    expect(document.activeElement).toBe(screen.getByTestId('run-history-choose'))
  })

  it('with no Run in the Project, the focus goes to the screen itself', async () => {
    await show('p-1', [], {})
    expect(screen.getByTestId('run-history').textContent).toContain('This Project has no Autopilot Runs yet.')
    expect(document.activeElement).toBe(screen.getByTestId('run-history'))
  })
})

describe('the rows and labels of the rework', () => {
  it('a span of no length is still a bar of 2 px', async () => {
    const facts = smallFacts()
    const work = [...facts.work, { id: 'a-0', kind: 'agent' as const, ticket: 'e/02', name: 'impl-09', agentType: 'worfy:implementer', start: T('10:05'), end: T('10:05'), startSource: 'transcript' as const }]
    await show('p-1', [smallItem()], { [SMALL_RUN]: viewOf({ ...facts, work }) })
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    const span = useRunHistory.getState().view!.timeline.spans.find((each) => each.name === 'impl-09')!
    const bar = rowOf(span.id).querySelector<HTMLElement>('[data-testid="run-history-bar"]')!
    expect(px(bar.style.width)).toBe(2)
  })

  it('a bar with no room for its full label gets the short one: the duration alone', async () => {
    // Two Waits a minute apart on the collapsed Wait lane: the first has no room for «cause · duration»
    // inside, and none right of its end, where the second starts.
    const facts = smallFacts({
      waits: [
        { id: 'w-1', cause: 'background-tasks', start: T('10:40'), end: T('10:50'), startSource: 'journal' },
        { id: 'w-2', cause: 'background-tasks', start: T('10:51'), end: T('11:00'), startSource: 'journal' },
      ],
    })
    await show('p-1', [smallItem()], { [SMALL_RUN]: viewOf(facts) })
    fireEvent.click(within(rowOf('lane:wait')).getByRole('button', { name: 'Collapse Waits' }))
    const first = useRunHistory.getState().view!.timeline.spans.find((each) => each.kind === 'wait' && each.start === Date.parse(T('10:40')))!
    const label = rowOf('lane:wait').querySelector<HTMLElement>(`[data-label-for="${CSS.escape(`${first.id}@0`)}"]`)
    expect(label?.textContent).toBe('10m 00s')
    expect(label?.dataset.placement).toBe('inside')
    expectLabelsClear()
  })

  it('the label right of the selected bar keeps its gap from the bar\'s outline', async () => {
    const view = viewOf(smallFacts())
    await show('p-1', [smallItem()], { [SMALL_RUN]: view })
    const wait = view.timeline.spans.find((each) => each.kind === 'wait')!
    const labelOf = () => rowOf(wait.id).querySelector<HTMLElement>(`[data-label-for="${CSS.escape(`${wait.id}@0`)}"]`)!
    const bar = rowOf(wait.id).querySelector<HTMLElement>('[data-testid="run-history-bar"]')!
    const end = px(bar.style.left) + px(bar.style.width)
    expect(labelOf().dataset.placement).toBe('after')
    expect(px(labelOf().style.left)).toBe(end + LABEL_GAP)
    fireEvent.click(rowOf(wait.id))
    expect(rowOf(wait.id).className).toContain('is-selected')
    expect(px(labelOf().style.left)).toBe(end + 2 + LABEL_GAP)
  })

  it('a transcript not there for work still running reads «not found yet», and «deleted» once the Run stopped', async () => {
    const lost = [{ ticket: 'e/02', kind: 'agent' as const, name: 'impl-05', source: 'transcript-deleted' as const }]
    const running = viewOf(smallFacts({ run: { id: SMALL_RUN, startedAt: T('10:00'), stoppedAt: null, live: true }, now: T('11:00'), lost }))
    const main = await show('p-1', [smallItem({ live: true, stoppedAt: null, reason: null })], { [SMALL_RUN]: running })
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    const id = running.timeline.spans.find((each) => each.lost !== null)!.id
    expect(rowOf(id).textContent).toContain('transcript not found yet')
    expect(rowOf(id).textContent).not.toContain('transcript deleted')
    act(() => main.send('runs.changed', viewOf(smallFacts({ lost }))))
    expect(rowOf(id).textContent).toContain('transcript deleted')
  })
})
