// The facts of a Run: the contract between the readers of the sources (worfy-flight-recorder
// tickets 13–16), the service that gathers them (ticket 17) and the span model (spans.ts), with the
// vocabulary they share. Pure types and constants: no Node, no DOM.
import type { MarkVerdict, PipelineStage } from '../workflow/pipeline'

// ── the vocabulary ───────────────────────────────────────────────────────────

/** The kinds of span, a fixed set (decision 01, Q8). */
export const SPAN_KINDS = ['run', 'wave', 'ticket', 'stage', 'agent', 'ci', 'gate', 'script', 'wait', 'orchestrator-turn'] as const
export type SpanKind = (typeof SPAN_KINDS)[number]

/** The kinds of work inside a Stage. */
export const WORK_KINDS = ['agent', 'ci', 'gate', 'script'] as const
export type WorkKind = (typeof WORK_KINDS)[number]

/** The subkinds of an agent span, by the agent's type and name. */
export const AGENT_SUBKINDS = ['implementer', 'verifier', 'other'] as const
export type AgentSubkind = (typeof AGENT_SUBKINDS)[number]

/** How a span ended (decision 03, Q6). A span with no outcome (`null`) is still running. */
export const SPAN_OUTCOMES = ['ok', 'failed', 'rejected', 'blocked', 'stopped', 'cut-off'] as const
export type SpanOutcome = (typeof SPAN_OUTCOMES)[number]

/** Why the work of a Run stood (the spec's Model section, on Waits, blocks and retries). */
export const WAIT_CAUSES = ['limits', 'limits-budget', 'background-tasks', 'gate-queue', 'other-machine'] as const
export type WaitCause = (typeof WAIT_CAUSES)[number]

/** Where a fact came from: the source of a span's start and of its end. */
export const FACT_SOURCES = ['journal', 'transcript', 'github', 'gate-log', 'marks-file', 'git'] as const
export type FactSource = (typeof FACT_SOURCES)[number]

/** A source that is gone or did not answer, with the label the screen shows (decision 08, Q5). */
export const LOST_SOURCE_LABELS = {
  'transcript-deleted': 'transcript deleted',
  'gate-logs-deleted': 'gate logs deleted (10 runs or 8 days)',
  'github-no-answer': 'GitHub did not answer',
  'branch-deleted': 'branch deleted',
} as const
export type LostSource = keyof typeof LOST_SOURCE_LABELS

// ── the facts: the contract with the readers ─────────────────────────────────
//
// Each reader fills `RunFacts` from its ONE source; the service (ticket 17) concatenates the arrays
// of the readers and adds what no source holds. Who fills what:
//
// | field                | filled by                                                              |
// |----------------------|------------------------------------------------------------------------|
// | `run.live`, `now`, `pipeline` | the service (17): whether Autopilot runs this Run now, the clock, `workflow.pipeline` |
// | `run` (the rest)     | Journal (13): `run-started`, `run-stopped`, the last line              |
// | `waves`              | Journal (13): `wave-started` … `wave-finished`                         |
// | `ticketEvents` `status` | Journal (13): `ticket-status`; a Journal before it — `claimed` at `wave-started`. A Ticket with no `status` before its other events counts as claimed |
// | `ticketEvents` `pr-opened`, `push`, `ci-started`, `ci-finished`, `approved`, `merge` | GitHub (15) |
// | `ticketEvents` `mark` | GitHub (15) in full mode; the marks file and `gate: VERIFIED` commits (16) in Silent mode and `local-green` |
// | `ticketEvents` `push`, `merge` without a PR | git (16)                                       |
// | `work` `agent`       | transcripts (14): `Agent` … report, `SendMessage` … report; `worktree` a canonical path |
// | `work` `ci`          | GitHub (15)                                                            |
// | `work` `gate`, `script` | gate logs (16): a gate run by `sha`/`worktree` (a canonical path), its steps with `parentWork` |
// | `waits`              | Journal (13): `limits`, `limits-budget`, `background-tasks`, `gate-queue`; GitHub (15): `other-machine` |
// | `retryCauses`        | Journal (13): `narrow-round`, `session-error`                         |
// | `turns`              | the Orchestrator's transcript (14)                                     |
// | `lost`               | the reader of the source that is gone: 14 transcripts, 15 GitHub, 16 gate logs and branches |
// | `orchestratorMarks`  | Journal (13): `refused-dialog`, `human-input`                         |
//
// No reader needs another source to fill its part: a gate run names its `sha` or `worktree`, and the
// model finds the Ticket (the sha of the Ticket's events and work, the worktree of its agents); a
// `session-error` names no agent, and the model attaches it to the next attempt; a lost source with
// no Ticket covers every Ticket of the Run the Journal knows of.
//
// The model compares `worktree` as a string: readers 14 and 16 hand over a canonical path (realpath;
// case-folded on Windows), since a pure model cannot resolve one. The path `.claude/worktrees/<NN>`
// is shared by ticket NN of every Epic over the days the gate keeps its logs, so work that ended
// before its Ticket's row began is left out.
//
// Times are ISO 8601 strings as the sources write them. A fact with no end (`end: null`) is open;
// `lastSeenAt` is the last event about it in the reader's source, where it is cut off once the Run
// is over (without it, its start). The facts need not be sorted. Ids are unique per kind.

