// The period summary and the Span panel of Work track (src/renderer/work-track/SummaryRow.tsx, SpanPanel.tsx;
// worfy-work-track ticket 10): the summary row — hours by Epic, hours of work in total with parallel
// Subagents counted once, merged PRs, Runs, no-data gaps — and a click on a Span, which opens the panel:
// what it is, the table (When, Duration, Epic, Ticket, PR, Outcome), Open Session, Open Run, Open PR and the
// source; Esc and ✕ close it.
//
// Main is a fake bridge: `workTrack.read` answers the facts below with the model's own summary (summary.ts),
// as the service of ticket 08 does; `projects.list` and `workflow.open` give the Project its repository page.
// «Today» is Thursday 5 November 2026, 14:00 local; the Day shown is Wednesday 4 November.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { WorkTrackView } from '../../src/shared/ipc/work-track'
import type { Period, SessionInfo, WorkFact } from '../../src/shared/work-track/facts'
import { summarize } from '../../src/shared/work-track/summary'
import { RunsView } from '../../src/renderer/flight-recorder/RunsView'
import { resetRunHistory, useRunHistory } from '../../src/renderer/flight-recorder/store'
import { setView, useNavigation } from '../../src/renderer/session/navigation'
import { resetWorkTrack, runsTabOf, setPeriod, useWorkTrack } from '../../src/renderer/work-track/store'

const at = (day: number, hour: number, minute = 0): string => new Date(2026, 10, day, hour, minute).toISOString()
const NOW = new Date(2026, 10, 5, 14, 0)
const PROJECT = 'p-1'
const ROOT = '/work/CanvasForAI'
const REPO = 'https://github.com/someone/worfy'
const RUN = '2026-11-04T08-00-00-000Z-a1b2c3'

const FACTS: WorkFact[] = [
  { id: `run:${RUN}`, kind: 'run', start: at(4, 8), end: at(4, 12), outcome: 'ok', session: null, epic: 'worfy-alpha', source: 'journal', title: 'Run · worfy-alpha' },
  { id: `wave:${RUN}:1`, kind: 'wave', start: at(4, 8, 5), end: at(4, 11, 50), outcome: 'ok', session: 's-orch', parent: `run:${RUN}`, epic: 'worfy-alpha', source: 'journal', title: 'Wave 1 · tickets 01, 02' },
  // A Wave started by hand: its marker, no Run.
  { id: 'wave-marker:worfy/worfy-beta-wave-1', kind: 'wave', start: at(4, 15), end: at(4, 16), outcome: 'ok', session: null, epic: 'worfy-beta', ticket: '07', source: 'wave-marker', title: 'Wave · tickets 07' },
  { id: 'turn:t1', kind: 'turn', start: at(4, 9), end: at(4, 9, 30), outcome: 'ok', session: 's-orch', source: 'transcript', title: 'Orchestrator' },
  // Two Subagents working the same hour, 09:00–10:00 and 09:30–10:30: an hour and a half of work, not two.
  { id: 'subagent:s-orch:a1', kind: 'subagent', start: at(4, 9), end: at(4, 10), outcome: 'ok', session: 's-orch', epic: 'worfy-alpha', ticket: '01', pr: 1501, source: 'transcript', title: 'impl-01' },
  { id: 'subagent:s-orch:a2', kind: 'subagent', start: at(4, 9, 30), end: at(4, 10, 30), outcome: 'rejected', session: 's-orch', epic: 'worfy-alpha', ticket: '02', source: 'transcript', title: 'verify-02' },
  { id: 'gate:wt/1', kind: 'gate', start: at(4, 13), end: at(4, 13, 10), outcome: 'failed', session: null, source: 'gate-log', title: 'gate fast' },
  { id: 'gh-pr:1501', kind: 'pr', start: at(4, 7), end: at(4, 12, 30), outcome: 'ok', session: null, epic: 'worfy-alpha', ticket: '01', pr: 1501, source: 'github', title: '#1501 Ticket 01' },
]
const SESSIONS: SessionInfo[] = [{ id: 's-orch', name: 'Orchestrator', vendor: 'claude', hidden: false, archived: false }]

function viewFor(projectId: string, period: Period, facts: readonly WorkFact[]): WorkTrackView {
  const input = { period, now: NOW.toISOString(), facts: [...facts], sessions: SESSIONS, gaps: [] }
  return { projectId, ...input, summary: summarize(input), loading: [] }
}

