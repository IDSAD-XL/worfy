// The details of the Run history screen (src/renderer/flight-recorder/DetailPanel.tsx, Timeline.tsx;
// worfy-flight-recorder ticket 19): the panel of the selected span — Overview with its nine fields, Links (the PR
// and the commit at the repository's page, the transcript in the Subagent's view or the Orchestrator's
// Session), Source (where its start and end come from, what limits the source) — «GitHub did not answer» with
// «Retry», and on the timeline the filter, «Problems only», the dashed outline of a retry's cause and the
// Ticket rows of a Wait or an Orchestrator turn.
//
// The night Run is test/fixtures/flight-recorder/night-run-view.json, what the service answers for the
// night-Run fixture (its repository page is https://github.com/someone/worfy). Main is a fake bridge.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeline, type RunFacts, type Span } from '../../src/shared/flight-recorder/spans'
import { selfTime, summarize } from '../../src/shared/flight-recorder/summary'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { runViewSchema, type RunListItem, type RunView } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { openRunHistory } from '../../src/renderer/flight-recorder/open'
import { RunHistoryView } from '../../src/renderer/flight-recorder/RunHistoryView'
import { LANE_ROWS } from '../../src/renderer/flight-recorder/filter'
import { chooseRun, formatDuration, formatLocal, ORCHESTRATOR_LANE, resetRunHistory, revealSpan, WAIT_LANE, useRunHistory } from '../../src/renderer/flight-recorder/store'
import { setView, useNavigation } from '../../src/renderer/session/navigation'

const NIGHT: RunView = runViewSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/flight-recorder/night-run-view.json'), 'utf8')))
const ITEM: RunListItem = { run: NIGHT.run, epic: 'worfy-pipeline', startedAt: '2026-10-17T22:29:32.707Z', stoppedAt: '2026-10-18T03:17:34.592Z', reason: 'blocked-tickets', live: false, tickets: [], by: 'button', mode: null, forecast: null, actual: null }
const SESSION = 'f6ab7045-416c-471a-a78d-433567aefa5a'
const IMPL_07_RETRY = 'agent:a60e687cd0ab6803e#2'
const VERIFY_07 = 'agent:adb147aa44e4451c4#1'
const spanOf = (id: string): Span => NIGHT.timeline.spans.find((span) => span.id === id)!

const T = (hhmm: string): string => `2026-10-20T${hhmm}:00.000Z`
const TWO_WAVES = '2026-10-20T10-00-00-000Z-bbbbbb'

