// The Work track view (worfy-work-track ticket 09; spec «What the owner sees», 1–2, 4–6; the prototype on
// Card card-dcf3918a): the row of controls — the switch of the Runs tab, Period «Day | Week | Month» (Week
// by default) with ‹ › and the words of the period, Lanes «by Session | by Epic», Density «compact |
// comfortable» — then the lanes of the period (Lanes.tsx; the Month as cells of days, MonthGrid.tsx) and
// the legend of the colours. The answer of main comes at once without the slow sources, which a line names
// while they are read; a source that fails is a hatched «no data» on the lanes, not an empty screen.
import { useEffect, type ReactNode } from 'react'
import type { WorkTrackSlowSource } from '../../shared/ipc/work-track'
import type { PeriodKind } from '../../shared/work-track/facts'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { Lanes } from './Lanes'
import { canGoLater, periodLabel, periodOf, readWorkTrack, setDensity, setLanes, setPeriod, shiftPeriod, showWorkTrack, useWorkTrack, type Density, type LaneMode } from './store'
import './work-track.css'

const PERIODS: readonly SegmentOption<PeriodKind>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]
const LANES: readonly SegmentOption<LaneMode>[] = [
  { value: 'session', label: 'by Session' },
  { value: 'epic', label: 'by Epic' },
]
const DENSITIES: readonly SegmentOption<Density>[] = [
  { value: 'compact', label: 'compact' },
  { value: 'comfortable', label: 'comfortable' },
]

const SLOW_WORDS: Readonly<Record<WorkTrackSlowSource, string>> = { transcripts: 'transcripts', github: 'GitHub' }

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w-wt-group">
      <span className="w-wt-group__label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  )
}

function Legend() {
  const swatch = (kind: string, words: string) => (
    <span className="w-wt-legend__item">
      <i className={`w-wt-legend__swatch w-wt-bar--${kind}`} aria-hidden="true" />
      {words}
    </span>
  )
  return (
    <footer className="w-wt-legend" data-testid="work-track-legend">
      {swatch('turn', 'Session turn')}
      {swatch('implementer', 'implementer')}
      {swatch('verifier', 'verifier')}
      {swatch('agent', 'other Subagent')}
      {swatch('wave', 'Run / Wave')}
      {swatch('gate', 'gate run')}
      <span className="w-wt-legend__item">
        <i className="w-wt-legend__swatch w-wt-legend__swatch--problem" aria-hidden="true" />
        failed / rejected
      </span>
      <span className="w-wt-legend__item">
        <i className="w-wt-legend__diamond" aria-hidden="true" />
        PR merged
      </span>
      <span className="w-wt-legend__item">
        <i className="w-wt-legend__swatch w-wt-legend__swatch--gap" aria-hidden="true" />
        no data
      </span>
      <span className="w-wt-legend__note">All Sessions of this Machine, hidden and archived too · titles only · times are local</span>
    </footer>
  )
}

/**
 * The Work track of `projectId`. `active` — the window shows the Runs tab: the view reads the Project's
 * Work track each time it becomes active. `switcher` — the switch of the Runs tab, first in the row.
 */
export function WorkTrackView({ projectId, active, switcher }: { projectId: string; active: boolean; switcher: ReactNode }) {
  const period = useWorkTrack((state) => state.period)
  const day = useWorkTrack((state) => state.day)
  const lanes = useWorkTrack((state) => state.lanes)
  const density = useWorkTrack((state) => state.density)
  const expanded = useWorkTrack((state) => state.expanded)
  const view = useWorkTrack((state) => (state.view?.projectId === projectId ? state.view : undefined))
  const error = useWorkTrack((state) => state.error)

  useEffect(() => {
    if (active) void showWorkTrack(projectId)
  }, [active, projectId])

  const shown = periodOf({ period, day })
  const later = canGoLater({ period, day })

  let body: ReactNode
  if (view !== undefined) body = <Lanes view={view} mode={lanes} expanded={expanded} density={density} />
  else if (error === null) body = <p className="w-wt-empty">Reading the Work track…</p>
  else body = null

  return (
    <div className="w-wt" data-testid="work-track" data-density={density} aria-label="Work track">
      <div className="w-wt-controls">
        {switcher}
        <Group label="Period">
          <SegmentedControl label="Period" options={PERIODS} value={period} onChange={(next) => void setPeriod(next)} />
        </Group>
        <div className="w-wt-group">
          <button type="button" className="w-wt-shift" aria-label="Earlier" title={`The ${period} before`} onClick={() => void shiftPeriod(-1)}>
            ‹
          </button>
          <span className="w-wt-period" data-testid="work-track-period">
            {periodLabel(shown)}
          </span>
          <button type="button" className="w-wt-shift" aria-label="Later" title={later ? `The ${period} after` : 'Nothing later: the period ends today'} disabled={!later} onClick={() => void shiftPeriod(1)}>
            ›
          </button>
        </div>
        <Group label="Lanes">
          <SegmentedControl label="Lanes" options={LANES} value={lanes} onChange={setLanes} />
        </Group>
        <Group label="Density">
          <SegmentedControl label="Density" options={DENSITIES} value={density} onChange={setDensity} />
        </Group>
        {view !== undefined && view.loading.length > 0 ? (
          <span className="w-wt-loading" role="status" data-testid="work-track-loading">
            Reading {view.loading.map((source) => SLOW_WORDS[source]).join(', ')}…
          </span>
        ) : null}
      </div>
      {error !== null ? (
        <div className="w-wt-notice" role="alert" data-testid="work-track-error">
          The Work track could not be read: {error}
          <button type="button" className="w-wt-retry" onClick={() => void readWorkTrack()}>
            Retry
          </button>
        </div>
      ) : null}
      {body}
      <Legend />
    </div>
  )
}
