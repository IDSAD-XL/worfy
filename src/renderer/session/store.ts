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
//   any arrived;
// - a `context` event (how full the context window is, worfy-polish ticket 23) is not part of the
//   transcript either: the store keeps the latest, for the meter under the input field;
// - a `settings` event that changes the model is a pick in the picker: the store keeps it as
//   `modelPick` until the next `init` says which model the Session runs, so the Session view's
//   header does not show the model before the pick as the current one (worfy-week ticket 12).
//
// Nothing here is saved: the transcript file is the record of the Session (ADR 0002, ADR 0005).
// A view of a Session that has a transcript — a resumed one, the Orchestrator after a restart —
// shows the transcript's events first and these after them (joinPastAndLive, worfy-daily ticket 22).
import { useEffect } from 'react'
import { create } from 'zustand'
import { typedText } from '../../shared/agent/attachments'
import type { AgentEvent, AgentEventEnvelope, ContextUsage, QueueSnapshot } from '../../shared/agent/events'
import type { SessionSettings } from '../../shared/agent/settings'
import { invoke, subscribe } from '../ipc'
import { toolsHiddenRenamed } from './transcript-view'

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
  /**
   * The model picked since the last `init` (null in `model`: Claude Code's default); null when no
   * pick waits for an `init` to confirm it. The first report of the settings is no pick.
   */
  modelPick: { model: string | null } | null
  /** How full the context window is, by the last `context` event; null: no data. */
  context: ContextUsage | null
}

interface LogsStore {
  logs: Readonly<Record<string, SessionLog>>
}

