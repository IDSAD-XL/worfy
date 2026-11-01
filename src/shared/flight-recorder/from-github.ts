// Facts from GitHub for the span model (worfy-flight-recorder ticket 15; the reader's part of the
// contract in facts.ts): gh's answers about the PRs of a Run's Tickets turned into Ticket events, CI
// work, the Wait `other-machine` and, when gh gave nothing, the label «GitHub did not answer». Pure:
// no Node, no DOM; src/main/flight-recorder/github.ts runs gh and hands the answers over.
//
// - A PR belongs to a Ticket by its branch (`tickets.branch` of the Profile); nothing is stamped into
//   commits or PRs. A PR merged or closed before the Run's window, or opened after it, is not the Run's;
//   every event of a PR that is kept is handed over, also those before the Run: the model clamps them to
//   the Ticket's row (an event before the Ticket's first status counts as an implied claim).
// - Only the Project's GitHub account speaks for the Gate (the repository may be public): a verdict
//   comment or a report of the cross-machine gate by anyone else counts not, and with no account none does.
// - Events: the PR opened on the head it had then, each later commit a push, the CI of the branch
//   started and finished on its head, the agents' marks on the head (its commit statuses `review`,
//   `check/<name>`, `deploy`; ADR-0067), the approval, the merge. gh gives the statuses of the head only,
//   so the Gate's verdict comments written before the head commit are `review` marks too (a REJECTED of
//   an earlier head); after it, a `review` status on the head stands for them.
// - CI work: one span per workflow run of the branch, else per check run of the head when the branch
//   has no runs; a run on the same head as an earlier run of the same name is its retry, linked to it.
//   A manual run (workflow_dispatch) of the branch is not the PR's CI, as for ciMark of pr-facts.mjs.
//   The runs of a merged PR's merge commit (CI in batch on main, started by hand too) are the Ticket's
//   CI under the name `<workflow> on <base>`, and change no Stage. A re-run GitHub keeps as one run with
//   `attempt` N has no earlier attempt to link: noted.
// - Every time is GitHub's, as gh printed it; a fact without a time is left out.
import type { LostFact, StageEventFact, WaitFact, WorkFact } from './facts'
import { time } from './journal-walk.mjs'
import { isCheckRun, labelNames, verdictComments, type GhCheck, type GhComment, type GhCommit, type GhPr, type GhRun } from './pr-facts.mjs'

type Iso = string

/** A workflow run of `gh run list --json` with the fields the reader asks for (RUN_FIELDS of github.ts). */
export interface GithubRun extends GhRun {
  databaseId?: number
  attempt?: number
  name?: string
  headSha?: string
  startedAt?: string | null
}

/** A PR of `gh pr list --json` with the fields the reader asks for (PR_FIELDS of github.ts) and the runs it found. */
export interface GithubPr extends GhPr {
  headRefOid?: string | null
  baseRefName?: string
  reviewDecision?: string | null
  reviews?: { state?: string; submittedAt?: string | null }[]
  closedAt?: string | null
  commits?: (GhCommit & { oid?: string })[]
  comments?: (GhComment & { author?: { login?: string } | null })[]
  /** The workflow runs of its branch. */
  ciRuns?: GithubRun[]
  /** The workflow runs of its merge commit: CI in batch on the main branch. */
  mergeRuns?: GithubRun[]
}

/** What gh answered for a Run. */
export interface GithubAnswer {
  prs: readonly GithubPr[]
}

/** The Profile's `cross_machine_gate`: the label of a PR that waits for the other machine and the heading of its report. */
export interface CrossMachineGate {
  label: string
  checksSection: string
}

export interface GithubFactsInput {
  /** The Tickets of the Run and their branches. */
  tickets: readonly { ticket: string; branch: string }[]
  /** The Run's window: its start, and its end (null while it is live). */
  window: { start: Iso; end: Iso | null }
  /** The Project's GitHub account (`github.account`): only its comments are verdicts and reports; null — none are. */
  account: string | null
  crossMachineGate?: CrossMachineGate | null
}

/** The part of RunFacts GitHub fills. */
export interface GithubFacts {
  ticketEvents: StageEventFact[]
  work: WorkFact[]
  waits: WaitFact[]
  lost: LostFact[]
}

/** CI of every Ticket of the Run that has none: GitHub did not answer (decision 08). */
export const GITHUB_NO_ANSWER: LostFact = { ticket: null, kind: 'ci', name: 'CI', source: 'github-no-answer' }

/** The facts when gh gave nothing (no network, no gh login): only the label, the local sources draw the rest. */
export function githubNoAnswer(): GithubFacts {
  return { ticketEvents: [], work: [], waits: [], lost: [{ ...GITHUB_NO_ANSWER }] }
}

