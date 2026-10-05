import { openSession } from '../../session/navigation'
import { useSessionNodeViewOf } from '../../session/node-sessions'
import { StatusChip } from '../../theme/primitives'
import type { SlotProps } from './index'
import './needs-permission.css'

// "Needs permission" on the Node of a Session worfy runs, while Claude Code waits for an answer to
// a permission request (ticket 21; the request itself is a card in the transcript,
// session/PermissionCard.tsx). A click opens the Session, where the card is.
export const order = 5

export default function NeedsPermission({ subject }: SlotProps) {
  const sessionId = subject.kind === 'session' ? subject.sessionId : ''
  const view = useSessionNodeViewOf(subject.kind === 'session' ? subject.projectId : undefined, sessionId)
  if (subject.kind !== 'session' || view?.state !== 'needs_permission') return null
  return (
    <button
      type="button"
      className="w-badge-button nodrag"
      data-testid="badge-needs-permission"
      title="Claude Code waits for your answer: open the Session"
      onClick={(event) => {
        event.stopPropagation()
        openSession({ nodeId: view.nodeId, projectId: view.projectId })
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <StatusChip status="blocked" label="Needs permission" />
    </button>
  )
}
