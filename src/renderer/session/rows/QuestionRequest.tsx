import { QuestionCard } from '../QuestionCard'
import type { TranscriptRowProps } from './index'

// Questions with answer options of a live Session (worfy-ui ticket 17), drawn as their card (../QuestionCard.tsx).
export const eventType = 'question_request'

export default function QuestionRequest({ event, sessionId, projectId }: TranscriptRowProps) {
  if (event.type !== 'question_request') return null
  return <QuestionCard request={event} sessionId={sessionId} projectId={projectId} />
}
