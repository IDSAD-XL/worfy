// The state of the Work track view (worfy-work-track ticket 09): which half of the Runs tab each Project
// shows («Run history | Work track», kept in the renderer's memory only), the period on screen, the lanes,
// the density, the Sessions whose Subagents are unfolded, and the last answer of `workTrack.read`
// (src/shared/ipc/work-track.ts). Main answers at once without the slow sources and names them in
// `loading`; the view shows that answer and asks again with `wait`.
import { create } from 'zustand'
import type { WorkTrackView } from '../../shared/ipc/work-track'
import type { Period, PeriodKind } from '../../shared/work-track/facts'
import { intervalUnionLength } from '../../shared/flight-recorder/summary'
import { periodBounds, type Lane, type WorkSpan } from '../../shared/work-track/lanes'
import { invoke } from '../ipc'

export type RunsTab = 'history' | 'track'
export type LaneMode = 'session' | 'epic'
export type Density = 'compact' | 'comfortable'

export interface WorkTrackState {
  /** The half of the Runs tab each Project shows; a Project not in it shows Run history. */
  tabs: Readonly<Record<string, RunsTab>>
  period: PeriodKind
  /**
   * The local midnight of the day the period is anchored to: the Day itself, the last day of the Week,
   * a day of the Month. null — today, whatever day that is when the period is read.
   */
  day: number | null
  lanes: LaneMode
  density: Density
  /** The Sessions whose Subagents are unfolded (▸). */
  expanded: ReadonlySet<string>
  projectId: string | null
  /** The last answer for the period on screen; undefined while the first one is read. */
  view: WorkTrackView | undefined
  /** Why the last read failed. */
  error: string | null
}

const INITIAL: WorkTrackState = { tabs: {}, period: 'week', day: null, lanes: 'session', density: 'compact', expanded: new Set(), projectId: null, view: undefined, error: null }

export const useWorkTrack = create<WorkTrackState>(() => INITIAL)

// ── days and periods ─────────────────────────────────────────────────────────

/** The local midnight `days` after the one of `time`, through daylight saving changes. */
export function addDays(time: number, days: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
}

export const startOfDay = (time: number): number => addDays(time, 0)

const anchorOf = (state: Pick<WorkTrackState, 'day'>): number => state.day ?? startOfDay(Date.now())