/** A small Run of Epic `e` whose Ticket 01 ran in Wave 1 and again in Wave 2, with an hour between. */
function twoWaves(): RunView {
  const facts: RunFacts = {
    run: { id: TWO_WAVES, startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok', reason: 'tickets-done' },
    now: T('14:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [
      { number: 1, startedAt: T('10:00'), finishedAt: T('11:00'), tickets: ['e/01'] },
      { number: 2, startedAt: T('12:00'), finishedAt: T('13:30'), tickets: ['e/01'] },
    ],
    ticketEvents: [
      { ticket: 'e/01', at: T('10:01'), source: 'journal', event: 'status', state: 'claimed' },
      { ticket: 'e/01', at: T('13:00'), source: 'journal', event: 'status', state: 'done' },
    ],
    work: [],
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
  }
  const timeline = buildTimeline(facts)
  return { projectId: NIGHT.projectId, run: TWO_WAVES, epic: 'e', timeline, summary: summarize(timeline), github: { state: 'unused', reason: 'test' }, repoUrl: null, profileReason: null, skippedLines: 0, error: null }
}
const TWO_WAVES_ITEM: RunListItem = { run: TWO_WAVES, epic: 'e', startedAt: T('10:00'), stoppedAt: T('14:00'), reason: 'tickets-done', live: false, tickets: ['e/01'], by: null, mode: null, forecast: null, actual: null }

/** The night Run as gh failing gives it: «GitHub did not answer» on a CI span of each Ticket. */
function withoutGithub(): RunView {
  const spans = NIGHT.timeline.spans.map((span) => (span.kind === 'ci' ? { ...span, lost: 'github-no-answer' as const, outcome: null } : span))
  return { ...NIGHT, github: { state: 'no-answer', at: 1, reason: 'error connecting to api.github.com' }, timeline: { ...NIGHT.timeline, spans } }
}

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

/** What main answers beside the list and the Run: «Retry» and shell.openExternal, replaceable per test. */
interface MainAnswers {
  /** Further Runs of the list and their timelines, beside the one shown first. */
  more?: { item: RunListItem; view: RunView }[]
  retry?: () => Promise<Answer>
  openExternal?: (url: string) => Promise<Answer>
}

/** Main as a fake bridge: the list, the Runs, «Retry» answering `retried`, and every call kept. */
function fakeMain(view: RunView, retried: RunView = NIGHT, answers: MainAnswers = {}) {
  const calls: { channel: string; input: unknown }[] = []
  const views = new Map([[view.run, view], ...(answers.more ?? []).map(({ view: other }) => [other.run, other] as const)])
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      const { run } = (input ?? {}) as { run?: string }
      if (channel === 'runs.list') return Promise.resolve({ ok: true, value: { runs: [ITEM, ...(answers.more ?? []).map(({ item }) => item)] } })
      if (channel === 'runs.open') return Promise.resolve(run !== undefined && views.has(run) ? { ok: true, value: views.get(run) } : { ok: false, error: `no Run ${run}` })
      if (channel === 'runs.retry') return answers.retry?.() ?? Promise.resolve({ ok: true, value: retried })
      if (channel === 'runs.close') return Promise.resolve({ ok: true, value: { closed: true } })
      if (channel === 'shell.openExternal') {
        const { url } = input as { url: string }
        return answers.openExternal?.(url) ?? Promise.resolve({ ok: true, value: { url } })
      }
      return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return calls
}

async function show(view: RunView = NIGHT, retried?: RunView, answers?: MainAnswers) {
  const calls = fakeMain(view, retried, answers)
  render(<RunHistoryView />)
  await act(() => openRunHistory(view.projectId, view.run))
  return calls
}

/** An answer a test gives when it wants: `answer` resolves the promise main returned. */
function deferred() {
  let answer!: (value: Answer) => void
  const promise = new Promise<Answer>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}

const select = (id: string) => act(() => revealSpan(id))
const panel = () => screen.getByTestId('run-history-detail')
const field = (name: string): string => within(panel()).getByTestId(`run-history-detail-${name}`).querySelector('td')?.textContent ?? ''
const tab = (name: string) => fireEvent.click(within(panel()).getByRole('tab', { name }))
const rowOf = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
const two = (value: number) => String(value).padStart(2, '0')
const clock = (ms: number) => {
  const date = new Date(ms)
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

beforeEach(() => {
  resetRunHistory()
  setView('canvas')
  useNavigation.setState({ opened: {}, offCanvas: {} })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the detail panel', () => {
  it('asks for a selection while there is none; × closes it again', async () => {
    await show()
    expect(panel().textContent).toContain('Click a bar or a row to see its details')
    await select(IMPL_07_RETRY)
    expect(panel().dataset.spanId).toBe(IMPL_07_RETRY)
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close the details' }))
    expect(useRunHistory.getState().selected).toBeNull()
    expect(panel().dataset.spanId).toBeUndefined()
  })

  it('Overview: the nine fields of the selected span — kind, start, end, duration, self time, outcome, attempt, reason, path', async () => {
    await show()
    await select(IMPL_07_RETRY)
    const span = spanOf(IMPL_07_RETRY)
    expect(field('kind')).toBe('Agent (implementer)')
    expect(field('start')).toBe(`${formatLocal(span.start)} · ${clock(span.start)}`)
    expect(field('end')).toBe(`${formatLocal(span.end!)} · ${clock(span.end!)}`)
    expect(field('duration')).toBe(formatDuration(span.until - span.start))
    expect(field('self-time')).toContain(formatDuration(selfTime(span, NIGHT.timeline)))
    expect(field('outcome')).toBe('ok')
    expect(field('attempt')).toBe('#2 — retry of verify-07 (rejected)')
    expect(field('reason')).toBe('after verify-07 rejected')
    expect(field('path')).toBe('Run 58e783 › Wave 1 › Ticket 07 › Agent review + Gate & merge › impl-07')
    // The cause is a link: it selects that span.
    fireEvent.click(within(panel()).getByRole('button', { name: 'verify-07' }))
    expect(useRunHistory.getState().selected).toBe(VERIFY_07)
    expect(field('attempt')).toBe('1')
    expect(field('outcome')).toBe('rejected')
    expect(field('reason')).toBe('REJECTED')
  })

  it('Overview of a Stage, a Wait, a cut-off turn: its kind, its own time under its children, its end', async () => {
    await show()
    const stage = spanOf('ticket:worfy-pipeline/07/stage:2')
    await select(stage.id)
    expect(field('kind')).toBe('Stage (Agent review + Gate & merge)')
    const self = selfTime(stage, NIGHT.timeline)
    expect(self).toBeLessThan(stage.until - stage.start)
    expect(field('self-time')).toContain(formatDuration(self))
    await select('wait:background-tasks:1')
    expect(field('kind')).toBe('Wait (background-tasks)')
    expect(field('path')).toBe('Run 58e783 › Background tasks')
    const turn = spanOf(`turn:${SESSION}:16`)
    await select(turn.id)
    expect(field('outcome')).toBe('cut-off')
    expect(field('end')).toBe(`${formatLocal(turn.end!)} · ${clock(turn.end!)} — cut off: the last event about it`)
  })

  it('Links: the PR and the commit open at the repository page in the browser; the transcript of an agent in its Subagent view', async () => {
    const calls = await show()
    await select(IMPL_07_RETRY)
    tab('Links')
    fireEvent.click(within(panel()).getByRole('button', { name: 'PR #460' }))
    await act(async () => undefined)
    expect(calls.filter((call) => call.channel === 'shell.openExternal').map((call) => call.input)).toEqual([{ url: 'https://github.com/someone/worfy/pull/460' }])
    expect(field('tickets')).toBe('worfy-pipeline/07')
    expect(within(panel()).queryByTestId('run-history-detail-verdict')).toBeNull()

    fireEvent.click(within(panel()).getByRole('button', { name: 'The transcript of impl-07' }))
    expect(useNavigation.getState().view).toBe('session')
    expect(useNavigation.getState().opened[NIGHT.projectId]).toEqual({ nodeId: `session:${SESSION}`, projectId: NIGHT.projectId, external: { sessionId: SESSION, agentId: 'a60e687cd0ab6803e' } })

    // A Ticket's commit, at the repository page too; the tab stays Links from span to span.
    setView('history')
    await select('ticket:worfy-pipeline/07')
    const sha = spanOf('ticket:worfy-pipeline/07').links.sha!
    fireEvent.click(within(panel()).getByRole('button', { name: sha.slice(0, 8) }))
    await act(async () => undefined)
    expect(calls.filter((call) => call.channel === 'shell.openExternal').at(-1)?.input).toEqual({ url: `https://github.com/someone/worfy/commit/${sha}` })
  })

  it('Links: an Orchestrator turn opens its Session; a Wait selects its Tickets', async () => {
    await show()
    await select(`turn:${SESSION}:3`)
    tab('Links')
    fireEvent.click(within(panel()).getByRole('button', { name: "The Orchestrator's transcript" }))
    expect(useNavigation.getState().opened[NIGHT.projectId]).toEqual({ nodeId: `session:${SESSION}`, projectId: NIGHT.projectId, external: { sessionId: SESSION } })
    setView('history')
    await select('wait:background-tasks:10')
    fireEvent.click(within(panel()).getByRole('button', { name: 'worfy-pipeline/05' }))
    expect(useRunHistory.getState().selected).toBe('ticket:worfy-pipeline/05')
  })

  it('Links without a page of the repository: the PR and the commit are text, with the reason in the tooltip', async () => {
    const calls = await show({ ...NIGHT, repoUrl: null })
    await select('ticket:worfy-pipeline/07')
    tab('Links')
    expect(within(panel()).queryByRole('button', { name: 'PR #460' })).toBeNull()
    const pr = within(panel()).getByText('PR #460')
    expect(pr.getAttribute('title')).toContain('No page of the repository')
    fireEvent.click(pr)
    expect(calls.some((call) => call.channel === 'shell.openExternal')).toBe(false)
  })

  it('Source: where the start and the end come from, and the lost source or the note that limits it', async () => {
    await show()
    await select('ticket:worfy-pipeline/03/stage:1')
    tab('Source')
    expect(field('start-source')).toBe('the Autopilot Journal')
    expect(field('end-source')).toBe('GitHub')
    await select('gate:0a6c108b/2026-10-17T23-37-10Z-41210')
    expect(field('start-source')).toBe('a gate log')
    expect(field('end-source')).toBe('a gate log')
    await select('lost:1')
    expect(field('start-source')).toBe('none: the source is gone')
    expect(field('lost')).toBe('gate logs deleted (10 runs or 8 days)')
    await select(`turn:${SESSION}:16`)
    expect(field('start-source')).toBe('a transcript')
    expect(field('end-source')).toBe('none: cut off at the last event about it in any source')
  })
})

describe('«GitHub did not answer» and «Retry»', () => {
  it('shows the reason over the timeline; «Retry» asks main at once, and its answer takes the label away', async () => {
    const calls = await show(withoutGithub(), NIGHT)
    const notice = screen.getByTestId('run-history-github')
    expect(notice.textContent).toContain('GitHub did not answer: error connecting to api.github.com')
    // The CI span says it in its Source, with «Retry» there too.
    await select('ci:gh-run:39084438682')
    tab('Source')
    expect(field('lost')).toContain('GitHub did not answer')
    expect(within(panel()).getByRole('button', { name: 'Retry' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    })
    expect(calls.filter((call) => call.channel === 'runs.retry').map((call) => call.input)).toEqual([{ projectId: NIGHT.projectId, run: NIGHT.run }])
    expect(screen.queryByTestId('run-history-github')).toBeNull()
    expect(document.querySelector('.w-fr-bar--lost.w-fr-bar--ci')).toBeNull()
    expect(within(panel()).queryByTestId('run-history-detail-lost')).toBeNull()
  })

  it('a «Retry» gh still fails keeps the label with the new reason; a failed call says so', async () => {
    const still = { ...withoutGithub(), github: { state: 'no-answer' as const, at: 2, reason: 'HTTP 502' } }
    await show(withoutGithub(), still)
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('run-history-github')).getByRole('button', { name: 'Retry' }))
    })
    expect(screen.getByTestId('run-history-github').textContent).toContain('GitHub did not answer: HTTP 502')
  })
})

