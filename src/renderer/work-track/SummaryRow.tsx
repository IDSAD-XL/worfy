// The summary of the period (worfy-work-track ticket 10; spec «What the owner sees», 3; owner decision 10): one
// row over the lanes, as the prototype on Card card-dcf3918a has it — «Hours by Epic», bars with their hours in
// up to three columns, the Epics past six as «+N»; then «of work in total», «PRs merged», «Autopilot Runs» and
// «no-data gaps» with its hint. The numbers are main's summary of the answer (src/shared/work-track/summary.ts):
// hours are the union of the work, so parallel Subagents count once.
import type { WorkTrackView } from '../../shared/ipc/work-track'
import { WORK_SOURCE_LABELS } from '../../shared/work-track/facts'
import { hoursText } from './store'

/** The Epics with a bar of their own: three columns of two rows. */
const SHOWN_EPICS = 6
/** The width of the longest Epic's bar, in pixels. */
const BAR_PX = 56

const TOTAL_TIP = 'Turns, Subagents and Waves, each moment once: work done in parallel counts once'
const GAPS_TIP = 'Parts of the period where a source has no data. Hover a hatched area to see the source and why.'

function Kpi({ value, words, testId, title }: { value: string; words: string; testId: string; title?: string }) {
  return (
    <div className="w-wt-kpi" title={title}>
      <b className="w-wt-kpi__value" data-testid={testId}>
        {value}
      </b>
      <span className="w-wt-kpi__words">{words}</span>
    </div>
  )
}

export function SummaryRow({ summary }: { summary: WorkTrackView['summary'] }) {
  const shown = summary.byEpic.slice(0, SHOWN_EPICS)
  const rest = summary.byEpic.slice(SHOWN_EPICS)
  const most = Math.max(1, ...shown.map((epic) => epic.ms))
  const gapsTip = [GAPS_TIP, ...summary.gaps.map((gap) => `${WORK_SOURCE_LABELS[gap.source]}: ${gap.why.join(' ')}`)].join('\n')
  return (
    <section className="w-wt-summary" data-testid="work-track-summary" aria-label="Summary of the period">
      <div className="w-wt-summary__epics">
        <h3 className="w-wt-summary__title">
          Hours by Epic
          {rest.length > 0 ? (
            <span className="w-wt-summary__more" data-testid="work-track-epic-more" title={rest.map((epic) => `${epic.epic} ${hoursText(epic.ms)}`).join('\n')}>
              +{rest.length}
            </span>
          ) : null}
        </h3>
        {shown.length === 0 ? (
          <span className="w-wt-summary__none">No work in this period</span>
        ) : (
          <div className="w-wt-summary__grid">
            {shown.map((epic) => (
              <div key={epic.epic} className="w-wt-epic" data-testid="work-track-epic-hours">
                <span className="w-wt-epic__name" title={epic.epic}>
                  {epic.epic}
                </span>
                <span className="w-wt-epic__bar" aria-hidden="true" style={{ width: `${Math.max(3, (epic.ms / most) * BAR_PX)}px` }} />
                <span className="w-wt-epic__hours">{hoursText(epic.ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Kpi value={hoursText(summary.workMs)} words="of work in total" testId="work-track-total" title={TOTAL_TIP} />
      <Kpi value={String(summary.prsMerged)} words="PRs merged" testId="work-track-prs" />
      <Kpi value={String(summary.runs)} words="Autopilot Runs" testId="work-track-runs" />
      <Kpi value={String(summary.gapCount)} words="no-data gaps" testId="work-track-gaps" title={gapsTip} />
    </section>
  )
}
