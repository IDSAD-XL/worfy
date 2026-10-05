import { runWaveState } from '../../../shared/actions/render-template'
import { useProjects } from '../../projects/useProjects'
import { invoke } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { useActionTemplates } from './templates'

// "Run wave" on an Epic frame (ticket 23). Active when the Epic's ready Wave is not empty and the
// Project's template is set and renders; otherwise inactive, and its tooltip says why. A click asks
// main to send the rendered template to the Project's Orchestrator (`actions.runWave`): at once, or
// into its queue while it is busy. An Epic whose Tickets are all done shows no button.

export const order = 20

function RunWave({ projectId, epic, tickets }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const branch = useProjects()?.projects.find((project) => project.id === projectId)?.branch ?? null
  const templates = useActionTemplates(projectId)
  const mine = tickets.filter((ticket) => ticket.epic === epic.epic)
  if (mine.length > 0 && mine.every((ticket) => ticket.state === 'done')) return null
  const state =
    templates === undefined
      ? ({ enabled: false, reason: 'Reading the Project settings…' } as const)
      : runWaveState({ epic: epic.epic, tickets, template: templates.runWave, branch })
  return (
    <ActionButton
      label="Run wave"
      testId="action-run-wave"
      primary
      enabled={state.enabled}
      title={state.enabled ? state.text : state.reason}
      run={async () => {
        const result = await invoke('actions.runWave', { projectId, epic: epic.epic })
        // main's reason without the channel name the IPC wrapper puts in front of it
        return result.ok ? undefined : result.error.replace(/^actions\.runWave failed: /u, '')
      }}
    />
  )
}

export default function EpicActions({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <RunWave {...subject} /> : null
}
