// GitHub for Work track (worfy-work-track ticket 06): the merged PRs and the CI runs of a Project over a
// period, read in batch, as the `pr` and `ci` facts of src/shared/work-track/facts.ts. Read-only gh, run as
// the Project's GitHub account through the PR tracker (`PrTracker.gh` of src/main/github/prs.ts), as the
// GitHub reader of Flight Recorder does; nothing is written to disk, to GitHub or to the Project.
//
// - Not three gh calls per Ticket branch (src/main/flight-recorder/github.ts) but a few per period: GitHub
//   search gives at most 1000 results a query, so the merged PRs are one GraphQL search per week of the
//   period (`merged:<from>..<to>`, 100 a page); the CI runs are one REST call per day
//   (`actions/runs?created=<from>..<to>`, 100 a page), the days not begun yet left out. Calls run one
//   after another, a week's search before its days' runs, so a month does not burst gh (search: 30 a minute).
// - A PR belongs to an Epic and a Ticket by its branch `<epic>/<NN>` (`tickets.branch` of the Profile); a
//   CI run by the PR it is of — the run's own PR, else the PR whose head or merge commit it ran on — else by
//   its own branch. Any other branch gives none: the screen shows «—» (spec, risk 3).
// - One read per Project and period per interval (GITHUB_READ_INTERVAL_MS); within it the answer kept in
//   memory is given again and gh is not run; `retry` reads at once.
// - gh fails (no network, no login, a rate limit, an answer that is not JSON): no more gh calls in this read,
//   and the part of the period not read yet is a gap «GitHub did not answer: <reason>»; the facts read before
//   the failure stay. That answer is kept for the interval too.
//
// shortcut: a week with more than 1000 merged PRs, or a day with more than 1000 runs, loses the rest (search
// and `actions/runs` stop there); split that chunk in halves when a repository merges that much.
import { z } from 'zod'
import type { Period, SourceGap, WorkFact } from '../../shared/work-track/facts'
import { periodBounds, periodDays } from '../../shared/work-track/lanes'
import { GITHUB_READ_INTERVAL_MS } from '../flight-recorder/github'
import type { GithubRepo } from '../github/deployments'

export { GITHUB_READ_INTERVAL_MS }

/** The days one search of merged PRs covers. */
export const SEARCH_DAYS = 7
/** The most GitHub gives a page, for the search and for `actions/runs`. */
export const PAGE_SIZE = 100
/** The label of a part of the period gh gave nothing for; the reason follows it. */
export const GITHUB_NO_ANSWER = 'GitHub did not answer'

/** The search of merged PRs: number, title, branch, opening and merge, the merge commit and the last commit. */
export const MERGED_PRS_QUERY = `query($q: String!, $after: String) {
  search(type: ISSUE, query: $q, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title headRefName createdAt mergedAt mergeCommit { oid } commits(last: 1) { nodes { commit { oid } } } } }
  }
}`

/** A read: the facts and the gaps of the period, the reason gh failed (null when it did not), when it ran. */
export interface WorkGithubRead {
  facts: WorkFact[]
  gaps: SourceGap[]
  error: string | null
  at: number
}

export interface WorkGithubReaderOptions {
  /** Runs a read-only gh command in the Project's root as its account (PrTracker.gh). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  now?: () => number
  intervalMs?: number
}

const searchSchema = z.object({
  data: z.object({
    search: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
      // A search of `is:pr` gives PRs only; a node of another type would come as `{}` and is dropped.
      nodes: z.array(z.object({}).loose().nullable()),
    }),
  }),
})

const prSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  headRefName: z.string(),
  createdAt: z.string(),
  mergedAt: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullish(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ oid: z.string() }) }).nullable()) }).nullish(),
})
type PrNode = z.infer<typeof prSchema>

const runSchema = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  head_branch: z.string().nullish(),
  head_sha: z.string().nullish(),
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  created_at: z.string(),
  run_started_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  pull_requests: z.array(z.object({ number: z.number().int() }).loose()).nullish(),
})
type RunNode = z.infer<typeof runSchema>

const runsSchema = z.object({ total_count: z.number().int(), workflow_runs: z.array(z.unknown()) })

/** A part of the period one gh question covers: [from, to). */
interface Chunk {
  kind: 'pr' | 'ci'
  from: number
  to: number
}

interface Entry {
  read: WorkGithubRead | null
  running: Promise<WorkGithubRead> | null
}

const NAME = /^[A-Za-z0-9._-]+$/u
const TICKET_BRANCH = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d{2,3})$/u
const GREEN = new Set(['success', 'skipped', 'neutral'])

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
/** A moment as GitHub's search and `created=` take it: to the second, in UTC. */
const githubTime = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/u, 'Z')
/** `<from>..<to>` of [from, to): GitHub includes both ends, so the end is the second before `to`. */
const range = ({ from, to }: Chunk): string => `${githubTime(from)}..${githubTime(to - 1000)}`

