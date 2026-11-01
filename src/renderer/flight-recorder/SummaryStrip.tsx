// The summary over the timeline (worfy-flight-recorder ticket 18; decision 03, Q8; decision 05, point 1):
// where the time of the Run went. The three longest Stages by self time as cards (a click selects the
// Stage on the timeline), the work inside Stages by subkind, summed over parallel spans, and the Waits by
// cause. A cause that counts only its time with no work running (COUNTED_WITHOUT_WORK, ticket 26) says
// so: its total is shorter than its bars on the Wait lane.
import type { WaitCause } from '../../shared/flight-recorder/facts'
import { COUNTED_WITHOUT_WORK, WITHOUT_WORK_NOTE } from '../../shared/flight-recorder/summary'
import type { RunView } from '../../shared/ipc/runs'
import { formatDuration, revealSpan } from './store'

const WORK_WORDS: Record<string, string> = { implementer: 'implementers', verifier: 'verifiers', other: 'other agents', ci: 'CI runs', gate: 'gate runs', script: 'scripts' }
// Every cause has its words: a new cause in WAIT_CAUSES fails typecheck here until it gets them.
const WAIT_WORDS: Readonly<Record<WaitCause, string>> = {
  limits: 'Limits',
  'limits-budget': 'Limits budget',
  'start-window': 'Start window',
  'background-tasks': 'background tasks',
  'gate-queue': 'gate queue',
  'other-machine': 'other Machine',
}
const percent = (share: number): string => `${Math.round(share * 100)}%`

export function SummaryStrip({ view }: { view: RunView }) {
  const { summary } = view
  const waitTotal = summary.waits.reduce((sum, row) => sum + row.total, 0)
  const workMax = Math.max(1, ...summary.work.map((row) => row.total))
  const waitMax = Math.max(1, ...summary.waits.map((row) => row.total))
  return (
    <section className="w-fr-summary" aria-label="Where the time went" data-testid="run-history-summary">
      <div className="w-fr-summary__group">
        <h3 className="w-fr-summary__title">Longest Stages by self time</h3>
        <div className="w-fr-cards">
          {summary.topStages.length === 0 ? <span className="w-fr-muted">No Stages</span> : null}
          {summary.topStages.map((stage) => (
            <button key={stage.spanId} type="button" className="w-fr-card" data-testid="run-history-stage-card" data-span-id={stage.spanId} onClick={() => revealSpan(stage.spanId)}>
              <span className="w-fr-card__value">{formatDuration(stage.selfTime)}</span>
              <span className="w-fr-card__name">
                {stage.name}
                {stage.attempt > 1 ? ` #${stage.attempt}` : ''} · Ticket {stage.ticket.split('/').at(-1)}
              </span>
              <span className="w-fr-muted">self of {formatDuration(stage.duration)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="w-fr-summary__group" data-testid="run-history-work">
        <h3 className="w-fr-summary__title">Work inside Stages ({summary.workNote})</h3>
        {summary.work.length === 0 ? <span className="w-fr-muted">No work</span> : null}
        {summary.work.map((row) => (
          <div key={row.subkind} className="w-fr-total">
            <span className="w-fr-total__name">{WORK_WORDS[row.subkind] ?? row.subkind}</span>
            <span className={`w-fr-total__bar w-fr-bar--${row.subkind === 'other' ? 'agent' : row.subkind}`} style={{ width: Math.max(3, (row.total / workMax) * 96) }} />
            <span className="w-fr-total__value">{formatDuration(row.total)}</span>
            <span className="w-fr-muted">×{row.count}</span>
          </div>
        ))}
      </div>
      <div className="w-fr-summary__group" data-testid="run-history-waits">
        <h3 className="w-fr-summary__title">
          Waits by cause — {formatDuration(waitTotal)} ({percent(summary.runDuration > 0 ? waitTotal / summary.runDuration : 0)} of the Run)
        </h3>
        {summary.waits.length === 0 ? <span className="w-fr-muted">No Waits</span> : null}
        {summary.waits.map((row) => (
          <div key={row.cause} className="w-fr-total" data-cause={row.cause}>
            <span className="w-fr-total__name">
              {WAIT_WORDS[row.cause]}
              {COUNTED_WITHOUT_WORK.has(row.cause) ? <span className="w-fr-muted"> · {WITHOUT_WORK_NOTE}</span> : null}
            </span>
            <span className="w-fr-total__bar w-fr-total__bar--wait" style={{ width: Math.max(3, (row.total / waitMax) * 96) }} />
            <span className="w-fr-total__value">{formatDuration(row.total)}</span>
            <span className="w-fr-muted">{percent(row.share)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
