// The Pipeline of a Project and the Stage of each of its Tickets (ADR-0067; CONTEXT.md, terms
// Pipeline and Stage). A Pipeline is a list of Stages taken from a fixed catalogue of kinds; the
// Profile turns kinds on, orders and renames them (`workflow.pipeline`), and every kind has its
// predicate here, in code. The Stage is computed, never stored (ADR-0002, ADR-0005): `stageOf` takes
// the facts main collected (src/main/workflow/stages.ts) and does no input or output of its own.
//
// The rule: the Stages go in Pipeline order, and the Ticket stands on the first one not passed.
// Irreversible facts pass every Stage before them: a merged PR passes all the Stages before the
// merge, Status `done` passes all but Done. A mark of an agent counts only on the head SHA.
// Comments of PRs are not read here: a verdict is a mark (`review`, `check/<name>`), not a text.
import { z } from 'zod'
import type { TicketState } from './types'

/** The catalogue of Stage kinds, in the order ADR-0067 lists them. */
export const STAGE_KINDS = ['queued', 'implementing', 'ci', 'agent-review', 'human-review', 'check', 'gate-merge', 'awaiting-merge', 'deploy', 'closing', 'done'] as const
export const stageKindSchema = z.enum(STAGE_KINDS)
export type StageKind = z.infer<typeof stageKindSchema>

/** The kinds whose predicate holds once the PR is merged: everything up to and including the merge. */
const BEFORE_MERGE: ReadonlySet<StageKind> = new Set(['queued', 'implementing', 'ci', 'agent-review', 'human-review', 'check', 'gate-merge', 'awaiting-merge'])

/** The kinds whose work belongs to people other than the agents (`Waits:` absent): the team. */
const TEAM_KINDS: ReadonlySet<StageKind> = new Set(['human-review', 'awaiting-merge'])

const CHECK_NAME = /^[a-z0-9][a-z0-9-]*$/u

/** A string with something besides white space in it, as the Harness checks `label` and `environment`. */
const nonBlank = (message: string) => z.string().refine((text) => text.trim() !== '', { message })

/**
 * One Stage of `workflow.pipeline`, as `bin/profile` resolves it into `_resolved.pipeline`. Each field
 * follows the rule of the Harness (harness/lib/pipeline.cjs), so the Pipeline editor in Settings
 * refuses what `bin/profile-set` would refuse.
 */
export const pipelineStageSchema = z.object({
  kind: stageKindSchema,
  /** `check` only, required there: the mark `check/<name>` the Stage waits for. */
  name: z.string().regex(CHECK_NAME, 'lower case letters, digits and dashes').optional(),
  /** The Stage's name on the board, instead of the catalogue's. */
  label: nonBlank('a label is not empty').optional(),
  /** `<number>h` or `<number>m`, the number from 1: how long a Ticket may stay before it counts as stuck (stuckAfterMs). */
  stuck_after: z.string().regex(/^[1-9]\d*[hm]$/u, 'a number from 1 and h or m, e.g. 2h or 30m').optional(),
  /** `deploy` only: the GitHub Deployment environment; without it the Stage waits for the commit status `deploy`. */
  environment: nonBlank('an environment is not empty').optional(),
})
export type PipelineStage = z.infer<typeof pipelineStageSchema>

/** The id of a Stage within its Pipeline: the kind, or `check/<name>` for a Check. */
export const stageId = (stage: PipelineStage): string => (stage.kind === 'check' ? `check/${stage.name ?? ''}` : stage.kind)

/**
 * A Pipeline: the rules `bin/profile` checks (harness/profiles/README.md, `workflow.pipeline`) —
 * `queued` first, `done` last, each kind once (`check` once per name, and only with a name),
 * `gate-merge` and `awaiting-merge` not together.
 */
export const pipelineSchema = z
  .array(pipelineStageSchema)
  .min(2)
  .superRefine((stages, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message })
    if (stages[0]?.kind !== 'queued') issue('queued must be the first Stage')
    if (stages.at(-1)?.kind !== 'done') issue('done must be the last Stage')
    const seen = new Set<string>()
    for (const stage of stages) {
      if (stage.kind === 'check' && stage.name === undefined) issue('a check Stage needs a name')
      if (stage.kind !== 'check' && stage.name !== undefined) issue(`${stage.kind} takes no name`)
      if (stage.kind !== 'deploy' && stage.environment !== undefined) issue(`${stage.kind} takes no environment`)
      const id = stageId(stage)
      if (seen.has(id)) issue(`${id} is in the Pipeline twice`)
      seen.add(id)
    }
    if (seen.has('gate-merge') && seen.has('awaiting-merge')) issue('gate-merge and awaiting-merge cannot be in one Pipeline')
  })

