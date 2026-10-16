import { useStoreApi, type InternalNode } from '@xyflow/react'
import { failureReason } from '../../../shared/ipc/channels'
import { EPIC_FRAME_KIND, ticketNodeId } from '../../../shared/layout/derived'
import { useWorkflow } from '../../workflow/useWorkflow'
import { invoke } from '../../ipc'
import { useReadOnly } from '../../projects/useProjects'
import type { SlotProps } from '../badges'
import { FRAME_GAP } from '../epic-layout'
import type { CanvasFlowNode } from '../nodes'
import type { EpicFrameData } from '../sources/epics'
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
// of the Epic frames' column, at the Ticket's height (`shipTicketSpot`), and main puts the Node on
// the first clear spot there. Outside that band the Session does not move the column (ADR-0032).

export const order = 10

/**
 * Where "Ship ticket" asks for its Session, from the Nodes on the Canvas: one FRAME_GAP right of
 * the frames' column — its left edge (`auto.x`, without a manual offset) plus the widest frame —
 * at the top of the Ticket as it is drawn. Undefined when the Ticket or the frames are not on the
 * Canvas; main then places the Node as it places every new one.
 */
function shipTicketSpot(nodes: Iterable<InternalNode<CanvasFlowNode>>, epic: string, num: number): { x: number; y: number } | undefined {
  const id = ticketNodeId(epic, num)
  let ticketY: number | undefined
  let columnRight = -Infinity
  for (const node of nodes) {
    if (node.id === id) ticketY = node.internals.positionAbsolute.y
    if (node.type === EPIC_FRAME_KIND) {
      const frame = node.data.node.data as EpicFrameData
      columnRight = Math.max(columnRight, frame.auto.x + (node.width ?? 0))
    }
  }
  if (ticketY === undefined || !Number.isFinite(columnRight)) return undefined
  return { x: Math.ceil(columnRight + FRAME_GAP), y: Math.round(ticketY) }
}

/** The Canvas's React Flow store; null where the button is drawn outside a Canvas. */
function useCanvasStore(): ReturnType<typeof useStoreApi<CanvasFlowNode>> | null {
  try {
    return useStoreApi<CanvasFlowNode>()
  } catch {
    return null
  }
}

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
        const near = store ? shipTicketSpot(store.getState().nodeLookup.values(), ticket.epic, ticket.num) : undefined
        const result = await invoke('actions.shipTicket', { projectId, epic: ticket.epic, num: ticket.num, ...(near ? { near } : {}) })
        return result.ok ? undefined : failureReason('actions.shipTicket', result.error)
      }}
    />
  )
}

export default function TicketActions({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ShipTicket {...subject} /> : null
}