/** The period on screen: the Day, the Week that ends on the anchor day, or the calendar Month of it. */
export function periodOf(state: Pick<WorkTrackState, 'period' | 'day'>): Period {
  const day = anchorOf(state)
  const date = new Date(day)
  const start = state.period === 'day' ? day : state.period === 'week' ? addDays(day, -6) : new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  return { kind: state.period, start: new Date(start).toISOString() }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A day as the screen names it: `Thu 5 Nov`. */
export function dayName(time: number): string {
  const date = new Date(time)
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** The words of the period: `Thu 5 Nov 2026`, `30 Oct – 5 Nov 2026`, `November 2026`. */
export function periodLabel(period: Period): string {
  const { start, end } = periodBounds(period)
  const first = new Date(start)
  if (period.kind === 'day') return `${dayName(start)} ${first.getFullYear()}`
  if (period.kind === 'month') return `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`
  const last = new Date(addDays(end, -1))
  const short = (date: Date) => `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return first.getFullYear() === last.getFullYear() ? `${short(first)} – ${short(last)} ${last.getFullYear()}` : `${short(first)} ${first.getFullYear()} – ${short(last)} ${last.getFullYear()}`
}

/** Whether › has somewhere to go: the period on screen ends before now. */
export function canGoLater(state: Pick<WorkTrackState, 'period' | 'day'>): boolean {
  return periodBounds(periodOf(state)).end <= Date.now()
}

// ── reading ──────────────────────────────────────────────────────────────────

/** Bumped by every read: an answer to an older one is for a screen that is no longer there. */
let asked = 0

/** Reads the period on screen for the Project on screen: at once, then again with `wait` while sources load. */
export async function readWorkTrack(): Promise<void> {
  const state = useWorkTrack.getState()
  if (state.projectId === null) return
  asked += 1
  const mine = asked
  const input = { projectId: state.projectId, period: periodOf(state) }
  useWorkTrack.setState({ error: null })
  const first = await invoke('workTrack.read', input)
  if (mine !== asked) return
  if (!first.ok) {
    useWorkTrack.setState({ error: first.error })
    return
  }
  useWorkTrack.setState({ view: first.value })
  if (first.value.loading.length === 0) return
  const full = await invoke('workTrack.read', { ...input, wait: true })
  if (mine !== asked) return
  if (full.ok) useWorkTrack.setState({ view: full.value })
  else useWorkTrack.setState({ error: full.error, view: { ...first.value, loading: [] } })
}

/** Shows the Work track of a Project: read again each time the view opens, the sources move on. */
export function showWorkTrack(projectId: string): Promise<void> {
  const { projectId: before } = useWorkTrack.getState()
  useWorkTrack.setState(before === projectId ? { projectId } : { projectId, view: undefined, expanded: new Set() })
  return readWorkTrack()
}

/** Another period on screen: what was shown is of the old one, so nothing is shown until the answer. */
function movePeriod(change: Pick<WorkTrackState, 'period' | 'day'>): Promise<void> {
  useWorkTrack.setState({ ...change, view: undefined })
  return readWorkTrack()
}

export function setPeriod(period: PeriodKind): Promise<void> {
  return movePeriod({ period, day: useWorkTrack.getState().day })
}

/** ‹ and ›: a Day, a Week or a Month earlier or later, never past today. */
export function shiftPeriod(direction: -1 | 1): Promise<void> {
  const state = useWorkTrack.getState()
  const day = anchorOf(state)
  const today = startOfDay(Date.now())
  let next: number
  if (state.period === 'day') next = addDays(day, direction)
  else if (state.period === 'week') next = addDays(day, 7 * direction)
  else {
    // The last day of the Month before or after.
    const date = new Date(day)
    next = new Date(date.getFullYear(), date.getMonth() + (direction === 1 ? 2 : 0), 0).getTime()
  }
  return movePeriod({ period: state.period, day: next >= today ? null : next })
}

/** A day clicked on the axis or in a Month cell: its Day. */
export function openDay(day: number): Promise<void> {
  const start = startOfDay(day)
  return movePeriod({ period: 'day', day: start >= startOfDay(Date.now()) ? null : start })
}

export function setLanes(lanes: LaneMode): void {
  useWorkTrack.setState({ lanes })
}

export function setDensity(density: Density): void {
  useWorkTrack.setState({ density })
}

/** ▸ / ▾ of a Session: its Subagents on lanes of their own, or folded into a strip. */
export function toggleSession(id: string): void {
  const expanded = new Set(useWorkTrack.getState().expanded)
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
  useWorkTrack.setState({ expanded })
}

// ── the hours of the Month cells (MonthGrid.tsx) ─────────────────────────────

const HOUR = 3_600_000

/** Hours as the cells write them: `1.9 h`. */
export const hoursText = (ms: number): string => `${(ms / HOUR).toFixed(1)} h`

/** The time `spans` cover inside the day that starts at `day`, each moment once. */
function dayWork(spans: readonly WorkSpan[], day: number): number {
  const end = addDays(day, 1)
  return intervalUnionLength(spans.filter((span) => span.start < end && span.end > day).map((span) => [Math.max(span.start, day), Math.min(span.end, end)] as const))
}

/** The spans a lane's cells count: a Session's folded Subagents too, a Run's Waves rather than the Run. */
const workOf = (lane: Lane): WorkSpan[] => [...lane.spans, ...lane.strip].filter((span) => span.kind !== 'run')

/** What a lane's cell of a day holds: hours of work, or for Gate runs the runs and how many failed. */
export function cellOf(lane: Lane, day: number): { value: number; words: string; text: string } | null {
  if (lane.kind === 'gate') {
    const end = addDays(day, 1)
    // A run counts on the day it started.
    const runs = lane.spans.filter((span) => span.start >= day && span.start < end)
    if (runs.length === 0) return null
    const failed = runs.filter((span) => span.outcome === 'failed').length
    return { value: runs.length, words: `${runs.length} gate run${runs.length === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}`, text: String(runs.length) }
  }
  const work = dayWork(workOf(lane), day)
  if (work === 0) return null
  return { value: work, words: hoursText(work), text: (work / HOUR).toFixed(1) }
}

/** The hours that shade a cell fully: the busiest lane-day, kept between 4 and 14 hours. */
export function monthScale(lanes: readonly Lane[], days: readonly number[]): number {
  let most = 0
  for (const lane of lanes) {
    if (lane.kind === 'gate') continue
    for (const day of days) most = Math.max(most, cellOf(lane, day)?.value ?? 0)
  }
  return Math.min(14 * HOUR, Math.max(4 * HOUR, most))
}

// ── the switch of the Runs tab ───────────────────────────────────────────────

export const runsTabOf = (state: Pick<WorkTrackState, 'tabs'>, projectId: string | undefined): RunsTab => (projectId === undefined ? 'history' : (state.tabs[projectId] ?? 'history'))

export function setRunsTab(projectId: string, tab: RunsTab): void {
  useWorkTrack.setState((state) => ({ tabs: { ...state.tabs, [projectId]: tab } }))
}

/** Back to nothing shown, for the tests. */
export function resetWorkTrack(): void {
  asked += 1
  useWorkTrack.setState(INITIAL)
}