/** The Pipeline of a Project whose Profile has no `workflow.pipeline` (ADR-0067). */
export const DEFAULT_PIPELINE: readonly PipelineStage[] = Object.freeze(
  (['queued', 'implementing', 'ci', 'agent-review', 'gate-merge', 'closing', 'done'] as const).map((kind) => Object.freeze({ kind })),
)

const KIND_LABELS: Record<StageKind, string> = {
  queued: 'Queued',
  implementing: 'Implementing',
  ci: 'CI',
  'agent-review': 'Agent review',
  'human-review': 'Human review',
  check: 'Check',
  'gate-merge': 'Gate & merge',
  'awaiting-merge': 'Awaiting merge',
  deploy: 'Deploy',
  closing: 'Closing',
  done: 'Done',
}

/** The name of a Stage on the board: the Profile's `label`, else the catalogue's (`Check «<name>»` for a Check). */
export function stageLabel(stage: PipelineStage): string {
  if (stage.label !== undefined) return stage.label
  return stage.kind === 'check' ? `Check «${stage.name ?? ''}»` : KIND_LABELS[stage.kind]
}

// ── the facts ────────────────────────────────────────────────────────────────

export const markVerdictSchema = z.enum(['pending', 'success', 'failure', 'skipped'])
export type MarkVerdict = z.infer<typeof markVerdictSchema>

/** An agent's mark (`bin/ticket mark`): `review` or `check/<name>`, bound to a commit. */
export interface MarkFact {
  kind: string
  verdict: MarkVerdict
  sha: string
  /** When it was set: `at` of the Silent mode file, `startedAt` (the status's createdAt) on GitHub. */
  at: string | null
}

/** One CI check of a PR, the agents' marks left out. */
export interface CheckFact {
  name: string
  state: 'pending' | 'success' | 'failure'
  startedAt: string | null
  completedAt: string | null
}

export interface PullFacts {
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  /** `headRefOid`; null when gh did not say. */
  headSha: string | null
  checks: readonly CheckFact[]
  /** `reviewDecision` as GitHub gives it: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED; null without one. */
  reviewDecision: string | null
  mergedAt: string | null
  mergeCommit: string | null
}

/** A deployed commit: a GitHub Deployment of `environment`, or the commit status `deploy` (environment null). */
export interface DeployFact {
  sha: string
  at: string | null
  environment: string | null
  /** Whether the Ticket's merge commit is this commit or its ancestor (`git merge-base --is-ancestor`). */
  containsMerge: boolean
}

export interface StageFacts {
  mode: 'full' | 'silent'
  status: TicketState
  statusAt: string | null
  blockedReason: string | null
  waits: string | null
  /** The head of the Ticket's branch: the PR's head while it is open, else the branch's own; null without a branch. */
  headSha: string | null
  /** The Ticket's PR: an open one first, then a merged one, then a closed one; null without any. */
  pr: PullFacts | null
  /** The agents' marks, oldest first, on any SHA: only those on the head SHA count. */
  marks: readonly MarkFact[]
  /** Collected only for a Ticket on Deploy; empty otherwise. */
  deploys: readonly DeployFact[]
  /** The e2e lock (`workflow.e2e_lock`): null when it is free; `prs` null when holder.json is empty or unreadable. */
  lock: { prs: readonly number[] | null } | null
}

// ── the Stage ────────────────────────────────────────────────────────────────

/** A caption of the Stage: why it waits within it. */
export const stageSubSchema = z.enum(['failing', 'gate running', 'waiting for gate', 'gate busy'])
export type StageSub = z.infer<typeof stageSubSchema>

