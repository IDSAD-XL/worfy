// The Limits waits of the Sessions on the Canvas (worfy-assistant ticket 08; idea 6 of the epic worfy-limits-out: any Session
// waits for the reset of the Limits in plain sight). Auto-continue answers only an Orchestrator (decision 3 of worfy-retry,
// src/main/agent/orchestrator-continue.ts); this module follows every other Session worfy runs. When a turn of one ends
// with a refusal by the Limits, the Session waits for their reset:
// - the wait is seen: wait(sessionId) and observeWaits() for the window and the Assistant, and a line of worfy's in the
//   Session's own chat, «worfy: waiting for the Limits, they reset at 06:02» (a `notice`, which the model does not get);
// - at the reset (plus RESUME_MARGIN_MS) the wait is due: the closed list continues the Session by the mode of its duty
//   (auto.ts, closed-list.ts), or the user does from the item's proposal; the wait does not send anything itself;
// - a message of a person (a `prompt`) ends the wait — so does the closing of the Session or an Autopilot run taking it.
//
// The refusal is told as LimitsWait tells it to an Autopilot run (src/main/autopilot/limits-wait.ts): the Session's
// Limits status during the turn, else the error text of its `result`. A reset however far is waited for (the Session
// sends nothing while it waits, and keeps no Mac awake). The timer goes by the wall clock: a Mac that slept through the
// reset makes the wait due at its first wake after it.
//
// shortcut: a Vendor other than Claude (Codex) is not read anew before the continuation, unlike Auto-continue
// (LimitsWait.stillRefused); a window still used up refuses the continued turn, and the Session waits again. Redo when
// the closed list continues Codex Sessions often enough for a refused turn to matter.
import type { AgentEvent } from '../../../shared/agent/events'
import type { LimitsState } from '../../../shared/agent/limits'
import type { SessionLimitsWait } from '../../../shared/assistant/actions'
import { clockText } from '../../agent/orchestrator-continue'
import type { EventSink } from '../../agent/session/types'
import { observeSessionLimits } from '../../agent/limits'
import { LimitsWait } from '../../autopilot/limits-wait'

export interface LimitsWaitsDeps {
  /** Gets every event of every Session (SessionRegistry.observe); answers the unsubscribe. */
  observe(sink: EventSink): () => void
  /** Whether the Session is a Project's Orchestrator: Auto-continue answers those, this module does not. */
  isOrchestrator(sessionId: string): boolean
  /** The live Session; null when it is gone. */
  session(sessionId: string): { readonly unattended: boolean; notice(text: string): void } | null
  /** The Limits state of limits.json (LimitsTracker.snapshot): the reset when the Session did not report one. */
  limits(): LimitsState
  now?(): number
  /** Calls `fire` once at the wall time `at`; answers the cancel (default: the wall-clock timer of LimitsWait). */
  schedule?(at: number, fire: () => void): () => void
}

interface Entry {
  wait: LimitsWait
  unwatch: () => void
  inTurn: boolean
  /** When the current wait began: the first refusal not followed by a turn that went through. */
  since: number | null
}

export class LimitsWaits {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(sessionId: string) => void>()
  private readonly now: () => number
  private readonly unobserve: () => void

  constructor(private readonly deps: LimitsWaitsDeps) {
    this.now = deps.now ?? Date.now
    this.unobserve = deps.observe((sessionId, event) => this.onEvent(sessionId, event))
  }

  /** What the Session waits for; null when it does not wait for the Limits. */
  wait(sessionId: string): SessionLimitsWait | null {
    const entry = this.entries.get(sessionId)
    const until = entry?.wait.until ?? null
    if (entry === undefined || until === null) return null
    return { sessionId, window: entry.wait.window, since: entry.since ?? until, until }
  }

  /** Every Session that waits for the Limits now. */
  waits(): SessionLimitsWait[] {
    return [...this.entries.keys()].flatMap((sessionId) => this.wait(sessionId) ?? [])
  }

  /** The wait of the Session ends: the closed list has sent its continuation (closed-list.ts). */
  resume(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (entry !== undefined) this.end(sessionId, entry)
  }

