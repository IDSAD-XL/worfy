// The span model of Flight Recorder (the Model section of the worfy-flight-recorder spec; decision
// 03): what a Run's timeline is made of and how it is built from facts. Pure: no Node, no DOM, no
// input or output — the readers of the sources (tickets 13–16) turn the Journal, the transcripts,
// GitHub and the gate logs into `RunFacts`, and `buildTimeline` turns those into spans. Nothing is
// stored: the timeline is computed each time it is opened (decision 01, Q4).
//
// The tree: Run → Wave → Ticket → Stage by the Project's Pipeline → work (an agent, a CI run, a gate
// run, a script). A Ticket that went through several Waves is one row for the whole Run, with a part
// per Wave and the gap between them (`segments`); so a Ticket span hangs off the Run and names its
// Waves in `links.waves` (self time of a Wave subtracts the parts of its Tickets: summary.ts). Two
// lanes beside the tree hang off the Run as well: the Waits of the Run and the turns of the
// Orchestrator, which link to Tickets instead of being nested in them.
//
// The rules the model keeps, each with its decision:
// - a Stage is not stored (ADR-0067): the Stage of a Ticket at each event is `stageOf` of
//   src/shared/workflow/pipeline.ts over the facts known up to that event, the same rules the board
//   uses. Where a source has no event, the Stages passed at once are one span with the names of all
//   of them and the note «no boundary in sources» (decision 03, Q3);
// - a Wait is a span with a cause; a block is not a span but a mark on the Ticket's row that lasts
//   until it is cleared or the Run ends; a retry is a new span of the same kind, attempt `#N`, linked
//   to the span that caused it (decision 03, Q5);
// - a span with no end ends at the last event about it in any source, outcome `cut-off`, once the
//   Run is over; while the Run is live it stretches to now and has no outcome (decision 03, Q7;
//   decision 07);
// - a span the Journal knows of whose details are gone carries the label of the lost source; a step
//   the Journal is silent about too did not happen (decision 08, Q5);
// - a Wait, a retry and every outcome other than `ok` carry a reason, always;
// - what happened after the Run ended (a merge by hand the next day, a block cleared later) is not
//   part of the Run.
import { harnessName } from '../agent/subagent-type'
import { stageId, stageLabel, stageOf, type CheckFact, type MarkFact, type MarkVerdict, type PipelineStage, type StageFacts } from '../workflow/pipeline'
import type { TicketState } from '../workflow/types'

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

/** The note on a span of neighbouring Stages no source separates. */
export const NO_BOUNDARY_NOTE = 'no boundary in sources'
/** The reason of a span whose sources give none, where a reason is required. */
export const NO_REASON = 'no reason in sources'
/** The reason of a span cut off: it has no end in any source. */
export const NO_END_REASON = 'no end in sources'
/** The reason of a Ticket a Wave finished before it was done. */
export const WAVE_FINISHED_REASON = 'the Wave finished before the Ticket was done'

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
// | `ticketEvents` `status` | Journal (13): `ticket-status`; a Journal before it — `claimed` at `wave-started` |
// | `ticketEvents` `pr-opened`, `push`, `ci-started`, `ci-finished`, `approved`, `merge` | GitHub (15) |
// | `ticketEvents` `mark` | GitHub (15) in full mode; the marks file and `gate: VERIFIED` commits (16) in Silent mode and `local-green` |
// | `ticketEvents` `push`, `merge` without a PR | git (16)                                       |
// | `work` `agent`       | transcripts (14): `Agent` … report, `SendMessage` … report             |
// | `work` `ci`          | GitHub (15)                                                            |
// | `work` `gate`, `script` | gate logs (16): a gate run by `sha`/`worktree`, its steps with `parentWork` |
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
   * work it cannot place (a gate run of another session's worktree is not this Run's).
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

// ── the spans ────────────────────────────────────────────────────────────────

/** A stretch of time in milliseconds since the epoch; a Ticket span has one per Wave. */
export interface Segment {
  start: number
  end: number
  /** The Wave of the part, for a Ticket and its Stages. */
  wave?: number
}

export interface SpanLinks {
  run: string
  /** The Wave of a Wave span; the Waves of a Ticket span. */
  wave?: number
  waves?: readonly number[]
  ticket?: string
  /** The Tickets an Orchestrator turn touched, the Tickets that stood in a Wait. */
  tickets?: readonly string[]
  session?: string
  agent?: string
  pr?: number
  sha?: string
  verdict?: string
}