describe('the filter and the highlights on the timeline', () => {
  it('«Problems only» leaves the failures, retries and Waits; pressed again, every row comes back', async () => {
    await show()
    await act(() => revealSpan('agent:a4f4ef600ce73b83a#1'))
    expect(rowOf('agent:a4f4ef600ce73b83a#1')).not.toBeNull()
    const before = document.querySelectorAll('[data-testid="run-history-row"]').length
    fireEvent.click(screen.getByTestId('run-history-problems'))
    expect(screen.getByTestId('run-history-problems').getAttribute('aria-pressed')).toBe('true')
    // The first implementer of 03 ended well: gone. The retry of impl-07 and the rejected verify-07 show, their rows open.
    expect(rowOf('agent:a4f4ef600ce73b83a#1')).toBeNull()
    expect(rowOf(IMPL_07_RETRY)).not.toBeNull()
    expect(rowOf(VERIFY_07)).not.toBeNull()
    expect(rowOf('ticket:worfy-pipeline/03/stage:1')).toBeNull()
    // A row closes under the filter, and the filter keeps it closed until it changes.
    fireEvent.click(within(rowOf('ticket:worfy-pipeline/07/stage:2')!).getByRole('button', { name: /^Collapse/ }))
    expect(rowOf(IMPL_07_RETRY)).toBeNull()
    fireEvent.click(screen.getByTestId('run-history-problems'))
    expect(document.querySelectorAll('[data-testid="run-history-row"]').length).toBe(before)
    expect(rowOf('agent:a4f4ef600ce73b83a#1')).not.toBeNull()
  })

  it('the filter by Ticket keeps that Ticket; cleared, every row comes back', async () => {
    await show()
    const before = document.querySelectorAll('[data-testid="run-history-row"]').length
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '05' } })
    const tickets = [...document.querySelectorAll<HTMLElement>('[data-testid="run-history-row"][data-kind="ticket"]')].map((row) => row.dataset.rowId)
    expect(tickets).toEqual(['ticket:worfy-pipeline/05'])
    expect(rowOf('agent:a710999976a65bea0#1')).not.toBeNull()
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '#999' } })
    expect(screen.getByTestId('run-history-filter-empty').textContent).toBe('No span of this Run matches the filter.')
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '' } })
    expect(document.querySelectorAll('[data-testid="run-history-row"]').length).toBe(before)
  })

  it('selecting a retry outlines its cause dashed; selecting a Wait or an Orchestrator turn marks its Tickets rows', async () => {
    await show()
    await select(IMPL_07_RETRY)
    expect(rowOf(VERIFY_07)?.dataset.cause).toBe('true')
    expect(rowOf(VERIFY_07)?.querySelector('[data-testid="run-history-bar"]')?.className).toContain('is-cause')
    expect(document.querySelectorAll('[data-cause="true"]')).toHaveLength(1)
    // The first attempt outlines nothing.
    await select('agent:a60e687cd0ab6803e#1')
    expect(document.querySelectorAll('[data-cause="true"], .w-fr-bar.is-cause')).toHaveLength(0)

    await select('wait:background-tasks:10')
    const related = () => [...document.querySelectorAll<HTMLElement>('[data-related="true"]')].map((row) => row.dataset.rowId).sort()
    expect(related()).toEqual(['ticket:worfy-pipeline/04', 'ticket:worfy-pipeline/05'])
    await select(`turn:${SESSION}:3`)
    expect(related()).toEqual(['ticket:worfy-pipeline/03', 'ticket:worfy-pipeline/07'])
    await select('ticket:worfy-pipeline/03')
    expect(related()).toEqual([])
  })
})

