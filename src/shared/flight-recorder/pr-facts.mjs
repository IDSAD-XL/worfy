// A PR as `gh` gives it read into facts: opening, the CI runs of its branch, CI on its head, the Gate verdicts in
// its comments, the merge marks on its head, the first commit, the merge and its labels. Shared by
// scripts/critical-path.mjs, which runs without a build and cannot import TypeScript, and by the app, which
// imports this file from TypeScript (types in pr-facts.d.mts). Plain JavaScript without Node modules: it reads gh's
// JSON and returns values; the caller runs gh.
import { time } from './journal-walk.mjs'

/** The fields scripts/critical-path.mjs asks `gh pr view` / `gh pr list --json` for. */
export const GH_FIELDS = 'number,headRefName,state,createdAt,mergedAt,statusCheckRollup,comments,commits,files'
/**
 * The fields the app asks for: those plus `labels` (the cross-machine gate's label of a PR) and `mergeCommit`
 * (the commit on the main branch whose CI runs stand for the PR's when CI runs in batch on main).
 */
export const GH_APP_FIELDS = `${GH_FIELDS},labels,mergeCommit`
/** The fields of `gh run list --json` for the CI runs of a PR's branch (the PR's `ciRuns`). */
export const GH_RUN_FIELDS = 'status,conclusion,event,createdAt,updatedAt'

/** Of several PRs for one Ticket: the merged one, else the newest. */
export function pick(prs) {
  const valid = prs.filter((pr) => pr && typeof pr === 'object' && Number.isInteger(pr.number))
  return valid.find((pr) => pr.state === 'MERGED' || pr.mergedAt) ?? valid.sort((a, b) => b.number - a.number)[0] ?? null
}

/** The moment CI went green, by the runs of the branch before the Gate, else by the PR's checks: { at } or { why }. */
export function ciMark(pr, gate) {
  const opened = time(pr.createdAt)
  if (Array.isArray(pr.ciRuns) && pr.ciRuns.length > 0) {
    // A manual run (workflow_dispatch) is not the PR's CI.
    const runs = pr.ciRuns.filter((run) => run && run.event !== 'workflow_dispatch')
    const greens = runs
      .filter((run) => run.status === 'completed' && ['success', 'skipped', 'neutral'].includes(run.conclusion))
      .map((run) => time(run.updatedAt))
      .filter((at) => at !== null && (opened === null || at >= opened))
      .sort((a, b) => a - b)
    if (greens.length > 0) {
      if (gate === null) return { at: greens[greens.length - 1] }
      const before = greens.filter((at) => at <= gate)
      return { at: before.length > 0 ? before[before.length - 1] : greens[0] }
    }
    if (runs.length > 0) return { why: 'CI not green (no successful run)' }
  }
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
  if (checks.length === 0) return { why: 'no CI checks on the PR' }
  let last = null
  for (const check of checks) {
    const name = check.name ?? check.context ?? 'check'
    if (check.__typename === 'StatusContext' || ('state' in check && !('conclusion' in check))) {
      if (check.state === 'PENDING' || check.state === 'EXPECTED') return { why: `CI not finished (${name})` }
      if (check.state !== 'SUCCESS') return { why: `CI not green (${name}: ${check.state})` }
    } else {
      if (check.status !== 'COMPLETED') return { why: `CI not finished (${name})` }
      if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion)) return { why: `CI not green (${name}: ${check.conclusion})` }
    }
    const at = time(check.completedAt) ?? time(check.startedAt)
    if (at !== null && (last === null || at > last)) last = at
  }
  return last === null ? { why: 'no time on the CI checks' } : { at: last }
}

/** A check run of the head (CI), not a commit status (a merge mark: `review`, `check/windows`). */
export const isCheckRun = (check) => Boolean(check) && typeof check === 'object' && check.__typename !== 'StatusContext' && !('state' in check && !('conclusion' in check))
const checkTime = (check) => time(check.completedAt) ?? time(check.startedAt)

/**
 * CI on the PR's head commit: the `ci-ok` check when the head has one (ADR-0083), else every check
 * run of the head. { at } — green, at null when the head has no CI; or { why }. Commit statuses
 * (`review`, `check/windows`) are the Orchestrator's merge marks, not CI.
 */
export function headCi(pr) {
  const runs = (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []).filter(isCheckRun)
  const oks = runs.filter((check) => check.name === 'ci-ok')
  if (oks.length > 0) {
    const ok = oks.reduce((a, b) => ((checkTime(b) ?? 0) >= (checkTime(a) ?? 0) ? b : a))
    if (ok.status !== 'COMPLETED') return { why: 'ci-ok not finished on the PR head' }
    if (ok.conclusion !== 'SUCCESS') return { why: `ci-ok not green on the PR head (${ok.conclusion})` }
    return time(ok.completedAt) === null ? { why: 'no time on ci-ok' } : { at: time(ok.completedAt) }
  }
  let last = null
  for (const check of runs) {
    const name = check.name ?? 'check'
    if (check.status !== 'COMPLETED') return { why: `CI not finished on the PR head (${name})` }
    if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion)) return { why: `CI not green on the PR head (${name}: ${check.conclusion})` }
    const at = time(check.completedAt)
    if (at !== null && (last === null || at > last)) last = at
  }
  if (runs.length > 0 && last === null) return { why: 'no time on the CI checks' }
  return { at: last }
}