const EMPTY: readonly AgentEvent[] = []
const EMPTY_LOG: SessionLog = { events: EMPTY, first: 0, echo: null, queue: null, settings: null, modelPick: null, context: null }

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
export function acceptAgentEvent({ sessionId, event: received }: AgentEventEnvelope): void {
  // A live event carries no time of its own: the row shows when it arrived (ticket 14).
  const event: AgentEvent = received.at === undefined ? { ...received, at: Date.now() } : received
  if (event.type === 'renamed') {
    // The Session view's «Hide tools» choice goes with the Session to its new id (worfy-ui ticket 25).
    toolsHiddenRenamed(event.from, sessionId)
    useSessionLogs.setState(({ logs }) => {
      const before = logs[event.from]
      if (before === undefined) return { logs }
      const after = logs[sessionId]
      const rest = { ...logs }
      delete rest[event.from]
      const merged = after ? capped([...before.events, ...after.events], before.first) : before
      // An `init` under the new id came after any pick made under the old one.
      const modelPick = after !== undefined && (after.modelPick !== null || after.events.some((each) => each.type === 'init')) ? after.modelPick : before.modelPick
      return {
        logs: {
          ...rest,
          [sessionId]: {
            events: merged.events,
            first: merged.first,
            echo: after?.echo ?? before.echo,
            queue: after?.queue ?? before.queue,
            settings: after?.settings ?? before.settings,
            modelPick,
            context: after?.context ?? before.context,
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
      case 'context':
        return { ...log, context: event.usage }
      case 'settings': {
        const picked = log.settings !== null && event.settings.model !== log.settings.model
        return { ...log, settings: event.settings, modelPick: picked ? { model: event.settings.model } : log.modelPick }
      }
      case 'prompt':
        return {
          ...log,
          ...append(log, { type: 'notice', kind: 'user', text: event.text, ...(event.attachments?.length ? { attachments: event.attachments } : {}), at: event.at }),
          echo: event.text,
        }
      default:
        if (event.type === 'notice' && event.kind === 'user' && log.echo !== null && event.text === log.echo) return { ...log, echo: null }
        return { ...log, ...append(log, event), echo: event.type === 'result' ? null : log.echo, modelPick: event.type === 'init' ? null : log.modelPick }
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

// ── the turns before the live events (worfy-daily ticket 22) ─────────────────

/**
 * What only one event carries: the ids Claude Code gave to a message, a tool call and a task. Both
 * the transcript file and the live Session carry them, so they tell where one starts in the other.
 */
function identity(event: AgentEvent): string | null {
  switch (event.type) {
    case 'text':
    case 'thinking':
      return `message:${event.messageId}`
    case 'tool_use':
      return `tool:${event.id}`
    case 'tool_result':
      return `result:${event.toolUseId}`
    case 'subagent':
      return `task:${event.taskId}:${event.phase}`
    default:
      return null
  }
}

/**
 * The text the user typed, for an event that opens a turn: a prompt (`notice` of kind `user`), or a
 * slash command, which a transcript file records as a `command` event and the live Session as the
 * prompt the user typed. Without the leading slash, and without the lines naming attachments, which
 * a transcript of an older worfy may still carry in the text (typedText), so the two compare equal. Claude Code's own `[Request interrupted by user]` is a prompt here too: it
 * closes a turn in the file.
 */
function typed(event: AgentEvent): string | null {
  if (event.type === 'notice' && event.kind === 'user') return typedText(event.text).trim().replace(/^\//, '')
  if (event.type === 'command') return `${event.name.replace(/^\//, '')} ${event.args}`.trim()
  return null
}

/**
 * The events of a Session's transcript file (`past`) followed by its live events, with no turn
 * twice. The Session writes its transcript while a turn runs, so the file read after Resume may
 * already hold turns the live events bring as well; those are shown from the live events.
 *
 * The live part starts in the file at the first event that carries an id one of the live events
 * carries too (`identity`), or else at its end. The file records a prompt before its answer, so
 * the live part starts earlier, at the prompts the live events bring before that event (all of
 * theirs when the file has none of their ids) that lie right before that point, after the last
 * event with an id. A prompt in the file that already has an answer,
 * or that an interruption closed, is a turn from before Resume and stays, even when the user typed
 * the same text again. A prompt from before Resume that got neither and reads like the first live
 * one cannot be told from it and is shown once.
 */
export function joinPastAndLive(past: readonly AgentEvent[], live: readonly AgentEvent[]): readonly AgentEvent[] {
  if (live.length === 0) return past
  if (past.length === 0) return live
  const ids = new Set<string>()
  for (const event of live) {
    const id = identity(event)
    if (id !== null) ids.add(id)
  }
  let cut = past.findIndex((event) => {
    const id = identity(event)
    return id !== null && ids.has(id)
  })
  if (cut < 0) cut = past.length
  // The prompts the live events open with, each as often as it comes: those before the live event
  // the file has at `cut`. A live event with an id the file never records — the end of a background
  // task Claude Code took in without a turn — may come first; it does not end the opening
  // (worfy-link ticket 41).
  const anchor = cut < past.length ? identity(past[cut] as AgentEvent) : null
  const anchorAt = anchor === null ? -1 : live.findIndex((event) => identity(event) === anchor)
  const opening = new Map<string, number>()
  for (const event of anchorAt < 0 ? live : live.slice(0, anchorAt)) {
    const text = typed(event)
    if (text !== null) opening.set(text, (opening.get(text) ?? 0) + 1)
  }
  // Back to the last event with an id: the prompts in between are live ones as long as each is one
  // the live events open with. Any other — a prompt from before Resume, the interruption that
  // closed one — ends the live part there.
  let start = cut
  for (let at = cut - 1; at >= 0; at -= 1) {
    const event = past[at] as AgentEvent
    if (identity(event) !== null) break
    const text = typed(event)
    if (text === null) continue
    const left = opening.get(text) ?? 0
    if (left === 0) break
    opening.set(text, left - 1)
    start = at
  }
  return [...past.slice(0, start), ...live]
}

/**
 * Whether `kept`, the events joinPastAndLive keeps of the file before the live ones, holds a turn
 * from before Resume for sure: an event with an id (none of the live events has it: the live part
 * starts at the first that has), or a prompt (one that opened the live part would not be kept). Events
 * without an id — an added notice, a hook's output, a local command — may be from after Resume:
 * joinPastAndLive keeps those that come before the first live event with an id.
 */
export function keepsTurnBeforeResume(kept: readonly AgentEvent[]): boolean {
  return kept.some((event) => identity(event) !== null || typed(event) !== null)
}

/** A Session's queue, settings and model pick; asks main for the first two when no event has brought them yet. */
export function useSessionControls(sessionId: string | null): Pick<SessionLog, 'queue' | 'settings' | 'modelPick'> {
  useEffect(ensureAgentEvents, [])
  const queue = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.queue ?? null)))
  const settings = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.settings ?? null)))
  const modelPick = useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.modelPick ?? null)))
  const missing = sessionId !== null && (queue === null || settings === null)
  useEffect(() => {
    if (missing) void loadControls(sessionId)
  }, [sessionId, missing])
  return { queue, settings, modelPick }
}

/** How full a Session's context window is, by its last `context` event; null: no data yet, or none. */
export function useSessionContext(sessionId: string | null): ContextUsage | null {
  useEffect(ensureAgentEvents, [])
  return useSessionLogs((store) => (sessionId === null ? null : (store.logs[sessionId]?.context ?? null)))
}
