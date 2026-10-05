import { failureReason } from '../../../shared/ipc/channels'
import { useWorkflow } from '../../workflow/useWorkflow'
import { invoke } from '../../ipc'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'
import { hasShipTicket, useShipTicketState } from './gates'

// "Ship ticket" on a Ticket (ticket 23). Active when the Ticket is open, every blocker is done and
// the Project's template is set and renders; otherwise inactive, and its tooltip says why
// («blocked by 09», «Set the Ship ticket template in Project settings»). A click asks main to start
// a new Session in the Project's root with the rendered template (`actions.shipTicket`); main checks
// the same conditions again over a fresh read. While a Session it launched for the Ticket is live
// (the Ticket stays open until that agent runs `ticket claim`), the button is inactive and says so
// (launches.ts). A Ticket in work or done shows no button: there is nothing to ship.

export const order = 10

function ShipTicket({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const { model } = useWorkflow(root)
  const state = useShipTicketState(projectId, ticket, model?.tickets ?? [ticket])
  if (!hasShipTicket(ticket)) return null
  return (
    <ActionButton
      label="Ship ticket"
      testId="action-ship-ticket"
      primary
      enabled={state.enabled}
      title={state.enabled ? state.text : state.reason}
      run={async () => {
        const result = await invoke('actions.shipTicket', { projectId, epic: ticket.epic, num: ticket.num })
        return result.ok ? undefined : failureReason('actions.shipTicket', result.error)
      }}
    />
  )
}

export default function TicketActions({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ShipTicket {...subject} /> : null
}