type Iso = string

/** The Run itself. */
export interface RunFact {
  /** The run id of the Journal: the key that links every other source (decision 01, Q5). */
  id: string
  startedAt: Iso
  /** `run-stopped`; null when the Journal has none. */
  stoppedAt: Iso | null
  /** Whether the Run is going on now (the service): open spans stretch to `now` instead of being cut off. */
  live: boolean
  /** The last line of the Run in the Journal: where a Run that stopped without `run-stopped` ends. */
  lastSeenAt?: Iso
  /** How the Run ended, when it did; `stopped` when absent. */
  outcome?: SpanOutcome
  /** The stop reason of `run-stopped` (`user-stop`, `no-ready-wave`, …). */
  reason?: string
}

/** A Wave of the Run (`wave-started` … `wave-finished`). */
export interface WaveFact {
  /** The number of the Wave within the Run, from 1. */
  number: number
  startedAt: Iso
  finishedAt: Iso | null
  lastSeenAt?: Iso
  /** The Tickets the Wave was sent with: the Tickets the Journal knows of. */
  tickets: readonly string[]
  /** The id of the Orchestrator Session the Wave went to (`wave-started.session`). */
  session?: string
}

/** Where and when a Ticket event happened. */
export interface EventBase {
  ticket: string
  at: Iso
  source: FactSource
}

/**
 * An event of a Ticket that may move it to another Stage (decision 03, Q3). The model replays them
 * in time order through `stageOf`, so a reader needs no Pipeline and maps nothing onto Stages.
 */
export type StageEventFact = EventBase & StageEvent

/** What a Ticket event says, its time and place aside. */
export type StageEvent =
  | {
      /** `ticket-status`: `claimed` is claim, `done` is done, `blocked` starts a block that the next status clears. */
      event: 'status'
      state: 'claimed' | 'blocked' | 'done' | 'open'
      /** `Blocked reason:` of a block. */
      reason?: string
      /** `Waits:` of a block. */
      waits?: string
    }
  | { event: 'pr-opened'; pr: number; sha: string | null }
  /** A new head of the Ticket's branch: a commit pushed to the PR, or to the branch without one. */
  | { event: 'push'; sha: string }
  /** A CI check of the PR started or finished; on another sha than the head it is ignored. */
  | { event: 'ci-started'; name: string; sha: string | null }
  | { event: 'ci-finished'; name: string; sha: string | null; conclusion: 'success' | 'failure' }
  /** An agent's mark (`review`, `check/<name>`); without `sha` it is on the current head. */
  | { event: 'mark'; mark: string; verdict: MarkVerdict; sha: string | null; reason?: string }
  /** The PR approved (`reviewDecision` APPROVED): Human review is passed. */
  | { event: 'approved' }
  | { event: 'merge'; pr?: number; sha?: string }

/** A reference to a work fact. */
export interface WorkRef {
  kind: WorkKind
  id: string
}

