import { shipTicketState } from '../../../shared/actions/render-template'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { invoke } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { useActionTemplates } from './templates'

// "Ship ticket" on a Ticket (ticket 23). Active when the Ticket is open, every blocker is done and
// the Project's template is set and renders; otherwise inactive, and its tooltip says why
// («blocked by 09», «Set the Ship ticket template in Project settings»). A click asks main to start
// a new Session in the Project's root with the rendered template (`actions.shipTicket`); main checks
// the same conditions again over a fresh read. A Ticket in work or done shows no button: there is
// nothing to ship.

export const order = 10

function ShipTicket({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const { model } = useWorkflow(root)
  const branch = useProjects()?.projects.find((project) => project.id === projectId)?.branch ?? null
  const templates = useActionTemplates(projectId)
  if (ticket.state === 'work' || ticket.state === 'done') return null
  const state =
    templates === undefined
      ? ({ enabled: false, reason: 'Reading the Project settings…' } as const)
      : shipTicketState({ ticket, tickets: model?.tickets ?? [ticket], template: templates.shipTicket, branch })
  return (
    <ActionButton
      label="Ship ticket"
      testId="action-ship-ticket"
      primary
      enabled={state.enabled}
      title={state.enabled ? state.text : state.reason}
      run={async () => {
        const result = await invoke('actions.shipTicket', { projectId, epic: ticket.epic, num: ticket.num })
        // main's reason without the channel name the IPC wrapper puts in front of it
        return result.ok ? undefined : result.error.replace(/^actions\.shipTicket failed: /u, '')
      }}
    />
  )
}

export default function TicketActions({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ShipTicket {...subject} /> : null
}
