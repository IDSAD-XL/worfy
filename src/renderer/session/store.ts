// The events of every live Session in the renderer, by Session id: one subscription to
// `agent.event` (src/shared/ipc/agent.ts) serves every Session view. The store keeps worfy's own
// events (src/shared/agent/events.ts) as they came, with these adjustments:
//
// - a `renamed` event moves what was kept under the Session's temporary id to its new id;
// - consecutive `delta` events of one block are joined into one, so a long answer is not
//   thousands of events;
// - the user's own message is not an event of Claude Code: main reports it with a `prompt` event
//   when it gives the message to Claude Code (at once, or out of the queue after a turn), and the
//   store keeps it as a `notice` of kind `user`, the way a parsed transcript file has it (ticket
//   14). Should Claude Code echo the message back, the echo is dropped. A message that was not
//   sent never gets a `prompt`, so there is nothing to take back;
// - `queue` and `settings` events are not part of the transcript: the store keeps only the latest
//   of each (ticket 19), and asks main for both (`agent.controls`) when a view needs them before
//   any arrived.
//
// Nothing here is saved: after a restart the view starts empty, and the transcript file is the
// record of the Session (ADR 0002, ADR 0005).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AgentEvent, AgentEventEnvelope, QueueSnapshot } from '../../shared/agent/events'
import type { SessionSettings } from '../../shared/agent/settings'
import { invoke, subscribe } from '../ipc'

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
  /** The Session's message queue; null until main reported it. */
  queue: QueueSnapshot | null
  /** The Session's model, effort and permission mode as worfy set them; null until main reported them. */
  settings: SessionSettings | null
}

interface LogsStore {
  logs: Readonly<Record<string, SessionLog>>
}

const EMPTY: readonly AgentEvent[] = []
const EMPTY_LOG: SessionLog = { events: EMPTY, first: 0, echo: null, queue: null, settings: null }

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
      return {
        logs: {
          ...rest,
          [sessionId]: {
            events: merged.events,
            first: merged.first,
            echo: after?.echo ?? before.echo,
            queue: after?.queue ?? before.queue,
            settings: after?.settings ?? before.settings,
          },
        },
      }
    })
    return
  }
  update(sessionId, (log) => {
    switch (event.type) {
      case 'queue':
        return { ...log, queue: { items: event.items, paused: event.paused } }
      case 'settings':
        return { ...log, settings: event.settings }
      case 'prompt':
        return { ...log, ...append(log, { type: 'notice', kind: 'user', text: event.text }), echo: event.text }
      default:
        if (event.type === 'notice' && event.kind === 'user' && log.echo !== null && event.text === log.echo) return { ...log, echo: null }
        return { ...log, ...append(log, event), echo: event.type === 'result' ? null : log.echo }
    }
  })
}

/**
 * Asks main for a Session's queue and settings, for a view that opened after their last events
 * went out. What events brought in the meantime is newer and stays.
 */
export async function loadControls(sessionId: string): Promise<void> {
  const result = await invoke('agent.controls', { sessionId })
  if (!result.ok) {
    console.error(`agent.controls ${sessionId} failed:`, result.error)
    return
  }
  update(sessionId, (log) => ({ ...log, queue: log.queue ?? result.value.queue, settings: log.settings ?? result.value.settings }))
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

/** A Session's queue and settings; asks main for them when no event has brought them yet. */
export function useSessionControls(sessionId: string | null): Pick<SessionLog, 'queue' | 'settings'> {
  useEffect(ensureAgentEvents, [])
  const queue = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.queue ?? null)))
  const settings = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.settings ?? null)))
  const missing = sessionId !== null && (queue === null || settings === null)
  useEffect(() => {
    if (missing) void loadControls(sessionId)
  }, [sessionId, missing])
  return { queue, settings }
}