const timed = (text: string | null | undefined): text is Iso => typeof text === 'string' && time(text) !== null
const at = (text: Iso): number => time(text) ?? 0

/** The PRs of these Tickets in the Run's window, each with its Ticket. */
function prsOfRun(answer: GithubAnswer, input: GithubFactsInput): { ticket: string; pr: GithubPr }[] {
  const ticketOf = new Map(input.tickets.map(({ ticket, branch }) => [branch, ticket]))
  const start = time(input.window.start)
  const end = input.window.end === null ? null : time(input.window.end)
  const found: { ticket: string; pr: GithubPr }[] = []
  const seen = new Set<number>()
  for (const pr of answer.prs) {
    const ticket = typeof pr.headRefName === 'string' ? ticketOf.get(pr.headRefName) : undefined
    if (ticket === undefined || !Number.isInteger(pr.number) || seen.has(pr.number)) continue
    const ended = time(pr.mergedAt) ?? time(pr.closedAt)
    const opened = time(pr.createdAt)
    if (start !== null && ended !== null && ended < start) continue
    if (end !== null && opened !== null && opened > end) continue
    seen.add(pr.number)
    found.push({ ticket, pr })
  }
  return found
}

/** The head of the PR: headRefOid, else its last commit. */
const headOf = (pr: GithubPr): string | null => pr.headRefOid ?? pr.commits?.at(-1)?.oid ?? null

const GREEN_RUN = new Set(['success', 'skipped', 'neutral'])
const GREEN_CHECK = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

/** The PR opened on the head it had then; each commit committed after the opening is a push. */
function headEvents(ticket: string, pr: GithubPr): StageEventFact[] {
  const events: StageEventFact[] = []
  const commits = (pr.commits ?? []).filter((commit) => typeof commit?.oid === 'string' && timed(commit.committedDate))
  if (timed(pr.createdAt)) {
    const opened = at(pr.createdAt)
    const before = commits.filter((commit) => at(commit.committedDate ?? '') <= opened).at(-1)
    events.push({ ticket, at: pr.createdAt, source: 'github', event: 'pr-opened', pr: pr.number, sha: before?.oid ?? null })
    for (const commit of commits) {
      if (at(commit.committedDate ?? '') > opened) events.push({ ticket, at: commit.committedDate ?? '', source: 'github', event: 'push', sha: commit.oid ?? '' })
    }
  }
  return events
}

const MARK_STATES: Record<string, 'success' | 'failure' | 'pending'> = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' }
/** The commit statuses that are agents' marks (MARK_CONTEXTS of src/main/github/prs.ts). */
const isMark = (context: string): boolean => context === 'review' || context === 'deploy' || (context.startsWith('check/') && context.length > 'check/'.length)

/** When the head commit was committed: from it on, a `review` status on the head stands for the verdict comments. */
function headTime(pr: GithubPr): number | null {
  const head = headOf(pr)
  const commit = (pr.commits ?? []).find((item) => item?.oid === head) ?? pr.commits?.at(-1)
  return time(commit?.committedDate)
}

/**
 * The agents' marks on the head, and the Gate's verdict comments (by the Project's account) as `review` marks:
 * all of them without a `review` status on the head, else those written before the head commit.
 */
function markEvents(ticket: string, pr: GithubPr, account: string | null): StageEventFact[] {
  const head = headOf(pr)
  const events: StageEventFact[] = []
  let review = false
  for (const check of (pr.statusCheckRollup ?? []) as (GhCheck & { createdAt?: string | null })[]) {
    if (!check || typeof check !== 'object' || isCheckRun(check)) continue
    const context = check.context ?? check.name ?? ''
    if (!isMark(context)) continue
    if (context === 'review') review = true
    const verdict = MARK_STATES[check.state ?? '']
    const when = timed(check.startedAt) ? check.startedAt : check.createdAt
    if (verdict === undefined || !timed(when)) continue
    events.push({ ticket, at: when, source: 'github', event: 'mark', mark: context, verdict, sha: head })
  }
  const covered = review ? headTime(pr) : null
  for (const comment of pr.comments ?? []) {
    const verdict = verdictComments({ number: pr.number, comments: [comment] }, account)[0]?.verdict
    if (verdict === undefined || verdict === null || !timed(comment.createdAt)) continue
    if (covered !== null && at(comment.createdAt) >= covered) continue
    events.push({ ticket, at: comment.createdAt, source: 'github', event: 'mark', mark: 'review', verdict: verdict === 'VERIFIED' ? 'success' : 'failure', sha: null, reason: `${verdict} comment` })
  }
  return events
}

