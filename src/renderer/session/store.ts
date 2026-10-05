// The events of every live Session in the renderer, by Session id: one subscription to
// `agent.event` (src/shared/ipc/agent.ts) serves every Session view. The store keeps worfy's own
// events (src/shared/agent/events.ts) as they came, with three adjustments:
//
// - a `renamed` event moves what was kept under the Session's temporary id to its new id;
// - consecutive `delta` events of one block are joined into one, so a long answer is not
//   thousands of events;
// - the user's own message is not an event of Claude Code: the Session view records it here when
//   it sends it (recordPrompt), as a `notice` of kind `user`, the way a parsed transcript file has
//   it (ticket 14). Should Claude Code echo the message back, the echo is dropped.
//
// Nothing here is saved: after a restart the view starts empty, and the transcript file is the
// record of the Session (ADR 0002, ADR 0005).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AgentEvent, AgentEventEnvelope } from '../../shared/agent/events'
import { subscribe } from '../ipc'

/** Events kept per Session; older ones are dropped first. */
export const KEEP_EVENTS = 5000

export interface SessionLog {
  events: readonly AgentEvent[]
  /** The last message the user sent and Claude Code has not echoed yet. */
  echo: string | null
}

interface LogsStore {
  logs: Readonly<Record<string, SessionLog>>
}

const EMPTY: readonly AgentEvent[] = []

export const useSessionLogs = create<LogsStore>(() => ({ logs: {} }))

function append(events: readonly AgentEvent[], event: AgentEvent): readonly AgentEvent[] {
  const last = events[events.length - 1]
  if (event.type === 'delta' && last?.type === 'delta' && last.kind === event.kind && last.parentToolUseId === event.parentToolUseId) {
    return [...events.slice(0, -1), { ...last, text: last.text + event.text }]
  }
  const next = [...events, event]
  return next.length > KEEP_EVENTS ? next.slice(next.length - KEEP_EVENTS) : next
}

function update(sessionId: string, change: (log: SessionLog) => SessionLog): void {
  useSessionLogs.setState(({ logs }) => ({ logs: { ...logs, [sessionId]: change(logs[sessionId] ?? { events: EMPTY, echo: null }) } }))
}

/** Takes one event of one Session, as `agent.event` delivers it. */
export function acceptAgentEvent({ sessionId, event }: AgentEventEnvelope): void {
  if (event.type === 'renamed') {
    useSessionLogs.setState(({ logs }) => {
      const before = logs[event.from]
      if (before === undefined) return { logs }
      const after = logs[sessionId]
      const rest = { ...logs }
      delete rest[event.from]
      const events = after ? [...before.events, ...after.events] : before.events
      return { logs: { ...rest, [sessionId]: { events, echo: after?.echo ?? before.echo } } }
    })
    return
  }
  update(sessionId, (log) => {
    if (event.type === 'notice' && event.kind === 'user' && log.echo !== null && event.text === log.echo) return { ...log, echo: null }
    return { events: append(log.events, event), echo: event.type === 'result' ? null : log.echo }
  })
}

/** Records a message the user sent to a Session. */
export function recordPrompt(sessionId: string, text: string): void {
  update(sessionId, (log) => ({ events: append(log.events, { type: 'notice', kind: 'user', text }), echo: text }))
}

let subscribed = false

/** Subscribes to `agent.event` once for the whole renderer; safe to call on every render. */
export function ensureAgentEvents(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('agent.event', acceptAgentEvent)
  } catch (error) {
    subscribed = false
    console.error('agent.event: cannot subscribe', error)
  }
}

/** The events of a Session so far; empty for null or a Session nothing arrived from yet. */
export function useSessionEvents(sessionId: string | null): readonly AgentEvent[] {
  useEffect(ensureAgentEvents, [])
  return useSessionLogs((store) => (sessionId === null ? EMPTY : (store.logs[sessionId]?.events ?? EMPTY)))
}
