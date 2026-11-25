// The closed list of actions in main (worfy-assistant ticket 08; spec, implementation decisions, the closed list of actions;
// ADR-0114, point 4; boundaries 3 and 6). The one door through which an action of the Assistant reaches a Session: main
// by itself (auto.ts), the Assistant through `worfy-app` (ticket 09) and the user's click (ticket 14) all call act().
//
// act() checks, in this order, and refuses with the first reason that holds (ActionRefusal):
// 1. the action is in the closed list (CLOSED_ACTIONS) — the list grows only by code;
// 2. a duty shows the item now (the duties' look: not paused, not off, past its threshold, not hidden by a rule) and
//    proposes the action for it;
// 3. the mode of the action lets the actor do it: `self` and `pre-approved` — anyone; `ask` — the user only;
//    `hand-over` — no one;
// 4. the Session the action is for is there and may take a message: no Autopilot run owns it, it is idle, and for an
//    Orchestrator no background task of it is alive; the Limits allow work (wake), or the wait for their reset is over
//    (continue);
// 5. a wake asked by main or the Assistant is within WAKES_PER_DAY wakes of that Orchestrator in 24 hours (`cap`).
// Then main sends its own text (WAKE_ORCHESTRATOR_TEXT, continueSessionText()), never one the caller gives, and every
// call — done or refused — is a line of the Assistant's journal with the item that caused it. check() answers the same
// verdict without acting and without a line: auto.ts asks it so a condition that does not hold yet fills no journal.
// A Session that queues the message (Session.send answers `queued`) gets it taken back, and the line says `busy`: a
// queued message would go out later — after a restart — with no fresh look at the Session or the Limits.
import type { LimitsState } from '../../../shared/agent/limits'
import type { SessionState } from '../../../shared/agent/events'
import {
  continueSessionText,
  isClosedAction,
  WAKE_ORCHESTRATOR_TEXT,
  type ActionActor,
  type ActionJournalLine,
  type ActionRefusal,
  type ActionRequest,
  type ActionResult,
  type ClosedAction,
  type SessionLimitsWait,
} from '../../../shared/assistant/actions'
import type { DutyActionMode, ShownItem } from '../../../shared/assistant/duties'
import { limitsCheck } from '../../agent/limits-gate'
import type { ActionJournal } from './journal'

/** What the closed list needs of a live Session (Session of src/main/agent/session.ts). */
export interface ActionTarget {
  readonly state: SessionState
  /** An Autopilot run owns the Session. */
  readonly unattended: boolean
  /** Its live background tasks (Subagents, background commands). */
  backgroundTasks(): readonly unknown[]
  /** `queued`: the Session holds it for later (worfy quits, a turn is held back) — the closed list takes it back. */
  send(text: string): 'sent' | 'queued'
  /** Its queue (Session.queued) and the removal of one message from it (Session.removeQueued). */
  queued(): { items: readonly { id: string; text: string }[] }
  removeQueued(id: string): boolean
}

/**
 * The most wakes of one Orchestrator in 24 hours by main and by the Assistant together; past it act() refuses them
 * (`cap`), and main's pass escalates the item instead (auto.ts). The user's click is not counted against it. Six: one
 * per 5-hour window of a day and night with one to spare. Decided without the owner (ticket 08, result section).
 */
export const WAKES_PER_DAY = 6

const DAY_MS = 24 * 60 * 60_000

export interface ClosedListDeps {
  now(): number
  /** What the duties show now, with their proposals and modes (Duties.look over every item of the attention core). */
  shown(): readonly ShownItem[]
  /** The Session of the Project's Orchestrator; null when it has none running. */
  orchestratorOf(projectId: string): string | null
  /** The live Session `sessionId`; null when it is gone. */
  session(sessionId: string): ActionTarget | null
  /** The Limits of limits.json (LimitsTracker.snapshot). */
  limits(): LimitsState
  /** Whether Auto-continue of the Project's Orchestrator waits to continue it (OrchestratorContinue.wait): it is not woken then. */
  continuing?(projectId: string): boolean
  /** The Limits waits of the Sessions on the Canvas (limits-waits.ts). */
  waits: { wait(sessionId: string): SessionLimitsWait | null; resume(sessionId: string): void }
  journal: ActionJournal
  /** The closed list did not help with an item: wakes the model of the Assistant (WakeLoop.escalate, ticket 06). */
  escalate?(itemId: string): void
}