function parse(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`gh ${what} gave an answer that is not JSON`)
  }
}

/** The Epic and the Ticket of a Ticket branch `<epic>/<NN>`; nothing for any other branch. */
function ticketOf(branch: string | null | undefined): Pick<WorkFact, 'epic' | 'ticket'> {
  const match = TICKET_BRANCH.exec(branch ?? '')
  return match ? { epic: match[1]!, ticket: match[2]! } : {}
}

/** The weeks of the period, then each week's days; the days not begun at `now` are left out. */
function chunksOf(period: Period, now: number): Chunk[] {
  const { end } = periodBounds(period)
  const days = periodDays(period)
  const chunks: Chunk[] = []
  for (let week = 0; week < days.length; week += SEARCH_DAYS) {
    const weekDays = days.slice(week, week + SEARCH_DAYS).filter((day) => day <= now)
    if (weekDays.length === 0) break
    chunks.push({ kind: 'pr', from: days[week]!, to: days[week + SEARCH_DAYS] ?? end })
    for (const day of weekDays) {
      const next = days[days.indexOf(day) + 1] ?? end
      chunks.push({ kind: 'ci', from: day, to: next })
    }
  }
  return chunks
}

function prFact(pr: PrNode): WorkFact {
  return {
    id: `gh-pr:${pr.number}`,
    kind: 'pr',
    start: pr.createdAt,
    end: pr.mergedAt,
    outcome: 'ok',
    session: null,
    ...ticketOf(pr.headRefName),
    pr: pr.number,
    source: 'github',
    title: `#${pr.number} ${pr.title}`,
  }
}

function ciFact(run: RunNode, prs: ReadonlyMap<number, PrNode>, byCommit: ReadonlyMap<string, number>): WorkFact {
  const own = run.pull_requests?.[0]?.number
  const number = own ?? (run.head_sha ? byCommit.get(run.head_sha) : undefined)
  const pr = number === undefined ? undefined : prs.get(number)
  const done = run.status === 'completed'
  const conclusion = run.conclusion ?? ''
  return {
    id: `gh-run:${run.id}`,
    kind: 'ci',
    start: run.run_started_at ?? run.created_at,
    end: done ? (run.updated_at ?? run.run_started_at ?? run.created_at) : null,
    outcome: !done ? null : GREEN.has(conclusion) ? 'ok' : conclusion === 'cancelled' ? 'stopped' : 'failed',
    session: null,
    ...ticketOf(pr?.headRefName ?? run.head_branch),
    ...(number === undefined ? {} : { pr: number }),
    source: 'github',
    title: run.name || 'CI',
  }
}

/** Reads gh for the Work track of a Project, at most once per interval for each period. */
export class WorkGithubReader {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number
  private readonly interval: number

  constructor(private readonly options: WorkGithubReaderOptions) {
    this.now = options.now ?? Date.now
    this.interval = options.intervalMs ?? GITHUB_READ_INTERVAL_MS
  }