/** One piece of work: an agent's stretch of active work, a CI run, a gate run, a step of a gate run. */
export interface WorkFact {
  /** Unique among the work facts of its kind: the agent id, the CI run id, the gate run folder… */
  id: string
  kind: WorkKind
  /**
   * The Ticket the work belongs to, when the source names it; `null` for work of the Run as a
   * whole; absent — the model finds it by `sha`, then `worktree`, then `parentWork`, and leaves out
   * work it cannot place (a gate run of another session's worktree is not this Run's). Reader 14
   * knows every agent it reports is this Run's: an agent whose Ticket it cannot tell (a verifier in
   * its own review worktree) gets its `sha` or `worktree` and, failing both, `null` — never absent
   * with neither, or it vanishes.
   */
  ticket?: string | null
  /** The agent's name (`impl-12`), the CI check, the gate step. Same Ticket, kind and name — attempts of one thing. */
  name: string
  /** The agent's type (`worfy:implementer`), for the subkind. */
  agentType?: string
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  /** How it ended; `ok` when it ended and the source says nothing else. */
  outcome?: SpanOutcome
  reason?: string
  /** The work that caused this attempt, when the source says (`SendMessage` after a verdict, a restart). */
  retryOf?: WorkRef
  /** The work this is a step of: a step of a gate run. */
  parentWork?: WorkRef
  /** A note of the source (a green-cache hit of the gate). */
  note?: string
  session?: string
  agent?: string
  pr?: number
  sha?: string
  /** The folder the work ran in: the gate's `worktree`, the agent's working folder. */
  worktree?: string
  verdict?: string
  startSource: FactSource
  endSource?: FactSource
}

/**
 * A cause of a retry the Journal holds without the work itself: `narrow-round` (a Ticket, no agent)
 * and `session-error` (a Session, no Ticket). The model attaches it to the first work of `kind`
 * (and of `ticket`, when given) that starts at or after `at`.
 */
export interface RetryCauseFact {
  ticket: string | null
  kind: WorkKind
  at: Iso
  reason: string
  source: FactSource
}

/** A Wait of the Run (the spec's Model section, on Waits, blocks and retries). */
export interface WaitFact {
  id: string
  cause: WaitCause
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  /** Detail of the cause: the Limits window, the background tasks, the machine waited for. */
  detail?: string
  /** The Tickets that stood (`other-machine`: the PR's); absent — the Tickets of the Waves open at its start. */
  tickets?: readonly string[]
  startSource: FactSource
  endSource?: FactSource
}

/** A turn of the Orchestrator: linked to the Tickets it touched, not nested in them. */
export interface TurnFact {
  id: string
  start: Iso
  end: Iso | null
  lastSeenAt?: Iso
  tickets: readonly string[]
  session?: string
  startSource: FactSource
  endSource?: FactSource
}

/**
 * A span whose details are gone: the implementer of a Ticket whose transcript is deleted, the gate
 * runs past the log's limit, the PR and CI GitHub did not give. The Ticket as for work; `ticket:
 * null` with a work kind — every Ticket of the Run that has no span of that kind; with
 * `orchestrator-turn` — the Orchestrator's lane. With no times it covers its Ticket's row (or the Run).
 */
export interface LostFact {
  ticket?: string | null
  sha?: string
  worktree?: string
  kind: WorkKind | 'orchestrator-turn'
  name: string
  source: LostSource
  start?: Iso
  end?: Iso
}

/** A mark on the Orchestrator's lane: a dialog Autopilot refused, input of a person. */
export interface OrchestratorMarkFact {
  kind: 'refused-dialog' | 'human-input'
  at: Iso
  text: string
}

/** Everything a timeline is built from. */
export interface RunFacts {
  run: RunFact
  /** The moment the timeline is computed: where open spans of a live Run end. */
  now: Iso
  /** The Project's Pipeline (`workflow.pipeline`, else DEFAULT_PIPELINE). */
  pipeline: readonly PipelineStage[]
  waves: readonly WaveFact[]
  ticketEvents: readonly StageEventFact[]
  work: readonly WorkFact[]
  retryCauses: readonly RetryCauseFact[]
  waits: readonly WaitFact[]
  turns: readonly TurnFact[]
  lost: readonly LostFact[]
  orchestratorMarks: readonly OrchestratorMarkFact[]
}