/** The approval (reviewDecision APPROVED) at the last approving review, and the merge. */
function endEvents(ticket: string, pr: GithubPr): StageEventFact[] {
  const events: StageEventFact[] = []
  if (pr.reviewDecision === 'APPROVED') {
    const approvals = (pr.reviews ?? []).filter((review) => review?.state === 'APPROVED' && timed(review.submittedAt)).map((review) => review.submittedAt ?? '')
    const last = approvals.sort((a, b) => at(a) - at(b)).at(-1)
    if (last !== undefined) events.push({ ticket, at: last, source: 'github', event: 'approved' })
  }
  if (timed(pr.mergedAt)) {
    const sha = pr.mergeCommit?.oid
    events.push({ ticket, at: pr.mergedAt, source: 'github', event: 'merge', pr: pr.number, ...(typeof sha === 'string' ? { sha } : {}) })
  }
  return events
}

/** How a workflow run ended: its outcome and reason; null while it runs. */
function runEnding(run: GithubRun): { outcome: WorkFact['outcome']; reason?: string } | null {
  if (run.status !== 'completed') return null
  const conclusion = run.conclusion ?? ''
  if (GREEN_RUN.has(conclusion)) return { outcome: 'ok' }
  return { outcome: conclusion === 'cancelled' ? 'stopped' : 'failed', reason: conclusion || 'no conclusion' }
}

/** The CI of a PR: its branch's runs (each a retry of the last earlier run of its name on its head), else the head's check runs. */
function ciFacts(ticket: string, pr: GithubPr): { events: StageEventFact[]; work: WorkFact[] } {
  const events: StageEventFact[] = []
  const work: WorkFact[] = []
  const runs = (pr.ciRuns ?? []).filter((run) => run && typeof run === 'object' && run.event !== 'workflow_dispatch' && timed(run.startedAt ?? run.createdAt))
  if (runs.length > 0) {
    for (const item of runFacts(ticket, pr, runs)) {
      work.push(item.work)
      const name = item.work.name
      const sha = item.work.sha ?? null
      events.push({ ticket, at: item.work.start, source: 'github', event: 'ci-started', name, sha })
      if (item.work.end !== null) events.push({ ticket, at: item.work.end, source: 'github', event: 'ci-finished', name, sha, conclusion: item.work.outcome === 'ok' ? 'success' : 'failure' })
    }
    return { events, work }
  }
  const head = headOf(pr)
  for (const check of (pr.statusCheckRollup ?? []).filter(isCheckRun)) {
    const name = check.name ?? 'check'
    if (!timed(check.startedAt)) continue
    const done = check.status === 'COMPLETED' && timed(check.completedAt)
    const green = GREEN_CHECK.has(check.conclusion ?? '')
    work.push({
      id: `gh-check:${pr.number}:${name}`,
      kind: 'ci',
      ticket,
      name,
      start: check.startedAt,
      end: done ? (check.completedAt ?? null) : null,
      ...(done ? { outcome: green ? 'ok' : check.conclusion === 'CANCELLED' ? 'stopped' : 'failed' } : {}),
      ...(done && !green ? { reason: (check.conclusion ?? 'no conclusion').toLowerCase() } : {}),
      pr: pr.number,
      ...(head === null ? {} : { sha: head }),
      startSource: 'github',
      ...(done ? { endSource: 'github' as const } : {}),
    })
    events.push({ ticket, at: check.startedAt, source: 'github', event: 'ci-started', name, sha: head })
    if (done) events.push({ ticket, at: check.completedAt ?? '', source: 'github', event: 'ci-finished', name, sha: head, conclusion: green ? 'success' : 'failure' })
  }
  return { events, work }
}

