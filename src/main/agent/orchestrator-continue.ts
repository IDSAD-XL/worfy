// Auto-continue of a manual turn of the Orchestrator, outside an Autopilot run (worfy-retry ticket 06,
// spec Q5 (a)): at night the Orchestrator often runs Waves by itself, with background agents, and a turn
// that ends with a temporary API error or a refusal by the Limits would otherwise wait for a person.
//
// The module follows the events of each Project's Orchestrator Session (SessionRegistry.observe; which
// Session is whose comes from the Orchestrators' views, `publish`) and, with Auto-continue on for the
// Project, does what an Autopilot run does in run.ts, with the same parts:
// - a temporary API error (turnFailureKind): TurnRetry (src/main/autopilot/turn-retry.ts) decides by the
//   plan of src/shared/agent/continue-plan.ts — 1, 5, 15, 30, 60 minutes, five in a row, no retry while an
//   external call of the turn has no result — and its timer sends retryText into the Session;
// - a refusal by the Limits (LimitsWait.hitOf, checked first): LimitsWait (src/main/autopilot/limits-wait.ts)
//   waits for the reset of the window the Vendor reported, or tries again every RECHECK_MS without one, a
//   reset more than 24 h away included (the switch is on: spec Q8 (c)), and sends continueText.
// The original message is never sent again: the continuation is a new message in the same Session.
//
// It stays silent while a run owns the Session (it runs unattended): the run answers then (spec, risk 6).
// A message of a person during the wait (a `prompt` that is not worfy's own continuation) takes the
// continuation's place: the wait ends, and that turn's end decides. A turn under way when the timer fires
// (a background task's task-notification) does the same. The switch turned off, the Session closed or
// the app quit (the registry closes every Session) cancel the wait; nothing goes out.
//
// What it does is told in the Orchestrator's transcript as worfy's own `notice` lines, which the model
// does not get: «worfy: API error 529, retry 2 of 5 at 14:20», «worfy: sent "continue" (retry 2 of 5)»,
// «worfy: not retried: `git push …` may or may not have run», «worfy: waiting for the Limits, resumes
// 14:20». A notice lives in the live Session's events only: worfy writes nothing into Claude Code's
// transcript (ADR-0005), so after a restart of the app the lines are gone (the ticket's result section says so).
//
// The wait of each Project (wait()) is what the countdown in the Orchestrator's chat shows (ticket 07).
//
// shortcut: no keep-awake during a manual wait, a Mac that sleeps continues at its first wake after the
// time (the wall-clock timer); redo when the owner wants a manual Limits wait to keep the Mac awake.
import { MAX_RETRIES } from '../../shared/agent/continue-plan'
import type { AgentEvent } from '../../shared/agent/events'
import type { LimitsState } from '../../shared/agent/limits'
import { turnFailureKind, type TransientError } from '../../shared/agent/turn-failure'
import type { LimitsHit } from '../../shared/autopilot/resume-at'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import { UNNAMED_VENDOR, type VendorId } from '../../shared/vendors/vendor'
import { LimitsWait } from '../autopilot/limits-wait'
import { TurnRetry } from '../autopilot/turn-retry'
import { observeSessionLimits } from './limits'
import type { EventSink, Session } from './session'

export interface OrchestratorContinueDeps {
  /** Gets every event of every Session (SessionRegistry.observe); answers the unsubscribe. */
  observe(sink: EventSink): () => void
  /** The live Session `sessionId` (SessionRegistry.get); throws when it is gone. */
  session(sessionId: string): Pick<Session, 'send' | 'notice' | 'state' | 'unattended'>
  /** Whether Auto-continue is on for the Project (autoContinueOn of src/main/settings/store.ts). */
  enabled(projectId: string): boolean
  /** Calls `listener` on each change of the settings where the switch lives; answers the unsubscribe. */
  observeSettings?(listener: () => void): () => void
  /** The Limits state of limits.json (LimitsTracker.snapshot). */
  limits(): LimitsState
  /** The clock, in milliseconds; tests pass a fixed one. */
  now?(): number
  /** Calls `fire` once at the wall time `at`; answers the cancel (default wallTimer). */
  schedule?(at: number, fire: () => void): () => void
  /** A random number in [0, 1) for the spread of a pause (default Math.random). */
  random?(): number
}

