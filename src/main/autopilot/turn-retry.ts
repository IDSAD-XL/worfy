// The retry of an Autopilot run after a temporary API error (worfy-retry ticket 04): what happens
// when a turn of the run's Orchestrator Session ends with an error that passes with time (500, 529,
// a dropped connection; src/shared/agent/turn-failure.ts) and Auto-continue is on for the Project.
//
// 1. The turn's end does not reach the cycle: the run goes `waiting` (`waitingFor: 'retry'`) with
//    `turn-retry` in its journal, and a timer is set to the pause of the plan
//    (src/shared/agent/continue-plan.ts, retryDecision): 1, 5, 15, 30, 60 minutes, ±20 %.
// 2. When it fires, the Orchestrator gets retryText — a new message that asks it to continue and names
//    what the failed turn already did outside the Session — never the turn's own text or the Wave's
//    command again.
// 3. A turn that ends without an error (the continuation's, a background task's, a person's) resets
//    the count; the sixth failure in a row, an error that is not temporary, or an external action
//    without its result is refused (`retry-refused`), and the turn's end goes to the cycle as before.
// 4. A turn under way when the timer fires ends the wait (`resumed`) and its end decides; a refusal by
//    the Limits ends it too, and the Limits wait goes on alone (run.ts).
//
// The pause goes by the wall clock (wallTimer, limits-wait.ts), as the wait for the Limits does. The
// switch is read before each decision and again when the timer fires: off by then, the wait is
// dropped and the run stops as it would have without it. Like LimitsWait, a timer that fired before
// its wait was cancelled finds its id no longer current (isCurrent) and sends nothing.
import { externalActions, retryDecision, retryText, type ExternalAction, type RetryDecision } from '../../shared/agent/continue-plan'
import type { AgentEvent } from '../../shared/agent/events'
import type { TransientError, TurnFailure } from '../../shared/agent/turn-failure'
import { wallTimer } from './limits-wait'

export interface TurnRetryDeps {
  /** Whether Auto-continue is on for the Project (autoContinueOn of src/main/settings/store.ts). */
  enabled(projectId: string): boolean
  /** Sends a message to the Session (Session.send); throws when the Session is gone. */
  send(sessionId: string, text: string): void
  /** The clock, in milliseconds; tests pass a fixed one. */
  now?(): number
  /** Calls `fire` once at the wall time `at`; answers the cancel (default wallTimer). */
  schedule?(at: number, fire: () => void): () => void
  /** A random number in [0, 1) for the spread of a pause (default Math.random). */
  random?(): number
}

/**
 * An external call of the turn with its command line as the model wrote it (a shell call; null for
 * another tool). The journal masks this line, not worfy's summary: the summary drops the option names
 * (`--token x` reads `x`) that the masking goes by.
 */
export interface RetryAction extends ExternalAction {
  command: string | null
}

/** The command line of a shell call's input (`command`: a text, or Codex's list of words); null when it has none. */
function commandLine(input: unknown): string | null {
  const command = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined
  if (typeof command === 'string') return command
  if (Array.isArray(command)) return command.filter((part): part is string => typeof part === 'string').join(' ')
  return null
}

/** The failed turn a retry follows: the kind of its error, its calls and its error text. */
export interface FailedTurn {
  error: TransientError
  actions: readonly ExternalAction[]
  /** The turn's error text, or null: what the cycle gets if the run gives the retry up. */
  message: string | null
}

/** The retry a run waits to send: which of how many, after which failed turn. */
interface PendingRetry extends FailedTurn {
  attempt: number
  of: number
}

/** The retries of one run. */
export class TurnRetry {
  /** Retries sent since the last turn that ended without an error. */
  private attempts = 0
  /** The id of the last wait; a timer of an earlier one sends nothing. */
  private id = 0
  private cancelTimer: (() => void) | null = null
  private untilValue: number | null = null
  private pending: PendingRetry | null = null
  /** The current turn's calls and their results: what externalActions reads at the turn's end. */
  private calls: AgentEvent[] = []
  private readonly now: () => number
  private readonly schedule: (at: number, fire: () => void) => () => void

  constructor(
    private readonly deps: TurnRetryDeps,
    private readonly projectId: string,
  ) {
    this.now = deps.now ?? Date.now
    this.schedule = deps.schedule ?? wallTimer(this.now)
  }

  /** Whether Auto-continue is on for the run's Project now. */
  enabled(): boolean {
    return this.deps.enabled(this.projectId)
  }

  /** While the run waits: when the continuation goes (milliseconds); otherwise null. */
  get until(): number | null {
    return this.untilValue
  }

  /** While the run waits: which retry it waits to send; otherwise null. */
  get retry(): { attempt: number; of: number } | null {
    return this.pending === null ? null : { attempt: this.pending.attempt, of: this.pending.of }
  }

  /** While the run waits: the failed turn the retry follows; otherwise null. */
  get failed(): FailedTurn | null {
    return this.pending
  }

  /** A turn of the Session began (its `prompt` event): the calls of the turn before are no longer its. */
  turnStarted(): void {
    this.calls = []
  }

  /** An event of the Session during a turn: its tool calls and their results are kept. */
  observe(event: AgentEvent): void {
    if (event.type === 'tool_use' || event.type === 'tool_result') this.calls.push(event)
  }

  /** The external and unclassified calls of the current turn (continue-plan.ts, externalActions), each with its command line. */
  actions(): RetryAction[] {
    const inputs = new Map<string, unknown>()
    for (const event of this.calls) if (event.type === 'tool_use') inputs.set(event.id, event.input)
    return externalActions(this.calls).map((action) => ({ ...action, command: commandLine(inputs.get(action.toolUseId)) }))
  }

  /** Whether to retry after the failure, given the turn's calls: the next attempt of the count. */
  decide(failure: TurnFailure, actions: readonly ExternalAction[]): RetryDecision {
    const random = this.deps.random ?? Math.random
    return retryDecision({ failure, attempt: this.attempts + 1, actions, random: random() })
  }

  /** Waits for the retry `decision`, then calls `fire` once; answers the wait's id (isCurrent). */
  wait(decision: Extract<RetryDecision, { kind: 'retry' }>, failed: FailedTurn, fire: (id: number) => void): number {
    this.cancel()
    this.id += 1
    const id = this.id
    this.attempts = decision.attempt
    this.pending = { ...failed, attempt: decision.attempt, of: decision.of }
    this.untilValue = this.now() + decision.delayMs
    this.cancelTimer = this.schedule(this.untilValue, () => fire(id))
    return id
  }

  /** Whether the wait `id` still goes on: not cancelled, sent or replaced by a later one. */
  isCurrent(id: number): boolean {
    return this.untilValue !== null && this.id === id
  }

  /** The wait is over: answers the continuation for the Orchestrator; the count stays until a turn goes through. */
  resume(): string {
    const pending = this.pending
    this.cancel()
    if (pending === null) throw new Error('no retry is waiting')
    return retryText(pending)
  }

  /** A turn ended without a retry: no wait goes on, and the next failure is the first of a new count. */
  passed(): void {
    this.attempts = 0
    this.cancel()
  }

  /** Cancels the timer; no message goes out. */
  cancel(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    this.untilValue = null
    this.pending = null
  }

  /** Sends the message to the Session. */
  send(sessionId: string, text: string): void {
    this.deps.send(sessionId, text)
  }
}