/** Work facts of workflow runs in start order; a run on the head of an earlier run of its name is that run's retry. */
function runFacts(ticket: string, pr: GithubPr, runs: readonly GithubRun[], merge?: { base: string }): { work: WorkFact }[] {
  const note = merge === undefined ? undefined : `CI on ${merge.base} after the merge`
  const sorted = [...runs].sort((a, b) => at(a.startedAt ?? a.createdAt ?? '') - at(b.startedAt ?? b.createdAt ?? ''))
  const last = new Map<string, string>()
  return sorted.map((run, index) => {
    // CI after the merge has a name of its own: the model would number it as a retry of the PR's CI.
    const name = `${run.name || 'CI'}${merge === undefined ? '' : ` on ${merge.base}`}`
    const id = `gh-run:${run.databaseId ?? `${pr.number}:${index + 1}`}`
    const start = (timed(run.startedAt) ? run.startedAt : run.createdAt) ?? ''
    const ending = runEnding(run)
    const end = ending !== null && timed(run.updatedAt) ? run.updatedAt : null
    const key = `${name}\n${run.headSha ?? ''}`
    const earlier = run.headSha === undefined ? undefined : last.get(key)
    last.set(key, id)
    const attemptNote = earlier === undefined && (run.attempt ?? 1) > 1 ? `attempt ${run.attempt} on GitHub` : undefined
    const notes = [note, attemptNote].filter((text): text is string => text !== undefined)
    const work: WorkFact = {
      id,
      kind: 'ci',
      ticket,
      name,
      start,
      end,
      ...(end === null && timed(run.updatedAt) ? { lastSeenAt: run.updatedAt } : {}),
      ...(end !== null && ending !== null ? { outcome: ending.outcome, ...(ending.reason === undefined ? {} : { reason: ending.reason }) } : {}),
      ...(earlier === undefined ? {} : { retryOf: { kind: 'ci' as const, id: earlier } }),
      ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
      pr: pr.number,
      ...(run.headSha === undefined ? {} : { sha: run.headSha }),
      startSource: 'github',
      ...(end === null ? {} : { endSource: 'github' as const }),
    }
    return { work }
  })
}

/** The first line of a report of the cross-machine gate: `<checks_section> report: green|red`. */
const isReport = (body: string, gate: CrossMachineGate): boolean => body.startsWith(`${gate.checksSection} report: green`) || body.startsWith(`${gate.checksSection} report: red`)

/**
 * The Waits `other-machine` of a PR: it waits from its opening, or from a commit after the last report, to
 * the next report of the serving machine by the Project's account (none without an account). A commit
 * counts by its committed time, as rule 1 of the gate queue: a rebase by the author after a red report
 * makes the PR wait again; the serving machine's own rebase comes before its report. A PR that never
 * had the label nor a report did not wait; the label is removed at the merge, so a report also tells
 * that it waited. A labelled PR merged or closed without a report waited until then; an open one
 * without a report still waits (no end: the model cuts it off or stretches it to now).
 */
function waitsOf(ticket: string, pr: GithubPr, gate: CrossMachineGate, account: string | null): WaitFact[] {
  const reports = (pr.comments ?? [])
    .filter((comment) => typeof comment?.body === 'string' && isReport(comment.body, gate) && timed(comment.createdAt))
    .filter((comment) => account !== null && comment.author?.login === account)
    .map((comment) => comment.createdAt ?? '')
  if (!labelNames(pr).includes(gate.label) && reports.length === 0) return []
  if (!timed(pr.createdAt)) return []
  const commits = (pr.commits ?? []).map((commit) => commit?.committedDate).filter(timed)
  const steps = [...commits.map((when) => ({ when, report: false })), ...reports.map((when) => ({ when, report: true }))].sort((a, b) => at(a.when) - at(b.when) || Number(a.report) - Number(b.report))
  const waits: WaitFact[] = []
  let open: Iso | null = pr.createdAt
  const close = (end: Iso | null) => {
    if (open === null) return
    waits.push({ id: `other-machine:${pr.number}:${waits.length + 1}`, cause: 'other-machine', start: open, end, detail: gate.label, tickets: [ticket], startSource: 'github', ...(end === null ? {} : { endSource: 'github' as const }) })
    open = null
  }
  for (const step of steps) {
    if (step.report) close(step.when)
    // A commit after a report: the PR waits again from it; one before the opening waits from the opening.
    else if (open === null && at(step.when) > at(pr.createdAt)) open = step.when
  }
  const over = timed(pr.mergedAt) ? pr.mergedAt : timed(pr.closedAt) ? pr.closedAt : null
  close(over)
  return waits
}

/** The facts of a Run from gh's answer: the PRs of its Tickets' branches in its window. */
export function githubFacts(answer: GithubAnswer, input: GithubFactsInput): GithubFacts {
  const facts: GithubFacts = { ticketEvents: [], work: [], waits: [], lost: [] }
  for (const { ticket, pr } of prsOfRun(answer, input)) {
    const ci = ciFacts(ticket, pr)
    facts.ticketEvents.push(...headEvents(ticket, pr), ...ci.events, ...markEvents(ticket, pr, input.account), ...endEvents(ticket, pr))
    facts.work.push(...ci.work)
    const merged = (pr.mergeRuns ?? []).filter((run) => run && typeof run === 'object' && timed(run.startedAt ?? run.createdAt))
    facts.work.push(...runFacts(ticket, pr, merged, { base: pr.baseRefName ?? 'main' }).map((item) => item.work))
    if (input.crossMachineGate) facts.waits.push(...waitsOf(ticket, pr, input.crossMachineGate, input.account))
  }
  return facts
}
