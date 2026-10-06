import { useEffect } from 'react'
import { create } from 'zustand'
import { autopilotStatusLine, type AutopilotState } from '../../../shared/ipc/autopilot'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, subscribe } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { hasRunWave, useRunWaveState } from './gates'

// "Autopilot" and "Stop autopilot" on an Epic frame (worfy-daily ticket 04, ADR-0024), with the
// run's status line: "Wave 3 · running", "stopped: no ready wave". Autopilot can start when "Run
// wave" could (the same verdict, gates.ts) and the Project has no run; main checks again and may
// still refuse (the Orchestrator is in a turn, worfy's own repository in a development build): the
// button then shows main's reason. The Project's run state is asked once (`autopilot.state`), then
// taken from `autopilot.changed`; a state replaces the one before it only with a higher revision.

export const order = 30

interface AutopilotStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, AutopilotState>>
}

const useAutopilotStore = create<AutopilotStore>(() => ({ byProject: {} }))

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

/** Stops the Project's run; its last state is taken at once. */
async function stop(projectId: string): Promise<string | undefined> {
  const result = await invoke('autopilot.stop', { projectId })
  if (!result.ok) return failureReason('autopilot.stop', result.error)
  take(result.value)
  return undefined
}

function Autopilot({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const wave = useRunWaveState(projectId, epic.epic, tickets)
  const state = useAutopilot(projectId)
  const mine = state?.epic === epic.epic
  const running = state?.status === 'running'
  const line = mine && state !== undefined ? autopilotStatusLine(state) : null
  if (!hasRunWave(epic.epic, tickets) && !(mine && running) && line === null) return null

  const button =
    mine && running ? (
      <ActionButton label="Stop autopilot" testId="action-stop-autopilot" enabled title={`Stop Autopilot over ${epic.epic} after this step`} run={() => stop(projectId)} />
    ) : (
      <ActionButton
        label="Autopilot"
        testId="action-autopilot"
        enabled={!running && wave.enabled}
        title={running ? `Autopilot is running Epic ${state?.epic ?? ''}` : wave.enabled ? `Run the Waves of ${epic.epic} one after another, without a person` : wave.reason}
        run={() => start(projectId, epic.epic)}
      />
    )
  return (
    <>
      {line === null ? null : (
        <span
          className="w-mono nodrag"
          data-testid="autopilot-status"
          data-status={state?.status}
          title={state?.message ?? line}
          style={{ flex: 'none', fontSize: 'var(--text-12)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
        >
          {line}
        </span>
      )}
      {button}
    </>
  )
}

export default function AutopilotAction({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <Autopilot {...subject} /> : null
}