export interface Span {
  id: string
  kind: SpanKind
  /** `agent` only. */
  subkind: AgentSubkind | null
  /** The tree, or one of the two lanes of the Run. */
  lane: 'tree' | 'wait' | 'orchestrator'
  parent: string | null
  name: string
  start: number
  /** null: not finished, the Run is live. */
  end: number | null
  /** Where the span stops on the timeline: its end, or now while the Run is live. */
  until: number
  /** The parts of the span: one for most, one per Wave for a Ticket and its Stages. */
  segments: readonly Segment[]
  outcome: SpanOutcome | null
  reason: string | null
  /** From 1; a retry is 2 and on. */
  attempt: number
  /** The span that caused this attempt. */
  retryOf: string | null
  links: SpanLinks
  startSource: FactSource | null
  endSource: FactSource | null
  /** The lost source of a span whose details are gone. */
  lost: LostSource | null
  /** NO_BOUNDARY_NOTE on a span of Stages no source separates; the source's note on work. */
  note: string | null
  /** `stage` only: the ids of the Pipeline Stages the span covers, in order. */
  stages: readonly string[]
  /** `wait` only. */
  waitCause: WaitCause | null
}

/** A block of a Ticket: its row is hatched from `at` to `until`. */
export interface BlockMark {
  ticket: string
  at: number
  until: number
  reason: string
  waits: string | null
  /** Whether the block was cleared within the Run (else it held to its end, or holds now). */
  cleared: boolean
  source: FactSource
}

export interface OrchestratorMark {
  kind: OrchestratorMarkFact['kind']
  at: number
  text: string
}