interface Verdict {
  refusal: ActionRefusal | null
  shown: ShownItem | null
  mode: DutyActionMode | null
  sessionId: string | null
  /** For continue-session: the wait it ends. */
  wait: SessionLimitsWait | null
}

const AUTO_MODES: ReadonlySet<DutyActionMode> = new Set(['self', 'pre-approved'])

/** Whether `mode` lets `by` do the action. */
export function modeAllows(mode: DutyActionMode, by: ActionActor): boolean {
  if (AUTO_MODES.has(mode)) return true
  return mode === 'ask' && by === 'user'
}

export class ClosedList {
  /**
   * The wakes done by main and the Assistant (by Session; the user's are not counted) and the items escalated, kept in
   * memory: a journal that cannot be written loses its lines, not these counts. The journal only restores them after a
   * restart (restore()).
   */
  private wakes: { sessionId: string; at: number }[] | null = null
  private readonly escalated = new Set<string>()

  constructor(private readonly deps: ClosedListDeps) {}

  /** The counts of an earlier run of worfy, read back once from the journal; an unreadable journal restores none. */
  private restore(): { sessionId: string; at: number }[] {
    if (this.wakes !== null) return this.wakes
    this.wakes = []
    try {
      for (const line of this.deps.journal.lines()) {
        if (line.outcome === 'escalated') this.escalated.add(line.item)
        else if (line.action === 'wake-orchestrator' && line.outcome === 'done' && line.by !== 'user' && line.sessionId !== null) this.wakes.push({ sessionId: line.sessionId, at: line.at })
      }
    } catch (error) {
      console.warn('[assistant] the journal of actions could not be read back', error)
    }
    return this.wakes
  }

  /** The wakes of the Orchestrator `sessionId` in the 24 hours before `now` by main and the Assistant; the user's are not kept. */
  private wakesWithinDay(sessionId: string, now: number): number {
    return this.restore().filter((wake) => wake.sessionId === sessionId && wake.at > now - DAY_MS).length
  }

  /** The verdict act() would give now; nothing is sent and nothing is written. */
  check(request: ActionRequest): ActionRefusal | null {
    return this.verdict(request).refusal
  }

  /** Does the action if every check holds; answers the journal line, written whatever the outcome. */
  act(request: ActionRequest): ActionResult {
    const verdict = this.verdict(request)
    if (verdict.refusal !== null) return this.refused(request, verdict, verdict.refusal)
    const action = request.action as ClosedAction
    const sessionId = verdict.sessionId as string
    const now = this.deps.now()
    const text = action === 'wake-orchestrator' ? WAKE_ORCHESTRATOR_TEXT : continueSessionText((verdict.wait as SessionLimitsWait).since, now)
    const session = this.deps.session(sessionId)
    try {
      if (session?.send(text) === 'queued') {
        // It would go out later — after a restart, say — with no fresh look at the Session or the Limits: taken back.
        const queued = session.queued().items.findLast((each) => each.text === text)
        if (queued !== undefined) session.removeQueued(queued.id)
        return this.refused(request, verdict, 'busy')
      }
    } catch {
      return this.refused(request, verdict, 'failed')
    }
    if (action === 'continue-session') this.deps.waits.resume(sessionId)
    else if (request.by !== 'user') this.restore().push({ sessionId, at: now })
    const line = this.write(this.line(request, verdict, { outcome: 'done', text }))
    return { ok: true, line }
  }

