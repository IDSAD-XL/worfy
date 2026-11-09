// What a live Session waits for from the user, from its events in this window (store.ts): the
// permission requests and the questions (worfy-ui ticket 17) not resolved yet. The Session's state
// says `needs_permission` for both; the Node's badges (canvas/badges/NeedsPermission.tsx,
// WaitsForAnswer.tsx) tell them apart by this. A window that opened or reloaded after a request
// arrived has not seen it: useWaitingRequests then asks main for the open ones (worfy-product-session
// ticket 30), so the card is drawn and the counts are right.
import { useEffect, useMemo, useState } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { loadOpenRequests, useSessionLog } from './store'

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

/** The open requests, and whether the Session waits for an answer with no request this window can draw. */
export interface WaitingRequests extends OpenRequests {
  /** `needs_permission`, and main gave no open request either: no card can be drawn, Interrupt still refuses it. */
  unseen: boolean
}

/**
 * The open requests of a live Session in state `state`; while it stands at `needs_permission` and this
 * window holds none of its requests — it opened or reloaded after they went out — asks main for them
 * once (worfy-product-session ticket 30): the Session would wait for an answer with no card to give it.
 */
export function useWaitingRequests(sessionId: string | null, state: string | null): WaitingRequests {
  const requests = useOpenRequests(sessionId)
  const missing = sessionId !== null && state === 'needs_permission' && requests.permissions === 0 && requests.questions.length === 0
  // The Session whose requests main was asked for, once its answer is in.
  const [asked, setAsked] = useState<string | null>(null)
  useEffect(() => {
    if (!missing) return
    let live = true
    void loadOpenRequests(sessionId).then(() => {
      if (live) setAsked(sessionId)
    })
    return () => {
      live = false
    }
  }, [sessionId, missing])
  return { ...requests, unseen: missing && asked === sessionId }
}