export const ticketStageSchema = z.object({
  /** The id of the Stage the Ticket stands on (stageId). */
  stage: z.string(),
  /** Its index in the Pipeline. */
  index: z.number().int().nonnegative(),
  kind: stageKindSchema,
  /** The ids of the Stages passed, in Pipeline order. */
  passed: z.array(z.string()),
  /** Of those, the Checks passed by a `skipped` mark: the stepper shows them skipped (ticket 05). */
  skipped: z.array(z.string()),
  /** Status `blocked`: a flag with its reason, on whatever Stage. */
  blocked: z.object({ reason: z.string().nullable() }).nullable(),
  /** Implementing again after a `failure` mark on the head SHA. */
  rework: z.boolean(),
  sub: stageSubSchema.nullable(),
  /** Who the Ticket waits for: its `Waits:` line, else by the kind of the Stage (`team` or `agent`); null on Done. */
  waits: z.string().nullable(),
  /** When the Ticket entered the Stage, ISO; from structured times only, null when none is known. */
  enteredAt: z.string().nullable(),
  /**
   * The time of its `Status:` line as the file has it: with Waits, the key of one wait (ticket 06).
   * Optional, and absent reads as null: a Linked machine's older worfy does not send it.
   */
  statusAt: z.string().nullable().optional(),
})
export type TicketStage = z.infer<typeof ticketStageSchema>

