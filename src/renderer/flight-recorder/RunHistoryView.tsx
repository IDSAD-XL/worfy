// The Run history screen (worfy-flight-recorder ticket 18; decision 05): the view `history` of the main
// area, over the whole viewport instead of the Canvas. No tab of the toolbar opens it — the entries of
// ticket 20 call openRunHistory (open.ts) — and Esc goes back to the Canvas. Top to bottom: the header
// of the Run with the choice of another Run of the Project, the summary, the timeline. Times are local.
import { useEffect } from 'react'
import type { Span } from '../../shared/flight-recorder/spans'
import type { RunListItem, RunView } from '../../shared/ipc/runs'
import { setView, useNavigation } from '../session/navigation'
import { chooseRun, formatDuration, formatLocal, leaveRunHistory, useRunHistory } from './store'
import { SummaryStrip } from './SummaryStrip'
import { Timeline } from './Timeline'
import './flight-recorder.css'

const STARTED_BY: Record<string, string> = { button: 'the Autopilot button', command: 'a command in a chat', tool: 'the Orchestrator (autopilot_start)' }

function runOption(item: RunListItem): string {
  return `${formatLocal(Date.parse(item.startedAt))} · ${item.epic}${item.live ? ' · live' : ''}`
}

/** The Tickets of the Run by how they ended, as the header counts them. */
function ticketCounts(spans: readonly Span[]): { done: number; blocked: number; cutOff: number; other: number } {
  const counts = { done: 0, blocked: 0, cutOff: 0, other: 0 }
  for (const span of spans) {
    if (span.kind !== 'ticket') continue
    if (span.outcome === 'ok') counts.done += 1
    else if (span.outcome === 'blocked') counts.blocked += 1
    else if (span.outcome === 'cut-off') counts.cutOff += 1
    else counts.other += 1
  }
  return counts
}

/** Retries: the attempts from #2 on of the work of the Run (an implementer sent back, a CI run again). */
const retries = (spans: readonly Span[]): number => spans.filter((span) => span.attempt > 1 && (span.kind === 'agent' || span.kind === 'ci' || span.kind === 'gate' || span.kind === 'script')).length

function stopWords(item: RunListItem | undefined, view: RunView): string {
  if (view.timeline.live) return 'running'
  if (item?.reason != null) return `stopped: ${item.reason}`
  return 'no stop in the Journal'
}

function Header({ view, runs }: { view: RunView; runs: readonly RunListItem[] }) {
  const epic = useRunHistory((state) => state.epic)
  const item = runs.find((each) => each.run === view.run)
  const run = view.timeline.spans.find((span) => span.kind === 'run')
  const counts = ticketCounts(view.timeline.spans)
  const waves = view.timeline.spans.filter((span) => span.kind === 'wave').length
  // The stop reason in the problem colour when the Run ended on a block or a failure (STOP_OUTCOMES, from-journal.ts).
  const problem = run?.outcome === 'blocked' || run?.outcome === 'failed'
  return (
    <header className="w-fr-header" data-testid="run-history-header">
      <h1 className="w-fr-header__title">Run history</h1>
      <select className="w-fr-select" aria-label="Run" value={view.run} onChange={(event) => void chooseRun(event.target.value)} data-testid="run-history-choose">
        {runs.map((each) => (
          <option key={each.run} value={each.run}>
            {runOption(each)}
          </option>
        ))}
      </select>
      {epic !== null ? <span className="w-fr-chip">Epic filter: {epic}</span> : null}
      <span>
        Epic <b data-testid="run-history-epic">{view.epic}</b>
      </span>
      {run !== undefined ? (
        <>
          <span data-testid="run-history-when">
            {formatLocal(run.start)} → {run.end === null ? 'now' : formatLocal(run.end)}
          </span>
          <b data-testid="run-history-duration">{formatDuration(run.until - run.start)}</b>
        </>
      ) : null}
      <span className={`w-fr-chip${problem ? ' w-fr-chip--problem' : ''}`} data-testid="run-history-reason">
        {stopWords(item, view)}
      </span>
      <span>
        Waves <b>{waves}</b>
      </span>
      <span data-testid="run-history-tickets">
        Tickets <b>{counts.done}</b> done · <b>{counts.blocked}</b> blocked · <b>{counts.cutOff}</b> cut-off
        {counts.other > 0 ? (
          <>
            {' '}
            · <b>{counts.other}</b> {view.timeline.live ? 'not done yet' : 'stopped'}
          </>
        ) : null}
      </span>
      <span data-testid="run-history-retries">
        Retries <b>{retries(view.timeline.spans)}</b>
      </span>
      {item?.by != null ? <span data-testid="run-history-by">Started by {STARTED_BY[item.by] ?? item.by}</span> : null}
      <span className="w-fr-muted">Times are local</span>
    </header>
  )
}

/** The screen of the view `history`. */
export function RunHistoryView() {
  const active = useNavigation((state) => state.view === 'history')
  const projectId = useRunHistory((state) => state.projectId)
  const runs = useRunHistory((state) => state.runs)
  const view = useRunHistory((state) => state.view)
  const error = useRunHistory((state) => state.error)
  const run = useRunHistory((state) => state.run)

  // Main stops sending the timeline once the window shows another view.
  useEffect(() => {
    if (!active) leaveRunHistory()
  }, [active])

  // Esc goes back to the Canvas, unless something on top of the screen took it (a dialog, the palette, a field).
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], input, textarea, select, [contenteditable="true"]')) return
      setView('canvas')
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [active])

  let body
  if (projectId === null) body = <p className="w-fr-empty">No Run is open. Run history opens from a stopped Run, an Epic or the Command palette.</p>
  else if (runs === undefined) body = <p className="w-fr-empty">Reading the Runs of the Project…</p>
  else if (runs.length === 0 && error === null) body = <p className="w-fr-empty">This Project has no Autopilot Runs yet.</p>
  else if (view === undefined || view.run !== run)
    body = (
      <>
        {runs.length > 0 && run !== null ? (
          <header className="w-fr-header">
            <h1 className="w-fr-header__title">Run history</h1>
            <select className="w-fr-select" aria-label="Run" value={run} onChange={(event) => void chooseRun(event.target.value)} data-testid="run-history-choose">
              {runs.map((each) => (
                <option key={each.run} value={each.run}>
                  {runOption(each)}
                </option>
              ))}
            </select>
          </header>
        ) : null}
        <p className="w-fr-empty">{error === null ? 'Computing the timeline of the Run…' : `The Run could not be read: ${error}`}</p>
      </>
    )
  else
    body = (
      <>
        <Header view={view} runs={runs} />
        {view.error !== null ? (
          <div className="w-fr-notice" role="status">
            The timeline stopped following the Run: {view.error}
          </div>
        ) : null}
        <SummaryStrip view={view} />
        <Timeline view={view} />
        {view.skippedLines > 0 ? <p className="w-fr-footnote">{view.skippedLines} lines of the Journal were left out: not JSON, or of an unknown kind.</p> : null}
      </>
    )

  return (
    <div className="w-fr" data-testid="run-history" aria-label="Run history">
      {body}
    </div>
  )
}
