// Blocking arrows inside an Epic frame: from each blocker to the Ticket it blocks, as the
// Ticket's "Blocked by" says. Every arrow is a thin pale line; one from a blocker that is not done
// yet is dashed ("waits on"). One from a done blocker is in the list but not drawn until it is on
// the chain of a hovered or selected Ticket (edge-focus.ts, worfy-week ticket 05), and then it is a
// solid line. The list does not change with the pointer. An arrow is drawn only when both Tickets are on
// the Canvas: a folded done stack or a collapsed frame hides theirs. Each arrow follows the route
// the frame's layout made for it (edge-types/RoutedEdge.tsx, ADR-0037): out of the blocker's right
// side, through the corridors between the columns, into the blocked Ticket's left side.
import { MarkerType, type Edge } from '@xyflow/react'
import type { LayoutNode } from '../../../shared/layout/types'
import type { Ticket } from '../../../shared/workflow/types'
import { routeKey, type Point } from '../epic-layout'
import { kind as ROUTED_EDGE } from '../edge-types/RoutedEdge'
import { EPIC_FRAME_KIND, TICKET_KIND, ticketNodeId, type EpicFrameData } from '../sources/epics'

const ticketOf = (node: LayoutNode): Ticket | undefined => {
  const ticket = (node.data as { ticket?: Ticket }).ticket
  return node.kind === TICKET_KIND && ticket !== undefined && Array.isArray(ticket.blockedNums) ? ticket : undefined
}

/** The routes of a frame's layout, by Epic; a Layout Node of that kind carries none. */
const routesOf = (node: LayoutNode): [string, Readonly<Record<string, readonly Point[]>>] | undefined => {
  const frame = node.data as Partial<EpicFrameData>
  return node.kind === EPIC_FRAME_KIND && frame.epic !== undefined && frame.layout?.routes !== undefined ? [frame.epic.epic, frame.layout.routes] : undefined
}

export default function blockingEdges(nodes: readonly LayoutNode[]): Edge[] {
  const tickets = new Map<string, Ticket>()
  const routes = new Map<string, Readonly<Record<string, readonly Point[]>>>()
  for (const node of nodes) {
    const ticket = ticketOf(node)
    if (ticket) tickets.set(node.id, ticket)
    const frame = routesOf(node)
    if (frame) routes.set(...frame)
  }
  const edges: Edge[] = []
  for (const [target, ticket] of tickets) {
    for (const blocker of new Set(ticket.blockedNums)) {
      const source = ticketNodeId(ticket.epic, blocker)
      const from = tickets.get(source)
      if (!from || source === target) continue
      const waiting = from.state !== 'done'
      edges.push({
        id: `blocks:${ticket.epic}/${blocker}->${ticket.num}`,
        source,
        target,
        type: ROUTED_EDGE,
        className: waiting ? 'w-edge-blocking w-edge-blocking--waits' : 'w-edge-blocking w-edge-blocking--done',
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border-strong)', width: 14, height: 14 },
        selectable: false,
        focusable: false,
        deletable: false,
        ariaLabel: `${String(blocker).padStart(2, '0')} blocks ${String(ticket.num).padStart(2, '0')}`,
        data: { kind: 'blocking', epic: ticket.epic, blocker, blocked: ticket.num, waiting, idle: waiting ? 'pale' : 'hidden', route: routes.get(ticket.epic)?.[routeKey(blocker, ticket.num)] },
      })
    }
  }
  return edges
}
