// Blocking arrows inside an Epic frame: from each blocker to the Ticket it blocks, as the
// Ticket's "Blocked by" says. An arrow from a blocker that is not done yet is dashed ("waits on");
// one from a done blocker is a faint solid line. An arrow is drawn only when both Tickets are on
// the Canvas: a folded done stack or a collapsed frame hides theirs.
import { MarkerType, type Edge } from '@xyflow/react'
import type { LayoutNode } from '../../../shared/layout/types'
import type { Ticket } from '../../../shared/workflow/types'
import { TICKET_KIND, ticketNodeId } from '../sources/epics'

const ticketOf = (node: LayoutNode): Ticket | undefined => {
  const ticket = (node.data as { ticket?: Ticket }).ticket
  return node.kind === TICKET_KIND && ticket !== undefined && Array.isArray(ticket.blockedNums) ? ticket : undefined
}

export default function blockingEdges(nodes: readonly LayoutNode[]): Edge[] {
  const tickets = new Map<string, Ticket>()
  for (const node of nodes) {
    const ticket = ticketOf(node)
    if (ticket) tickets.set(node.id, ticket)
  }
  const edges: Edge[] = []
  for (const [target, ticket] of tickets) {
    for (const blocker of new Set(ticket.blockedNums)) {
      const source = ticketNodeId(ticket.epic, blocker)
      const from = tickets.get(source)
      if (!from || source === target) continue
      const waiting = from.state !== 'done'
      const color = waiting ? 'var(--text-muted)' : 'var(--border-strong)'
      edges.push({
        id: `blocks:${ticket.epic}/${blocker}->${ticket.num}`,
        source,
        target,
        className: waiting ? 'w-edge-blocking w-edge-blocking--waits' : 'w-edge-blocking w-edge-blocking--done',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        selectable: false,
        focusable: false,
        deletable: false,
        ariaLabel: `${String(blocker).padStart(2, '0')} blocks ${String(ticket.num).padStart(2, '0')}`,
        data: { kind: 'blocking', epic: ticket.epic, blocker, blocked: ticket.num, waiting },
      })
    }
  }
  return edges
}
