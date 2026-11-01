// The state of the Run history screen (worfy-flight-recorder ticket 18): which Project and Run it shows,
// the Runs to choose from, the timeline main computed for the Run (src/shared/ipc/runs.ts), and what the
// user did on it — the span selected, the rows open, the stretch of time on screen. Main keeps sending
// `runs.changed` for the open Run while it goes on (decision 07); the screen lets the Run go
// (`runs.close`) when it shows another one or the window leaves the view.
import { create } from 'zustand'
import type { RunListItem, RunView } from '../../shared/ipc/runs'
import type { Span } from '../../shared/flight-recorder/spans'
import { invoke, subscribe } from '../ipc'

/** A stretch of the time axis, ms since the epoch. */
export interface TimeWindow {
  from: number
  to: number
}

export interface RunHistoryState {
  projectId: string | null
  /** The Epic the list keeps to (opened from an Epic's menu); null — every Run of the Project. */
  epic: string | null
  /** The Runs of the Project, newest first; undefined until main answers. */
  runs: RunListItem[] | undefined
  /** The Run on screen; null — none chosen yet (the newest is taken once the list comes). */
  run: string | null
  view: RunView | undefined
  /** Why the list or the timeline could not be had. */
  error: string | null
  selected: string | null
  /** The rows shown open; filled with the defaults when a Run's first timeline comes. */
  expanded: ReadonlySet<string>
  /** The stretch on screen; null — the whole Run («Fit»), which follows a live Run's end. */
  window: TimeWindow | null
}

const INITIAL: RunHistoryState = { projectId: null, epic: null, runs: undefined, run: null, view: undefined, error: null, selected: null, expanded: new Set(), window: null }

export const useRunHistory = create<RunHistoryState>(() => INITIAL)

/** The id of the row of each lane, beside the spans' own ids. */
export const WAIT_LANE = 'lane:wait'
export const ORCHESTRATOR_LANE = 'lane:orchestrator'

/** The Run whose `runs.changed` this window takes, as main knows it: opened and not closed yet. */
let held: { projectId: string; run: string } | null = null
let subscribed = false

function onChanged(view: RunView): void {
  const state = useRunHistory.getState()
  if (view.projectId !== state.projectId || view.run !== state.run) return
  useRunHistory.setState({ view })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('runs.changed', onChanged)
  } catch (error) {
    subscribed = false
    console.error('runs.changed: cannot subscribe', error)
  }
}

function letGo(): void {
  if (held === null) return
  const { projectId, run } = held
  held = null
  void invoke('runs.close', { projectId, run })
}

/** The rows open when a Run is first shown: the Run, its Waves and Tickets, and the Wait lane. */
export function defaultExpanded(view: RunView): Set<string> {
  const open = new Set<string>([WAIT_LANE])
  for (const span of view.timeline.spans) if (span.kind === 'run' || span.kind === 'wave' || span.kind === 'ticket') open.add(span.id)
  return open
}

async function openRun(projectId: string, run: string): Promise<void> {
  letGo()
  ensureSubscribed()
  const mine = { projectId, run }
  held = mine
  const result = await invoke('runs.open', { projectId, run })
  // Another Run was chosen, or the window left the view, while main computed this one. The close sent
  // then may have reached main before the open held the Run, so it goes once more.
  if (held !== mine) {
    if (result.ok) void invoke('runs.close', { projectId, run })
    return
  }
  if (!result.ok) {
    held = null
    useRunHistory.setState({ error: result.error })
    return
  }
  useRunHistory.setState({ view: result.value, error: null, expanded: defaultExpanded(result.value), window: null, selected: null })
}

/**
 * Shows the Runs of a Project on the screen: `run` when given, else the newest one; with `epic`, only
 * that Epic's Runs are in the list (decision 06, Q2). Answers once the timeline is there or has failed.
 */
export async function showRuns(projectId: string, run?: string, epic?: string): Promise<void> {
  letGo()
  useRunHistory.setState({ ...INITIAL, projectId, epic: epic ?? null, run: run ?? null })
  const listed = await invoke('runs.list', epic === undefined ? { projectId } : { projectId, epic })
  const state = useRunHistory.getState()
  if (state.projectId !== projectId) return
  if (!listed.ok) {
    useRunHistory.setState({ runs: [], error: listed.error })
    return
  }
  const chosen = state.run ?? listed.value.runs[0]?.run ?? null
  useRunHistory.setState({ runs: listed.value.runs, run: chosen })
  if (chosen !== null) await openRun(projectId, chosen)
}

/** The header's choice of another Run of the list. */
export async function chooseRun(run: string): Promise<void> {
  const { projectId } = useRunHistory.getState()
  if (projectId === null) return
  useRunHistory.setState({ run, view: undefined, error: null, selected: null, window: null })
  await openRun(projectId, run)
}

/** The window left the view: main stops sending this Run's timeline. What is on screen stays. */
export function leaveRunHistory(): void {
  letGo()
}

/** Whether the screen holds the Run open in main now (for the tests). */
export const holdsRun = (): boolean => held !== null

export function selectSpan(id: string | null): void {
  useRunHistory.setState({ selected: id })
}

