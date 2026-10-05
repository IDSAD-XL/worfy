// The events of every live Session in the renderer, by Session id: one subscription to
// `agent.event` (src/shared/ipc/agent.ts) serves every Session view. The store keeps worfy's own
// events (src/shared/agent/events.ts) as they came, with three adjustments:
//
// - a `renamed` event moves what was kept under the Session's temporary id to its new id;
// - consecutive `delta` events of one block are joined into one, so a long answer is not
//   thousands of events;
// - the user's own message is not an event of Claude Code: the Session view records it here when
//   it sends it (recordPrompt), as a `notice` of kind `user`, the way a parsed transcript file has
//   it (ticket 14). Should Claude Code echo the message back, the echo is dropped. Should sending
//   fail, the view takes the message back out (retractPrompt).
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
  /**
   * How many of this Session's events were dropped before `events[0]` (KEEP_EVENTS): the position
   * of `events[0]` in the whole Session. Transcript rows are keyed by that position, so dropping
   * old events does not rebuild every row.
   */
  first: number
  /** The last message the user sent and Claude Code has not echoed yet. */
  echo: string | null
}

interface LogsStore {
  logs: Readonly<Record<string, SessionLog>>
}

const EMPTY: readonly AgentEvent[] = []
const EMPTY_LOG: SessionLog = { events: EMPTY, first: 0, echo: null }

export const useSessionLogs = create<LogsStore>(() => ({ logs: {} }))

/** Keeps the newest KEEP_EVENTS events and counts the dropped ones into `first`. */
function capped(events: readonly AgentEvent[], first: number): Pick<SessionLog, 'events' | 'first'> {
  const over = events.length - KEEP_EVENTS
  return over > 0 ? { events: events.slice(over), first: first + over } : { events, first }
}

function append(log: SessionLog, event: AgentEvent): Pick<SessionLog, 'events' | 'first'> {
  const { events, first } = log
  const last = events[events.length - 1]
  if (event.type === 'delta' && last?.type === 'delta' && last.kind === event.kind && last.parentToolUseId === event.parentToolUseId) {
    return { events: [...events.slice(0, -1), { ...last, text: last.text + event.text }], first }
  }
  return capped([...events, event], first)
}

function update(sessionId: string, change: (log: SessionLog) => SessionLog): void {
  useSessionLogs.setState(({ logs }) => ({ logs: { ...logs, [sessionId]: change(logs[sessionId] ?? EMPTY_LOG) } }))
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
      const merged = after ? capped([...before.events, ...after.events], before.first) : before
      return { logs: { ...rest, [sessionId]: { events: merged.events, first: merged.first, echo: after?.echo ?? before.echo } } }
    })
    return
  }
  update(sessionId, (log) => {
    if (event.type === 'notice' && event.kind === 'user' && log.echo !== null && event.text === log.echo) return { ...log, echo: null }
    return { ...append(log, event), echo: event.type === 'result' ? null : log.echo }
  })
}

/** Records a message the user sent to a Session. */
export function recordPrompt(sessionId: string, text: string): void {
  update(sessionId, (log) => ({ ...append(log, { type: 'notice', kind: 'user', text }), echo: text }))
}

/**
 * Takes back a message recordPrompt recorded when sending it failed: the latest prompt with this
 * text leaves the transcript and the prompt history, and is no longer expected as an echo.
 */
export function retractPrompt(sessionId: string, text: string): void {
  update(sessionId, (log) => {
    const at = log.events.findLastIndex((event) => event.type === 'notice' && event.kind === 'user' && event.text === text)
    const events = at === -1 ? log.events : [...log.events.slice(0, at), ...log.events.slice(at + 1)]
    return { events, first: log.first, echo: log.echo === text ? null : log.echo }
  })
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

/** The kept events of a Session and the position of the first of them; empty for null or a Session nothing arrived from yet. */
export function useSessionLog(sessionId: string | null): SessionLog {
  useEffect(ensureAgentEvents, [])
  return useSessionLogs((store) => (sessionId === null ? EMPTY_LOG : (store.logs[sessionId] ?? EMPTY_LOG)))
}
