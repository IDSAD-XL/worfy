import { useMemo } from 'react'
import { epicHistory, useArchive } from '../archive-list'
import type { SlotProps } from '../badges'
import { SessionHistoryButton } from '../session-history'
import '../overlays/archive.css'

// «N sessions» in an Epic frame's header (worfy-canvas ticket 09, ADR-0076): the archived Sessions
// bound to the Epic and to each of its Tickets, newest first. Show brings a Node back next to its
// Ticket, or next to the frame's header for one bound to the Epic (../session-history.tsx).
export const order = 40

function EpicSessions({ projectId, epic }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const list = useArchive(projectId)
  const sessions = useMemo(() => epicHistory(list, epic.epic), [list, epic.epic])
  return (
    <SessionHistoryButton
      projectId={projectId}
      sessions={sessions}
      heading={`Archived sessions of ${epic.epic}`}
      label={`archived of epic ${epic.epic}`}
      className="w-action"
      testId="epic-sessions"
    />
  )
}

export default function EpicSessionHistory({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <EpicSessions {...subject} /> : null
}
