import { useEffect } from 'react'
import { create } from 'zustand'
import { autopilotStatusLine, type AutopilotState } from '../../../shared/ipc/autopilot'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, subscribe } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { hasRunWave, useRunWaveState } from './gates'

// "Autopilot" and "Stop autopilot" on an Epic frame (worfy-daily ticket 04, ADR-0024), with the
// run's status line: "Wave 3 · running", "Wave 3 · 4 background tasks" (ticket 29, ADR-0029: the
// Orchestrator's background tasks still run), "waiting for limits · resumes 14:20" (ticket 05),
// "stopped: no ready wave". A run that waits for the Limits or for background tasks is still a run:
// Stop is offered and stops it. Stop interrupts the Orchestrator and its background tasks (worfy-week
// ticket 17, ADR-0050): main halts the turn, up to 15 s, and gives the Orchestrator back with its old
// process closed; worktrees and branches stay. Until main answers, the button says "Stopping…" and
// takes no click. A later Autopilot over the Epic takes the interrupted Wave's Tickets that are
// still in work into its first Wave (`resumable`), so the button is available for them too.
// Autopilot can start when "Run wave" could (the same verdict, gates.ts) with a template that names
// the Wave's Tickets ({tickets}, ADR-0033), and the Project has no run; main checks again and may still refuse (the Orchestrator is in a turn, worfy's own
// repository in a development build): the button then shows main's reason. The Project's run state
// is asked once (`autopilot.state`), then taken from `autopilot.changed`; a state replaces the one
// before it only with a higher revision.
//
// A run keeps the display on from its start to its end (ticket 32, ADR-0034): the hints of the
// "Autopilot" button and of the status line while running or waiting say so. The visible line does
// not: 220px is already taken by its longest lines.

export const order = 30

/** Added to the hints of a run that holds keep-awake (ADR-0034). */
export const DISPLAY_STAYS_ON = 'The display stays on until the run ends'

/** The title of Stop: what it does (worfy-week ticket 17). */
const stopTitle = (epic: string): string => `Stop Autopilot over ${epic}: interrupts the Orchestrator and its background tasks; worktrees stay`

/** The title of the button while Stop waits for main. */
export const STOPPING_TITLE = 'Stopping Autopilot: the Orchestrator\'s turn is being interrupted'

interface AutopilotStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, AutopilotState>>
  /** Projects whose `autopilot.stop` has not answered yet. */
  stopping: Readonly<Record<string, true>>
}

const useAutopilotStore = create<AutopilotStore>(() => ({ byProject: {}, stopping: {} }))

function setStopping(projectId: string, on: boolean): void {
  useAutopilotStore.setState(({ stopping }) => {
    const next = { ...stopping }
    if (on) next[projectId] = true
    else delete next[projectId]
    return { stopping: next }
  })
}

const asked = new Set<string>()
let subscribed = false

function take(state: AutopilotState): void {
  useAutopilotStore.setState(({ byProject }) => {
    const known = byProject[state.projectId]
    if (known !== undefined && known.revision >= state.revision) return {}
    return { byProject: { ...byProject, [state.projectId]: state } }
  })
}

function ensure(projectId: string): void {
  if (!subscribed) {
    subscribed = true
    try {
      subscribe('autopilot.changed', take)
    } catch (error) {
      subscribed = false
      console.error('autopilot.changed: cannot subscribe', error)
    }
  }
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('autopilot.state', { projectId }).then((result) => {
    if (result.ok) take(result.value)
    else {
      asked.delete(projectId)
      console.error('autopilot.state failed:', result.error)
    }
  })
}

function useAutopilot(projectId: string): AutopilotState | undefined {
  useEffect(() => ensure(projectId), [projectId])
  return useAutopilotStore((store) => store.byProject[projectId])
}

/** Starts a run; its first state is taken at once. Resolves to main's reason when refused. */
async function start(projectId: string, epic: string): Promise<string | undefined> {
  const result = await invoke('autopilot.start', { projectId, epic })
  if (!result.ok) return failureReason('autopilot.start', result.error)
  take(result.value)
  return undefined
}

/**
 * Stops the Project's run; its last state is taken at once. Main answers once the Orchestrator's
 * turn is interrupted and the Orchestrator given back; meanwhile the button is "Stopping…".
 */
async function stop(projectId: string): Promise<string | undefined> {
  if (useAutopilotStore.getState().stopping[projectId] === true) return undefined
  setStopping(projectId, true)
  try {
    const result = await invoke('autopilot.stop', { projectId })
    if (!result.ok) return failureReason('autopilot.stop', result.error)
    take(result.value)
    return undefined
  } finally {
    setStopping(projectId, false)
  }
}

const noRun = (): Promise<undefined> => Promise.resolve(undefined)

function Autopilot({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const state = useAutopilot(projectId)
  const mine = state?.epic === epic.epic
  // Only the frame of the Epic being stopped says so.
  const stopping = useAutopilotStore((store) => store.stopping[projectId] === true) && mine
  const running = state?.status === 'running' || state?.status === 'waiting'
  // After a Stop of this Epic, the Tickets it interrupted count as ready while still in work.
  const wave = useRunWaveState(projectId, epic.epic, tickets, true, mine && !running ? (state?.resumable ?? []) : [])
  const line = mine && state !== undefined ? autopilotStatusLine(state) : null
  if (!hasRunWave(epic.epic, tickets) && !(mine && running) && line === null && !stopping) return null

  const button = stopping ? (
    <ActionButton label="Stopping…" testId="action-stop-autopilot" enabled={false} title={STOPPING_TITLE} run={noRun} />
  ) : mine && running ? (
    <ActionButton label="Stop autopilot" testId="action-stop-autopilot" enabled title={stopTitle(epic.epic)} run={() => stop(projectId)} />
  ) : (
    <ActionButton
      label="Autopilot"
      testId="action-autopilot"
      enabled={!running && wave.enabled}
      title={running ? `Autopilot is running Epic ${state?.epic ?? ''}` : wave.enabled ? `Run the Waves of ${epic.epic} one after another, without a person. ${DISPLAY_STAYS_ON}` : wave.reason}
      run={() => start(projectId, epic.epic)}
    />
  )
  if (line === null) return button
  // The status line goes above the button, out of the header's row: it takes no width from the
  // Epic's title, and runs left over the actions beside the button through the header's top margin
  // (56px header: the 20px button centred, 18px free above it). It stays inside the header: below
  // it, a Node placed over the Epic's frame (the Orchestrator lands at 40,40 of the Canvas) would
  // be under the line. 220px holds the longest lines whole, "waiting for limits · resumes 14:20"
  // and "Wave 1 · 2 background tasks" (test/e2e/autopilot.spec.ts checks both).
  return (
    <div className="nodrag" style={{ flex: 'none', position: 'relative' }}>
      {button}
      <span
        data-testid="autopilot-status"
        data-status={state?.status}
        title={state?.message ?? (running ? `${line}. ${DISPLAY_STAYS_ON}` : line)}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 'calc(100% + 2px)',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontSize: 'var(--text-11)',
          lineHeight: '14px',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
        }}
      >
        {line}
      </span>
    </div>
  )
}

export default function AutopilotAction({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <Autopilot {...subject} /> : null
}