  /** Calls `listener` with a Session's id when its wait begins, becomes due or ends; answers the unsubscribe. */
  observeWaits(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  stop(): void {
    this.unobserve()
    for (const entry of this.entries.values()) {
      entry.wait.cancel()
      entry.unwatch()
    }
    this.entries.clear()
  }

  private entryOf(sessionId: string): Entry {
    let entry = this.entries.get(sessionId)
    if (entry !== undefined) return entry
    const wait = new LimitsWait({
      state: () => this.deps.limits(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => this.deps.observe(sink), isSession, listener),
      // The wait sends nothing: the closed list does, with main's own text.
      send: () => undefined,
      now: this.now,
      ...(this.deps.schedule === undefined ? {} : { schedule: this.deps.schedule }),
    })
    entry = { wait, unwatch: wait.watch((id) => id === sessionId), inTurn: false, since: null }
    this.entries.set(sessionId, entry)
    return entry
  }

  private onEvent(sessionId: string, event: AgentEvent): void {
    if (event.type === 'notice') return
    if (event.type === 'state' && event.state === 'closed') {
      const entry = this.entries.get(sessionId)
      if (entry === undefined) return
      const waited = entry.wait.until !== null
      entry.wait.cancel()
      entry.unwatch()
      this.entries.delete(sessionId)
      if (waited) this.tell(sessionId)
      return
    }
    const entry = this.entryOf(sessionId)
    switch (event.type) {
      case 'prompt':
        // A person's message (or the continuation, whose wait ended before it went) takes the wait's place.
        this.turnStarted(entry)
        this.end(sessionId, entry)
        return
      case 'state':
        if (event.state === 'busy' && !entry.inTurn) this.turnStarted(entry)
        else if (event.state === 'idle' || event.state === 'error' || event.state === 'starting') entry.inTurn = false
        return
      case 'result':
        entry.inTurn = false
        this.turnEnded(sessionId, entry, event)
        return
      default:
        return
    }
  }

  private turnStarted(entry: Entry): void {
    entry.inTurn = true
    entry.wait.turnStarted()
  }

  private turnEnded(sessionId: string, entry: Entry, event: Extract<AgentEvent, { type: 'result' }>): void {
    const session = this.deps.session(sessionId)
    // An Orchestrator has Auto-continue, a run answers the Session it owns: neither waits here.
    if (session === null || session.unattended || this.deps.isOrchestrator(sessionId)) return this.end(sessionId, entry)
    const message = event.error ?? (event.isError ? event.text : null)
    const hit = entry.wait.hitOf({ isError: event.isError, interrupted: event.interrupted, message })
    if (hit === null) return this.end(sessionId, entry)
    const plan = entry.wait.plan(hit, true)
    if (plan.kind === 'quota' || plan.kind === 'give-up') {
      this.end(sessionId, entry)
      this.notice(sessionId, plan.kind === 'quota' ? 'worfy: the Limits refused this turn by a quota, and nothing resets' : `worfy: not waiting for the Limits: ${plan.reason}`)
      return
    }
    entry.since ??= this.now()
    entry.wait.wait(plan.at, () => this.tell(sessionId))
    this.tell(sessionId)
    const at = clockText(plan.at, this.now())
    this.notice(sessionId, plan.kind === 'at' ? `worfy: waiting for the Limits, they reset at ${at}` : `worfy: waiting for the Limits, no reset time reported, next try at ${at}`)
  }

  /** No wait goes on, and the next refusal starts a new one; the listeners hear of it if one went on. */
  private end(sessionId: string, entry: Entry): void {
    const waited = entry.wait.until !== null
    entry.wait.passed()
    entry.since = null
    if (waited) this.tell(sessionId)
  }

  private tell(sessionId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId)
      } catch (error) {
        console.warn(`[assistant] ${sessionId}: a listener of the Limits wait failed`, error)
      }
    }
  }

  /** A line of worfy's in the Session's chat, once the event being handled has reached the windows (as orchestrator-continue.ts does). */
  private notice(sessionId: string, text: string): void {
    queueMicrotask(() => {
      try {
        this.deps.session(sessionId)?.notice(text)
      } catch {
        // The Session is gone: there is no one to tell.
      }
    })
  }
}