/** Main as a fake bridge; `repoUrl` null — the Project's origin is no repository on GitHub. */
function fakeMain(options: { facts?: readonly WorkFact[]; repoUrl?: string | null } = {}) {
  const calls: { channel: string; input: unknown }[] = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      if (channel === 'runs.list') return Promise.resolve({ ok: true, value: { runs: [] } })
      if (channel === 'projects.list') return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'CanvasForAI', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
      if (channel === 'workflow.open') return Promise.resolve({ ok: true, value: { root: ROOT, epics: [], tickets: [], error: null, branchErrors: [], repoUrl: options.repoUrl === undefined ? REPO : options.repoUrl } })
      if (channel === 'workflow.close') return Promise.resolve({ ok: true, value: {} })
      if (channel === 'shell.openExternal') return Promise.resolve({ ok: true, value: { url: (input as { url: string }).url } })
      if (channel === 'workTrack.read') {
        const read = input as { projectId: string; period: Period }
        return Promise.resolve({ ok: true, value: viewFor(read.projectId, read.period, options.facts ?? FACTS) })
      }
      return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return { calls }
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  })

/** The Runs tab on Work track, the Day of Wednesday 4 November, the Subagents of the Orchestrator unfolded. */
async function openDay(): Promise<HTMLElement> {
  render(<RunsView activeProjectId={PROJECT} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Work track' }))
  })
  await settle()
  useWorkTrack.setState({ day: new Date(2026, 10, 4).getTime(), expanded: new Set(['s-orch']) })
  await act(async () => {
    await setPeriod('day')
  })
  await settle()
  return screen.getByTestId('work-track')
}