/** What a Project's Orchestrator waits for, for the countdown in its chat (worfy-retry ticket 07). */
export type ContinueWait =
  /** A continuation after a temporary API error: retry `attempt` of `of`, sent at `until` (ms). */
  | { kind: 'retry'; attempt: number; of: number; error: TransientError; until: number }
  /** A continuation after a refusal by the Limits: `window` resets (null: none reported), sent at `until` (ms). */
  | { kind: 'limits'; window: string | null; until: number }

/** One Project's Orchestrator: its current Session and what waits on it. */
interface Entry {
  projectId: string
  sessionId: string
  vendor: VendorId
  retry: TurnRetry
  limits: LimitsWait
  unwatch: () => void
  /** worfy's continuation until its `prompt` comes back; a `prompt` of another text is a person's. */
  sent: string | null
}

/** The temporary error in the words of a transcript line. */
const ERROR_WORDS: Record<TransientError, string> = {
  'api-500': 'API error 500',
  'api-502': 'API error 502',
  'api-503': 'API error 503',
  'api-504': 'API error 504',
  overloaded: 'API error 529',
  connection: 'API connection lost',
  timeout: 'API request timed out',
  stream: 'API response stream broke off',
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** `at` in local time: `14:20` on the day of `now`, `2026-11-09 14:20` on another day. */
export function clockText(at: number, now: number): string {
  const date = new Date(at)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

/** Auto-continue of the manual turns of every Project's Orchestrator. */
export class OrchestratorContinue {
  private readonly entries = new Map<string, Entry>()
  private readonly cleanups: (() => void)[] = []
  private readonly now: () => number

  constructor(private readonly deps: OrchestratorContinueDeps) {
    this.now = deps.now ?? Date.now
    this.cleanups.push(deps.observe((sessionId, event) => this.onEvent(sessionId, event)))
    const unobserve = deps.observeSettings?.(() => this.settingsChanged())
    if (unobserve !== undefined) this.cleanups.push(unobserve)
  }

  /** A new view of an Orchestrator (Orchestrators' `publish`): which Session is the Project's now. */
  view(view: OrchestratorView): void {
    if (view.sessionId === null) return
    const entry = this.entries.get(view.projectId)
    if (entry !== undefined) {
      entry.sessionId = view.sessionId
      entry.vendor = view.vendor ?? entry.vendor
      return
    }
    this.entries.set(view.projectId, this.entry(view.projectId, view.sessionId, view.vendor ?? UNNAMED_VENDOR))
  }

  /** What the Project's Orchestrator waits for to be continued; null when nothing waits. */
  wait(projectId: string): ContinueWait | null {
    const entry = this.entries.get(projectId)
    if (entry === undefined) return null
    const failed = entry.retry.failed
    const retry = entry.retry.retry
    if (entry.retry.until !== null && failed !== null && retry !== null) return { kind: 'retry', attempt: retry.attempt, of: retry.of, error: failed.error, until: entry.retry.until }
    if (entry.limits.until !== null) return { kind: 'limits', window: entry.limits.window, until: entry.limits.until }
    return null
  }

  /** Cancels every wait and follows nothing more. */
  stop(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    for (const entry of this.entries.values()) {
      this.drop(entry)
      entry.unwatch()
    }
    this.entries.clear()
  }

  private entry(projectId: string, sessionId: string, vendor: VendorId): Entry {
    const send = (id: string, text: string): void => {
      this.deps.session(id).send(text)
    }
    const timing = {
      ...(this.deps.now === undefined ? {} : { now: this.deps.now }),
      ...(this.deps.schedule === undefined ? {} : { schedule: this.deps.schedule }),
    }
    const retry = new TurnRetry({ enabled: (id) => this.deps.enabled(id), send, ...timing, ...(this.deps.random === undefined ? {} : { random: this.deps.random }) }, projectId)
    const limits = new LimitsWait({
      state: () => this.deps.limits(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => this.deps.observe(sink), isSession, listener),
      send,
      ...timing,
    })
    const entry: Entry = { projectId, sessionId, vendor, retry, limits, unwatch: () => undefined, sent: null }
    entry.unwatch = limits.watch((id) => id === entry.sessionId)
    return entry
  }

  private entryOf(sessionId: string): Entry | null {
    for (const entry of this.entries.values()) if (entry.sessionId === sessionId) return entry
    return null
  }

  private onEvent(sessionId: string, event: AgentEvent): void {
    if (event.type === 'notice') return
    const entry = this.entryOf(sessionId)
    if (entry === null) return
    if (event.type === 'state' && event.state === 'closed') {
      this.drop(entry)
      return
    }
    // A run owns the Session: it answers the Session's errors itself, and nothing of this module waits.
    if (this.owned(entry)) {
      this.drop(entry)
      return
    }
    switch (event.type) {
      case 'prompt':
        entry.retry.turnStarted()
        entry.limits.turnStarted()
        if (entry.sent !== null && event.text === entry.sent) {
          entry.sent = null
          return
        }
        // A person's message: its turn is the continuation, and its end decides.
        entry.retry.cancel()
        entry.limits.cancel()
        return
      case 'result':
        this.turnEnded(entry, event)
        return
      case 'tool_use':
      case 'tool_result':
        entry.retry.observe(event)
        return
      default:
        return
    }
  }

  /** The end of a manual turn: with the switch on, a temporary error or a refusal waits for its continuation. */
  private turnEnded(entry: Entry, event: Extract<AgentEvent, { type: 'result' }>): void {
    const message = event.error ?? (event.isError ? event.text : null)
    // The refusal is told by the Limits status of this turn, so it is read now; the Limits go first (spec, risk 3).
    const hit = entry.limits.hitOf({ isError: event.isError, interrupted: event.interrupted, message })
    const failure = turnFailureKind({ vendor: entry.vendor, isError: event.isError, interrupted: event.interrupted, error: message, terminalReason: event.terminalReason })
    const actions = failure.kind === 'transient' ? entry.retry.actions() : []
    if (!this.deps.enabled(entry.projectId)) {
      this.drop(entry)
      return
    }
    if (hit !== null) {
      entry.retry.cancel()
      this.limitsHit(entry, hit)
      return
    }
    entry.limits.passed()
    if (failure.kind === 'none') {
      entry.retry.passed()
      return
    }
    const decision = entry.retry.decide(failure, actions)
    if (decision.kind === 'retry' && failure.kind === 'transient') {
      entry.retry.wait(decision, { error: failure.error, actions, message }, (id) => this.retryFired(entry, id))
      this.notice(entry, `worfy: ${ERROR_WORDS[failure.error]}, retry ${decision.attempt} of ${decision.of} at ${clockText(entry.retry.until ?? this.now(), this.now())}`)
      return
    }
    entry.retry.passed()
    if (decision.kind !== 'refused') return
    if (decision.reason === 'in-flight') {
      const list = decision.inFlight.map((action) => `\`${action.description}\``).join(', ')
      this.notice(entry, `worfy: not retried: ${list} may or may not have run`)
    } else if (decision.reason === 'cap') {
      this.notice(entry, `worfy: not retried: gave up after ${MAX_RETRIES} retries`)
    }
  }

  private limitsHit(entry: Entry, hit: LimitsHit): void {
    // The switch is on: a reset more than 24 h away is waited for too (spec Q8 (c)).
    const plan = entry.limits.plan(hit, true)
    if (plan.kind === 'quota') {
      entry.limits.passed()
      this.notice(entry, 'worfy: not continued: the Limits refused the turn by a quota, and nothing resets')
      return
    }
    if (plan.kind === 'give-up') {
      entry.limits.passed()
      this.notice(entry, `worfy: not continued: ${plan.reason}`)
      return
    }
    const id = entry.limits.wait(plan.at, () => this.limitsFired(entry, id))
    const at = clockText(plan.at, this.now())
    this.notice(entry, plan.kind === 'at' ? `worfy: waiting for the Limits, resumes ${at}` : `worfy: waiting for the Limits, no reset time reported, next try at ${at}`)
  }

  private retryFired(entry: Entry, id: number): void {
    if (!entry.retry.isCurrent(id)) return
    const session = this.ready(entry)
    if (session === null) return
    const retry = entry.retry.retry
    const text = entry.retry.resume()
    if (this.send(entry, session, text) && retry !== null) this.notice(entry, `worfy: sent "continue" (retry ${retry.attempt} of ${retry.of})`)
  }

  private limitsFired(entry: Entry, id: number): void {
    if (!entry.limits.isCurrent(id)) return
    const session = this.ready(entry)
    if (session === null) return
    const text = entry.limits.resume()
    if (this.send(entry, session, text)) this.notice(entry, 'worfy: sent "continue" after the Limits wait')
  }

  /**
   * The Session a fired wait sends to, or null: the wait ends without a message when the Session is
   * gone, a run owns it, the switch is off, or a turn is under way (that turn's end decides).
   */
  private ready(entry: Entry): ReturnType<OrchestratorContinueDeps['session']> | null {
    let session: ReturnType<OrchestratorContinueDeps['session']>
    try {
      session = this.deps.session(entry.sessionId)
    } catch {
      this.drop(entry)
      return null
    }
    if (session.unattended) {
      this.drop(entry)
      return null
    }
    if (!this.deps.enabled(entry.projectId)) {
      this.drop(entry)
      this.notice(entry, 'worfy: Auto-continue is off; nothing was sent')
      return null
    }
    if (session.state !== 'idle') {
      entry.retry.cancel()
      entry.limits.cancel()
      return null
    }
    return session
  }

  private send(entry: Entry, session: ReturnType<OrchestratorContinueDeps['session']>, text: string): boolean {
    entry.sent = text
    try {
      session.send(text)
      return true
    } catch (error) {
      entry.sent = null
      console.warn(`[orchestrator] ${entry.projectId}: could not send the continuation`, error)
      return false
    }
  }

  /** The switch may have changed: a Project whose switch is off now waits no more. */
  private settingsChanged(): void {
    for (const entry of this.entries.values()) {
      if (!this.waiting(entry) || this.deps.enabled(entry.projectId)) continue
      this.drop(entry)
      this.notice(entry, 'worfy: Auto-continue is off; nothing was sent')
    }
  }

  private waiting(entry: Entry): boolean {
    return entry.retry.until !== null || entry.limits.until !== null
  }

  /** Whether a run owns the Session: it runs unattended (Orchestrators.setUnattended); false when it is gone. */
  private owned(entry: Entry): boolean {
    try {
      return this.deps.session(entry.sessionId).unattended
    } catch {
      return false
    }
  }

  /** No wait goes on, and the next failure is the first of a new count. */
  private drop(entry: Entry): void {
    entry.retry.passed()
    entry.limits.passed()
    entry.sent = null
  }

  /** A line of worfy's in the Orchestrator's transcript; the model does not get it. */
  private notice(entry: Entry, text: string): void {
    try {
      this.deps.session(entry.sessionId).notice(text)
    } catch {
      // The Session is gone: there is no one to tell.
    }
  }
}
