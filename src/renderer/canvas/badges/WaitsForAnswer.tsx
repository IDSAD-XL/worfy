import { openSession } from '../../session/navigation'
import { useSessionNodeViewOf } from '../../session/node-sessions'
import { useOpenRequests } from '../../session/open-requests'
import { StatusChip } from '../../theme/primitives'
import type { SlotProps } from './index'
import './needs-permission.css'

// "Waits for answer" on the Node of a Session worfy runs, while Claude Code waits for the answer to
// its questions (worfy-ui ticket 17; the questions are a card in the transcript,
// session/QuestionCard.tsx). It stands where "Needs permission" stands (the same order), which
// gives way to it while every open request of the Session is a question. A click opens the Session.
export const order = 5

export default function WaitsForAnswer({ subject }: SlotProps) {
  const sessionId = subject.kind === 'session' ? subject.sessionId : ''
  const view = useSessionNodeViewOf(subject.kind === 'session' ? subject.projectId : undefined, sessionId)
  const { questions } = useOpenRequests(view?.sessionId ?? null)
  if (subject.kind !== 'session' || view?.state !== 'needs_permission' || questions.length === 0) return null
  return (
    <button
      type="button"
      className="w-badge-button nodrag"
      data-testid="badge-waits-for-answer"
      title={`Claude Code asks: ${questions[0]?.questions[0]?.question ?? ''} Open the Session to answer`}
      onClick={(event) => {
        event.stopPropagation()
        openSession({ nodeId: view.nodeId, projectId: view.projectId })
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <StatusChip status="blocked" label="Waits for answer" />
    </button>
  )
}