/** The merge marks on the head — its commit statuses (`review`, `check/windows`) — with their state and time. */
export function headMarks(pr) {
  return (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [])
    .filter((check) => check && typeof check === 'object' && !isCheckRun(check))
    .map((check) => ({ name: check.context ?? check.name ?? 'status', state: check.state ?? null, at: time(check.startedAt) ?? time(check.createdAt) }))
}

const VERDICT = /^\s*(NARROW:\s*)?(VERIFIED|REJECTED)\b/
const NARROW = /^\s*NARROW:/

/** gh's `authorAssociation` of the people who may write in the repository: the Gate writes as one of them. */
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * Whether a comment may be the Gate's. `account` — the Project's GitHub account: only its comments; `null` — no
 * account, so no comment; absent — any comment but one gh marks as written by someone outside the repository (a
 * stranger on a public repository: `authorAssociation` other than OWNER, MEMBER or COLLABORATOR). A comment
 * without the field (an older answer, a file of --prs) counts.
 */
function byGate(comment, account) {
  // null matches no login: no account, no comment.
  if (account !== undefined) return comment.author?.login === account
  return typeof comment.authorAssociation !== 'string' || TRUSTED.has(comment.authorAssociation)
}

/**
 * The Gate's comments on the PR in order: a verdict (`VERIFIED`, `REJECTED`, either after `NARROW:`) and the
 * opening of a narrow fix round (`NARROW: …` without a verdict; one per Ticket, harness/skills/epic-wave/SKILL.md).
 * { at, verdict, narrow }: verdict null for an opening, at null for a comment without a time. Only the comments
 * `byGate` lets through count.
 */
export function verdictComments(pr, account) {
  const comments = (Array.isArray(pr.comments) ? pr.comments : []).filter((c) => typeof c?.body === 'string' && byGate(c, account))
  const found = []
  for (const comment of comments) {
    const verdict = VERDICT.exec(comment.body)
    if (verdict !== null) found.push({ at: time(comment.createdAt), verdict: verdict[2], narrow: verdict[1] !== undefined })
    else if (NARROW.test(comment.body)) found.push({ at: time(comment.createdAt), verdict: null, narrow: true })
  }
  return found
}

/**
 * The Gate verdicts summed up: the Gate is the last VERIFIED (a `NARROW: VERIFIED` too), a rework round is a
 * REJECTED outside a narrow round (`NARROW: REJECTED` is that round's verdict), and the narrow rounds are the
 * `NARROW: …` openings.
 */
export function verdicts(pr, account) {
  let gate = null
  let rejected = 0
  let narrow = 0
  let narrowVerdict = false
  for (const comment of verdictComments(pr, account)) {
    if (comment.verdict === 'VERIFIED') {
      if (comment.at !== null && (gate === null || comment.at > gate)) gate = comment.at
    } else if (comment.verdict === 'REJECTED' && !comment.narrow) rejected++
    if (comment.verdict !== null && comment.narrow) narrowVerdict = true
    else if (comment.verdict === null) narrow++
  }
  // A verdict of a narrow round whose opening comment is missing still means the round was held.
  return { gate, rejected, narrow: narrow === 0 && narrowVerdict ? 1 : narrow }
}

/** The first commit of the PR: the earliest authored time. */
export function firstCommit(pr) {
  const times = (Array.isArray(pr.commits) ? pr.commits : []).map((c) => time(c?.authoredDate) ?? time(c?.committedDate)).filter((t) => t !== null)
  return times.length > 0 ? Math.min(...times) : null
}

/** The names of the PR's labels (gh's `labels`: objects with a name). */
export function labelNames(pr) {
  return (Array.isArray(pr.labels) ? pr.labels : []).map((label) => label?.name).filter((name) => typeof name === 'string' && name !== '')
}

/** Every fact of one PR, times in ms; `account` as for verdictComments. */
export function prFacts(pr, account) {
  const gate = verdicts(pr, account).gate
  return {
    number: pr.number,
    branch: typeof pr.headRefName === 'string' ? pr.headRefName : null,
    state: typeof pr.state === 'string' ? pr.state : null,
    opened: time(pr.createdAt),
    merged: time(pr.mergedAt),
    mergeCommit: typeof pr.mergeCommit?.oid === 'string' ? pr.mergeCommit.oid : null,
    firstCommit: firstCommit(pr),
    ciRuns: (Array.isArray(pr.ciRuns) ? pr.ciRuns : [])
      .filter((run) => run && typeof run === 'object')
      .map((run) => ({ status: run.status ?? null, conclusion: run.conclusion ?? null, event: run.event ?? null, created: time(run.createdAt), updated: time(run.updatedAt) })),
    ci: ciMark(pr, gate),
    headCi: headCi(pr),
    headMarks: headMarks(pr),
    verdicts: verdictComments(pr, account),
    labels: labelNames(pr),
  }
}
