// The Runs tab (worfy-work-track ticket 09; owner decision 1): the switch «Run history | Work track» over the
// view `history`. Each Project keeps its choice while the app runs (work-track/store.ts); a Project never
// switched shows Run history. An entry that names a Run or an Epic — the toast of a stopped Run, «History»
// of the Autopilot status line, «Run history» of an Epic's menu — shows Run history whatever was chosen.
//
// Run history stays mounted under Work track, hidden: its Esc back to the Canvas and its Canvas on another
// Project hold for both halves.
import { useEffect, type ReactNode } from 'react'
import { SegmentedControl, type SegmentOption } from '../theme/primitives'
import { useNavigation } from '../session/navigation'
import { runsTabOf, setRunsTab, useWorkTrack, type RunsTab } from '../work-track/store'
import { WorkTrackView } from '../work-track/WorkTrackView'
import { RunHistoryView } from './RunHistoryView'
import { useRunHistory } from './store'
import '../work-track/work-track.css'

const TABS: readonly SegmentOption<RunsTab>[] = [
  { value: 'history', label: 'Run history' },
  { value: 'track', label: 'Work track', title: 'All the work of the Project on this Machine over a Day, a Week or a Month' },
]

function Switch({ projectId, tab }: { projectId: string | undefined; tab: RunsTab }): ReactNode {
  return (
    <SegmentedControl
      label="Runs view"
      options={projectId === undefined ? TABS.map((option) => ({ ...option, disabled: true })) : TABS}
      value={tab}
      onChange={(next) => {
        if (projectId !== undefined) setRunsTab(projectId, next)
      }}
    />
  )
}

export function RunsView({ activeProjectId }: { activeProjectId?: string }) {
  const tab = useWorkTrack((state) => runsTabOf(state, activeProjectId))
  const active = useNavigation((state) => state.view === 'history')

  // openRunHistory asks for the focus each time (store.ts, askFocus): with a Run or an Epic named, the
  // entry is about that Run.
  useEffect(
    () =>
      useRunHistory.subscribe((state, before) => {
        if (state.focusAsked === before.focusAsked || state.projectId === null) return
        if (state.run !== null || state.epic !== null) setRunsTab(state.projectId, 'history')
      }),
    [],
  )

  const switcher = <Switch projectId={activeProjectId} tab={tab} />
  return (
    <div className="w-runs" data-testid="runs-view">
      {tab === 'history' ? <div className="w-runs__bar">{switcher}</div> : null}
      <div className="w-runs__body" hidden={tab !== 'history'}>
        <RunHistoryView activeProjectId={activeProjectId} />
      </div>
      {tab === 'track' && activeProjectId !== undefined ? <WorkTrackView projectId={activeProjectId} active={active} switcher={switcher} /> : null}
    </div>
  )
}