const span = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-span-id="${id}"]`)
  if (found === null) throw new Error(`no span ${id} on the screen`)
  return found
}

async function clickSpan(id: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(span(id))
  })
  await settle()
  return screen.getByTestId('work-track-panel')
}

/** The table of the panel as `name → value`. */
function table(panel: HTMLElement): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of within(panel).getAllByRole('row')) {
    const name = row.querySelector('th')?.textContent ?? ''
    rows[name] = row.querySelector('td')?.textContent ?? ''
  }
  return rows
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetRunHistory()
  resetWorkTrack()
  setView('history')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the summary of the period', () => {
  it('counts the hours of parallel Subagents once, by Epic and in total, with PRs, Runs and gaps', async () => {
    fakeMain()
    await openDay()
    const summary = screen.getByTestId('work-track-summary')
    // Work: Wave 08:05–11:50 and the turn and Subagents inside it, 15:00–16:00 of the hand Wave: 4 h 45 m.
    expect(within(summary).getByTestId('work-track-total').textContent).toBe('4.8 h')
    const epics = within(summary).getAllByTestId('work-track-epic-hours').map((row) => row.textContent)
    // worfy-alpha: the Wave 08:05–11:50 with the Subagents 09:00–10:30 inside it — 3 h 45 m once; the turn has no Epic.
    expect(epics).toEqual(['worfy-alpha3.8 h', 'worfy-beta1.0 h', '—0.5 h'])
    expect(within(summary).getByTestId('work-track-prs').textContent).toBe('1')
    expect(within(summary).getByTestId('work-track-runs').textContent).toBe('1')
    expect(within(summary).getByTestId('work-track-gaps').textContent).toBe('0')
    expect(within(summary).getByTestId('work-track-gaps').closest('[title]')?.getAttribute('title')).toMatch(/^Parts of the period where a source has no data/u)
  })

  it('shows six Epics at most and the rest as «+N»', async () => {
    const epics = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']
    fakeMain({
      facts: epics.map((epic, index) => ({ id: `w-${epic}`, kind: 'wave', start: at(4, 1 + index), end: at(4, 1 + index, 30 + index), outcome: 'ok', session: null, epic, source: 'wave-marker', title: `Wave ${epic}` })),
    })
    await openDay()
    const summary = screen.getByTestId('work-track-summary')
    expect(within(summary).getAllByTestId('work-track-epic-hours')).toHaveLength(6)
    const more = within(summary).getByTestId('work-track-epic-more')
    expect(more.textContent).toBe('+2')
    expect(more.getAttribute('title')).toBe('e2 0.5 h\ne1 0.5 h')
  })
})

describe('the Span panel', () => {
  it('opens on a click on a Subagent: what, when, its Epic, Ticket, PR, Outcome, its Session and the source', async () => {
    fakeMain()
    await openDay()
    expect(screen.queryByTestId('work-track-panel')).toBeNull()
    const panel = await clickSpan('subagent:s-orch:a2')
    expect(within(panel).getByRole('heading').textContent).toBe('verify-02')
    expect(within(panel).getByTestId('work-track-panel-what').textContent).toBe('Subagent · verifier · Orchestrator')
    const rows = table(panel)
    expect(Object.keys(rows)).toEqual(['When', 'Duration', 'Epic', 'Ticket', 'PR', 'Outcome'])
    expect(rows.Duration).toBe('1h 00m')
    expect(rows.Epic).toBe('worfy-alpha')
    expect(rows.Ticket).toBe('02')
    expect(rows.PR).toBe('—')
    expect(rows.Outcome).toBe('rejected')
    expect(within(panel).getByTestId('work-track-panel-source').textContent).toMatch(/^Source: Claude Code transcripts\./u)
    // Only titles: nothing but the names of the facts reaches the panel.
    expect(panel.textContent).not.toMatch(/prompt|message/iu)

    // Open Session: the Session of the Subagent, its transcript in the Session view.
    expect(within(panel).getByRole('button', { name: 'Open Run' })).toHaveProperty('disabled', true)
    expect(within(panel).getByRole('button', { name: 'Open PR' })).toHaveProperty('disabled', true)
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Open Session' }))
    })
    expect(useNavigation.getState().view).toBe('session')
    expect(useNavigation.getState().opened[PROJECT]).toEqual({ nodeId: 'session:s-orch', projectId: PROJECT, external: { sessionId: 's-orch' } })
  })

  it('has no Open Run for a Wave outside a Run, and no Open Session for work of no Session', async () => {
    fakeMain()
    await openDay()
    const panel = await clickSpan('wave-marker:worfy/worfy-beta-wave-1')
    expect(within(panel).getByRole('heading').textContent).toBe('Wave · tickets 07')
    const run = within(panel).getByRole('button', { name: 'Open Run' })
    expect(run).toHaveProperty('disabled', true)
    expect(run.getAttribute('title')).toBe('Not part of an Autopilot Run')
    expect(within(panel).getByRole('button', { name: 'Open Session' })).toHaveProperty('disabled', true)
    expect(table(panel).Ticket).toBe('07')
    expect(within(panel).getByTestId('work-track-panel-source').textContent).toMatch(/^Source: Wave markers\./u)
  })

  it('opens Run history on the Run of a Wave of a Run', async () => {
    const { calls } = fakeMain()
    await openDay()
    const panel = await clickSpan(`wave:${RUN}:1`)
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Open Run' }))
    })
    await settle()
    expect(useRunHistory.getState()).toMatchObject({ projectId: PROJECT, run: RUN })
    expect(runsTabOf(useWorkTrack.getState(), PROJECT)).toBe('history')
    expect(calls.some((call) => call.channel === 'runs.list')).toBe(true)
  })

  it('opens a merged PR on GitHub from its diamond, and says so without a repository page', async () => {
    const { calls } = fakeMain()
    await openDay()
    const panel = await clickSpan('gh-pr:1501')
    expect(within(panel).getByRole('heading').textContent).toBe('#1501 Ticket 01')
    const rows = table(panel)
    expect(rows.PR).toBe('#1501')
    expect(rows.Outcome).toBe('merged')
    expect(rows.Duration).toBe('5h 30m')
    expect(within(panel).getByTestId('work-track-panel-source').textContent).toMatch(/^Source: GitHub\./u)
    const open = within(panel).getByRole('button', { name: 'Open PR' })
    expect(open).toHaveProperty('disabled', false)
    await act(async () => {
      fireEvent.click(open)
    })
    expect(calls.filter((call) => call.channel === 'shell.openExternal').map((call) => call.input)).toEqual([{ url: `${REPO}/pull/1501` }])
  })

  it('keeps Open PR off when the Project has no page on GitHub', async () => {
    fakeMain({ repoUrl: null })
    await openDay()
    const panel = await clickSpan('subagent:s-orch:a1')
    expect(table(panel).PR).toBe('#1501')
    const open = within(panel).getByRole('button', { name: 'Open PR' })
    expect(open).toHaveProperty('disabled', true)
    expect(open.getAttribute('title')).toMatch(/^No page of the repository/u)
  })

  it('closes on ✕ and on Esc, and Esc then goes back to the Canvas as before', async () => {
    fakeMain()
    await openDay()
    let panel = await clickSpan('gate:wt/1')
    expect(table(panel).Outcome).toBe('failed')
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Close the details' }))
    })
    expect(screen.queryByTestId('work-track-panel')).toBeNull()

    panel = await clickSpan('gate:wt/1')
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(screen.queryByTestId('work-track-panel')).toBeNull()
    // The press closed the panel only: the Runs tab is still on screen; the next one goes to the Canvas.
    expect(useNavigation.getState().view).toBe('history')
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(useNavigation.getState().view).toBe('canvas')
  })
})
