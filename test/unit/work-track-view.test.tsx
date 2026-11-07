// The Work track view (src/renderer/work-track/; worfy-work-track ticket 09): the switch «Run history | Work
// track» of the Runs tab, remembered per Project; the Period (Week by default) and its shift; the lanes «by
// Session» and «by Epic»; the Subagents unfolded under their Session; the hatched «no data» with its hint; the
// Month cells, whose click opens the Day; the answer read without `wait` first, then with it.
//
// Main is a fake bridge: `workTrack.read` answers the facts below for the period asked, with the model's own
// summary (summary.ts), as the service of ticket 08 does. «Today» is Thursday 5 November 2026, 14:00 local.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { WorkTrackView } from '../../src/shared/ipc/work-track'
import type { Period, SessionInfo, SourceGap, WorkFact } from '../../src/shared/work-track/facts'
import { summarize } from '../../src/shared/work-track/summary'
import { RunsView } from '../../src/renderer/flight-recorder/RunsView'
import { resetRunHistory } from '../../src/renderer/flight-recorder/store'
import { setView } from '../../src/renderer/session/navigation'
import { resetWorkTrack } from '../../src/renderer/work-track/store'

/** A local moment of 2026: November unless `month` (0-based) says otherwise. */
const at = (day: number, hour: number, minute = 0, month = 10): string => new Date(2026, month, day, hour, minute).toISOString()
const NOW = new Date(2026, 10, 5, 14, 0)

const FACTS: WorkFact[] = [
  { id: 'run-1', kind: 'run', start: at(4, 9), end: at(4, 12), outcome: 'ok', session: null, epic: 'worfy-alpha', source: 'journal', title: 'Run 1a2b3c · worfy-alpha' },
  { id: 'wave-1', kind: 'wave', start: at(4, 9, 5), end: at(4, 11, 50), outcome: 'ok', session: null, parent: 'run-1', source: 'journal', title: 'Wave 1 · tickets 01, 02' },
  { id: 'turn-1', kind: 'turn', start: at(4, 9), end: at(4, 9, 20), outcome: 'ok', session: 's-orch', epic: 'worfy-alpha', source: 'transcript', title: 'Orchestrator turn' },
  { id: 'sub-1', kind: 'subagent', start: at(4, 9, 10), end: at(4, 10, 30), outcome: 'ok', session: 's-orch', parent: 'wave-1', source: 'transcript', title: 'impl-01' },
  { id: 'sub-2', kind: 'subagent', start: at(4, 10, 35), end: at(4, 11), outcome: 'rejected', session: 's-orch', parent: 'wave-1', source: 'transcript', title: 'verify-01' },
  { id: 'turn-2', kind: 'turn', start: at(5, 10), end: at(5, 10, 40), outcome: 'ok', session: 's-codex', epic: 'worfy-beta', source: 'codex', title: 'Session turn' },
  { id: 'turn-3', kind: 'turn', start: at(31, 15, 0, 9), end: at(31, 15, 30, 9), outcome: 'ok', session: 's-old', source: 'transcript', title: 'Session turn' },
  { id: 'gate-1', kind: 'gate', start: at(4, 11), end: at(4, 11, 10), outcome: 'failed', session: null, source: 'gate-log', title: 'gate fast' },
  { id: 'pr-1', kind: 'pr', start: at(4, 8), end: at(4, 12, 30), outcome: 'ok', session: null, pr: 1500, epic: 'worfy-alpha', source: 'github', title: 'PR #1500' },
  { id: 'ci-1', kind: 'ci', start: at(4, 11, 15), end: at(4, 11, 25), outcome: 'failed', session: null, pr: 1500, epic: 'worfy-alpha', ticket: '01', source: 'github', title: 'ci' },
  { id: 'ci-2', kind: 'ci', start: at(5, 13, 50), end: null, outcome: null, session: null, source: 'github', title: 'ci' },
  { id: 'status-1', kind: 'ticket-status', start: at(4, 12, 31), end: at(4, 12, 31), outcome: 'ok', session: null, epic: 'worfy-alpha', ticket: '01', source: 'git', title: '01 claimed → done' },
]
const SESSIONS: SessionInfo[] = [
  { id: 's-orch', name: 'Orchestrator', vendor: 'claude', hidden: false, archived: false },
  { id: 's-codex', name: 'Codex helper', vendor: 'codex', hidden: true, archived: false },
  { id: 's-old', name: 'Session 5e55 · old-tree', vendor: 'claude', hidden: false, archived: true },
]
const GAPS: SourceGap[] = [{ source: 'transcript', start: at(30, 0, 0, 9), end: at(31, 0, 0, 9), why: 'Transcripts are deleted after 30 days.' }]

