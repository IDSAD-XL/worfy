import { failureReason } from '../../../shared/ipc/channels'
import { invoke } from '../../ipc'
import { useReadOnly } from '../../projects/useProjects'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { hasRunWave, useRunWaveState } from './gates'

// "Run wave" on an Epic frame (ticket 23). Active when the Epic's ready Wave is not empty and the
// Project's template is set and renders; otherwise inactive, and its tooltip says why. A click asks
// main to send the rendered template to the Project's Orchestrator (`actions.runWave`): at once, or
// into its queue while it is busy. An Epic whose Tickets are all done shows no button. On a read-only
// screen (worfy-link ticket 25) it is inactive and says so.

export const order = 20

function RunWave({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const state = useRunWaveState(projectId, epic.epic, tickets)
  const readOnly = useReadOnly()
  if (!hasRunWave(epic.epic, tickets)) return null
  return (
    <ActionButton
      label="Run wave"
      testId="action-run-wave"
      primary
      enabled={readOnly === null && state.enabled}
      title={readOnly ?? (state.enabled ? state.text : state.reason)}
      run={async () => {
        const result = await invoke('actions.runWave', { projectId, epic: epic.epic })
        return result.ok ? undefined : failureReason('actions.runWave', result.error)
      }}
    />
  )
}

export default function EpicActions({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <RunWave {...subject} /> : null
}