export interface Timeline {
  runId: string
  live: boolean
  now: number
  /** Every span, the Run first; a child names its parent. */
  spans: readonly Span[]
  blocks: readonly BlockMark[]
  orchestratorMarks: readonly OrchestratorMark[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ms(iso: Iso): number {
  const value = Date.parse(iso)
  if (Number.isNaN(value)) throw new Error(`flight-recorder: not a time: ${JSON.stringify(iso)}`)
  return value
}

const optionalMs = (iso: Iso | null | undefined): number | null => (iso === null || iso === undefined ? null : ms(iso))

/** The subkind of an agent: by its Harness type (`worfy:implementer`), else by its name (`impl-12`). */
export function agentSubkind(name: string, agentType?: string): AgentSubkind {
  const type = agentType === undefined ? null : harnessName(agentType)
  if (type === 'implementer') return 'implementer'
  if (type === 'reviewer' || type === 'verifier') return 'verifier'
  if (type !== null && agentType !== undefined) return 'other'
  if (/^impl(?:ementer)?-/iu.test(name)) return 'implementer'
  if (/^(?:verify|verifier|review|reviewer)-/iu.test(name)) return 'verifier'
  return 'other'
}

/** The parts of [start, end] inside `segments`. */
export function clip(start: number, end: number, segments: readonly Segment[]): Segment[] {
  const parts: Segment[] = []
  for (const segment of segments) {
    const from = Math.max(start, segment.start)
    const to = Math.min(end, segment.end)
    if (to > from) parts.push(segment.wave === undefined ? { start: from, end: to } : { start: from, end: to, wave: segment.wave })
  }
  return parts
}

interface Ending {
  end: number | null
  until: number
  outcome: SpanOutcome | null
  reason: string | null
}

/**
 * How a fact ends: closed — at its end with its outcome; open in a live Run — not finished, up to
 * now; open in a Run that is over — cut off at the last event about it, never before its start.
 */
function ending(start: number, end: number | null, lastSeen: number | null, live: boolean, now: number, outcome: SpanOutcome | undefined, reason: string | undefined): Ending {
  if (end !== null) {
    const result = outcome ?? 'ok'
    return { end, until: end, outcome: result, reason: reason ?? (result === 'ok' ? null : NO_REASON) }
  }
  if (live) return { end: null, until: Math.max(start, now), outcome: null, reason: reason ?? null }
  const cut = Math.max(start, lastSeen ?? start)
  return { end: cut, until: cut, outcome: 'cut-off', reason: reason ?? NO_END_REASON }
}

function span(fields: Partial<Span> & Pick<Span, 'id' | 'kind' | 'lane' | 'parent' | 'name' | 'start' | 'end' | 'until' | 'links'>): Span {
  return {
    subkind: null,
    segments: fields.until > fields.start ? [{ start: fields.start, end: fields.until }] : [],
    outcome: null,
    reason: null,
    attempt: 1,
    retryOf: null,
    startSource: null,
    endSource: null,
    lost: null,
    note: null,
    stages: [],
    waitCause: null,
    ...fields,
  }
}

const byTime = <T>(time: (item: T) => number) => (a: T, b: T) => time(a) - time(b)

const workId = (ref: WorkRef): string => `${ref.kind}:${ref.id}`

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

// ── the Stages of a Ticket ───────────────────────────────────────────────────

/** What is known of a Ticket's PR up to a moment of the replay. */
interface PullState {
  number: number
  state: 'OPEN' | 'MERGED'
  headSha: string | null
  checks: Map<string, CheckFact>
  approved: boolean
  mergedAt: string | null
}

const PLACEHOLDER_CHECK = '\u0000pending'

/** The status of `ticket-status` as epic-status reads the `Status:` line. */
const STATUS: Record<Extract<StageEventFact, { event: 'status' }>['state'], TicketState> = { claimed: 'work', blocked: 'blocked', done: 'done', open: 'open' }

const changesHead = (event: StageEventFact): boolean => event.event === 'push' || (event.event === 'pr-opened' && event.sha !== null)
const isCi = (event: StageEventFact): boolean => event.event === 'ci-started' || event.event === 'ci-finished'

interface StageRun {
  stages: Span[]
  pr: number | null
  sha: string | null
}

interface TicketContext {
  runId: string
  pipeline: readonly PipelineStage[]
}

/**
 * The Stage spans of one Ticket: its events replayed in time order, the Stage after each one being
 * `stageOf` over the facts known so far (ADR-0067: the board's rules). A move forward closes the
 * open span over every Stage passed (more than one — the note «no boundary in sources»); a move
 * back closes it `rejected` (a failure mark on the head) or `stopped` (a new commit) and opens the
 * earlier Stage again, attempt `#N`; Done closes the last one. The last open span ends with the Ticket.
 *
 * Until the first check of a new head is seen, a PR whose head has CI events later counts one
 * pending check: `stageOf` passes CI on an open PR with no checks, which in history is only the
 * minute before the first check appears.
 */
function stagesOf(ticket: Span, events: readonly StageEventFact[], context: TicketContext): StageRun {
  const { pipeline } = context
  const last = pipeline.length - 1
  const sorted = [...events].sort(byTime((event) => ms(event.at)))

  let status: TicketState = 'open'
  let statusAt: string | null = null
  let pr: PullState | null = null
  let branchHead: string | null = null
  const marks: MarkFact[] = []

  const facts = (): StageFacts => ({
    mode: 'full',
    status,
    statusAt,
    blockedReason: null,
    waits: null,
    headSha: branchHead,
    pr: pr === null ? null : { number: pr.number, state: pr.state, headSha: pr.headSha, checks: [...pr.checks.values()], reviewDecision: pr.approved ? 'APPROVED' : null, mergedAt: pr.mergedAt, mergeCommit: null },
    marks,
    deploys: [],
    lock: null,
  })
  const head = (): string | null => (pr?.state === 'OPEN' ? pr.headSha : null) ?? branchHead
  /** Whether CI events follow a head change at `index`, before the next head change. */
  const ciFollows = (index: number): boolean => {
    for (const next of sorted.slice(index + 1)) {
      if (changesHead(next)) return false
      if (isCi(next)) return true
    }
    return false
  }
  const newHead = (sha: string | null, index: number) => {
    if (sha !== null) branchHead = sha
    if (pr !== null && pr.state === 'OPEN') {
      pr.headSha = sha ?? pr.headSha
      pr.checks = new Map()
      if (ciFollows(index)) pr.checks.set(PLACEHOLDER_CHECK, { name: PLACEHOLDER_CHECK, state: 'pending', startedAt: null, completedAt: null })
    }
  }

  interface Raw {
    from: number
    through: number
    start: number
    end: number | null
    until: number
    outcome: SpanOutcome | null
    reason: string | null
    startSource: FactSource | null
    endSource: FactSource | null
    pr: number | null
    sha: string | null
  }
  const raws: Raw[] = []
  let current = 0
  let openedAt = ticket.start
  let openedBy: FactSource | null = null

  for (const [index, event] of sorted.entries()) {
    if (current === last) break
    const raw = ms(event.at)
    // The Ticket's row is the Run's: what comes after its end is outside it.
    if (raw > ticket.until) break
    const at = Math.max(raw, openedAt)
    const before = { pr: pr?.number ?? null, sha: head() }
    switch (event.event) {
      case 'status':
        status = STATUS[event.state]
        statusAt = event.at
        break
      case 'pr-opened':
        pr = { number: event.pr, state: 'OPEN', headSha: null, checks: new Map(), approved: false, mergedAt: null }
        newHead(event.sha, index)
        break
      case 'push':
        newHead(event.sha, index)
        break
      case 'ci-started':
      case 'ci-finished': {
        if (pr === null || pr.state !== 'OPEN' || (event.sha !== null && pr.headSha !== null && event.sha !== pr.headSha)) break
        pr.checks.delete(PLACEHOLDER_CHECK)
        const state = event.event === 'ci-started' ? 'pending' : event.conclusion
        pr.checks.set(event.name, { name: event.name, state, startedAt: null, completedAt: null })
        break
      }
      case 'mark':
        marks.push({ kind: event.mark, verdict: event.verdict, sha: event.sha ?? head() ?? '', at: event.at })
        break
      case 'approved':
        if (pr !== null) pr.approved = true
        break
      case 'merge':
        if (pr === null) pr = { number: event.pr ?? 0, state: 'MERGED', headSha: event.sha ?? null, checks: new Map(), approved: false, mergedAt: event.at }
        else {
          pr.state = 'MERGED'
          pr.mergedAt = event.at
        }
        break
    }
    const stage = stageOf(facts(), pipeline)
    if (stage.index === current) continue
    const back = stage.index < current
    const failure = event.event === 'mark' && event.verdict === 'failure'
    raws.push({
      from: current,
      through: back ? current : stage.index - 1,
      start: openedAt,
      end: at,
      until: at,
      outcome: back ? (stage.rework && failure ? 'rejected' : 'stopped') : 'ok',
      reason: back ? (stage.rework && failure ? (event.reason ?? `${event.mark}: failure`) : `back to ${stageLabel(pipeline[stage.index] ?? pipeline[0] ?? { kind: 'queued' })}`) : null,
      startSource: openedBy,
      endSource: event.source,
      ...before,
    })
    current = stage.index
    openedAt = at
    openedBy = event.source
  }
  if (current !== last) {
    raws.push({
      from: current,
      through: current,
      start: openedAt,
      end: ticket.end === null ? null : Math.max(ticket.end, openedAt),
      until: Math.max(ticket.until, openedAt),
      outcome: ticket.outcome,
      reason: ticket.reason,
      startSource: openedBy,
      endSource: ticket.endSource,
      pr: pr?.number ?? null,
      sha: head(),
    })
  }

  // A Stage passed in no time is no span, unless it is the one the Ticket stands on.
  const kept = raws.filter((item, index) => item.until > item.start || index === raws.length - 1)
  const seen = new Map<string, number>()
  const stages: Span[] = []
  for (const item of kept) {
    const covered = pipeline.slice(item.from, item.through + 1)
    const ids = covered.map(stageId)
    const attempt = 1 + Math.max(0, ...ids.map((id) => seen.get(id) ?? 0))
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    // The cause of a Stage entered again: the last span that went back.
    const cause = attempt > 1 ? [...stages].reverse().find((earlier) => earlier.outcome === 'rejected' || earlier.outcome === 'stopped') : undefined
    const links: SpanLinks = { run: context.runId, ticket: ticket.name }
    if (item.pr !== null && item.pr !== 0) links.pr = item.pr
    if (item.sha !== null) links.sha = item.sha
    stages.push(
      span({
        id: `${ticket.id}/stage:${stages.length + 1}`,
        kind: 'stage',
        lane: 'tree',
        parent: ticket.id,
        name: covered.map(stageLabel).join(' + '),
        start: item.start,
        end: item.end,
        until: item.until,
        segments: clip(item.start, item.until, ticket.segments),
        outcome: item.outcome,
        reason: item.reason ?? (attempt > 1 ? (cause === undefined ? NO_REASON : `after ${cause.name}: ${cause.reason ?? NO_REASON}`) : null),
        attempt,
        retryOf: cause?.id ?? null,
        links,
        startSource: item.startSource,
        endSource: item.endSource,
        note: ids.length > 1 ? NO_BOUNDARY_NOTE : null,
        stages: ids,
      }),
    )
  }
  return { stages, pr: pr === null || pr.number === 0 ? null : pr.number, sha: head() }
}

// ── the timeline ─────────────────────────────────────────────────────────────

interface TicketRow {
  ticket: Span
  stages: Span[]
}

/** Builds the timeline of a Run from its facts. */
export function buildTimeline(facts: RunFacts): Timeline {
  const { run } = facts
  const runId = run.id
  const live = run.live
  const now = ms(facts.now)
  const runStart = ms(run.startedAt)
  const runEnding: Ending = (() => {
    const stopped = optionalMs(run.stoppedAt)
    if (stopped !== null) {
      const outcome = run.outcome ?? 'stopped'
      return { end: stopped, until: stopped, outcome, reason: run.reason ?? (outcome === 'ok' ? null : NO_REASON) }
    }
    return ending(runStart, null, optionalMs(run.lastSeenAt), live, now, undefined, run.reason)
  })()
  const runSpan = span({
    id: 'run',
    kind: 'run',
    lane: 'tree',
    parent: null,
    name: runId,
    start: runStart,
    ...runEnding,
    links: { run: runId },
    startSource: 'journal',
    endSource: runEnding.end === null ? null : 'journal',
  })
  /** The end of the Run: nothing after it belongs to the Run. */
  const limit = runSpan.until
  const spans: Span[] = [runSpan]

  // Waves.
  const waves = [...facts.waves].sort((a, b) => a.number - b.number)
  const waveSpans = new Map<number, Span>()
  for (const wave of waves) {
    const start = ms(wave.startedAt)
    const end = ending(start, optionalMs(wave.finishedAt), optionalMs(wave.lastSeenAt) ?? runEnding.end, live, now, undefined, undefined)
    const waveSpan = span({
      id: `wave:${wave.number}`,
      kind: 'wave',
      lane: 'tree',
      parent: runSpan.id,
      name: `Wave ${wave.number}`,
      start,
      ...end,
      links: { run: runId, wave: wave.number, ...(wave.session === undefined ? {} : { session: wave.session }) },
      startSource: 'journal',
      endSource: wave.finishedAt === null ? null : 'journal',
    })
    waveSpans.set(wave.number, waveSpan)
    spans.push(waveSpan)
  }

  // Ticket rows: one per Ticket the Journal knows of, a part per Wave.
  const ticketWaves = new Map<string, number[]>()
  for (const wave of waves) for (const ticket of wave.tickets) ticketWaves.set(ticket, [...(ticketWaves.get(ticket) ?? []), wave.number])
  const eventsOf = groupBy(
    facts.ticketEvents.filter((event) => ms(event.at) <= limit),
    (event) => event.ticket,
  )

  // Blocks: a `blocked` status up to the next status of the Ticket, the end of the Run, or now.
  const blocks: BlockMark[] = []
  for (const [ticket, events] of eventsOf) {
    if (!ticketWaves.has(ticket)) continue
    let open: BlockMark | null = null
    for (const event of events.flatMap((item) => (item.event === 'status' ? [item] : [])).sort(byTime((item) => ms(item.at)))) {
      const reason = event.reason ?? NO_REASON
      if (event.state === 'blocked' && open !== null && open.reason === reason) continue
      if (open !== null) Object.assign(open, { until: ms(event.at), cleared: true })
      open = null
      if (event.state !== 'blocked') continue
      open = { ticket, at: ms(event.at), until: limit, reason, waits: event.waits ?? null, cleared: false, source: event.source }
      blocks.push(open)
    }
  }
  blocks.sort((a, b) => a.at - b.at)

  const rows = new Map<string, TicketRow>()
  for (const [ticket, numbers] of ticketWaves) {
    const events = eventsOf.get(ticket) ?? []
    const doneEvent = events.filter((event) => event.event === 'status' && event.state === 'done').sort(byTime((event) => ms(event.at)))[0]
    const doneAt = doneEvent === undefined ? null : ms(doneEvent.at)
    const segments: Segment[] = []
    for (const number of numbers) {
      const wave = waveSpans.get(number)
      if (wave === undefined) continue
      // A Ticket done in an earlier Wave and named again has nothing to do in the later one.
      if (doneAt !== null && wave.start >= doneAt && segments.length > 0) continue
      const end = doneAt !== null && doneAt >= wave.start && doneAt < wave.until ? doneAt : wave.until
      segments.push({ start: wave.start, end, wave: number })
    }
    segments.sort((a, b) => a.start - b.start)
    const first = segments[0]
    const lastSegment = segments.at(-1)
    if (first === undefined || lastSegment === undefined) continue
    const lastWave = waveSpans.get(lastSegment.wave ?? -1)
    let ticketEnding: Ending
    if (doneAt !== null) ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'ok', reason: null }
    // A live Run: a Ticket not done is not finished, between Waves too (decision 07).
    else if (live) ticketEnding = { end: null, until: Math.max(now, lastSegment.end), outcome: null, reason: null }
    else {
      const openBlock = blocks.find((block) => block.ticket === ticket && !block.cleared && block.at <= lastSegment.end)
      if (openBlock !== undefined) ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'blocked', reason: openBlock.reason }
      else if (lastWave?.outcome === 'cut-off') ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'cut-off', reason: NO_END_REASON }
      else ticketEnding = { end: lastSegment.end, until: lastSegment.end, outcome: 'stopped', reason: WAVE_FINISHED_REASON }
    }
    const ticketSpan = span({
      id: `ticket:${ticket}`,
      kind: 'ticket',
      lane: 'tree',
      parent: runSpan.id,
      name: ticket,
      start: first.start,
      ...ticketEnding,
      segments,
      links: { run: runId, ticket, waves: segments.map((segment) => segment.wave ?? 0) },
      startSource: 'journal',
      endSource: ticketEnding.end === null ? null : (doneEvent?.source ?? 'journal'),
    })
    const staged = stagesOf(ticketSpan, events, { runId, pipeline: facts.pipeline })
    if (staged.pr !== null) ticketSpan.links.pr = staged.pr
    if (staged.sha !== null) ticketSpan.links.sha = staged.sha
    rows.set(ticket, { ticket: ticketSpan, stages: staged.stages })
    spans.push(ticketSpan, ...staged.stages)
  }

  /** The parent of work of a Ticket at `at`: the Stage open then, else the Ticket; the Run without a row. */
  const parentAt = (ticket: string | null, at: number): string => {
    const row = ticket === null ? undefined : rows.get(ticket)
    if (row === undefined) return runSpan.id
    const stage = row.stages.find((item) => at >= item.start && at < item.until) ?? row.stages.find((item) => at === item.start)
    return stage?.id ?? row.ticket.id
  }

  // Which Ticket a sha or a worktree belongs to: the Ticket's own events and work.
  const bySha = new Map<string, string>()
  const byWorktree = new Map<string, string>()
  for (const event of facts.ticketEvents) {
    const sha = 'sha' in event ? event.sha : undefined
    if (typeof sha === 'string') bySha.set(sha, event.ticket)
  }
  for (const fact of facts.work) {
    if (typeof fact.ticket !== 'string') continue
    if (fact.sha !== undefined) bySha.set(fact.sha, fact.ticket)
    if (fact.worktree !== undefined) byWorktree.set(fact.worktree, fact.ticket)
  }
  const factsById = new Map(facts.work.map((fact) => [workId(fact), fact]))
  /** The Ticket of a fact: named, else by sha, worktree or parent work; undefined — not this Run's. */
  const ticketOf = (fact: { ticket?: string | null; sha?: string; worktree?: string; parentWork?: WorkRef }, depth = 0): string | null | undefined => {
    if (fact.ticket !== undefined) return fact.ticket
    const found = (fact.sha === undefined ? undefined : bySha.get(fact.sha)) ?? (fact.worktree === undefined ? undefined : byWorktree.get(fact.worktree))
    if (found !== undefined) return found
    const parent = fact.parentWork === undefined ? undefined : factsById.get(workId(fact.parentWork))
    return parent === undefined || depth > 8 ? undefined : ticketOf(parent, depth + 1)
  }

  // Work: the Ticket of each fact; the Journal silent about the Ticket — no step.
  const placed = facts.work
    .map((fact) => ({ fact, ticket: ticketOf(fact) }))
    .filter((item): item is { fact: WorkFact; ticket: string | null } => item.ticket !== undefined && (item.ticket === null || rows.has(item.ticket)) && ms(item.fact.start) <= limit)
    .sort(byTime((item) => ms(item.fact.start)))

  // Retry causes of the Journal: each on the first work of its kind (and Ticket) at or after it.
  const causeOf = new Map<string, RetryCauseFact>()
  for (const cause of [...facts.retryCauses].sort(byTime((item) => ms(item.at)))) {
    const target = placed.find(({ fact, ticket }) => fact.kind === cause.kind && (cause.ticket === null || ticket === cause.ticket) && ms(fact.start) >= ms(cause.at) && !causeOf.has(workId(fact)))
    if (target !== undefined) causeOf.set(workId(target.fact), cause)
  }

  const workSpans = new Map<string, Span>()
  const ticketOfSpan = new Map<string, string | null>()
  for (const { fact, ticket } of placed) {
    const id = workId(fact)
    const start = ms(fact.start)
    const end = ending(start, optionalMs(fact.end), optionalMs(fact.lastSeenAt), live, now, fact.outcome, fact.reason)
    const links: SpanLinks = { run: runId }
    if (ticket !== null) links.ticket = ticket
    if (fact.session !== undefined) links.session = fact.session
    if (fact.agent !== undefined) links.agent = fact.agent
    if (fact.pr !== undefined) links.pr = fact.pr
    if (fact.sha !== undefined) links.sha = fact.sha
    if (fact.verdict !== undefined) links.verdict = fact.verdict
    const parentWork = fact.parentWork === undefined ? undefined : workSpans.get(workId(fact.parentWork))
    const subkind = fact.kind === 'agent' ? agentSubkind(fact.name, fact.agentType) : null

    // The attempt: one more than the attempt before it — the work the source names, else the last
    // one of the same Ticket, kind and name, else (for a retry the Journal names) of the same kind.
    const earlier = [...workSpans.values()].filter((other) => other.kind === fact.kind && ticketOfSpan.get(other.id) === ticket && other.start <= start)
    const given = fact.retryOf === undefined ? undefined : workSpans.get(workId(fact.retryOf))
    const sameName = earlier.filter((other) => other.name === fact.name).at(-1)
    const journalCause = causeOf.get(id)
    const sameKind = journalCause === undefined ? undefined : earlier.filter((other) => other.subkind === subkind).at(-1)
    const previous = given ?? sameName ?? sameKind
    const attempt = previous === undefined ? 1 : previous.attempt + 1

    let retryOf: string | null = null
    let reason = end.reason
    if (previous !== undefined) {
      // The cause: the source's, else the last work of the Ticket that failed or was rejected
      // after the previous attempt began and before this one (a REJECTED verifier, a failed CI run).
      const failedBefore = [...workSpans.values()]
        .filter((other) => ticketOfSpan.get(other.id) === ticket && (other.outcome === 'failed' || other.outcome === 'rejected') && other.until <= start && other.start >= previous.start)
        .sort((a, b) => b.until - a.until)[0]
      const cause = given ?? failedBefore ?? previous
      retryOf = cause.id
      if (fact.reason === undefined && (end.outcome === 'ok' || end.outcome === null)) {
        reason = journalCause?.reason ?? `after ${cause.name}${cause.outcome === 'ok' || cause.outcome === null ? '' : ` ${cause.outcome}`}`
      }
    }

    const work = span({
      id,
      kind: fact.kind,
      subkind,
      lane: 'tree',
      parent: parentWork?.id ?? parentAt(ticket, start),
      name: fact.name,
      start,
      ...end,
      reason,
      attempt,
      retryOf,
      links,
      note: fact.note ?? null,
      startSource: fact.startSource,
      endSource: end.end === null ? null : (fact.endSource ?? (fact.end === null ? null : fact.startSource)),
    })
    workSpans.set(id, work)
    ticketOfSpan.set(id, ticket)
    spans.push(work)
  }

  // The lane of Waits.
  for (const wait of [...facts.waits].sort(byTime((fact) => ms(fact.start)))) {
    const start = ms(wait.start)
    if (start > limit) continue
    const end = ending(start, optionalMs(wait.end), optionalMs(wait.lastSeenAt), live, now, undefined, undefined)
    // The Tickets of the Waves open at its start, else of the Wave that waited for it.
    const openWaves = waves.filter((wave) => {
      const waveSpan = waveSpans.get(wave.number)
      return waveSpan !== undefined && waveSpan.start <= start && start <= waveSpan.until
    })
    const nextWave = waves.find((wave) => (waveSpans.get(wave.number)?.start ?? -1) >= start)
    const tickets = wait.tickets ?? (openWaves.length > 0 ? openWaves : nextWave === undefined ? [] : [nextWave]).flatMap((wave) => wave.tickets)
    spans.push(
      span({
        id: `wait:${wait.id}`,
        kind: 'wait',
        lane: 'wait',
        parent: runSpan.id,
        name: wait.cause,
        start,
        ...end,
        // A Wait always has its cause for a reason; a cut-off one keeps the cause too.
        reason: wait.detail === undefined ? wait.cause : `${wait.cause}: ${wait.detail}`,
        waitCause: wait.cause,
        links: { run: runId, tickets: [...new Set(tickets)] },
        startSource: wait.startSource,
        endSource: end.end === null ? null : (wait.endSource ?? (wait.end === null ? null : wait.startSource)),
      }),
    )
  }

  // The lane of the Orchestrator.
  for (const turn of [...facts.turns].sort(byTime((fact) => ms(fact.start)))) {
    const start = ms(turn.start)
    if (start > limit) continue
    const end = ending(start, optionalMs(turn.end), optionalMs(turn.lastSeenAt), live, now, undefined, undefined)
    spans.push(
      span({
        id: `turn:${turn.id}`,
        kind: 'orchestrator-turn',
        lane: 'orchestrator',
        parent: runSpan.id,
        name: 'Orchestrator',
        start,
        ...end,
        links: { run: runId, tickets: [...turn.tickets], ...(turn.session === undefined ? {} : { session: turn.session }) },
        startSource: turn.startSource,
        endSource: end.end === null ? null : (turn.endSource ?? (turn.end === null ? null : turn.startSource)),
      }),
    )
  }

  // Spans whose details are gone: only where the Journal knows of the step.
  let lostCount = 0
  const addLost = (fact: LostFact, owner: Span, ticket: string | null) => {
    const start = optionalMs(fact.start) ?? owner.start
    const until = optionalMs(fact.end) ?? owner.until
    const timed = fact.start !== undefined || fact.end !== undefined
    lostCount += 1
    spans.push(
      span({
        id: `lost:${lostCount}`,
        kind: fact.kind,
        subkind: fact.kind === 'agent' ? agentSubkind(fact.name) : null,
        lane: fact.kind === 'orchestrator-turn' ? 'orchestrator' : 'tree',
        parent: fact.kind === 'orchestrator-turn' ? runSpan.id : timed ? parentAt(ticket, start) : owner.id,
        name: fact.name,
        start,
        // It ends with what it covers: in a stopped Run it never reads as running.
        end: fact.end !== undefined ? until : (owner.end ?? (live ? null : until)),
        until,
        ...(timed ? {} : { segments: owner.segments }),
        links: ticket === null ? { run: runId } : { run: runId, ticket },
        lost: fact.source,
      }),
    )
  }
  for (const fact of facts.lost) {
    if (fact.kind === 'orchestrator-turn') {
      addLost(fact, runSpan, null)
      continue
    }
    const ticket = ticketOf(fact)
    if (ticket === undefined) continue
    if (ticket !== null) {
      const row = rows.get(ticket)
      if (row !== undefined) addLost(fact, row.ticket, ticket)
      continue
    }
    // No Ticket: the source is gone for the whole Run — every Ticket with no span of that kind.
    for (const [name, row] of rows) {
      if (spans.some((item) => item.kind === fact.kind && item.links.ticket === name)) continue
      addLost(fact, row.ticket, name)
    }
  }

  const orchestratorMarks = facts.orchestratorMarks
    .map((mark) => ({ kind: mark.kind, at: ms(mark.at), text: mark.text }))
    .filter((mark) => mark.at <= limit)
    .sort((a, b) => a.at - b.at)

  return { runId, live, now, spans, blocks, orchestratorMarks }
}

/** The children of a span: the spans that name it their parent. */
export const childrenOf = (timeline: Timeline, parent: Span): Span[] => timeline.spans.filter((item) => item.parent === parent.id)

/** How long a span lasted: the sum of its parts. */
export const duration = (item: Span): number => item.segments.reduce((total, segment) => total + (segment.end - segment.start), 0)