/** Selects a span and opens the rows above it, so its row is on screen (a card of the summary). */
export function revealSpan(id: string): void {
  const { view, expanded } = useRunHistory.getState()
  const spans = new Map((view?.timeline.spans ?? []).map((span) => [span.id, span]))
  const open = new Set(expanded)
  let span: Span | undefined = spans.get(id)
  while (span !== undefined) {
    // A Ticket hangs off the Run but is drawn under the Wave it started in (displayChildren): that row too.
    const wave = span.kind === 'ticket' ? firstWaveOf(span, spans.values()) : undefined
    if (wave !== undefined) open.add(wave.id)
    const parent: string | null = span.parent
    if (parent === null) break
    open.add(parent)
    span = spans.get(parent)
  }
  useRunHistory.setState({ selected: id, expanded: open })
}

export function toggleRow(id: string): void {
  const open = new Set(useRunHistory.getState().expanded)
  if (open.has(id)) open.delete(id)
  else open.add(id)
  useRunHistory.setState({ expanded: open })
}

/** «Expand all»: every row with rows under it. */
export function expandAll(ids: readonly string[]): void {
  useRunHistory.setState({ expanded: new Set(ids) })
}

/** «Collapse»: the Run and its Waves stay open, every Ticket and lane closes. */
export function collapseAll(): void {
  const { view } = useRunHistory.getState()
  const open = new Set<string>()
  for (const span of view?.timeline.spans ?? []) if (span.kind === 'run' || span.kind === 'wave') open.add(span.id)
  useRunHistory.setState({ expanded: open })
}

export function setTimeWindow(window: TimeWindow | null): void {
  useRunHistory.setState({ window })
}

// ── the rows of the tree ─────────────────────────────────────────────────────

/** The Wave a Ticket's row is drawn under: the first of its Waves. */
export function firstWaveOf(ticket: Span, spans: Iterable<Span>): Span | undefined {
  const waves = ticket.links.waves ?? (ticket.links.wave === undefined ? [] : [ticket.links.wave])
  if (waves.length === 0) return undefined
  const first = Math.min(...waves)
  for (const span of spans) if (span.kind === 'wave' && span.links.wave === first) return span
  return undefined
}

/** A row of the timeline: a lane of the Run, or a span of the tree, with the rows drawn under it. */
export interface Row {
  id: string
  /** The span of the row; null for a lane, whose children are its spans. */
  span: Span | null
  lane: 'wait' | 'orchestrator' | null
  depth: number
  children: Span[]
  open: boolean
}

const byStart = (a: Span, b: Span): number => a.start - b.start || a.id.localeCompare(b.id)

/**
 * The spans drawn under a span in the tree: a Run shows its Waves, then what else hangs off it; a Wave
 * shows the Tickets that started in it (a Ticket of several Waves is one row, under its first); the rest
 * show their children. The lanes' spans are not in the tree.
 */
export function displayChildren(span: Span, spans: readonly Span[]): Span[] {
  const tree = spans.filter((each) => each.lane === 'tree')
  if (span.kind === 'wave') return tree.filter((each) => each.kind === 'ticket' && firstWaveOf(each, spans)?.id === span.id).sort(byStart)
  const children = tree.filter((each) => each.parent === span.id)
  if (span.kind !== 'run') return children.sort(byStart)
  const waves = children.filter((each) => each.kind === 'wave').sort((a, b) => (a.links.wave ?? 0) - (b.links.wave ?? 0))
  const rest = children.filter((each) => each.kind !== 'wave' && !(each.kind === 'ticket' && firstWaveOf(each, spans) !== undefined)).sort(byStart)
  return [...waves, ...rest]
}

/** The rows on screen, top to bottom: the Wait lane, the Orchestrator lane, then the tree from the Run. */
export function buildRows(spans: readonly Span[], expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const lane = (id: string, which: 'wait' | 'orchestrator') => {
    const children = spans.filter((span) => span.lane === which).sort(byStart)
    rows.push({ id, span: null, lane: which, depth: 0, children, open: expanded.has(id) })
    if (expanded.has(id)) for (const span of children) rows.push({ id: span.id, span, lane: null, depth: 1, children: [], open: false })
  }
  lane(WAIT_LANE, 'wait')
  lane(ORCHESTRATOR_LANE, 'orchestrator')
  const walk = (span: Span, depth: number) => {
    const children = displayChildren(span, spans)
    const open = expanded.has(span.id)
    rows.push({ id: span.id, span, lane: null, depth, children, open })
    if (open) for (const child of children) walk(child, depth + 1)
  }
  const run = spans.find((span) => span.kind === 'run')
  if (run !== undefined) walk(run, 0)
  return rows
}

/** Every row that has rows under it: what «Expand all» opens. */
export function expandableIds(spans: readonly Span[]): string[] {
  const ids = [WAIT_LANE, ORCHESTRATOR_LANE].filter((id) => spans.some((span) => span.lane === (id === WAIT_LANE ? 'wait' : 'orchestrator')))
  for (const span of spans) if (span.lane === 'tree' && displayChildren(span, spans).length > 0) ids.push(span.id)
  return ids
}

/** Back to nothing shown, for the tests. */
export function resetRunHistory(): void {
  held = null
  // A test gives each case a bridge of its own: the next open subscribes to it.
  subscribed = false
  useRunHistory.setState(INITIAL)
}

// ── words and numbers on screen ──────────────────────────────────────────────

const two = (value: number): string => String(value).padStart(2, '0')

/** A duration as the screen writes it: `40s`, `12m 05s`, `4h 48m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${two(minutes)}m` : `${minutes}m ${two(seconds % 60)}s`
}

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A moment in local time with its date: `Oct 18, 01:29`. */
export const formatLocal = (ms: number): string => dateTime.format(ms)

/** A moment in local time on the axis: `01:30`. */
export function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
