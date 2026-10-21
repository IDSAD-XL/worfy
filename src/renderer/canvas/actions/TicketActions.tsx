import { failureReason } from '../../../shared/ipc/channels'
import { useWorkflow } from '../../workflow/useWorkflow'
import { invoke } from '../../ipc'
import { useReadOnly } from '../../projects/useProjects'
import type { SlotProps } from '../badges'
import { useCanvasStore } from '../canvas-store'
import { sessionSpot, spotInputs } from '../session-spot'
import { ActionButton } from './action-button'
import { hasShipTicket, useShipTicketState } from './gates'

// "Ship ticket" on a Ticket (ticket 23). Active when the Ticket is open, every blocker is done and
// the Project's template is set and renders; otherwise inactive, and its tooltip says why
// («blocked by 09», «Set the Ship ticket template in Project settings»). A click asks main to start
// a new Session in the Project's root with the rendered template (`actions.shipTicket`); main checks
// the same conditions again over a fresh read. While a Session it launched for the Ticket is live
// (the Ticket stays open until that agent runs `ticket claim`), the button is inactive and says so
// (launches.ts). A Ticket in work or done shows no button: there is nothing to ship.
//
// The new Session goes next to its Ticket (worfy-daily ticket 28): the click sends the spot right
// of the strip of Epic frames, at the Ticket's height (`sessionSpot`, worfy-canvas ticket 11), and
// main puts the Node on the first clear spot there. Outside that band the Session does not move
// the strip (ADR-0032). Without the Ticket or the frames on the Canvas no spot is sent, and main
// places the Node as it places every new one.

export const order = 10

function ShipTicket({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const { model } = useWorkflow(root)
  const state = useShipTicketState(projectId, ticket, model?.tickets ?? [ticket])
  const store = useCanvasStore()
  // Inactive on a read-only screen (worfy-link ticket 25), with the reason.
  const readOnly = useReadOnly()
  if (!hasShipTicket(ticket)) return null
  return (
    <ActionButton
      label="Ship ticket"
      testId="action-ship-ticket"
      primary
      enabled={readOnly === null && state.enabled}
      title={readOnly ?? (state.enabled ? state.text : state.reason)}
      run={async () => {
        const { frames, strip } = store ? spotInputs(store.getState().nodeLookup.values()) : { frames: [], strip: undefined }
        const near = sessionSpot({ kind: 'ticket', epic: ticket.epic, num: ticket.num }, frames, strip)
        const result = await invoke('actions.shipTicket', { projectId, epic: ticket.epic, num: ticket.num, ...(near ? { near } : {}) })
        return result.ok ? undefined : failureReason('actions.shipTicket', result.error)
      }}
    />
  )
}

export default function TicketActions({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ShipTicket {...subject} /> : null
}