function viewFor(projectId: string, period: Period, loading: WorkTrackView['loading'] = [], gaps: readonly SourceGap[] = GAPS): WorkTrackView {
  const input = { period, now: NOW.toISOString(), facts: FACTS, sessions: SESSIONS, gaps: [...gaps] }
  return { projectId, ...input, summary: summarize(input), loading }
}

interface Read {
  projectId: string
  period: Period
  wait?: boolean
}

/** Main as a fake bridge: `workTrack.read` from the facts above, slow sources still loading on a read without `wait` when asked. */
function fakeMain(options: { loading?: WorkTrackView['loading']; fail?: string; gaps?: readonly SourceGap[] } = {}) {
  const reads: Read[] = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'runs.list') return Promise.resolve({ ok: true, value: { runs: [] } })
      if (channel !== 'workTrack.read') return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
      const read = input as Read
      reads.push(read)
      if (options.fail !== undefined) return Promise.resolve({ ok: false, error: options.fail })
      return Promise.resolve({ ok: true, value: viewFor(read.projectId, read.period, read.wait === true ? [] : (options.loading ?? []), options.gaps) })
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return { reads }
}

const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
})

async function openWorkTrack() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Work track' }))
  })
  await settle()
  return screen.getByTestId('work-track')
}

const pressed = (group: string): string | null => screen.getByRole('group', { name: group }).querySelector('[aria-pressed="true"]')?.textContent ?? null
const laneTitles = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-testid="work-track-lane"]')].map((lane) => lane.dataset.laneTitle ?? '')
const localDay = (iso: string): string => {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
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

describe('the switch of the Runs tab', () => {
  it('shows Run history first and Work track on «Work track», remembered per Project', async () => {
    fakeMain()
    const { rerender } = render(<RunsView activeProjectId="p-1" />)
    expect(pressed('Runs view')).toBe('Run history')
    expect(screen.getByTestId('run-history').closest('[hidden]')).toBeNull()
    expect(screen.queryByTestId('work-track')).toBeNull()

    await openWorkTrack()
    expect(pressed('Runs view')).toBe('Work track')
    expect(screen.getByTestId('run-history').closest('[hidden]')).not.toBeNull()

    // Another Project has its own choice: Run history until it is switched there too.
    rerender(<RunsView activeProjectId="p-2" />)
    await settle()
    expect(pressed('Runs view')).toBe('Run history')
    rerender(<RunsView activeProjectId="p-1" />)
    await settle()
    expect(pressed('Runs view')).toBe('Work track')

    fireEvent.click(screen.getByRole('button', { name: 'Run history' }))
    expect(screen.queryByTestId('work-track')).toBeNull()
    expect(screen.getByTestId('run-history').closest('[hidden]')).toBeNull()
  })
})

describe('the Work track view', () => {
  it('reads the Week ending today by default, and the lanes by Session', async () => {
    const main = fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    expect(pressed('Period')).toBe('Week')
    expect(pressed('Lanes')).toBe('by Session')
    expect(pressed('Density')).toBe('compact')
    expect(main.reads).toHaveLength(1)
    expect(main.reads[0]).toMatchObject({ projectId: 'p-1', period: { kind: 'week' } })
    expect(localDay(main.reads[0]!.period.start)).toBe('2026-10-30')
    expect(screen.getByTestId('work-track-period').textContent).toContain('30 Oct – 5 Nov 2026')
    // Autopilot Runs on top, the Sessions by their first work, Gate runs last.
    expect(laneTitles()).toEqual(['Autopilot Runs', 'Session 5e55 · old-tree', 'Orchestrator', 'Codex helper', 'Gate runs'])
    // The marks of a Session: hidden, archived, its Vendor.
    const codex = document.querySelector<HTMLElement>('[data-lane-id="session:s-codex"]')!
    expect(within(codex).getByText('hidden')).toBeTruthy()
    expect(within(codex).getByText('Codex')).toBeTruthy()
    expect(within(document.querySelector<HTMLElement>('[data-lane-id="session:s-old"]')!).getByText('archived')).toBeTruthy()
    // A Span's tooltip: its name, its time, its duration; a problem outcome says so.
    const verifier = document.querySelector<HTMLElement>('[data-span-id="sub-2"]')
    expect(verifier).toBeNull()
    const gate = document.querySelector<HTMLElement>('[data-span-id="gate-1"]')!
    expect(gate.title).toMatch(/^gate fast\n.*11:00 – 11:10 · 10m 00s · failed$/u)
    expect(gate.className).toContain('w-wt-bar--problem')
    // The merged PR is a diamond on the axis; «now» is on the track.
    expect(screen.getByTestId('work-track-pr').getAttribute('title')).toContain('PR #1500 merged')
    expect(document.querySelectorAll('[data-testid="work-track-now"]').length).toBeGreaterThan(0)
  })

  it('shifts the period with ‹ ›, not past today', async () => {
    const main = fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Earlier' }))
    })
    await settle()
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-10-23')
    expect(screen.getByTestId('work-track-period').textContent).toContain('23 Oct – 29 Oct 2026')
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    })
    await settle()
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-10-30')

    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Day' }))
    })
    await settle()
    expect(main.reads.at(-1)!.period.kind).toBe('day')
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-11-5')
    expect(screen.getByTestId('work-track-period').textContent).toContain('Thu 5 Nov 2026')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Earlier' }))
    })
    await settle()
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-11-4')
  })

  it('puts the work on Epic lanes «by Epic», «—» last, without reading again', async () => {
    const main = fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    fireEvent.click(within(screen.getByRole('group', { name: 'Lanes' })).getByRole('button', { name: 'by Epic' }))
    expect(laneTitles()).toEqual(['worfy-alpha', 'worfy-beta', '—', 'Gate runs'])
    expect(main.reads).toHaveLength(1)
    // The Subagents of a Wave of the Epic are on its lane.
    expect(document.querySelector('[data-lane-id="epic:worfy-alpha"] [data-span-id="sub-2"]')).not.toBeNull()
  })

  it('unfolds the Subagents of a Session with ▸, a lane each', async () => {
    fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    const toggle = screen.getByRole('button', { name: 'Show the Subagents of Orchestrator' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Folded, the Subagents are a strip on the Session's lane.
    expect(document.querySelectorAll('[data-lane-id="session:s-orch"] [data-testid="work-track-strip"]')).toHaveLength(2)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide the Subagents of Orchestrator' }).getAttribute('aria-expanded')).toBe('true')
    expect(laneTitles()).toEqual(['Autopilot Runs', 'Session 5e55 · old-tree', 'Orchestrator', 'impl-01', 'verify-01', 'Codex helper', 'Gate runs'])
    const verifier = document.querySelector<HTMLElement>('[data-span-id="sub-2"]')!
    expect(verifier.className).toContain('w-wt-bar--verifier')
    expect(verifier.className).toContain('w-wt-bar--problem')
    expect(document.querySelector<HTMLElement>('[data-span-id="sub-1"]')!.className).toContain('w-wt-bar--implementer')
  })

  it('hatches a gap «no data» with the source and why in its hint', async () => {
    fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    const gaps = [...document.querySelectorAll<HTMLElement>('[data-testid="work-track-gap"]')]
    expect(gaps.length).toBeGreaterThan(0)
    // Every transcript lane takes the gap of all the Sessions.
    expect(gaps.every((gap) => gap.closest('[data-testid="work-track-lane"]')?.getAttribute('data-lane-id')?.startsWith('session:'))).toBe(true)
    expect(gaps[0]!.title).toBe('No data · Claude Code transcripts\nTranscripts are deleted after 30 days.')
    // The first day of the seven: its share of the track (a day of a daylight saving change is longer or shorter).
    const [first, second, after] = [new Date(2026, 9, 30), new Date(2026, 9, 31), new Date(2026, 10, 6)].map((date) => date.getTime())
    expect(Number.parseFloat(gaps[0]!.style.left)).toBe(0)
    expect(Number.parseFloat(gaps[0]!.style.width)).toBeCloseTo(((second! - first!) / (after! - first!)) * 100, 5)
  })

  it('marks the CI runs and the Ticket status changes on rows of their own in Week and Day, not in Month; a click opens the panel (ticket 13)', async () => {
    fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    const row = (id: string): HTMLElement => {
      const found = document.querySelector<HTMLElement>(`[data-testid="work-track-mark-row"][data-row-id="${id}"]`)
      if (found === null) throw new Error(`no row ${id} on the screen`)
      return found
    }
    expect(row('ci').textContent).toContain('CI runs')
    expect(row('ticket-status').textContent).toContain('Ticket status')
    const ci = within(row('ci')).getAllByTestId('work-track-ci')
    expect(ci.map((mark) => mark.dataset.spanId)).toEqual(['ci-1', 'ci-2'])
    // The colour of a CI run is its outcome; one still running has none yet.
    expect(ci[0]!.className).toContain('w-wt-mark--failed')
    expect(ci[1]!.className).toContain('w-wt-mark--running')
    expect(ci[0]!.title).toMatch(/^ci\n.* · failed\nworfy-alpha 01\nPR #1500$/u)
    const status = within(row('ticket-status')).getAllByTestId('work-track-status')
    expect(status.map((mark) => mark.dataset.spanId)).toEqual(['status-1'])
    expect(status[0]!.title).toMatch(/^01 claimed → done\n/u)

    await act(async () => {
      fireEvent.click(ci[0]!)
    })
    await settle()
    const panel = screen.getByTestId('work-track-panel')
    expect(within(panel).getByRole('heading').textContent).toBe('ci')
    expect(within(panel).getByTestId('work-track-panel-what').textContent).toBe('CI run')
    expect(within(panel).getByTestId('work-track-panel-source').textContent).toMatch(/^Source: GitHub\./u)

    // The Day keeps the marks of its day only.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Wed 4 Nov' }))
    })
    await settle()
    expect(within(row('ci')).getAllByTestId('work-track-ci').map((mark) => mark.dataset.spanId)).toEqual(['ci-1'])
    expect(within(row('ticket-status')).getAllByTestId('work-track-status')).toHaveLength(1)

    // The Month counts merges in its cells, as before, and has no marks.
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Month' }))
    })
    await settle()
    expect(document.querySelector('[data-testid="work-track-marks"]')).toBeNull()
    expect(screen.getAllByTestId('work-track-month-day')[3]!.getAttribute('title')).toMatch(/1 PR merged/u)
  })

  it('hatches a GitHub gap on the row of CI runs and a git gap on the row of status changes, each with its source and why (ticket 13)', async () => {
    fakeMain({
      gaps: [
        ...GAPS,
        { source: 'github', start: at(3, 0), end: at(3, 6), why: 'GitHub could not be reached: no network.' },
        { source: 'git', start: at(2, 0), end: at(3, 0), why: 'The Project is not a git repository.' },
      ],
    })
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    const gapsOf = (selector: string) => [...document.querySelectorAll<HTMLElement>(`${selector} [data-testid="work-track-gap"]`)].map((gap) => gap.title)
    expect(gapsOf('[data-row-id="ci"]')).toEqual(['No data · GitHub\nGitHub could not be reached: no network.'])
    expect(gapsOf('[data-row-id="ticket-status"]')).toEqual(['No data · git log of the Ticket files\nThe Project is not a git repository.'])
    // The lanes keep only their own sources' gaps.
    expect(gapsOf('[data-testid="work-track-lane"]').every((title) => title.startsWith('No data · Claude Code transcripts'))).toBe(true)
  })

  it('opens the Day of a day clicked on the Week axis', async () => {
    const main = fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    const days = screen.getAllByTestId('work-track-day')
    expect(days).toHaveLength(7)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Wed 4 Nov' }))
    })
    await settle()
    expect(pressed('Period')).toBe('Day')
    expect(main.reads.at(-1)!.period.kind).toBe('day')
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-11-4')
  })

  it('shows Month as cells of days, and a click on a day opens its Day', async () => {
    const main = fakeMain()
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'Month' }))
    })
    await settle()
    expect(main.reads.at(-1)!.period.kind).toBe('month')
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-11-1')
    expect(screen.getByTestId('work-track-period').textContent).toContain('November 2026')
    // Thirty days on the axis, each with its merges; no bars, cells only.
    const heads = screen.getAllByTestId('work-track-month-day')
    expect(heads).toHaveLength(30)
    expect(heads[3]!.getAttribute('title')).toMatch(/^Wed 4 Nov: .* of work, 1 PR merged/u)
    expect(document.querySelectorAll('[data-testid="work-track-span"]')).toHaveLength(0)
    const cell = document.querySelector<HTMLElement>('[data-lane-id="session:s-orch"] [data-testid="work-track-day-cell"][data-day="4"]')!
    expect(cell.title).toMatch(/^Wed 4 Nov: 1\.9 h/u)
    await act(async () => {
      fireEvent.click(cell)
    })
    await settle()
    expect(pressed('Period')).toBe('Day')
    expect(localDay(main.reads.at(-1)!.period.start)).toBe('2026-11-4')
    expect(screen.getByTestId('work-track-period').textContent).toContain('Wed 4 Nov 2026')
  })

  it('shows the answer at once, names the sources still read, then asks again with wait', async () => {
    const main = fakeMain({ loading: ['transcripts', 'github'] })
    let resolveWait: (() => void) | undefined
    const bridge = (globalThis as unknown as { worfy: WorfyBridge }).worfy
    const invoke = bridge.invoke
    bridge.invoke = (channel, input) => {
      if ((input as Read | undefined)?.wait === true) return new Promise((resolve) => (resolveWait = () => resolve(invoke(channel, input))))
      return invoke(channel, input)
    }
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    expect(screen.getByTestId('work-track-loading').textContent).toContain('Reading transcripts, GitHub…')
    expect(laneTitles()).toContain('Autopilot Runs')
    await act(async () => {
      resolveWait?.()
    })
    await settle()
    expect(main.reads.map((read) => read.wait === true)).toEqual([false, true])
    expect(screen.queryByTestId('work-track-loading')).toBeNull()
  })

  it('says why the Work track could not be read, and Retry reads it again', async () => {
    const main = fakeMain({ fail: 'the service is down' })
    render(<RunsView activeProjectId="p-1" />)
    await openWorkTrack()
    expect(screen.getByTestId('work-track-error').textContent).toContain('The Work track could not be read: the service is down')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    await settle()
    expect(main.reads).toHaveLength(2)
  })
})