  /**
   * The merged PRs and the CI runs of `repo` over the period, gh run in the Project at `root`. Runs gh only
   * when the interval has passed since the last read of the same period, or with `retry`; one read at a time.
   */
  read(root: string, repo: GithubRepo, period: Period, options: { retry?: boolean } = {}): Promise<WorkGithubRead> {
    const key = `${root}\n${repo.owner}/${repo.name}\n${period.kind}\n${period.start}`
    const now = this.now()
    // Answers of other periods that are out of date go: the next read of them runs gh anyway.
    for (const [other, entry] of this.entries) {
      if (other !== key && entry.running === null && (entry.read === null || now - entry.read.at >= this.interval)) this.entries.delete(other)
    }
    const entry = this.entries.get(key) ?? { read: null, running: null }
    this.entries.set(key, entry)
    if (entry.running !== null) return entry.running
    if (entry.read !== null && !options.retry && now - entry.read.at < this.interval) return Promise.resolve(entry.read)
    entry.running = this.fetch(root, repo, period, now).then((read) => {
      entry.read = read
      entry.running = null
      return read
    })
    return entry.running
  }

  private async fetch(root: string, repo: GithubRepo, period: Period, at: number): Promise<WorkGithubRead> {
    const prs = new Map<number, PrNode>()
    const runs = new Map<number, RunNode>()
    const gaps: SourceGap[] = []
    let error: string | null = null
    const chunks = chunksOf(period, at)
    for (const [index, chunk] of chunks.entries()) {
      try {
        if (!NAME.test(repo.owner) || !NAME.test(repo.name)) throw new Error(`not a GitHub repository: ${repo.owner}/${repo.name}`)
        if (chunk.kind === 'pr') for (const pr of await this.mergedPrs(root, repo, chunk)) prs.set(pr.number, pr)
        else for (const run of await this.runs(root, repo, chunk)) runs.set(run.id, run)
      } catch (failure) {
        error = messageOf(failure)
        // The rest of the period is not read: from the first unread chunk to the end.
        const from = Math.min(...chunks.slice(index).map((unread) => unread.from))
        gaps.push({ source: 'github', start: new Date(from).toISOString(), end: new Date(periodBounds(period).end).toISOString(), why: `${GITHUB_NO_ANSWER}: ${error}` })
        break
      }
    }
    const byCommit = new Map<string, number>()
    for (const pr of prs.values()) {
      const head = pr.commits?.nodes.at(-1)?.commit.oid
      if (head) byCommit.set(head, pr.number)
      if (pr.mergeCommit?.oid) byCommit.set(pr.mergeCommit.oid, pr.number)
    }
    const facts = [...[...prs.values()].map(prFact), ...[...runs.values()].map((run) => ciFact(run, prs, byCommit))]
    return { facts, gaps, error, at }
  }

  /** The PRs merged in the chunk: one search, page after page. */
  private async mergedPrs(root: string, repo: GithubRepo, chunk: Chunk): Promise<PrNode[]> {
    const q = `repo:${repo.owner}/${repo.name} is:pr is:merged merged:${range(chunk)}`
    const found: PrNode[] = []
    let after: string | null = null
    do {
      const args = ['api', 'graphql', '-f', `query=${MERGED_PRS_QUERY}`, '-f', `q=${q}`, ...(after === null ? [] : ['-f', `after=${after}`])]
      const answer = searchSchema.safeParse(parse(await this.options.gh(root, args), 'search'))
      if (!answer.success) throw new Error('gh search gave no list of PRs')
      const { nodes, pageInfo } = answer.data.data.search
      for (const node of nodes) {
        const pr = prSchema.safeParse(node)
        if (pr.success) found.push(pr.data)
      }
      after = pageInfo.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null
    } while (after !== null)
    return found
  }

  /** The workflow runs created in the chunk: one call a page. */
  private async runs(root: string, repo: GithubRepo, chunk: Chunk): Promise<RunNode[]> {
    const found: RunNode[] = []
    for (let page = 1; ; page += 1) {
      const path = `repos/${repo.owner}/${repo.name}/actions/runs?created=${range(chunk)}&per_page=${PAGE_SIZE}&page=${page}`
      const answer = runsSchema.safeParse(parse(await this.options.gh(root, ['api', path]), 'actions/runs'))
      if (!answer.success) throw new Error('gh actions/runs gave no list of runs')
      for (const item of answer.data.workflow_runs) {
        const run = runSchema.safeParse(item)
        if (run.success) found.push(run.data)
      }
      if (answer.data.workflow_runs.length < PAGE_SIZE || page * PAGE_SIZE >= answer.data.total_count) return found
    }
  }
}