/** A time as a number; a date alone is 00:00 UTC; null when it does not read. */
function timeOf(text: string | null | undefined): number | null {
  if (text == null || text === '') return null
  const value = Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T00:00Z` : text)
  return Number.isNaN(value) ? null : value
}

const earliest = (times: readonly (number | null)[]): number | null => times.reduce<number | null>((min, t) => (t === null ? min : min === null || t < min ? t : min), null)
const latest = (times: readonly (number | null)[]): number | null => times.reduce<number | null>((max, t) => (t === null ? max : max === null || t > max ? t : max), null)

/** The last mark of each kind on `sha`, by the order they were set. */
function marksOn(marks: readonly MarkFact[], sha: string | null): Map<string, MarkFact> {
  const last = new Map<string, MarkFact>()
  if (sha === null) return last
  for (const mark of marks) if (mark.sha === sha) last.set(mark.kind, mark)
  return last
}

/** The Stage of one Ticket in `pipeline` from its facts. */
export function stageOf(facts: StageFacts, pipeline: readonly PipelineStage[]): TicketStage {
  const pull = facts.pr !== null && facts.pr.state !== 'CLOSED' ? facts.pr : null
  const open = pull?.state === 'OPEN' ? pull : null
  const merged = pull?.state === 'MERGED'
  const done = facts.status === 'done'
  const head = open?.headSha ?? facts.headSha
  const onHead = marksOn(facts.marks, head)
  const failure = [...onHead.values()].find((mark) => mark.verdict === 'failure') ?? null
  const checks = open?.checks ?? []

  /** Whether `stage` is passed, and the time of the fact that passed it. */
  const judge = (stage: PipelineStage): { passed: boolean; at: number | null; skipped?: boolean } => {
    if (done && stage.kind !== 'done') return { passed: true, at: stage.kind === 'closing' ? timeOf(facts.statusAt) : null }
    if (merged && BEFORE_MERGE.has(stage.kind)) {
      return { passed: true, at: stage.kind === 'gate-merge' || stage.kind === 'awaiting-merge' ? timeOf(pull.mergedAt) : null }
    }
    switch (stage.kind) {
      case 'queued':
        return { passed: facts.status !== 'open' && facts.status !== 'none', at: timeOf(facts.statusAt) }
      case 'implementing':
        return {
          passed: (open !== null || onHead.size > 0) && failure === null,
          at: earliest([...[...onHead.values()].map((mark) => timeOf(mark.at)), ...checks.map((check) => timeOf(check.startedAt))]),
        }
      case 'ci':
        return { passed: open !== null && checks.every((check) => check.state === 'success'), at: latest(checks.map((check) => timeOf(check.completedAt))) }
      case 'agent-review': {
        const review = onHead.get('review')
        return { passed: review?.verdict === 'success', at: timeOf(review?.at) }
      }
      case 'check': {
        const check = onHead.get(stageId(stage))
        const passed = check?.verdict === 'success' || check?.verdict === 'skipped'
        return { passed, at: timeOf(check?.at), skipped: check?.verdict === 'skipped' }
      }
      case 'human-review':
        return { passed: open?.reviewDecision === 'APPROVED', at: null }
      case 'gate-merge':
      case 'awaiting-merge':
        return { passed: false, at: null }
      case 'deploy': {
        // Silent mode writes no commit status `deploy` (ADR-0067): only a Deployment of the environment counts there.
        const environment = stage.environment ?? null
        const found = merged ? facts.deploys.filter((deploy) => deploy.containsMerge && deploy.environment === environment && (environment !== null || facts.mode === 'full')) : []
        return { passed: found.length > 0, at: earliest(found.map((deploy) => timeOf(deploy.at))) }
      }
      case 'closing':
        return { passed: false, at: null }
      case 'done':
        return { passed: false, at: null }
    }
  }

  const passed: string[] = []
  const skipped: string[] = []
  const times: (number | null)[] = [timeOf(facts.statusAt)]
  let index = pipeline.length - 1
  for (const [at, stage] of pipeline.entries()) {
    const verdict = judge(stage)
    if (!verdict.passed) {
      index = at
      break
    }
    passed.push(stageId(stage))
    if (verdict.skipped) skipped.push(stageId(stage))
    times.push(verdict.at)
  }
  const current = pipeline[index] ?? { kind: 'done' as const }
  const rework = current.kind === 'implementing' && failure !== null
  if (rework) times.push(timeOf(failure.at))
  if (passed.length === pipeline.length) passed.pop()

  let sub: StageSub | null = null
  if (current.kind === 'ci' && checks.some((check) => check.state === 'failure')) sub = 'failing'
  if (current.kind === 'gate-merge' && facts.lock !== null) {
    const holders = facts.lock.prs
    if (holders === null || holders.length === 0) sub = 'gate busy'
    else sub = open !== null && holders.includes(open.number) ? 'gate running' : 'waiting for gate'
  }

  const entered = latest(times)
  return {
    stage: stageId(current),
    index,
    kind: current.kind,
    passed,
    skipped,
    blocked: facts.status === 'blocked' ? { reason: facts.blockedReason } : null,
    rework,
    sub,
    waits: current.kind === 'done' ? null : (facts.waits ?? (TEAM_KINDS.has(current.kind) ? 'team' : 'agent')),
    enteredAt: entered === null ? null : new Date(entered).toISOString(),
    statusAt: facts.statusAt,
  }
}

// ── stuck ────────────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** The Stages of the agents: stuck after 2 h unless the Profile says otherwise (spec, owner's decision 7). */
const AGENT_KINDS: ReadonlySet<StageKind> = new Set(['implementing', 'agent-review', 'ci', 'gate-merge'])
export const AGENT_STUCK_MS = 2 * HOUR_MS
/** The Stages of people, and any Stage that waits for the owner or the team: 24 h. */
export const PEOPLE_STUCK_MS = 24 * HOUR_MS

/**
 * How long a Ticket may stand on `stage` while it waits for `waits` before it counts as stuck, in
 * ms: the Profile's `stuck_after`, else 24 h for Human review, Awaiting merge and any Stage that
 * waits for the owner or the team, else 2 h for the Stages of the agents. Null: the Stage has no
 * threshold (Queued, a Check, Deploy, Closing without `stuck_after`; Done always).
 */
export function stuckAfterMs(stage: PipelineStage, waits: string | null): number | null {
  if (stage.kind === 'done') return null
  const own = stage.stuck_after === undefined ? null : /^(\d+)([hm])$/u.exec(stage.stuck_after)
  if (own) return Number(own[1]) * (own[2] === 'h' ? HOUR_MS : MINUTE_MS)
  if (TEAM_KINDS.has(stage.kind) || waits === 'owner' || waits === 'team') return PEOPLE_STUCK_MS
  return AGENT_KINDS.has(stage.kind) ? AGENT_STUCK_MS : null
}

export interface Stuck {
  /** Whether the Ticket has stood on its Stage for its threshold or longer. */
  stuck: boolean
  /** How long it has stood there: now − enteredAt. */
  forMs: number
  /** The threshold (stuckAfterMs); null when the Stage has none. */
  afterMs: number | null
}

/** How long a Ticket has stood on `stage` at `now` and whether that makes it stuck; null without a known `enteredAt`. */
export function stuckOf(stage: PipelineStage, ticket: Pick<TicketStage, 'waits' | 'enteredAt'>, now: number): Stuck | null {
  const entered = timeOf(ticket.enteredAt)
  if (entered === null) return null
  const forMs = Math.max(0, now - entered)
  const afterMs = stuckAfterMs(stage, ticket.waits)
  return { stuck: afterMs !== null && forMs >= afterMs, forMs, afterMs }
}

/** The time on a Stage in words, as the tooltips say it: «on CI for 3 h». */
export function onStageFor(title: string, ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS)
  const hours = Math.floor(ms / HOUR_MS)
  const time = hours < 1 ? `${minutes} min` : hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`
  return `on ${title} for ${time}`
}
