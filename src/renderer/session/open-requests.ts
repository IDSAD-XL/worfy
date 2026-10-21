// What a live Session waits for from the user, from its events in this window (store.ts): the
// permission requests and the questions (worfy-ui ticket 17) not resolved yet. The Session's state
// says `needs_permission` for both; the Node's badges (canvas/badges/NeedsPermission.tsx,
// WaitsForAnswer.tsx) tell them apart by this. A window that opened after a request arrived has
// not seen it: then both counts are 0 and the state alone speaks.
import { useMemo } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { useSessionLog } from './store'

export type QuestionRequestEvent = Extract<AgentEvent, { type: 'question_request' }>

export interface OpenRequests {
  /** Open permission requests. */
  permissions: number
  /** Open questions, oldest first. */
  questions: QuestionRequestEvent[]
}

export function openRequests(events: readonly AgentEvent[]): OpenRequests {
  const resolved = new Set<string>()
  for (const event of events) if (event.type === 'permission_resolved' || event.type === 'question_resolved') resolved.add(event.requestId)
  let permissions = 0
  const questions: QuestionRequestEvent[] = []
  for (const event of events) {
    if (event.type === 'permission_request' && !resolved.has(event.requestId)) permissions += 1
    else if (event.type === 'question_request' && !resolved.has(event.requestId)) questions.push(event)
  }
  return { permissions, questions }
}

/** The open requests of a live Session; none for null. */
export function useOpenRequests(sessionId: string | null): OpenRequests {
  const { events } = useSessionLog(sessionId)
  return useMemo(() => openRequests(events), [events])
}
