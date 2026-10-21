import { ticketHistory, useArchive } from '../archive-list'
import { SessionHistoryButton } from '../session-history'
import type { SlotProps } from './index'
import '../overlays/archive.css'

// «N sessions» on a Ticket whose Sessions the automatic archive took off the Canvas (worfy-canvas
// ticket 09, ADR-0076). A click opens their list, newest first, each with its title, the time it
// ended and Show, which brings the Node back next to the Ticket (overlays/ArchivePopover.tsx).
export const order = 40

function TicketSessions({ projectId, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const sessions = ticketHistory(useArchive(projectId), ticket.epic, ticket.num)
  const name = `${ticket.epic}/${String(ticket.num).padStart(2, '0')}`
  return (
    <SessionHistoryButton
      projectId={projectId}
      sessions={sessions}
      heading={`Archived sessions of ${name}`}
      label={`archived of ticket ${name}`}
      className="w-archive-badge"
      testId="ticket-sessions"
    />
  )
}

export default function SessionHistory({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <TicketSessions {...subject} /> : null
}