describe('round 1 of the review', () => {
  it('Duration of a Ticket of two Waves is the sum of its parts, «in 2 parts», not its whole stretch', async () => {
    const view = twoWaves()
    await show(view)
    const ticket = view.timeline.spans.find((span) => span.kind === 'ticket')!
    expect(ticket.segments).toHaveLength(2)
    const parts = ticket.segments.reduce((sum, part) => sum + part.end - part.start, 0)
    expect(parts).toBeLessThan(ticket.until - ticket.start)
    await select(ticket.id)
    expect(field('duration')).toBe(`${formatDuration(parts)} in 2 parts`)
  })

  it('Source names the note of the source', async () => {
    await show()
    await select('gate:0a6c108b/2026-10-17T23-37-10Z-41210')
    tab('Source')
    expect(field('source-note')).toBe('gate log: a run answered wholly by the green cache writes no timings.json and is not shown')
  })

  it('a «Retry» whose call fails says so next to the notice; the next «Retry» clears it', async () => {
    const failing = vi.fn(() => Promise.resolve<Answer>({ ok: false, error: 'the Run is gone' }))
    const answers: MainAnswers = { retry: () => failing() }
    await show(withoutGithub(), NIGHT, answers)
    const notice = screen.getByTestId('run-history-github')
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    })
    expect(within(notice).getByTestId('run-history-retry-error').textContent).toBe(' Retry failed: the Run is gone')
    failing.mockImplementation(() => Promise.resolve<Answer>({ ok: true, value: NIGHT }))
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    })
    expect(screen.queryByTestId('run-history-github')).toBeNull()
  })

  it('both «Retry» buttons share one call in flight: the second does not read gh again', async () => {
    const pending = deferred()
    const calls = await show(withoutGithub(), NIGHT, { retry: () => pending.promise })
    await select('ci:gh-run:39084438682')
    tab('Source')
    const notice = screen.getByTestId('run-history-github')
    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    })
    const inPanel = within(panel()).getByTestId('run-history-retry-github')
    expect(inPanel.textContent).toBe('Retrying…')
    expect((inPanel as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(inPanel)
    })
    expect(calls.filter((call) => call.channel === 'runs.retry')).toHaveLength(1)
    await act(async () => {
      pending.answer({ ok: true, value: NIGHT })
      await pending.promise
    })
    expect(screen.queryByTestId('run-history-github')).toBeNull()
  })

  it('«The page could not be opened» goes with another selection, and an answer after it changed is dropped', async () => {
    const late = deferred()
    let opens = 0
    await show(NIGHT, NIGHT, { openExternal: () => (++opens === 1 ? Promise.resolve<Answer>({ ok: false, error: 'no browser' }) : late.promise) })
    await select('ticket:worfy-pipeline/07')
    tab('Links')
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: 'PR #460' }))
    })
    expect(within(panel()).getByRole('alert').textContent).toBe('The page could not be opened: no browser')
    await select('ticket:worfy-pipeline/04')
    expect(within(panel()).queryByRole('alert')).toBeNull()
    // A second open fails only once 03 is selected: its error is about 04 and is not shown.
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: 'PR #467' }))
    })
    await select('ticket:worfy-pipeline/03')
    await act(async () => {
      late.answer({ ok: false, error: 'late' })
      await late.promise
    })
    expect(within(panel()).queryByRole('alert')).toBeNull()
  })

  it('a new filter opens the rows the previous filter had closed', async () => {
    await show()
    fireEvent.click(screen.getByTestId('run-history-problems'))
    fireEvent.click(within(rowOf('ticket:worfy-pipeline/07/stage:2')!).getByRole('button', { name: /^Collapse/ }))
    expect(rowOf(IMPL_07_RETRY)).toBeNull()
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '07' } })
    expect(rowOf(IMPL_07_RETRY)).not.toBeNull()
  })

  it('each Run has its own filter: another Run shows unfiltered, with an empty field', async () => {
    await show(NIGHT, NIGHT, { more: [{ item: TWO_WAVES_ITEM, view: twoWaves() }] })
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '05' } })
    fireEvent.click(screen.getByTestId('run-history-problems'))
    await act(() => chooseRun(TWO_WAVES))
    expect((screen.getByTestId('run-history-filter') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('run-history-problems').getAttribute('aria-pressed')).toBe('false')
    // The successful Ticket of that Run shows: no Problems only carried over.
    expect(rowOf(twoWaves().timeline.spans.find((span) => span.kind === 'ticket')!.id)).not.toBeNull()
  })

  it('each Run has its own filter even when its timeline replaces the other with no loading between', async () => {
    await show()
    fireEvent.change(screen.getByTestId('run-history-filter'), { target: { value: '05' } })
    // chooseRun shows «loading» first, which drops the Timeline; the key keeps a Run's filter its own
    // without relying on that.
    act(() => useRunHistory.setState({ run: TWO_WAVES, view: twoWaves() }))
    expect((screen.getByTestId('run-history-filter') as HTMLInputElement).value).toBe('')
  })

  it('a span selected from outside the tree shows under the filter: its closed rows open, a filter that hides it is cleared', async () => {
    await show()
    fireEvent.click(screen.getByTestId('run-history-problems'))
    fireEvent.click(within(rowOf('ticket:worfy-pipeline/07')!).getByRole('button', { name: /^Collapse/ }))
    expect(rowOf(IMPL_07_RETRY)).toBeNull()
    // As a card of the summary or a link of the panel selects it.
    await select(IMPL_07_RETRY)
    expect(rowOf(IMPL_07_RETRY)).not.toBeNull()
    expect(screen.getByTestId('run-history-problems').getAttribute('aria-pressed')).toBe('true')
    // The first implementer of 03 ended well: Problems only hides it, so the filter goes.
    await select('agent:a4f4ef600ce73b83a#1')
    expect(screen.getByTestId('run-history-problems').getAttribute('aria-pressed')).toBe('false')
    expect(rowOf('agent:a4f4ef600ce73b83a#1')).not.toBeNull()
    // A filter set while a span is selected may hide it: it stays.
    fireEvent.click(screen.getByTestId('run-history-problems'))
    expect(screen.getByTestId('run-history-problems').getAttribute('aria-pressed')).toBe('true')
    expect(rowOf('agent:a4f4ef600ce73b83a#1')).toBeNull()
  })

  it('the lane rows of the filter are those of the store', () => {
    expect(LANE_ROWS).toEqual({ wait: WAIT_LANE, orchestrator: ORCHESTRATOR_LANE })
  })
})