  /**
   * The closed list did not help with item `itemId`: a line `escalated`, and the model of the Assistant is woken for it
   * (ticket 06). Once per item: a second call does nothing and answers null.
   */
  escalate(itemId: string, by: ActionActor = 'main'): ActionJournalLine | null {
    this.restore()
    if (this.escalated.has(itemId)) return null
    this.escalated.add(itemId)
    const shown = this.deps.shown().find((each) => each.item.id === itemId) ?? null
    const request: ActionRequest = { action: 'wake-orchestrator', itemId, by }
    const line = this.write(this.line(request, { refusal: null, shown, mode: null, sessionId: shown?.item.subject.id ?? null, wait: null }, { outcome: 'escalated' }))
    this.deps.escalate?.(itemId)
    return line
  }

  /** The journal, oldest first. */
  journal(): ActionJournalLine[] {
    return this.deps.journal.lines()
  }

  private verdict(request: ActionRequest): Verdict {
    const verdict: Verdict = { refusal: null, shown: null, mode: null, sessionId: null, wait: null }
    const refuse = (refusal: ActionRefusal): Verdict => ({ ...verdict, refusal })
    if (!isClosedAction(request.action)) return refuse('not-in-list')
    verdict.shown = this.deps.shown().find((each) => each.item.id === request.itemId) ?? null
    if (verdict.shown === null) return refuse('no-item')
    const proposal = verdict.shown.proposals.find((each) => each.action === request.action)
    if (proposal === undefined) return refuse('not-proposed')
    verdict.mode = proposal.mode
    if (!modeAllows(proposal.mode, request.by)) return refuse('mode')
    const item = verdict.shown.item
    if (item.subject.kind !== 'session' || item.projectId === null) return refuse('no-target')
    verdict.sessionId = item.subject.id
    const orchestrator = this.deps.orchestratorOf(item.projectId)
    // An Orchestrator is woken, never continued: Auto-continue answers its refused turns (orchestrator-continue.ts).
    if ((request.action === 'wake-orchestrator') !== (orchestrator === item.subject.id)) return refuse('no-target')
    const session = this.deps.session(item.subject.id)
    if (session === null) return refuse('no-target')
    if (session.unattended) return refuse('run-owns')
    if (session.state !== 'idle') return refuse('busy')
    const now = this.deps.now()
    if (request.action === 'wake-orchestrator') {
      if (session.backgroundTasks().length > 0 || this.deps.continuing?.(item.projectId) === true) return refuse('busy')
      if (!limitsCheck(this.deps.limits(), 'on-demand', now).ok) return refuse('limits')
      if (request.by !== 'user' && this.wakesWithinDay(item.subject.id, now) >= WAKES_PER_DAY) return refuse('cap')
      return verdict
    }
    verdict.wait = this.deps.waits.wait(item.subject.id)
    if (verdict.wait === null || verdict.wait.until > now) return refuse('limits')
    return verdict
  }

  private refused(request: ActionRequest, verdict: Verdict, reason: ActionRefusal): ActionResult {
    return { ok: false, reason, line: this.write(this.line(request, verdict, { outcome: 'refused', reason })) }
  }

  private line(request: ActionRequest, verdict: Verdict, outcome: Pick<ActionJournalLine, 'outcome'> & Partial<Pick<ActionJournalLine, 'reason' | 'text'>>): ActionJournalLine {
    const item = verdict.shown?.item ?? null
    return {
      at: this.deps.now(),
      action: request.action,
      by: request.by,
      item: request.itemId,
      duty: verdict.shown?.duty ?? null,
      projectId: item?.projectId ?? null,
      itemKind: item?.kind ?? null,
      itemText: item?.text ?? null,
      mode: verdict.mode,
      sessionId: verdict.sessionId,
      ...outcome,
    }
  }

  /** A line the journal could not write is logged; the action itself stays done. */
  private write(line: ActionJournalLine): ActionJournalLine {
    try {
      this.deps.journal.append(line)
    } catch (error) {
      console.warn('[assistant] a line of the journal of actions could not be written', error)
    }
    return line
  }
}
